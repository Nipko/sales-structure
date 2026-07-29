import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

/**
 * Escucha `service_request.created` (emitido por la tool create_service_request
 * de servicios_hogar) y notifica a los humanos cuando la urgencia es emergencia.
 *
 * Hasta ahora el evento se emitía al vacío: una fuga de gas creaba el request y
 * ningún humano recibía aviso — ni email, ni inbox. La única escalación real era
 * por keywords de handoff en el texto del cliente, y el board de despacho se
 * enteraba por su refresh de 20 segundos.
 */
@Injectable()
export class ServiceRequestListener {
    private readonly logger = new Logger(ServiceRequestListener.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly emailService: EmailService,
    ) {}

    @OnEvent('service_request.created')
    async onServiceRequestCreated(payload: { requestId: string; tenantSchemaName: string; urgency?: string }): Promise<void> {
        try {
            if (payload?.urgency !== 'emergencia') return;

            const tenant = await this.prisma.tenant.findFirst({
                where: { schemaName: payload.tenantSchemaName },
                select: { id: true, name: true },
            });
            if (!tenant) return;

            const rows = (await this.prisma.executeInTenantSchema(
                payload.tenantSchemaName,
                `SELECT service_type, customer_name, customer_phone, address, city, issue_description
                 FROM service_requests WHERE id = $1::uuid LIMIT 1`,
                [payload.requestId],
            )) as any[];
            const req = rows?.[0];
            if (!req) return;

            // Admin + supervisores del tenant: los que pueden despachar un técnico.
            const recipients = await this.prisma.user.findMany({
                where: {
                    tenantId: tenant.id,
                    isActive: true,
                    role: { in: ['tenant_admin', 'tenant_supervisor'] },
                },
                select: { email: true },
            });
            if (recipients.length === 0) return;

            const detalle = [
                `Servicio: ${req.service_type || '—'}`,
                `Cliente: ${req.customer_name || 'sin nombre'} · ${req.customer_phone || 'sin teléfono'}`,
                `Dirección: ${[req.address, req.city].filter(Boolean).join(', ') || 'sin dirección'}`,
                `Problema: ${req.issue_description || '—'}`,
            ].join('<br>');

            // Fire-and-forget por destinatario: un SMTP flojo no debe frenar el turno.
            for (const r of recipients) {
                void this.emailService.send({
                    to: r.email,
                    subject: `🚨 EMERGENCIA — nueva solicitud de servicio (${tenant.name})`,
                    html: `<p>El asistente registró una solicitud marcada como <strong>EMERGENCIA</strong>:</p><p>${detalle}</p><p>Revisala en el panel: <a href="https://admin.parallly-chat.cloud/admin/service-requests">Solicitudes de servicio</a></p>`,
                });
            }
            this.logger.log(`Emergencia notificada a ${recipients.length} responsable(s) del tenant ${tenant.id} (request ${payload.requestId})`);
        } catch (e: any) {
            // Nunca romper el flujo de la conversación por una notificación.
            this.logger.error(`No se pudo notificar la emergencia ${payload?.requestId}: ${e?.message}`);
        }
    }
}
