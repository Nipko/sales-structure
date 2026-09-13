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
    async handleLeadCreated(event: {
        tenantId: string;
        leadId: string;
        contactId: string;
        conversationId: string;
        phone: string;
        name: string;
        channel?: string;
        source?: string;
    }) {
        await this.dispatch(event.tenantId, 'lead.created', {
            leadId: event.leadId,
            contactId: event.contactId,
            conversationId: event.conversationId,
            phone: event.phone,
            name: event.name,
            channel: event.channel,
            source: event.source,
        }, `lead.created:${event.leadId}`);
    }

    @OnEvent('message.inbound')
    async handleMessageReceived(event: {
        tenantId: string;
        conversationId: string;
        messageId: string;
        contactId?: string;
        phone?: string;
        channel?: string;
        messageType?: string;
        text?: string;
    }) {
        await this.dispatch(event.tenantId, 'message.received', {
            conversationId: event.conversationId,
            contactId: event.contactId,
            phone: event.phone,
            channel: event.channel,
            messageType: event.messageType,
            text: event.text?.slice(0, 500),
        }, `message.received:${event.messageId}`);
    }

    @OnEvent('conversation.archived')
    async handleConversationClosed(event: {
        tenantId: string;
        conversationId: string;
    }) {
        await this.dispatch(event.tenantId, 'conversation.closed', {
            conversationId: event.conversationId,
        }, `conversation.closed:${event.conversationId}`);
    }

    @OnEvent('pipeline.stage_changed')
    async handleDealStageChanged(event: {
        tenantId: string;
        dealId: string;
        leadId?: string;
        fromStage: string;
        toStage: string;
        value?: number;
    }) {
        await this.dispatch(event.tenantId, 'deal.stage_changed', {
            dealId: event.dealId,
            leadId: event.leadId,
            fromStage: event.fromStage,
            toStage: event.toStage,
            value: event.value,
        }, `deal.stage_changed:${event.dealId}:${event.toStage}`);
    }

    @OnEvent('appointment.created')
    async handleAppointmentBooked(event: {
        schemaName: string;
        appointment: any;
    }) {
        const tenantId = await this.resolveTenantId(event.schemaName);
        if (!tenantId) return;

        await this.dispatch(tenantId, 'appointment.booked', {
            appointmentId: event.appointment.id,
            contactId: event.appointment.contact_id || event.appointment.contactId,
            serviceName: event.appointment.service_name || event.appointment.serviceName,
            startAt: event.appointment.start_at || event.appointment.startAt,
            endAt: event.appointment.end_at || event.appointment.endAt,
            status: event.appointment.status,
        }, `appointment.booked:${event.appointment.id}`);
    }

    // ── Helpers ────────────────────────────────────────────────────────

    private async dispatch(
        tenantId: string,
        event: string,
        payload: Record<string, any>,
        eventKey?: string,
    ): Promise<void> {
        try {
            await this.webhookSubscription.dispatchEvent(tenantId, event, payload, eventKey);
        } catch (err: any) {
            this.logger.error(
                `Zapier webhook dispatch failed: event=${event} tenant=${tenantId} error=${err.message}`,
            );
            throw err;
        }
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
