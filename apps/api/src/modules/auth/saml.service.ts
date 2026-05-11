import { Injectable, Logger, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

export interface SamlConfig {
    enabled: boolean;
    idpEntityId: string;
    idpSsoUrl: string;
    idpSloUrl?: string;
    idpCertificate: string;
    spEntityId: string;
    emailDomains: string[];
    forceSso: boolean;
    defaultRole: string;
    attributeMapping: Record<string, string>;
}

const SAML_DOMAIN_CACHE_TTL = 300;

@Injectable()
export class SamlService {
    private readonly logger = new Logger(SamlService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly throttle: TenantThrottleService,
    ) {}

    async getSamlConfig(tenantId: string): Promise<SamlConfig | null> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = tenant?.settings as Record<string, any> | null;
        return settings?.saml || null;
    }

    async updateSamlConfig(tenantId: string, config: Partial<SamlConfig>): Promise<SamlConfig> {
        const ssoEnabled = await this.throttle.isFeatureEnabled(tenantId, 'sso');
        if (!ssoEnabled) {
            throw new ForbiddenException({
                error: 'plan_limit_reached',
                resource: 'sso',
                message: 'SSO requires Enterprise or Custom plan',
            });
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const currentSettings = (tenant.settings as Record<string, any>) || {};
        const currentSaml = currentSettings.saml || {};

        const merged: SamlConfig = {
            enabled: config.enabled ?? currentSaml.enabled ?? false,
            idpEntityId: config.idpEntityId ?? currentSaml.idpEntityId ?? '',
            idpSsoUrl: config.idpSsoUrl ?? currentSaml.idpSsoUrl ?? '',
            idpSloUrl: config.idpSloUrl ?? currentSaml.idpSloUrl,
            idpCertificate: config.idpCertificate ?? currentSaml.idpCertificate ?? '',
            spEntityId: config.spEntityId ?? currentSaml.spEntityId ?? `https://api.parallly-chat.cloud/api/v1/auth/saml/metadata/${tenantId}`,
            emailDomains: config.emailDomains ?? currentSaml.emailDomains ?? [],
            forceSso: config.forceSso ?? currentSaml.forceSso ?? false,
            defaultRole: config.defaultRole ?? currentSaml.defaultRole ?? 'tenant_agent',
            attributeMapping: config.attributeMapping ?? currentSaml.attributeMapping ?? {},
        };

        if (merged.enabled) {
            if (!merged.idpEntityId) throw new BadRequestException('IdP Entity ID is required');
            if (!merged.idpSsoUrl) throw new BadRequestException('IdP SSO URL is required');
            if (!merged.idpCertificate) throw new BadRequestException('IdP Certificate is required');
            if (!merged.emailDomains.length) throw new BadRequestException('At least one email domain is required');
        }

        merged.emailDomains = merged.emailDomains.map(d => d.toLowerCase().trim());

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings: { ...currentSettings, saml: { ...merged } } as any },
        });

        await this.redis.del('saml:domain_map');
        this.logger.log(`SAML config updated for tenant ${tenantId}: enabled=${merged.enabled}`);
        return merged;
    }

    async findTenantByEmailDomain(email: string): Promise<{ tenantId: string; config: SamlConfig } | null> {
        const domain = email.split('@')[1]?.toLowerCase();
        if (!domain) return null;

        const cacheKey = 'saml:domain_map';
        let domainMap = await this.redis.getJson(cacheKey) as Record<string, string> | null;

        if (!domainMap) {
            domainMap = await this.buildDomainMap();
            await this.redis.setJson(cacheKey, domainMap, SAML_DOMAIN_CACHE_TTL);
        }

        const tenantId = domainMap[domain];
        if (!tenantId) return null;

        const config = await this.getSamlConfig(tenantId);
        if (!config?.enabled) return null;

        return { tenantId, config };
    }

    private async buildDomainMap(): Promise<Record<string, string>> {
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, settings: true },
        });

        const map: Record<string, string> = {};
        for (const t of tenants) {
            const settings = t.settings as Record<string, any> | null;
            const saml = settings?.saml as SamlConfig | undefined;
            if (saml?.enabled && saml.emailDomains?.length) {
                for (const domain of saml.emailDomains) {
                    map[domain.toLowerCase()] = t.id;
                }
            }
        }
        return map;
    }

    async provisionOrLinkUser(
        tenantId: string,
        samlProfile: { email: string; firstName?: string; lastName?: string; nameId: string },
        config: SamlConfig,
    ) {
        const email = samlProfile.email.toLowerCase();

        let user = await this.prisma.user.findFirst({
            where: { email },
            include: { tenant: true },
        });

        if (user) {
            if (user.tenantId && user.tenantId !== tenantId) {
                throw new ForbiddenException('User belongs to a different tenant');
            }

            if (!user.tenantId) {
                user = await this.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        tenantId,
                        authProvider: 'saml',
                        emailVerified: true,
                    },
                    include: { tenant: true },
                });
            } else if (user.authProvider !== 'saml') {
                user = await this.prisma.user.update({
                    where: { id: user.id },
                    data: { authProvider: 'saml', emailVerified: true },
                    include: { tenant: true },
                });
            }

            return user;
        }

        const role = config.defaultRole || 'tenant_agent';
        const firstName = samlProfile.firstName
            || config.attributeMapping?.firstName
            || email.split('@')[0];
        const lastName = samlProfile.lastName || '';

        user = await this.prisma.user.create({
            data: {
                email,
                firstName,
                lastName,
                role,
                tenantId,
                authProvider: 'saml',
                emailVerified: true,
                onboardingCompleted: true,
            },
            include: { tenant: true },
        });

        this.logger.log(`JIT provisioned SAML user ${email} for tenant ${tenantId}`);
        return user;
    }

    async isSsoForced(tenantId: string): Promise<boolean> {
        const config = await this.getSamlConfig(tenantId);
        return config?.enabled === true && config.forceSso === true;
    }
}
