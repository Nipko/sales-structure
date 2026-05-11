import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

export interface WhiteLabelConfig {
    enabled: boolean;
    brandName: string;
    logoUrl?: string;
    faviconUrl?: string;
    primaryColor: string;
    accentColor: string;
    customDomain?: string;
    customCss?: string;
    footerText?: string;
    hidePoweredBy: boolean;
    customEmailFromName?: string;
    customEmailFromDomain?: string;
    kbHeaderHtml?: string;
    bookingHeaderHtml?: string;
}

const CACHE_TTL = 600;

@Injectable()
export class WhiteLabelService {
    private readonly logger = new Logger(WhiteLabelService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly throttle: TenantThrottleService,
    ) {}

    async getConfig(tenantId: string): Promise<WhiteLabelConfig | null> {
        const cacheKey = `whitelabel:${tenantId}`;
        const cached = await this.redis.getJson(cacheKey);
        if (cached) return cached as WhiteLabelConfig;

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = tenant?.settings as Record<string, any> | null;
        const config = settings?.whiteLabel || null;

        if (config) {
            await this.redis.setJson(cacheKey, config, CACHE_TTL);
        }
        return config;
    }

    async updateConfig(tenantId: string, updates: Partial<WhiteLabelConfig>): Promise<WhiteLabelConfig> {
        const whitelabelEnabled = await this.throttle.isFeatureEnabled(tenantId, 'whiteLabel');
        if (!whitelabelEnabled) {
            throw new ForbiddenException({
                error: 'plan_limit_reached',
                resource: 'whiteLabel',
                message: 'White-label requires Custom plan',
            });
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const currentSettings = (tenant.settings as Record<string, any>) || {};
        const current = currentSettings.whiteLabel || {};

        const merged: WhiteLabelConfig = {
            enabled: updates.enabled ?? current.enabled ?? false,
            brandName: updates.brandName ?? current.brandName ?? '',
            logoUrl: updates.logoUrl ?? current.logoUrl,
            faviconUrl: updates.faviconUrl ?? current.faviconUrl,
            primaryColor: updates.primaryColor ?? current.primaryColor ?? '#6c5ce7',
            accentColor: updates.accentColor ?? current.accentColor ?? '#2ecc71',
            customDomain: updates.customDomain ?? current.customDomain,
            customCss: updates.customCss ?? current.customCss,
            footerText: updates.footerText ?? current.footerText,
            hidePoweredBy: updates.hidePoweredBy ?? current.hidePoweredBy ?? false,
            customEmailFromName: updates.customEmailFromName ?? current.customEmailFromName,
            customEmailFromDomain: updates.customEmailFromDomain ?? current.customEmailFromDomain,
            kbHeaderHtml: updates.kbHeaderHtml ?? current.kbHeaderHtml,
            bookingHeaderHtml: updates.bookingHeaderHtml ?? current.bookingHeaderHtml,
        };

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings: { ...currentSettings, whiteLabel: { ...merged } } as any },
        });

        await this.redis.del(`whitelabel:${tenantId}`);
        this.logger.log(`White-label config updated for tenant ${tenantId}`);
        return merged;
    }

    async getConfigBySlug(slug: string): Promise<{ tenantId: string; config: WhiteLabelConfig | null }> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { slug },
            select: { id: true, settings: true, name: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const settings = tenant.settings as Record<string, any> | null;
        const config = settings?.whiteLabel as WhiteLabelConfig | null;
        return { tenantId: tenant.id, config };
    }

    async getConfigByDomain(domain: string): Promise<{ tenantId: string; config: WhiteLabelConfig } | null> {
        const cacheKey = `whitelabel:domain:${domain}`;
        const cached = await this.redis.getJson(cacheKey);
        if (cached) return cached as { tenantId: string; config: WhiteLabelConfig };

        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, settings: true },
        });

        for (const t of tenants) {
            const settings = t.settings as Record<string, any> | null;
            const wl = settings?.whiteLabel as WhiteLabelConfig | undefined;
            if (wl?.enabled && wl.customDomain === domain) {
                const result = { tenantId: t.id, config: wl };
                await this.redis.setJson(cacheKey, result, CACHE_TTL);
                return result;
            }
        }
        return null;
    }
}
