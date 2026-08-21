import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { SmsCreditsService } from './sms-credits.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { SmsKillSwitchService } from './sms-kill-switch.service';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

export interface TenantSmsSendResult {
    sent: boolean;
    reason?: 'invalid' | 'monetization_disabled' | 'platform_sms_unconfigured' | 'insufficient_credits' | 'send_failed' | 'opted_out';
    sid?: string;
    segments?: number;
    balance?: number;
    error?: string;
}

/**
 * Reseller notification SMS: sends a tenant's one-way notification to their
 * customer via the PLATFORM Twilio account (SMS_ALERT_* creds) and charges the
 * tenant's prepaid credit balance (1 credit = 1 Twilio segment).
 *
 * Charging model: reserve the estimated segments BEFORE sending (atomic guarded
 * decrement), send, then reconcile against Twilio's actual `num_segments`. On a
 * send failure the reservation is refunded. This guarantees the balance never
 * goes negative and a failed send never costs the tenant.
 *
 * NOT used for: platform 2FA/security (PlatformSmsService), ops alerts
 * (SmsAlertService), or the tenant's BYO conversational channel (SmsSenderService).
 */
@Injectable()
export class TenantNotificationSmsService {
    private readonly logger = new Logger(TenantNotificationSmsService.name);
    private readonly accountSid?: string;
    private readonly authToken?: string;
    private readonly envSender?: string;

    constructor(
        config: ConfigService,
        private readonly smsCredits: SmsCreditsService,
        private readonly prisma: PrismaService,
        private readonly killSwitch: SmsKillSwitchService,
        private readonly regionalProfile: RegionalProfileService,
    ) {
        this.accountSid = config.get<string>('SMS_ALERT_ACCOUNT_SID');
        this.authToken = config.get<string>('SMS_ALERT_AUTH_TOKEN');
        // Dedicated commercial sender for tenant notifications; falls back to the
        // ops/2FA number if a separate one isn't configured.
        this.envSender = config.get<string>('SMS_SENDER_ID') || config.get<string>('SMS_ALERT_FROM');
    }

    get enabled(): boolean {
        return !!(this.accountSid && this.authToken && this.envSender);
    }

    /**
     * Estimate Twilio segments for `body`. Any non-ASCII char forces UCS-2
     * encoding (70/67-char segments) — this covers Spanish á/í/ó/ú/¿/¡, which
     * are outside GSM-7 basic. Conservative: over-estimates rather than under.
     */
    estimateSegments(body: string): number {
        // Twilio counts UCS-2 by UTF-16 code UNITS, not code points — a non-BMP char
        // (emoji, some CJK) is 2 units. Using body.length (UTF-16 units) avoids the
        // ~2x under-count that let emoji-heavy messages be under-charged.
        const units = body.length;
        let unicode = false;
        for (const ch of body) {
            if ((ch.codePointAt(0) ?? 0) > 127) { unicode = true; break; }
        }
        if (unicode) return units <= 70 ? 1 : Math.ceil(units / 67);
        return units <= 160 ? 1 : Math.ceil(units / 153);
    }

    /**
     * Send + charge. `opts.reason` labels the ledger movement (broadcast /
     * appointment / nurturing / recall …); `opts.ref` correlates refunds.
     */
    async send(
        tenantId: string,
        to: string,
        body: string,
        opts?: { reason?: string; ref?: string; metadata?: Record<string, any> },
    ): Promise<TenantSmsSendResult> {
        if (!to || !body) return { sent: false, reason: 'invalid' };
        // Interruptor maestro de plataforma, por encima del kill-switch del
        // modelo reseller: apagado el SMS, no sale nada y no se cobra nada.
        if (!(await this.killSwitch.isEnabled())) return { sent: false, reason: 'monetization_disabled' };
        // Master switch: while the reseller model is off, nothing is sent and nothing
        // is charged — the platform never fronts a per-SMS cost it can't recover.
        if (!(await this.smsCredits.isEnabled())) return { sent: false, reason: 'monetization_disabled' };
        if (!this.enabled) return { sent: false, reason: 'platform_sms_unconfigured' };

        // Baja: no se manda Y no se cobra.
        //
        // `send()` validaba interruptor, credenciales y saldo, pero nunca
        // consultaba el consentimiento — pese a que el módulo de compliance ya
        // registra los opt-out. Cada reenvío a alguien que pidió la baja
        // descontaba créditos igual: además del riesgo regulatorio y para la
        // cuenta de Twilio, era cobrarle al tenant por un mensaje que no debía
        // salir.
        if (await this.isOptedOut(tenantId, to)) {
            this.logger.log(`SMS bloqueado por opt-out tenant=${tenantId} to=${to}`);
            return { sent: false, reason: 'opted_out' };
        }

        const sender = (await this.smsCredits.getSenderId()) || this.envSender!;
        const est = this.estimateSegments(body);
        const ref = opts?.ref || randomUUID();
        const meta = { to, reason: opts?.reason || 'outbound', ...(opts?.metadata || {}) };

        // 1. Reserve estimated segments (atomic; never negative).
        const reserved = await this.smsCredits.consume(tenantId, est, 'consumption', ref, meta);
        if (!reserved.ok) {
            return { sent: false, reason: 'insufficient_credits', balance: reserved.balance };
        }

        // 2. Send via platform Twilio.
        const res = await this.twilioSend(to, sender, body);
        if (!res.ok) {
            // El ref del REEMBOLSO tiene que ser único por intento.
            //
            // El índice único parcial del ledger es (tenant_id, reason, ref)
            // WHERE ref IS NOT NULL AND delta > 0: alcanza a los movimientos
            // POSITIVOS, o sea a los reembolsos, no a los consumos. Y el
            // broadcast pasa un ref estable por destinatario
            // (`bcast:{campaignId}:{recipientId}`) con attempts:3.
            //
            // Con `refund:{ref}` fijo eso daba: intento 1 descuenta N y devuelve
            // N; intentos 2 y 3 descuentan N y su reembolso choca contra el
            // índice, se descarta como duplicado y no acredita. El tenant
            // terminaba pagando 2N créditos por un mensaje que nunca salió, con
            // el ledger mostrando consumos sin contrapartida.
            //
            // Un uuid por intento hace que cada consumo tenga su devolución.
            await this.smsCredits
                .addCredits(tenantId, est, 'refund', `refund:${ref}:${randomUUID()}`, { ...meta, forRef: ref, error: res.error })
                .catch(() => { });
            this.logger.warn(`Notification SMS failed tenant=${tenantId} to=${to}: ${res.error}`);
            return { sent: false, reason: 'send_failed', error: res.error };
        }

        // 3. Reconcile against Twilio's real segment count.
        const actual = res.numSegments && res.numSegments > 0 ? res.numSegments : est;
        if (actual > est) {
            const extra = await this.smsCredits.consume(tenantId, actual - est, 'consumption', `reconcile:${ref}`, meta);
            if (!extra.ok) {
                this.logger.warn(`SMS segment reconcile shortfall tenant=${tenantId} ref=${ref} (${actual} vs est ${est})`);
            }
        } else if (actual < est) {
            await this.smsCredits
                .addCredits(tenantId, est - actual, 'refund', `reconcile:${ref}`, meta)
                .catch(() => { });
        }

        return { sent: true, sid: res.sid, segments: actual, balance: Math.max(0, reserved.balance - (actual - est)) };
    }

    /**
     * ¿Este teléfono pidió la baja?
     *
     * Mira los dos lugares donde el sistema la registra, porque no son
     * redundantes: `leads.opted_out` es la marca global del lead (la escribe el
     * detector de opt-out del pipeline) y `opt_out_records` es el registro POR
     * CANAL del módulo de compliance. Alguien puede haber pedido la baja de SMS
     * sin haberla pedido de WhatsApp.
     *
     * Falla ABIERTO a propósito: si la consulta se cae, se manda. Un SMS de más
     * es un problema; un recordatorio de turno que no llega porque la base
     * hipó es peor, y este servicio no es el lugar donde defender el opt-out en
     * última instancia.
     */
    private async isOptedOut(tenantId: string, phone: string): Promise<boolean> {
        try {
            const schemaName = await this.prisma.getTenantSchemaName(tenantId);
            if (!schemaName) return false;
            // Acá un número mal normalizado hace lo PEOR posible: no
            // encuentra el opt-out y le manda a alguien que pidió no recibir.
            const region = await this.regionalProfile.phoneRegionFor(tenantId);
            const normalized = normalizePhoneE164(phone, region) || phone;
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT 1
                   FROM leads l
                  WHERE (l.phone_normalized = $1 OR l.phone = $2)
                    AND (
                        l.opted_out = true
                        OR EXISTS (
                            SELECT 1 FROM opt_out_records o
                             WHERE o.lead_id = l.id AND o.channel IN ('sms', 'all')
                        )
                    )
                  LIMIT 1`,
                [normalized, phone],
            );
            return (rows?.length || 0) > 0;
        } catch (e: any) {
            this.logger.warn(`Chequeo de opt-out falló (se envía igual): ${e.message}`);
            return false;
        }
    }

    private async twilioSend(
        to: string,
        from: string,
        body: string,
    ): Promise<{ ok: boolean; sid?: string; numSegments?: number; error?: string }> {
        try {
            const url = `${TWILIO_API}/Accounts/${this.accountSid}/Messages.json`;
            const params = new URLSearchParams({ To: to, From: from, Body: body });
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64'),
                },
                body: params.toString(),
                signal: AbortSignal.timeout(10_000),
            });
            const data = (await res.json().catch(() => ({}))) as any;
            if (!res.ok || data.error_code || data.status === 'failed') {
                return { ok: false, error: data.message || data.error_message || `HTTP ${res.status}` };
            }
            const numSegments = parseInt(data.num_segments || '0', 10) || undefined;
            return { ok: true, sid: data.sid, numSegments };
        } catch (e: any) {
            return { ok: false, error: e.message };
        }
    }
}
