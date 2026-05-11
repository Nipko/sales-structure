import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PushService } from './push.service';

@Injectable()
export class PushListenerService {
    private readonly logger = new Logger(PushListenerService.name);

    constructor(private readonly pushService: PushService) {}

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
    }) {
        if (!event.tenantId) return;

        await this.pushService.sendToTenantRole(event.tenantId, 'tenant_admin', {
            title: 'Nueva cita agendada',
            body: `${event.customerName || 'Cliente'} — ${event.serviceName || 'Servicio'}`,
            url: '/admin/appointments',
            tag: 'appointment-new',
        }).catch(() => {});
    }
}
