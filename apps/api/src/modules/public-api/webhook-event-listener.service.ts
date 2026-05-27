import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookSubscriptionService } from './webhook-subscription.service';

@Injectable()
export class WebhookEventListenerService {
    private readonly logger = new Logger(WebhookEventListenerService.name);

    constructor(
        private readonly webhookSubscription: WebhookSubscriptionService,
        private readonly prisma: PrismaService,
    ) {}

    @OnEvent('lead.captured')
    handleLeadCreated(event: {
        tenantId: string;
        leadId: string;
        contactId: string;
        conversationId: string;
        phone: string;
        name: string;
        channel?: string;
        source?: string;
    }) {
        this.dispatch(event.tenantId, 'lead.created', {
            leadId: event.leadId,
            contactId: event.contactId,
            conversationId: event.conversationId,
            phone: event.phone,
            name: event.name,
            channel: event.channel,
            source: event.source,
        });
    }

    @OnEvent('message.inbound')
    handleMessageReceived(event: {
        tenantId: string;
        conversationId: string;
        contactId?: string;
        phone?: string;
        channel?: string;
        messageType?: string;
        text?: string;
    }) {
        this.dispatch(event.tenantId, 'message.received', {
            conversationId: event.conversationId,
            contactId: event.contactId,
            phone: event.phone,
            channel: event.channel,
            messageType: event.messageType,
            text: event.text?.slice(0, 500),
        });
    }

    @OnEvent('conversation.archived')
    handleConversationClosed(event: {
        tenantId: string;
        conversationId: string;
    }) {
        this.dispatch(event.tenantId, 'conversation.closed', {
            conversationId: event.conversationId,
        });
    }

    @OnEvent('pipeline.stage_changed')
    handleDealStageChanged(event: {
        tenantId: string;
        dealId: string;
        leadId?: string;
        fromStage: string;
        toStage: string;
        value?: number;
    }) {
        this.dispatch(event.tenantId, 'deal.stage_changed', {
            dealId: event.dealId,
            leadId: event.leadId,
            fromStage: event.fromStage,
            toStage: event.toStage,
            value: event.value,
        });
    }

    @OnEvent('appointment.created')
    async handleAppointmentBooked(event: {
        schemaName: string;
        appointment: any;
    }) {
        const tenantId = await this.resolveTenantId(event.schemaName);
        if (!tenantId) return;

        this.dispatch(tenantId, 'appointment.booked', {
            appointmentId: event.appointment.id,
            contactId: event.appointment.contact_id || event.appointment.contactId,
            serviceName: event.appointment.service_name || event.appointment.serviceName,
            startAt: event.appointment.start_at || event.appointment.startAt,
            endAt: event.appointment.end_at || event.appointment.endAt,
            status: event.appointment.status,
        });
    }

    // ── Helpers ────────────────────────────────────────────────────────

    private dispatch(tenantId: string, event: string, payload: Record<string, any>): void {
        // Fire-and-forget — don't block the event handler
        this.webhookSubscription.dispatchEvent(tenantId, event, payload).catch((err) =>
            this.logger.error(
                `Zapier webhook dispatch failed: event=${event} tenant=${tenantId} error=${err.message}`,
            ),
        );
    }

    private async resolveTenantId(schemaName: string): Promise<string | null> {
        try {
            const tenant = await this.prisma.tenant.findFirst({
                where: { schemaName },
                select: { id: true },
            });
            return tenant?.id ?? null;
        } catch {
            return null;
        }
    }
}
