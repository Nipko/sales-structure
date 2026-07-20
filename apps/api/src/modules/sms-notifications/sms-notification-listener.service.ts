import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { SmsSenderService } from './sms-sender.service';
import { SmsNotificationsService } from './sms-notifications.service';
import type { HandoffEscalatedEvent } from '../handoff/handoff.service';
import { smsHandoffText } from './sms-notification-i18n';

/**
 * Sends an SMS to the human agent (or tenant admins/supervisors) when the AI
 * escalates a conversation. Mirrors PushListenerService, but adds a plan gate
 * (`smsNotifications`) and a per-tenant opt-in, and sends via the tenant's own
 * Twilio number. WhatsApp/push/WebSocket/email already fire for the same event;
 * SMS is the reinforcement channel for agents away from the dashboard.
 *
 * Requires zero changes to HandoffService — it just listens to the existing
 * `handoff.escalated` event alongside the push/slack listeners.
 */
@Injectable()
export class SmsNotificationListenerService {
    private readonly logger = new Logger(SmsNotificationListenerService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
        private readonly sender: SmsSenderService,
        private readonly config: SmsNotificationsService,
    ) {}

    @OnEvent('handoff.escalated')
    async onHandoff(event: HandoffEscalatedEvent): Promise<void> {
        try {
            if (!event?.tenantId) return;

            // 1. Plan gate — transactional SMS is a paid feature.
            const allowed = await this.throttle.isFeatureEnabled(event.tenantId, 'smsNotifications');
            if (!allowed) return;

            // 2. Tenant opt-in.
            const cfg = await this.config.getConfig(event.tenantId);
            if (!cfg.enabled || !cfg.events.handoff) return;

            // 3. Recipient phone(s): the assigned agent, else tenant admins/supervisors.
            const phones = await this.resolvePhones(event.tenantId, event.assignedTo);
            if (!phones.length) return;

            // 4. Compose in the tenant's language.
            const lang = await this.getTenantLanguage(event.tenantId);
            const text = smsHandoffText(lang, event.contactName, event.reason);

            // 5. Best-effort send (SmsSenderService never throws).
            for (const phone of phones) {
                await this.sender.sendToNumber(event.tenantId, phone, text);
            }
        } catch (e: any) {
            this.logger.warn(`Handoff SMS notification failed: ${e.message}`);
        }
    }

    /** Assigned agent's phone, or all tenant admins'/supervisors' phones as fallback. */
    private async resolvePhones(tenantId: string, assignedTo: string | null): Promise<string[]> {
        if (assignedTo) {
            const agent = await this.prisma.user.findUnique({
                where: { id: assignedTo },
                select: { phone: true, isActive: true },
            });
            return agent?.isActive && agent.phone ? [agent.phone] : [];
        }
        const admins = await this.prisma.user.findMany({
            where: { tenantId, role: { in: ['tenant_admin', 'tenant_supervisor'] }, isActive: true },
            select: { phone: true },
        });
        return admins.map((a: { phone: string | null }) => a.phone).filter((p): p is string => !!p);
    }

    private async getTenantLanguage(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { language: true },
            });
            return (tenant?.language || 'es').slice(0, 2).toLowerCase();
        } catch {
            return 'es';
        }
    }
}
