import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TelegramAlertService } from './telegram-alert.service';

/**
 * Avisos al canal de operaciones cuando alguien canjea —o se le revoca— un cupón
 * de meses gratis.
 *
 * Vive acá y no en el módulo de billing por una razón concreta: `TelegramAlertService`
 * no se exporta de `HealthModule`, y hacer que BillingModule importe HealthModule
 * arrastraría AIModule y cinco colas de BullMQ a la cadena de arranque del cobro.
 * `CouponsService` solo emite el evento; quién lo escucha es problema de acá.
 *
 * NO pasa por `PlatformMonitorService.alert()` a propósito: eso persiste un
 * incidente con severidad y cooldown, y un canje no es un incidente — llenaría el
 * Centro de Operaciones de ruido y el dedup se comería avisos legítimos de
 * canjes distintos.
 */
@Injectable()
export class CouponAlertListener {
    private readonly logger = new Logger(CouponAlertListener.name);

    constructor(private readonly telegram: TelegramAlertService) {}

    @OnEvent('coupon.redeemed')
    async onRedeemed(payload: {
        code: string;
        tenantId: string;
        tenantName?: string;
        freeMonths: number;
        source: string;
        trialEndsAt: Date;
        description?: string | null;
    }): Promise<void> {
        const origin = SOURCE_LABEL[payload.source] || payload.source;
        await this.notify([
            `🎁 <b>Cupón canjeado</b>`,
            ``,
            `<b>Código:</b> <code>${esc(payload.code)}</code>`,
            `<b>Cuenta:</b> ${esc(payload.tenantName || payload.tenantId)}`,
            `<b>Regalo:</b> ${payload.freeMonths} mes(es) gratis`,
            `<b>Origen:</b> ${esc(origin)}`,
            `<b>Prueba hasta:</b> ${fmtDate(payload.trialEndsAt)}`,
            payload.description ? `<i>${esc(payload.description)}</i>` : '',
        ]);
    }

    /**
     * Aviso al mintear. El dueño quería enterarse cuando se "hacen y hacen
     * cupones": esto cierra el círculo del lado de la EMISIÓN, no solo del canje.
     * Solo alerta lo que vale la pena mirar —lotes y emisiones de alto impacto—,
     * para no spamear con cada cupón suelto de 1 mes.
     */
    @OnEvent('coupon.issued')
    async onIssued(payload: {
        kind: 'single' | 'batch';
        code: string;
        freeMonths: number;
        maxRedemptions?: number | null;
        count?: number;
        plannedGiftedMonths?: number | null;
        highImpact?: boolean;
        reason?: string | null;
    }): Promise<void> {
        if (payload.kind !== 'batch' && !payload.highImpact) return;

        const potential = payload.plannedGiftedMonths != null
            ? `${payload.plannedGiftedMonths} mes(es)-gratis`
            : 'sin tope (potencial infinito)';
        const head = payload.kind === 'batch' ? '🎟️ <b>Lote de cupones emitido</b>' : '🎫 <b>Cupón emitido</b>';

        await this.notify([
            payload.highImpact ? `${head} · <b>ALTO IMPACTO</b>` : head,
            ``,
            payload.kind === 'batch'
                ? `<b>Lote:</b> <code>${esc(payload.code)}</code> · ${payload.count} códigos`
                : `<b>Código:</b> <code>${esc(payload.code)}</code>`,
            `<b>Regalo:</b> ${payload.freeMonths} mes(es) c/u`,
            `<b>Potencial:</b> ${esc(potential)}`,
            payload.reason ? `<b>Motivo:</b> ${esc(payload.reason)}` : '',
        ]);
    }

    @OnEvent('coupon.revoked')
    async onRevoked(payload: {
        code: string;
        tenantId: string;
        tenantName?: string;
        reason?: string | null;
        restoredTrialEndsAt?: Date | null;
    }): Promise<void> {
        await this.notify([
            `⛔ <b>Cupón revocado</b>`,
            ``,
            `<b>Código:</b> <code>${esc(payload.code)}</code>`,
            `<b>Cuenta:</b> ${esc(payload.tenantName || payload.tenantId)}`,
            `<b>Prueba vuelve a:</b> ${payload.restoredTrialEndsAt ? fmtDate(payload.restoredTrialEndsAt) : 'sin fecha de prueba'}`,
            payload.reason ? `<b>Motivo:</b> ${esc(payload.reason)}` : '',
        ]);
    }

    /**
     * Envía el aviso. Nunca propaga: que no salga una notificación no puede
     * deshacer un canje ya commiteado.
     *
     * NO se consulta `alertConfig.channels.telegram` a propósito. Ese interruptor
     * gobierna las ALERTAS DE INFRAESTRUCTURA (disco, RAM, colas); apagarlo para
     * dejar de recibir ruido de ops silenciaba también los avisos de cupones, que
     * son un evento de negocio y el control antifraude del dueño. Eran dos cosas
     * distintas atadas al mismo switch.
     *
     * Y cuando no se envía, ahora se dice POR QUÉ: antes retornaba en silencio,
     * así que un aviso que no llegaba no dejaba ningún rastro para diagnosticar.
     */
    private async notify(lines: string[]): Promise<void> {
        try {
            if (!this.telegram.enabled) {
                this.logger.warn(
                    '[Coupons] Aviso de cupón NO enviado: Telegram sin configurar ' +
                    '(faltan TELEGRAM_ALERT_BOT_TOKEN y/o TELEGRAM_ALERT_CHAT_ID en el entorno).',
                );
                return;
            }
            await this.telegram.send(lines.filter(Boolean).join('\n'));
            this.logger.log('[Coupons] Aviso enviado al canal de operaciones.');
        } catch (err: any) {
            this.logger.warn(`[Coupons] Telegram notice failed: ${err?.message}`);
        }
    }
}

const SOURCE_LABEL: Record<string, string> = {
    onboarding: 'Al crear la cuenta',
    billing_settings: 'Desde Facturación',
    admin: 'Aplicado por soporte',
};

/** Telegram acepta un subconjunto de HTML: hay que escapar el resto. */
function esc(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function fmtDate(value: Date | string): string {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toISOString().slice(0, 10);
}
