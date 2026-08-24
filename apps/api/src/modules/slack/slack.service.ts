import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import {
    type PinnedHttpsTarget,
    prepareSafeHttpsTarget,
    safeAxiosOptions,
} from '../../common/utils/safe-outbound-url.util';
import { mutateTenantSettingsBranchAtomic } from '../../common/utils/tenant-settings-branch.util';
import {
    isMaskedSecret,
    TENANT_SECRET_MASK,
    TenantSecretCryptoService,
} from '../../common/crypto/tenant-secret-crypto.service';

export interface SlackConfig {
    enabled: boolean;
    webhookUrl?: string;
    events: {
        handoff: boolean;
        appointment: boolean;
    };
}

const DEFAULT_CONFIG: SlackConfig = {
    enabled: false,
    webhookUrl: '',
    events: { handoff: true, appointment: true },
};

export const SLACK_SECRET_FIELDS = ['webhookUrl'] as const;
export const SLACK_SECRET_FIELD_IDS: Record<typeof SLACK_SECRET_FIELDS[number], string> = {
    webhookUrl: 'webhook_url',
};

@Injectable()
export class SlackService {
    private readonly logger = new Logger(SlackService.name);

    constructor(
        private prisma: PrismaService,
        private readonly secrets: TenantSecretCryptoService,
    ) {}

    async getConfig(tenantId: string): Promise<SlackConfig> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = (tenant?.settings as Record<string, any>) || {};
        const stored = settings.slack as SlackConfig | undefined;
        const cfg = stored ? await this.decryptConfig(tenantId, stored) : undefined;
        return {
            enabled: cfg?.enabled ?? false,
            webhookUrl: cfg?.webhookUrl ?? '',
            events: {
                handoff: cfg?.events?.handoff ?? true,
                appointment: cfg?.events?.appointment ?? true,
            },
        };
    }

    async getRedactedConfig(tenantId: string): Promise<SlackConfig> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = (tenant?.settings as Record<string, any>) || {};
        const cfg = settings.slack as SlackConfig | undefined;
        return {
            enabled: cfg?.enabled ?? false,
            webhookUrl: cfg?.webhookUrl ? TENANT_SECRET_MASK : '',
            events: {
                handoff: cfg?.events?.handoff ?? true,
                appointment: cfg?.events?.appointment ?? true,
            },
        };
    }

    async updateConfig(tenantId: string, updates: Partial<SlackConfig>): Promise<SlackConfig> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new BadRequestException('Tenant not found');

        const hasNewWebhook = updates.webhookUrl !== undefined && !isMaskedSecret(updates.webhookUrl);
        const validatedWebhook = hasNewWebhook && updates.webhookUrl
            ? (await this.prepareSlackTarget(updates.webhookUrl)).url.toString()
            : hasNewWebhook ? '' : undefined;
        const merged = await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'slack',
            (value): SlackConfig => {
                const live = (value && typeof value === 'object' ? value : DEFAULT_CONFIG) as SlackConfig;
                let webhookUrl = hasNewWebhook
                    ? validatedWebhook ?? ''
                    : live.webhookUrl ?? '';
                if (webhookUrl) {
                    const context = this.secretContext(tenantId);
                    if (hasNewWebhook) {
                        webhookUrl = this.secrets.encrypt(webhookUrl, context);
                    } else {
                        // A masked/omitted webhook preserves stored material,
                        // but cannot bypass the plaintext migration cut.
                        const result = this.secrets.readCompatible(webhookUrl, context);
                        webhookUrl = result.needsRewrap
                            ? this.secrets.encrypt(result.plaintext, context)
                            : webhookUrl;
                    }
                }
                const enabled = updates.enabled ?? live.enabled ?? false;
                if (enabled && !webhookUrl) {
                    throw new BadRequestException('Configure a valid Slack webhook URL first');
                }
                return {
                    enabled,
                    webhookUrl,
                    events: {
                        handoff: updates.events?.handoff ?? live.events?.handoff ?? true,
                        appointment: updates.events?.appointment ?? live.events?.appointment ?? true,
                    },
                };
            },
        );
        return {
            ...merged,
            webhookUrl: merged.webhookUrl ? TENANT_SECRET_MASK : '',
        };
    }

    /** Post a message to the tenant's Slack webhook, gated by config + event flag. */
    async notify(tenantId: string, eventKey: keyof SlackConfig['events'], text: string): Promise<void> {
        try {
            const cfg = await this.getConfig(tenantId);
            if (!cfg.enabled || !cfg.webhookUrl) return;
            if (!cfg.events?.[eventKey]) return;
            await this.post(cfg.webhookUrl, text);
        } catch (err: any) {
            this.logger.warn(`Slack notify failed for tenant ${tenantId}: ${err?.code || err?.name || 'error'}`);
        }
    }

    async sendTest(tenantId: string): Promise<{ ok: boolean }> {
        const cfg = await this.getConfig(tenantId);
        if (!cfg.webhookUrl) {
            throw new BadRequestException('Configure a valid Slack webhook URL first');
        }
        await this.post(cfg.webhookUrl, ':white_check_mark: Parallly conectado a Slack — las notificaciones funcionarán aquí.');
        return { ok: true };
    }

    private async prepareSlackTarget(url: string): Promise<PinnedHttpsTarget> {
        const target = await prepareSafeHttpsTarget(url, 'webhook de Slack');
        if (target.hostname !== 'hooks.slack.com' || !target.url.pathname.startsWith('/services/')) {
            throw new BadRequestException('Invalid Slack webhook URL (must use https://hooks.slack.com/services/)');
        }
        return target;
    }

    private async post(webhookUrl: string, text: string): Promise<void> {
        const target = await this.prepareSlackTarget(webhookUrl);
        await axios.post(target.url.toString(), { text }, {
            ...safeAxiosOptions(target, 10_000),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    private secretContext(tenantId: string) {
        return {
            tenantId,
            scope: 'slack' as const,
            provider: 'slack',
            field: SLACK_SECRET_FIELD_IDS.webhookUrl,
        };
    }

    private async decryptConfig(tenantId: string, stored: SlackConfig): Promise<SlackConfig> {
        if (!stored.webhookUrl) return { ...stored };
        try {
            const context = this.secretContext(tenantId);
            const result = this.secrets.readCompatible(stored.webhookUrl, context);
            if (result.needsRewrap) {
                try {
                    const envelope = this.secrets.encrypt(result.plaintext, context);
                    await this.persistRewrappedWebhook(tenantId, stored.webhookUrl, envelope);
                } catch (error: any) {
                    this.logger.warn(`[SLACK] no se pudo re-cifrar el webhook: ${error?.code || error?.message}`);
                }
            }
            return { ...stored, webhookUrl: result.plaintext };
        } catch (error: any) {
            // An unreadable configured URL must not be sent as an HTTP target.
            this.logger.warn(`[SLACK] webhook ilegible: ${error?.code || error?.message}`);
            return { ...stored, webhookUrl: '' };
        }
    }

    private async persistRewrappedWebhook(
        tenantId: string,
        expected: string,
        envelope: string,
    ): Promise<void> {
        await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'slack',
            (value) => {
                const current = value && typeof value === 'object' ? value as SlackConfig : undefined;
                return current?.webhookUrl === expected
                    ? { ...current, webhookUrl: envelope }
                    : current ?? DEFAULT_CONFIG;
            },
        );
    }
}
