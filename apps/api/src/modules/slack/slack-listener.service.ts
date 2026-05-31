import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SlackService } from './slack.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Posts Slack notifications on key business events (T2.16).
 * Mirrors the push-listener pattern but targets a tenant's Slack webhook.
 */
@Injectable()
export class SlackListenerService {
    constructor(
        private readonly slack: SlackService,
        private readonly prisma: PrismaService,
    ) {}

    @OnEvent('handoff.escalated')
    async onHandoff(event: { tenantId: string; reason?: string; contactName?: string }) {
        if (!event?.tenantId) return;
        const who = event.contactName || 'Un cliente';
        const reason = event.reason ? ` — ${event.reason}` : '';
        await this.slack.notify(event.tenantId, 'handoff', `🙋 *Conversación escalada*: ${who}${reason}`);
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
        if (!tenantId && event.schemaName) {
            try {
                const tenant = await this.prisma.tenant.findFirst({
                    where: { schemaName: event.schemaName },
                    select: { id: true },
                });
                tenantId = tenant?.id || undefined;
            } catch {
                return;
            }
        }
        if (!tenantId) return;

        const customer = event.customerName || event.appointment?.customerName
            || event.appointment?.customer_name || event.appointment?.contact_name || 'Cliente';
        const service = event.serviceName || event.appointment?.serviceName
            || event.appointment?.service_name || 'Servicio';

        await this.slack.notify(tenantId, 'appointment', `📅 *Nueva cita*: ${customer} — ${service}`);
    }
}
