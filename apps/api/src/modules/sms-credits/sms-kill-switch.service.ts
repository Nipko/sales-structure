import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const SETTING_KEY = 'sms.platform_enabled';
const CACHE_KEY = 'sms:platform_enabled';
const CACHE_TTL_SEC = 60;

/**
 * Interruptor maestro de TODO el SMS de la plataforma.
 *
 * Decisión del dueño (ago 2026): SMS apagado por completo — ni el propio (2FA,
 * alertas de operaciones) ni el de los tenants (créditos, notificaciones,
 * broadcast). El motivo es económico: los tiers por defecto estaban por debajo
 * del costo de Twilio-CO, y un SMS que Twilio acepta y el carrier no entrega se
 * paga igual, así que el producto perdía plata en el peor caso y empataba en el
 * mejor.
 *
 * Por qué UN interruptor y no apagar seis cosas por separado: los emisores son
 * cinco servicios distintos y cada uno tenía su propia condición de encendido
 * (credenciales presentes, kill-switch del reseller, canal configurado). Con
 * eso, "apagar el SMS" era una lista de seis lugares que hay que acordarse de
 * revisar, y cualquier camino nuevo nacía encendido. Ahora hay una sola
 * pregunta que responder.
 *
 * DEFAULT: apagado. Si el ajuste no existe en la base, no se manda nada. Es lo
 * contrario del criterio habitual de esta plataforma —que suele fallar abierto—
 * y a propósito: acá lo que está del otro lado es un cargo real por mensaje.
 *
 * Para encenderlo: `platform_settings` → `sms.platform_enabled` = `true`.
 */
@Injectable()
export class SmsKillSwitchService {
    private readonly logger = new Logger(SmsKillSwitchService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    async isEnabled(): Promise<boolean> {
        try {
            const cached = await this.redis.get(CACHE_KEY);
            if (cached !== null && cached !== undefined) return cached === 'true';

            const rows = await this.prisma.$queryRaw<{ value: string }[]>`
                SELECT value FROM platform_settings WHERE key = ${SETTING_KEY} LIMIT 1
            `;
            const enabled = String(rows?.[0]?.value ?? '').toLowerCase() === 'true';
            await this.redis.set(CACHE_KEY, enabled ? 'true' : 'false', CACHE_TTL_SEC).catch(() => {});
            return enabled;
        } catch (e: any) {
            // Falla CERRADO: si no se puede leer el ajuste, no se manda. Un SMS
            // de más cuesta plata; uno de menos, no.
            this.logger.warn(`No se pudo leer ${SETTING_KEY}, se asume apagado: ${e.message}`);
            return false;
        }
    }

    /** Para cuando se cambie el ajuste desde el panel. */
    async invalidate(): Promise<void> {
        await this.redis.del(CACHE_KEY).catch(() => {});
    }
}
