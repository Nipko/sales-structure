import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import type { OutboundMessage } from '@parallext/shared';

/**
 * Recall Service — daily cron that re-engages contacts whose last appointment
 * is older than the tenant-configured threshold (e.g. dental cleanings every
 * 6 months, gym membership lapse, aesthetic series follow-up).
 *
 * Per-tenant config lives at tenant.settings.recallConfig:
 *   {
 *     enabled: boolean,
 *     daysThreshold: number,   // e.g. 180 for semi-annual dental
 *     message: string,         // template body, supports {name} and {months}
 *     cooldownDays: number,    // backoff before re-prompting (default 90)
 *   }
 *
 * Marks contacts.next_recall_at = NOW() + cooldownDays after sending so
 * the same contact doesn't get hit every day until they reply.
 */
@Injectable()
export class RecallService {
    private readonly logger = new Logger(RecallService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly outboundQueue: OutboundQueueService,
        private readonly channelTokenService: ChannelTokenService,
    ) {}

    /** Daily at 9am — local server time. */
    @Cron('0 9 * * *')
    async processRecalls(): Promise<void> {
        this.logger.log('[Cron] Processing recall messages...');

        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name, settings FROM tenants WHERE is_active = true
            `;

            let totalSent = 0;
            for (const tenant of tenants || []) {
                const config = (tenant.settings as any)?.recallConfig;
                if (!config?.enabled) continue;

                const sent = await this.processForTenant(tenant.id, tenant.schema_name, config);
                totalSent += sent;
            }
            this.logger.log(`[Cron] Recall sweep complete: ${totalSent} messages sent`);
        } catch (e: any) {
            this.logger.error(`[Cron] Recall sweep failed: ${e.message}`);
        }
    }

    /** Public entry point so the dashboard can trigger a manual run for testing. */
    async processForTenant(
        tenantId: string,
        schemaName: string,
        config: { daysThreshold: number; message?: string; cooldownDays?: number; channelType?: string },
    ): Promise<number> {
        const daysThreshold = config.daysThreshold || 180;
        const cooldownDays = config.cooldownDays || 90;
        const channelType = config.channelType || 'whatsapp';

        // Find contacts whose last appointment is older than the threshold AND
        // either have never been recalled OR their cooldown has expired. We
        // also require a phone number — recall via WhatsApp is the only flow
        // we ship today.
        let dueContacts: any[];
        try {
            dueContacts = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, name, phone, last_appointment_at
                 FROM contacts
                 WHERE phone IS NOT NULL
                   AND last_appointment_at IS NOT NULL
                   AND last_appointment_at < NOW() - ($1::int * INTERVAL '1 day')
                   AND (next_recall_at IS NULL OR next_recall_at <= NOW())
                 LIMIT 100`,
                [daysThreshold],
            );
        } catch (e: any) {
            this.logger.warn(`Failed to query recall contacts for ${tenantId}: ${e.message}`);
            return 0;
        }

        if (!dueContacts?.length) return 0;
        this.logger.log(`Tenant ${tenantId}: ${dueContacts.length} contact(s) due for recall`);

        // Resolve channel credentials once per tenant rather than per contact.
        let creds: { accessToken: string; accountId: string } | null = null;
        try {
            creds = await this.resolveCredentials(tenantId, channelType);
        } catch (e: any) {
            this.logger.warn(`Tenant ${tenantId} has no ${channelType} credentials — skipping recall: ${e.message}`);
            return 0;
        }

        const message = config.message ||
            'Hola {name}, ya pasaron {months} meses desde tu última visita. ¿Quieres agendar tu cita de control?';

        let sent = 0;
        for (const c of dueContacts) {
            try {
                const monthsAgo = Math.round(
                    (Date.now() - new Date(c.last_appointment_at).getTime()) / (1000 * 60 * 60 * 24 * 30),
                );
                const text = message
                    .replace(/\{name\}/g, c.name?.split(' ')?.[0] || 'estimado/a')
                    .replace(/\{months\}/g, String(monthsAgo));

                const outbound: OutboundMessage = {
                    tenantId,
                    channelType: channelType as any,
                    channelAccountId: creds.accountId,
                    to: c.phone,
                    content: { type: 'text' as any, text },
                };

                await this.outboundQueue.enqueue(outbound, creds.accessToken);

                // Set next_recall_at so we don't keep hitting them daily.
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `UPDATE contacts SET next_recall_at = NOW() + ($1::int * INTERVAL '1 day') WHERE id = $2::uuid`,
                    [cooldownDays, c.id],
                );
                sent++;
            } catch (e: any) {
                this.logger.warn(`Recall failed for contact ${c.id}: ${e.message}`);
            }
        }

        return sent;
    }

    private async resolveCredentials(tenantId: string, channelType: string): Promise<{ accessToken: string; accountId: string }> {
        const creds = await this.channelTokenService.getChannelToken(tenantId, channelType);
        if (!creds?.accessToken || !creds?.accountId) throw new Error(`no active ${channelType} credentials`);
        return { accessToken: creds.accessToken, accountId: creds.accountId };
    }

    // ── Tenant config CRUD (used by the dashboard) ────────────────

    async getConfig(tenantId: string): Promise<any> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        return (tenant?.settings as any)?.recallConfig || {
            enabled: false,
            daysThreshold: 180,
            cooldownDays: 90,
            channelType: 'whatsapp',
            message: 'Hola {name}, ya pasaron {months} meses desde tu última visita. ¿Quieres agendar tu cita de control?',
        };
    }

    async setConfig(tenantId: string, config: any): Promise<any> {
        const existing = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = (existing?.settings as any) || {};
        settings.recallConfig = {
            enabled: !!config.enabled,
            daysThreshold: Math.max(1, parseInt(config.daysThreshold || 180, 10)),
            cooldownDays: Math.max(1, parseInt(config.cooldownDays || 90, 10)),
            channelType: config.channelType || 'whatsapp',
            message: config.message || '',
        };
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings },
        });
        return settings.recallConfig;
    }

    /** Manual trigger for "Send recall now" button in the dashboard. */
    async runNow(tenantId: string): Promise<{ sent: number }> {
        const config = await this.getConfig(tenantId);
        if (!config.enabled) return { sent: 0 };
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant?.schemaName) return { sent: 0 };
        const sent = await this.processForTenant(tenantId, tenant.schemaName, config);
        return { sent };
    }
}
