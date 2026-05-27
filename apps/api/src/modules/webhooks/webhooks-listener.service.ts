import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhooksService, WebhookEventType } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WebhooksListenerService {
    private readonly logger = new Logger(WebhooksListenerService.name);

    constructor(
        private webhooks: WebhooksService,
        private prisma: PrismaService,
    ) {}

    @OnEvent('lead.captured')
    async onLeadCaptured(event: {
        tenantId: string;
        leadId: string;
        contactId: string;
        conversationId: string;
        phone: string;
        name: string;
        channel?: string;
        source?: string;
    }) {
        await this.emit(event.tenantId, 'lead.created', {
            leadId: event.leadId,
            contactId: event.contactId,
            conversationId: event.conversationId,
            phone: event.phone,
            name: event.name,
            channel: event.channel,
            source: event.source,
        });
    }

    @OnEvent('handoff.escalated')
    async onHandoffEscalated(event: {
        tenantId: string;
        conversationId: string;
        reason: string;
        summary: string;
        assignedTo: string | null;
        assignedAgentName?: string;
        contactName?: string;
        contactPhone?: string;
    }) {
        await this.emit(event.tenantId, 'handoff.created', {
            conversationId: event.conversationId,
            reason: event.reason,
            summary: event.summary,
            assignedTo: event.assignedTo,
            assignedAgentName: event.assignedAgentName,
            contactName: event.contactName,
            contactPhone: event.contactPhone,
        });
    }

    @OnEvent('appointment.created')
    async onAppointmentCreated(event: { schemaName: string; appointment: any }) {
        const tenantId = await this.resolveTenantId(event.schemaName);
        if (!tenantId) return;

        await this.emit(tenantId, 'appointment.booked', {
            appointmentId: event.appointment.id,
            contactId: event.appointment.contact_id || event.appointment.contactId,
            serviceName: event.appointment.service_name || event.appointment.serviceName,
            startAt: event.appointment.start_at || event.appointment.startAt,
            endAt: event.appointment.end_at || event.appointment.endAt,
            status: event.appointment.status,
        });
    }

    @OnEvent('message.inbound')
    async onMessageReceived(event: {
        tenantId: string;
        conversationId: string;
        contactId?: string;
        phone?: string;
        channel?: string;
        messageType?: string;
        text?: string;
    }) {
        await this.emit(event.tenantId, 'message.received', {
            conversationId: event.conversationId,
            contactId: event.contactId,
            phone: event.phone,
            channel: event.channel,
            messageType: event.messageType,
            text: event.text?.slice(0, 500),
        });
    }

    @OnEvent('campaign.completed')
    async onCampaignCompleted(event: {
        tenantId: string;
        campaignId: string;
        name: string;
        sentCount: number;
        failedCount: number;
    }) {
        await this.emit(event.tenantId, 'campaign.completed', {
            campaignId: event.campaignId,
            name: event.name,
            sentCount: event.sentCount,
            failedCount: event.failedCount,
        });
    }

    @OnEvent('handoff.completed')
    async onHandoffCompleted(event: { tenantId: string; conversationId: string }) {
        await this.emit(event.tenantId, 'handoff.resolved', {
            conversationId: event.conversationId,
        });
    }

    @OnEvent('appointment.cancelled')
    async onAppointmentCancelled(event: { schemaName: string; appointment: any; reason?: string }) {
        const tenantId = await this.resolveTenantId(event.schemaName);
        if (!tenantId) return;

        await this.emit(tenantId, 'appointment.cancelled', {
            appointmentId: event.appointment.id,
            contactId: event.appointment.contact_id || event.appointment.contactId,
            serviceName: event.appointment.service_name || event.appointment.serviceName,
            startAt: event.appointment.start_at || event.appointment.startAt,
            reason: event.reason,
        });
    }

    @OnEvent('conversation.archived')
    async onConversationClosed(event: { tenantId: string; conversationId: string }) {
        await this.emit(event.tenantId, 'conversation.closed', {
            conversationId: event.conversationId,
        });
    }

    @OnEvent('pipeline.stage_changed')
    async onDealStageChanged(event: {
        tenantId: string;
        dealId: string;
        leadId?: string;
        fromStage: string;
        toStage: string;
        value?: number;
    }) {
        await this.emit(event.tenantId, 'deal.stage_changed', {
            dealId: event.dealId,
            leadId: event.leadId,
            fromStage: event.fromStage,
            toStage: event.toStage,
            value: event.value,
        });
    }

    private async emit(tenantId: string, event: WebhookEventType, payload: Record<string, any>) {
        try {
            await this.webhooks.dispatch(tenantId, event, payload);
        } catch (err: any) {
            this.logger.error(`Webhook dispatch failed: event=${event} tenant=${tenantId} error=${err.message}`);
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
