import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { OperationConfirmationService } from '../email-templates/operation-confirmation.service';

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escucha `service_request.created` (emitido por el writer canónico de
 * servicios_hogar, tanto para IA como para altas manuales) y notifica a los
 * humanos cuando la urgencia es emergencia.
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
        /**
         * El aviso AL CLIENTE usa la plantilla del tenant
         * (`homeservice_booking_confirmation`), no el correo interno de arriba:
         * lo firma el negocio y sale en su idioma. Ver `notifyCustomer`.
         */
        private readonly confirmations: OperationConfirmationService,
    ) {}

    /**
     * Dos avisos distintos con el mismo disparador, y no comparten nada.
     *
     * El interno despierta a un humano cuando hay una emergencia; el del
     * cliente confirma una visita agendada y lo gobierna el interruptor del
     * dueño. Se ejecutan por separado a propósito: un SMTP flojo con los
     * responsables no puede costarle al cliente su confirmación, ni al revés.
     */
    @OnEvent('service_request.created')
    async onServiceRequestCreated(payload: { requestId: string; tenantSchemaName: string; urgency?: string }): Promise<void> {
        await this.notifyCustomer(payload).catch((error: any) =>
            this.logger.error(`No se pudo confirmar al cliente la solicitud `
                + `${payload?.requestId}: ${error?.message}`));
        await this.notifyEmergency(payload);
    }

    private async notifyEmergency(payload: { requestId: string; tenantSchemaName: string; urgency?: string }): Promise<void> {
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

            const address = [req.address, req.city]
                .filter(Boolean)
                .map((value) => escapeHtml(value))
                .join(', ') || 'sin dirección';
            const detalle = [
                `Servicio: ${escapeHtml(req.service_type || '—')}`,
                `Cliente: ${escapeHtml(req.customer_name || 'sin nombre')} · ${escapeHtml(req.customer_phone || 'sin teléfono')}`,
                `Dirección: ${address}`,
                `Problema: ${escapeHtml(req.issue_description || '—')}`,
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

    /**
     * ═══ LA CONFIRMACIÓN AL CLIENTE QUE EL INTERRUPTOR PROMETÍA ═══
     *
     * `tools.homeServices.emailConfirmations` lo declara el contrato de perfil
     * de negocio, el editor del agente lo dibuja como interruptor y hasta dice
     * qué plantilla gobierna —`homeservice_booking_confirmation`— y NADIE lo
     * leía. La plantilla se sembraba en cada tenant y no se renderizó nunca: el
     * dueño podía prender las confirmaciones de visita, la pantalla decía que
     * las prendió, y ningún cliente recibió una.
     *
     * ── SÓLO UNA VISITA AGENDADA, NUNCA UNA SOLICITUD REGISTRADA ────────────
     *
     * La plantilla dice «Visita Técnica Programada» y lista fecha y hora. Una
     * solicitud nace `pending` cuando el cliente no eligió horario, y mandar
     * eso sería afirmarle una visita que nadie agendó — la misma clase de
     * mentira que un «pedido confirmado» sobre una orden pendiente. Así que la
     * condición es `status = 'scheduled'` CON `scheduled_at`, que es exactamente
     * lo que el writer escribe cuando la herramienta trae servicio y horario.
     *
     * A request scheduled later by a human emits `service_request.scheduled`;
     * it enters this same renderer and confirmation policy after the update
     * commits, so the dashboard and conversational writer behave alike.
     */
    private async notifyCustomer(payload: { requestId: string; tenantSchemaName: string }): Promise<void> {
        const schema = String(payload?.tenantSchemaName ?? '').trim();
        const requestId = String(payload?.requestId ?? '').trim();
        if (!schema || !requestId) return;

        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT status, contact_id, conversation_id, service_type, address, city,
                    assigned_technician_name, customer_name,
                    to_char(scheduled_at, 'YYYY-MM-DD') AS scheduled_date,
                    to_char(scheduled_at, 'HH24:MI') AS scheduled_time
               FROM service_requests WHERE id = $1::uuid LIMIT 1`,
            [requestId],
        );
        const req = rows?.[0];
        if (!req) return;
        // Una solicitud sin horario no tiene visita que confirmar.
        if (req.status !== 'scheduled' || !req.scheduled_date) return;

        // Quién decide y a quién se le escribe lo resuelve una sola pieza para
        // toda la plataforma —`OperationConfirmationService`—: propiedad del
        // schema, destinatario, interruptor del agente que atendió e idioma.
        // Acá queda sólo lo que únicamente una visita técnica sabe.
        await this.confirmations.send({
            schemaName: schema,
            families: ['homeServices'],
            slug: 'homeservice_booking_confirmation',
            conversationId: req.conversation_id,
            contactId: req.contact_id,
            operation: `service request ${requestId}`,
            variables: {
                service_name: String(req.service_type ?? ''),
                appointment_date: String(req.scheduled_date ?? ''),
                appointment_time: String(req.scheduled_time ?? ''),
                location: [req.address, req.city].filter(Boolean).join(', '),
                agent_name: String(req.assigned_technician_name ?? ''),
            },
        });
    }

    @OnEvent('service_request.scheduled')
    async onServiceRequestScheduled(payload: { requestId: string; tenantSchemaName: string }): Promise<void> {
        await this.notifyCustomer(payload).catch((error: any) =>
            this.logger.error(`No se pudo confirmar al cliente la solicitud agendada `
                + `${payload?.requestId}: ${error?.message}`));
    }
}
