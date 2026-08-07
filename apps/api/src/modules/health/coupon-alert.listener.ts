import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TelegramAlertService } from './telegram-alert.service';
import { AlertConfigService } from './alert-config.service';

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

    constructor(
        private readonly telegram: TelegramAlertService,
        private readonly alertConfig: AlertConfigService,
    ) {}

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
     * Respeta el interruptor de Telegram del Centro de Operaciones y nunca
     * propaga: que no salga un aviso no puede deshacer un canje ya commiteado.
     */
    private async notify(lines: string[]): Promise<void> {
        try {
            if (!this.telegram.enabled) return;
            const cfg = await this.alertConfig.get();
            if (!cfg.channels.telegram) return;
            await this.telegram.send(lines.filter(Boolean).join('\n'));
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
