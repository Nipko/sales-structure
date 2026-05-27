import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PushListenerService {
    private readonly logger = new Logger(PushListenerService.name);

    constructor(
        private readonly pushService: PushService,
        private readonly prisma: PrismaService,
    ) {}

    @OnEvent('handoff.escalated')
    async onHandoff(event: {
        tenantId: string;
        conversationId: string;
        reason: string;
        assignedTo?: string;
        assignedAgentName?: string;
        contactName?: string;
    }) {
        const payload = {
            title: 'Conversación escalada',
            body: `${event.contactName || 'Cliente'} necesita atención — ${event.reason}`,
            url: '/admin/inbox',
            tag: `handoff-${event.conversationId}`,
        };

        if (event.assignedTo) {
            await this.pushService.sendToUser(event.assignedTo, payload).catch(() => {});
        } else {
            await this.pushService.sendToTenantRole(event.tenantId, 'tenant_admin', payload).catch(() => {});
            await this.pushService.sendToTenantRole(event.tenantId, 'tenant_supervisor', payload).catch(() => {});
        }
    }

    @OnEvent('handoff.escalated_supervisor')
    async onSupervisorEscalation(event: {
        tenantId: string;
        conversationId: string;
        contactName?: string;
    }) {
        await this.pushService.sendToTenantRole(event.tenantId, 'tenant_supervisor', {
            title: 'Escalación SLA',
            body: `${event.contactName || 'Conversación'} sin respuesta por más de 5 minutos`,
            url: '/admin/inbox',
            tag: `sla-${event.conversationId}`,
        }).catch(() => {});
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

        // Read customer and service names supporting both direct parameters and nested appointment object
        const customerName = event.customerName || event.appointment?.customerName || event.appointment?.customer_name || event.appointment?.contactName || event.appointment?.contact_name || 'Cliente';
        const serviceName = event.serviceName || event.appointment?.serviceName || event.appointment?.service_name || 'Servicio';

        await this.pushService.sendToTenantRole(tenantId, 'tenant_admin', {
            title: 'Nueva cita agendada',
            body: `${customerName} — ${serviceName}`,
            url: '/admin/appointments',
            tag: 'appointment-new',
        }).catch(() => {});
    }
}
