import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';
import { pushI18n } from './push-i18n';
import { enqueueOperationalPushNotices, ensureOperationalNoticeOutbox } from '../operational-notices/operational-notice-outbox';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function effectUuid(value: string): string {
    if (UUID.test(value)) return value;
    const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
    hex[12] = '4'; hex[16] = '8';
    return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

@Injectable()
export class PushListenerService {
    private readonly logger = new Logger(PushListenerService.name);

    constructor(
        private readonly pushService: PushService,
        private readonly prisma: PrismaService,
        @Optional() @InjectQueue('outbound-messages') private readonly queue?: Queue<any>,
    ) {}

    /**
     * Los eventos de las verticales viajan con el NOMBRE DEL SCHEMA (es lo unico
     * que tiene a mano el executor de herramientas), no con el tenantId. Push
     * necesita el id para resolver destinatarios.
     */
    private async resolveTenantId(schemaName?: string): Promise<string | undefined> {
        if (!schemaName) return undefined;
        try {
            const tenant = await this.prisma.tenant.findFirst({
                where: { schemaName },
                select: { id: true },
            });
            return tenant?.id || undefined;
        } catch (err: any) {
            this.logger.warn(`Failed to resolve tenantId from schema ${schemaName}: ${err.message}`);
            return undefined;
        }
    }

    private async enqueuePush(tenantId: string, schema: string, input: {
        eventType: string; entityId: string; eventKey: string; contactId?: string | null;
        conversationId?: string | null; recipientUserId?: string | null;
        roles?: Array<'tenant_admin' | 'tenant_supervisor'>;
        payload: { title: string; body: string; url: string; tag: string };
    }): Promise<void> {
        await ensureOperationalNoticeOutbox(this.prisma, schema);
        const ids = await this.prisma.transactionInTenantSchema(schema, query => enqueueOperationalPushNotices(query, schema, {
            entityId: effectUuid(input.entityId), eventKey: input.eventKey, contactId: input.contactId,
            conversationId: input.conversationId, recipientUserId: input.recipientUserId, roles: input.roles,
            payload: { ...input.payload, eventType: input.eventType },
        }));
        for (const noticeId of ids) {
            try {
                if (!this.queue) throw new Error('operational_notice_queue_unavailable');
                await this.queue.add('operational-notice', { operationalNotice: { tenantId, noticeId } }, {
                    jobId: `operational-notice-${tenantId}-${noticeId}`, attempts: 3,
                    backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 86400 }, removeOnFail: { age: 86400 },
                });
            } catch (error: any) {
                this.logger.warn(`Durable push ${noticeId} remains pending: ${error.message}`);
            }
        }
    }

    /** Push al dueño y a los supervisores: nadie tiene asignado un pedido todavia. */
    private async notifyOwners(tenantId: string, schema: string, input: {
        eventType: string; entityId: string; eventKey: string; contactId?: string | null;
        conversationId?: string | null; payload: { title: string; body: string; url: string; tag: string };
    }) {
        await this.enqueuePush(tenantId, schema, { ...input, roles: ['tenant_admin', 'tenant_supervisor'] });
    }

    /** Resolve tenant language (2-char, fallback 'es'). */
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

    // One destination, one event. A transfer used to announce itself once to
    // all six consumers, so a single failure among them re-announced it to
    // the five that had already succeeded.
    @OnEvent('handoff.escalated.push')
    async onHandoff(event: {
        tenantId: string;
        conversationId: string;
        reason: string;
        assignedTo?: string;
        assignedAgentName?: string;
        contactName?: string;
    }) {
        const lang = await this.getTenantLanguage(event.tenantId);
        const t = pushI18n(lang);

        const payload = {
            title: t.handoffTitle,
            body: t.handoffBody(event.contactName || t.contactFallback, event.reason),
            url: '/admin/inbox',
            tag: `handoff-${event.conversationId}`,
        };

        if (event.assignedTo) {
            const sent=await this.pushService.sendToUser(event.assignedTo,payload,'handoff');
            return `push:${sent}`;
        } else {
            const [admins,supervisors]=await Promise.all([
                this.pushService.sendToTenantRole(event.tenantId,'tenant_admin',payload,'handoff'),
                this.pushService.sendToTenantRole(event.tenantId,'tenant_supervisor',payload,'handoff'),
            ]);
            return `push:${admins+supervisors}`;
        }
    }

    @OnEvent('message.inbound')
    async onInboundMessage(event: {
        tenantId: string;
        conversationId: string;
        messageId?: string;
        contactId?: string;
        channel?: string;
        messageType?: string;
        text?: string;
    }) {
        if (!event?.tenantId || !event?.conversationId) return;
        try {
            const schemaName = await this.prisma.getTenantSchemaName(event.tenantId);
            if (!schemaName) return;

            // Only push when a human agent owns the conversation — otherwise the AI
            // is handling it and the agent shouldn't be pinged for every message.
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT assigned_to,contact_id FROM conversations WHERE id = $1::uuid`,
                [event.conversationId],
            );
            const assignedTo = rows?.[0]?.assigned_to;
            if (!assignedTo) return;

            const lang = await this.getTenantLanguage(event.tenantId);
            const t = pushI18n(lang);

            const preview = (event.text || '').trim().slice(0, 120) || t.newMessageFallback;
            await this.enqueuePush(event.tenantId, schemaName, {
                eventType: 'message.inbound', entityId: event.conversationId,
                eventKey: `push:message.inbound:${event.messageId || effectUuid(`${event.conversationId}:${event.text || ''}`)}`,
                contactId: rows[0]?.contact_id || event.contactId || null, conversationId: event.conversationId,
                recipientUserId: assignedTo, payload: { title: t.newMessageTitle, body: preview,
                    url: '/admin/inbox', tag: `msg-${event.conversationId}` },
            });
        } catch (err: any) {
            this.logger.warn(`Inbound-message push failed: ${err.message}`);
        }
    }

    @OnEvent('handoff.escalated_supervisor')
    async onSupervisorEscalation(event: {
        tenantId: string;
        conversationId: string;
        contactId?: string;
        contactName?: string;
    }) {
        const lang = await this.getTenantLanguage(event.tenantId);
        const t = pushI18n(lang);

        const schema = await this.prisma.getTenantSchemaName(event.tenantId);
        await this.enqueuePush(event.tenantId, schema, {
            eventType: 'handoff.escalated_supervisor', entityId: event.conversationId,
            eventKey: `push:handoff.sla:${event.conversationId}`, contactId: event.contactId || null,
            conversationId: event.conversationId, roles: ['tenant_supervisor'],
            payload: { title: t.slaEscalationTitle,
                body: t.slaEscalationBody(event.contactName || t.conversationFallback),
                url: '/admin/inbox', tag: `sla-${event.conversationId}` },
        });
    }

    @OnEvent('appointment.created')
    async onAppointment(event: {
        tenantId?: string;
        schemaName?: string;
        customerName?: string;
        serviceName?: string;
        appointment?: any;
    }) {
        let tenantId = event.tenantId;

        // If tenantId is not in the event but schemaName is, resolve it via database
        if (!tenantId && event.schemaName) {
            try {
                const tenant = await this.prisma.tenant.findFirst({
                    where: { schemaName: event.schemaName },
                    select: { id: true },
                });
                tenantId = tenant?.id || undefined;
            } catch (err: any) {
                this.logger.warn(`Failed to resolve tenantId for Push Notification: ${err.message}`);
            }
        }

        if (!tenantId) return;

        const lang = await this.getTenantLanguage(tenantId);
        const t = pushI18n(lang);

        // Read customer and service names supporting both direct parameters and nested appointment object
        const customerName = event.customerName || event.appointment?.customerName || event.appointment?.customer_name || event.appointment?.contactName || event.appointment?.contact_name || t.contactFallback;
        const serviceName = event.serviceName || event.appointment?.serviceName || event.appointment?.service_name || t.serviceFallback;

        const schema = event.schemaName || await this.prisma.getTenantSchemaName(tenantId);
        const appointmentId = String(event.appointment?.id || '');
        if (!appointmentId) return;
        await this.enqueuePush(tenantId, schema, {
            eventType: 'appointment.created', entityId: appointmentId,
            eventKey: `push:appointment.created:${appointmentId}`,
            contactId: event.appointment?.contactId || event.appointment?.contact_id || null,
            conversationId: event.appointment?.conversationId || event.appointment?.conversation_id || null,
            roles: ['tenant_admin'], payload: { title: t.newAppointmentTitle,
                body: `${customerName} — ${serviceName}`, url: '/admin/appointments', tag: 'appointment-new' },
        });
    }

    /**
     * Pedido de restaurante cerrado por el agente en el chat.
     *
     * Hasta ahora este evento no lo escuchaba NADIE: el bot tomaba el pedido, lo
     * escribia en food_orders y el dueño solo se enteraba si tenia el tablero
     * abierto (refresca cada 15s). Un pedido de comida es lo mas urgente que
     * produce la plataforma — 20 minutos sin verlo es el pedido perdido.
     *
     * Cada pedido lleva su propio `tag` a proposito: dos pedidos simultaneos no
     * deben colapsar en una sola notificacion como si fueran actualizaciones del
     * mismo hecho.
     */
    @OnEvent('food_order.created')
    async onFoodOrder(event: {
        orderId: string;
        tenantSchemaName?: string;
        schemaName?: string;
        customerName?: string;
        contactId?: string;
        orderType?: string;
        total?: number;
        currency?: string;
        tableNumber?: string;
    }) {
        const tenantId = await this.resolveTenantId(event.schemaName || event.tenantSchemaName);
        if (!tenantId) return;

        const lang = await this.getTenantLanguage(tenantId);
        const t = pushI18n(lang);

        const typeLabel = event.orderType === 'pickup' ? t.orderTypePickup
            : event.orderType === 'dine_in' ? `${t.orderTypeDineIn}${event.tableNumber ? ` ${event.tableNumber}` : ''}`
                : t.orderTypeDelivery;
        const total = `${Number(event.total || 0).toLocaleString()} ${event.currency || ''}`.trim();

        const schema = event.schemaName || event.tenantSchemaName!;
        await this.notifyOwners(tenantId, schema, {
            eventType: 'food_order.created', entityId: event.orderId,
            eventKey: `push:food_order.created:${event.orderId}`, contactId: event.contactId || null,
            payload: { title: t.newOrderTitle,
                body: t.newOrderBody(event.customerName || t.contactFallback, typeLabel, total),
                url: '/admin/food-orders', tag: `food-order-${event.orderId}` },
        });
    }

    /**
     * Pedido de cotización de una sesión de fotos.
     *
     * `photo_session.requested` tenía un solo emisor y CERO oyentes: el
     * fotógrafo no se enteraba de una cotización nueva salvo que abriera la
     * página. En un rubro donde el estudio es una o dos personas que están
     * fotografiando —no mirando un panel— eso es la cotización perdida, y el
     * mensaje que el bot le manda al cliente ("el equipo te envía una propuesta
     * en las próximas horas") queda dependiendo de que alguien mire.
     */
    @OnEvent('photo_session.requested')
    async onPhotoSessionRequested(event: {
        sessionId?: string;
        tenantSchemaName?: string;
        schemaName?: string;
        customerName?: string;
        contactId?: string;
        conversationId?: string;
        packageName?: string;
        sessionType?: string;
        date?: string;
    }) {
        const tenantId = await this.resolveTenantId(event.schemaName || event.tenantSchemaName);
        if (!tenantId) return;

        const lang = await this.getTenantLanguage(tenantId);
        const t = pushI18n(lang);

        const what = event.packageName || event.sessionType || '';
        const when = event.date ? ` · ${event.date}` : '';
        if (!event.sessionId) return;
        const schema = event.schemaName || event.tenantSchemaName!;
        await this.notifyOwners(tenantId, schema, {
            eventType: 'photo_session.requested', entityId: event.sessionId,
            eventKey: `push:photo_session.requested:${event.sessionId}`, contactId: event.contactId || null,
            conversationId: event.conversationId || null,
            payload: { title: t.newPhotoRequestTitle,
                body: `${event.customerName || t.contactFallback}${what ? ` · ${what}` : ''}${when}`,
                url: '/admin/photo-sessions', tag: `photo-session-${event.sessionId}` },
        });
    }

    /**
     * Cancelacion desde el chat. Importa tanto como el alta: la cocina puede
     * estar preparando el plato en ese mismo momento.
     */
    @OnEvent('food_order.cancelled')
    async onFoodOrderCancelled(event: {
        orderId: string;
        tenantSchemaName?: string;
        schemaName?: string;
    }) {
        const schema = event.schemaName || event.tenantSchemaName;
        const tenantId = await this.resolveTenantId(schema);
        if (!tenantId || !schema) return;

        const lang = await this.getTenantLanguage(tenantId);
        const t = pushI18n(lang);

        // El evento de cancelacion no lleva el nombre (el cliente cancela citando
        // solo el id del pedido); se lee del pedido ya guardado.
        let customerName = t.contactFallback;
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT customer_name,contact_id FROM food_orders WHERE id = $1::uuid`,
                [event.orderId],
            );
            if (rows[0]?.customer_name) customerName = rows[0].customer_name;
        } catch {
            // Un nombre que no se pudo leer no debe silenciar la alerta.
        }

        const contactId = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT contact_id FROM food_orders WHERE id=$1::uuid`, [event.orderId])
            .then(rows => rows[0]?.contact_id || null).catch(() => null);
        await this.notifyOwners(tenantId, schema, {
            eventType: 'food_order.cancelled', entityId: event.orderId,
            eventKey: `push:food_order.cancelled:${event.orderId}`, contactId,
            payload: { title: t.orderCancelledTitle, body: t.orderCancelledBody(customerName),
                url: '/admin/food-orders', tag: `food-order-cancel-${event.orderId}` },
        });
    }
}
