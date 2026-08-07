import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import {
    type PinnedHttpsTarget,
    prepareSafeHttpsTarget,
    safeAxiosOptions,
} from '../../common/utils/safe-outbound-url.util';

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

@Injectable()
export class SlackService {
    private readonly logger = new Logger(SlackService.name);

    constructor(private prisma: PrismaService) {}

    async getConfig(tenantId: string): Promise<SlackConfig> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = (tenant?.settings as Record<string, any>) || {};
        const cfg = settings.slack as SlackConfig | undefined;
        return {
            enabled: cfg?.enabled ?? false,
            webhookUrl: cfg?.webhookUrl ?? '',
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

        const currentSettings = (tenant.settings as Record<string, any>) || {};
        const current: SlackConfig = currentSettings.slack || DEFAULT_CONFIG;

        const merged: SlackConfig = {
            enabled: updates.enabled ?? current.enabled ?? false,
            webhookUrl: updates.webhookUrl ?? current.webhookUrl ?? '',
            events: {
                handoff: updates.events?.handoff ?? current.events?.handoff ?? true,
                appointment: updates.events?.appointment ?? current.events?.appointment ?? true,
            },
        };
        if (merged.webhookUrl) {
            merged.webhookUrl = (await this.prepareSlackTarget(merged.webhookUrl)).url.toString();
        } else if (merged.enabled) {
            throw new BadRequestException('Configure a valid Slack webhook URL first');
        }

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings: { ...currentSettings, slack: merged } as any },
        });
        return merged;
    }

    /** Post a message to the tenant's Slack webhook, gated by config + event flag. */
    async notify(tenantId: string, eventKey: keyof SlackConfig['events'], text: string): Promise<void> {
        try {
            const cfg = await this.getConfig(tenantId);
            if (!cfg.enabled || !cfg.webhookUrl) return;
            if (!cfg.events?.[eventKey]) return;
            await this.post(cfg.webhookUrl, text);
        } catch (err: any) {
            this.logger.warn(`Slack notify failed for tenant ${tenantId}: ${err.message}`);
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
}
