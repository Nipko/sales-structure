import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { TenantNotificationSmsService } from '../sms-credits/tenant-notification-sms.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';

/** Cuánto dura la verificación una vez lograda, dentro de la misma conversación. */
const VERIFIED_TTL_SEC = 30 * 60;
/** Vida del código. */
const CODE_TTL_SEC = 10 * 60;
const MAX_ATTEMPTS = 5;

export type StartResult =
    | { status: 'sent'; via: 'email' | 'sms'; hint: string }
    | { status: 'no_channel' }
    | { status: 'already_verified' };

/**
 * Verificación de identidad en dos pasos, desde el chat.
 *
 * Por qué existe: las plantillas de seguros, finanzas y salud pedían cédula/DNI
 * mientras el contrato base del prompt lo prohibía. El LLM decidía turno a turno
 * a quién obedecer, y cuando ganaba la plantilla terminábamos acumulando
 * documentos de identidad de terceros en un JSONB sin cifrar. Se sacó la cédula
 * de las plantillas; esto es lo que ocupa su lugar y hace la identidad
 * verificable de verdad en vez de declarada.
 *
 * LA REGLA QUE DEFINE EL DISEÑO: el código NUNCA sale por el mismo canal desde
 * el que escribe la persona. Si alguien se apoderó de ese WhatsApp, mandarle el
 * código a ese mismo WhatsApp no prueba absolutamente nada — sería teatro de
 * seguridad. Va al correo del contacto, o por SMS si no hay correo y la
 * conversación no es por SMS.
 *
 * Si no hay ningún canal fuera de banda, se dice (`no_channel`) en vez de
 * inventar una verificación: la tool que lo pidió escala a un humano, que es la
 * respuesta honesta.
 */
@Injectable()
export class ChatIdentityService {
    private readonly logger = new Logger(ChatIdentityService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly email: EmailService,
        private readonly sms: TenantNotificationSmsService,
    ) {}

    private verifiedKey(conversationId: string) { return `chat:verified:${conversationId}`; }
    private codeKey(conversationId: string) { return `chat:idcode:${conversationId}`; }

    /** ¿Esta conversación ya verificó identidad hace poco? */
    async isVerified(conversationId: string): Promise<boolean> {
        if (!conversationId) return false;
        // Falla CERRADO: si Redis no contesta, no se da por verificado a nadie.
        // Es lo contrario del criterio de las alertas, y a propósito — acá lo que
        // está del otro lado son datos de una póliza o una historia clínica.
        try {
            return !!(await this.redis.get(this.verifiedKey(conversationId)));
        } catch {
            return false;
        }
    }

    /**
     * Manda el código por un canal DISTINTO al de la conversación.
     * `hint` es lo que el agente puede repetirle al cliente sin filtrar el dato
     * completo ("al correo que termina en @gmail.com").
     */
    async startVerification(
        tenantId: string,
        schemaName: string,
        contactId: string,
        conversationId: string,
        conversationChannel: string,
    ): Promise<StartResult> {
        if (await this.isVerified(conversationId)) return { status: 'already_verified' };

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT email, phone, phone_normalized FROM contacts WHERE id = $1::uuid LIMIT 1`,
            [contactId],
        ).catch(() => []);
        const contact = rows?.[0];
        if (!contact) return { status: 'no_channel' };

        const code = String(Math.floor(100000 + Math.random() * 900000));
        const body = `Tu código de verificación es ${code}. Vence en 10 minutos. Si no lo pediste, ignorá este mensaje.`;

        // El correo es el preferido: casi nunca es el mismo medio por el que
        // llega la conversación, y no cuesta créditos.
        if (contact.email) {
            const ok = await this.email
                .send({
                    to: contact.email,
                    subject: 'Código de verificación',
                    html: `<p style="font-size:16px;font-family:sans-serif">${body}</p>`,
                })
                .then(() => true)
                .catch(() => false);
            if (ok) {
                await this.storeCode(conversationId, contactId, code);
                return { status: 'sent', via: 'email', hint: this.maskEmail(contact.email) };
            }
        }

        const phone = contact.phone_normalized || normalizePhoneE164(contact.phone || '') || contact.phone;
        // SMS sólo si la conversación NO viene por SMS — si no, estaríamos
        // mandando el código por el mismo canal que queremos verificar.
        if (phone && conversationChannel !== 'sms') {
            const res = await this.sms.send(tenantId, phone, body, { reason: 'identity_verification' }).catch(() => null);
            if (res?.sent) {
                await this.storeCode(conversationId, contactId, code);
                return { status: 'sent', via: 'sms', hint: this.maskPhone(phone) };
            }
        }

        return { status: 'no_channel' };
    }

    /** Valida el código y, si es correcto, marca la conversación como verificada. */
    async verifyCode(conversationId: string, code: string): Promise<{ ok: boolean; reason?: 'expired' | 'wrong' | 'too_many' }> {
        const raw = await this.redis.get(this.codeKey(conversationId)).catch(() => null);
        if (!raw) return { ok: false, reason: 'expired' };

        let data: { code: string; contactId: string; attempts: number };
        try { data = JSON.parse(raw as string); } catch { return { ok: false, reason: 'expired' }; }

        if (data.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many' };

        if (String(code).trim() !== data.code) {
            // El contador se sube ANTES de responder: si no, un atacante puede
            // probar los 10^6 códigos cortando la conexión antes del write.
            data.attempts += 1;
            await this.redis.set(this.codeKey(conversationId), JSON.stringify(data), CODE_TTL_SEC).catch(() => {});
            return { ok: false, reason: data.attempts >= MAX_ATTEMPTS ? 'too_many' : 'wrong' };
        }

        await this.redis.set(this.verifiedKey(conversationId), data.contactId, VERIFIED_TTL_SEC).catch(() => {});
        await this.redis.del(this.codeKey(conversationId)).catch(() => {});
        this.logger.log(`Identidad verificada en la conversación ${conversationId}`);
        return { ok: true };
    }

    private async storeCode(conversationId: string, contactId: string, code: string): Promise<void> {
        await this.redis
            .set(this.codeKey(conversationId), JSON.stringify({ code, contactId, attempts: 0 }), CODE_TTL_SEC)
            .catch(() => {});
    }

    /** j***@gmail.com — suficiente para que lo reconozca, inútil para un tercero. */
    private maskEmail(email: string): string {
        const [user, domain] = String(email).split('@');
        if (!domain) return '***';
        return `${user.slice(0, 1)}***@${domain}`;
    }

    /** ****4321 */
    private maskPhone(phone: string): string {
        const s = String(phone);
        return `****${s.slice(-4)}`;
    }
}
