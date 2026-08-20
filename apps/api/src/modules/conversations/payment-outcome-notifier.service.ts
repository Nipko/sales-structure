import { Injectable, Logger, Optional } from '@nestjs/common';
import { ChannelType } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { EmailService } from '../email/email.service';

/**
 * Cerrar el lazo del pago: contarle al cliente cómo terminó.
 *
 * El cobro ya confirmaba la reserva en la base y emitía un evento… que nadie
 * escuchaba. El cliente pagaba, Wompi le decía "listo", y de nosotros no recibía
 * una palabra: iba a asumir que falló y a escribir o llamar. Una confirmación
 * que el cliente no ve no es una confirmación.
 *
 * Vive acá y no dentro de cada vertical porque el desenlace es el mismo en
 * todas —se pagó y quedó firme, o se pagó y ya no había lugar— y porque los dos
 * mensajes tienen que sonar igual salga de donde salga.
 *
 * LA VENTANA DE 24h: WhatsApp sólo deja escribir libre dentro de las 24h desde
 * el último mensaje DEL CLIENTE. Con la retención de 20 minutos el caso normal
 * entra holgado —acaba de escribir para reservar— pero un pago que se acredita
 * tarde cae fuera y Meta lo rechaza.
 *
 * Ahí se cae a EMAIL. No se intenta y se ve fallar: se decide antes, porque un
 * rechazo de Meta deja al cliente sin enterarse igual y sin rastro legible. El
 * email no reemplaza a una plantilla aprobada —el cliente escribió por WhatsApp
 * y ahí querría la respuesta— pero es lo que se puede mandar hoy sin depender de
 * que Meta apruebe nada. Sin email queda el log, para que el dueño al menos vea
 * que su cliente no fue avisado.
 */
@Injectable()
export class PaymentOutcomeNotifierService {
    private readonly logger = new Logger(PaymentOutcomeNotifierService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Optional() private readonly outbound?: OutboundQueueService,
        @Optional() private readonly email?: EmailService,
    ) {}

    /**
     * Le avisa al cliente por el mismo canal en el que venía hablando.
     *
     * `dedupeId` es obligatorio en la práctica: el webhook del proveedor llega
     * varias veces por diseño y sin él el cliente recibiría el mismo "quedó
     * confirmada" tres veces. Se deriva de la operación, no del reintento, así
     * que los reenvíos colapsan en uno solo.
     */
    async notifyCustomer(input: {
        tenantId: string;
        conversationId?: string | null;
        contactId?: string | null;
        text: string;
        dedupeId: string;
    }): Promise<boolean> {
        if (!this.outbound || !input.text?.trim()) return false;
        if (!input.conversationId && !input.contactId) return false;

        try {
            const schemaName = await this.prisma.getTenantSchemaName(input.tenantId);
            if (!schemaName) return false;

            // La conversación manda porque trae la cuenta concreta por la que se
            // venía hablando: un tenant con dos números de WhatsApp no puede
            // responder por el que no es. Si la operación no tiene conversación
            // (creada a mano en el panel), se cae al último contacto conocido.
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                input.conversationId
                    ? `SELECT c.id AS conversation_id, c.channel_type, c.channel_account_id,
                              ct.external_id, ct.email, ct.name,
                              (SELECT MAX(m.created_at) FROM messages m
                                WHERE m.conversation_id = c.id AND m.direction = 'inbound') AS last_inbound_at
                         FROM conversations c
                         JOIN contacts ct ON ct.id = c.contact_id
                        WHERE c.id = $1::uuid
                        LIMIT 1`
                    : `SELECT c.id AS conversation_id, c.channel_type, c.channel_account_id,
                              ct.external_id, ct.email, ct.name,
                              (SELECT MAX(m.created_at) FROM messages m
                                WHERE m.conversation_id = c.id AND m.direction = 'inbound') AS last_inbound_at
                         FROM conversations c
                         JOIN contacts ct ON ct.id = c.contact_id
                        WHERE c.contact_id = $1::uuid
                        ORDER BY c.updated_at DESC
                        LIMIT 1`,
                [input.conversationId || input.contactId],
            );

            const target = rows?.[0];
            if (!target?.external_id || !target?.channel_type) {
                this.logger.warn(
                    `[Pago] no hay canal por donde avisarle al cliente (tenant ${input.tenantId})`,
                );
                return false;
            }

            // La ventana de 24h de WhatsApp. Meta sólo deja escribir libre dentro
            // de las 24h desde el último mensaje DEL CLIENTE; pasado eso hace
            // falta una plantilla aprobada. No lo intentamos y lo vemos fallar:
            // se decide antes, porque un rechazo de Meta deja al cliente sin
            // enterarse igual y sin rastro que el dueño pueda leer.
            //
            // Sólo aplica a WhatsApp. El resto de los canales no tiene ventana.
            if (String(target.channel_type) === 'whatsapp' && this.isOutsideWhatsappWindow(target.last_inbound_at)) {
                return this.notifyByEmail(target, input.text);
            }

            await this.outbound.enqueue({
                tenantId: input.tenantId,
                to: String(target.external_id),
                channelType: String(target.channel_type) as ChannelType,
                channelAccountId: String(target.channel_account_id || ''),
                content: { type: 'text', text: input.text },
                dedupeId: input.dedupeId,
            } as any);
            return true;
        } catch (e: any) {
            // Nunca hace fallar al emisor: el pago YA está acreditado y tirar
            // acá no lo revierte, sólo perdería el evento entero.
            this.logger.error(`[Pago] no se pudo avisar al cliente: ${e.message}`);
            return false;
        }
    }

    /** 24h desde el último mensaje del cliente. Sin mensajes, se asume fuera. */
    private isOutsideWhatsappWindow(lastInboundAt: unknown): boolean {
        if (!lastInboundAt) return true;
        const t = new Date(lastInboundAt as any).getTime();
        if (!Number.isFinite(t)) return true;
        return Date.now() - t > 24 * 60 * 60 * 1000;
    }

    /**
     * Fuera de la ventana: email.
     *
     * No reemplaza a una plantilla aprobada —el cliente escribió por WhatsApp y
     * ahí querría la respuesta— pero es lo que se puede mandar hoy sin depender
     * de que Meta apruebe nada. Si no hay email, queda el log: al menos el dueño
     * puede ver que su cliente no fue avisado.
     */
    private async notifyByEmail(target: any, text: string): Promise<boolean> {
        const to = String(target?.email || '').trim();
        if (!to || !this.email) {
            this.logger.warn(
                '[Pago] fuera de la ventana de 24h de WhatsApp y sin email: el cliente NO fue avisado',
            );
            return false;
        }
        const ok = await this.email.send({
            to,
            subject: 'Tu pago fue recibido',
            text,
            html: `<p>${text}</p>`,
        });
        if (ok) this.logger.log('[Pago] avisado por email (fuera de la ventana de 24h de WhatsApp)');
        return ok;
    }
}

/** Los dos desenlaces, en los cuatro idiomas de la plataforma. */
export const PAYMENT_OUTCOME_TEXT: Record<string, { confirmed: (what: string) => string }> = {
    es: { confirmed: (what) => `¡Listo! Recibimos tu pago y ${what} quedó confirmada. ¡Te esperamos!` },
    en: { confirmed: (what) => `All set! We received your payment and ${what} is confirmed. See you soon!` },
    pt: { confirmed: (what) => `Pronto! Recebemos seu pagamento e ${what} está confirmada. Até breve!` },
    fr: { confirmed: (what) => `C'est fait ! Nous avons reçu votre paiement et ${what} est confirmée. À bientôt !` },
};

export function paymentConfirmedText(lang: string | undefined, what: string): string {
    const L = (lang || 'es').slice(0, 2).toLowerCase();
    return (PAYMENT_OUTCOME_TEXT[L] || PAYMENT_OUTCOME_TEXT.es).confirmed(what);
}
