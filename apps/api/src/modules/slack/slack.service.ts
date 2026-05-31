import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

        const webhookUrl = updates.webhookUrl ?? '';
        if (updates.enabled && webhookUrl && !this.isValidSlackUrl(webhookUrl)) {
            throw new BadRequestException('Invalid Slack webhook URL (must start with https://hooks.slack.com/)');
        }

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
        if (!cfg.webhookUrl || !this.isValidSlackUrl(cfg.webhookUrl)) {
            throw new BadRequestException('Configure a valid Slack webhook URL first');
        }
        await this.post(cfg.webhookUrl, ':white_check_mark: Parallly conectado a Slack — las notificaciones funcionarán aquí.');
        return { ok: true };
    }

    private isValidSlackUrl(url: string): boolean {
        return /^https:\/\/hooks\.slack\.com\//.test(url);
    }

    private async post(webhookUrl: string, text: string): Promise<void> {
        // Node 18+ global fetch
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
    }
}
