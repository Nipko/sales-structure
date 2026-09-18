import { Logger } from '@nestjs/common';
import { CERTIFIED_SELF_SERVICE_CHANNELS, advanceOnboardingStage, isOnboardingStage, onboardingOnceKey } from '@parallext/shared';
import type { PrismaService } from '../../modules/prisma/prisma.service';
import { mutateTenantSettingsAtomic } from './tenant-settings.util';
import { recordOnboardingEvent } from './onboarding-event.util';

/**
 * La primera respuesta real del agente, registrada una sola vez.
 *
 * Existe porque la etapa sola no alcanzaba para decir "esta cuenta ya vio a su
 * agente responderle a alguien". La etapa es monótona y `completed` tiene más
 * rango que `live`; el último botón del asistente ("Ir al panel") escribe
 * `completed`, así que la dueña que conectaba su canal y apretaba ese botón —el
 * camino que queremos— no podía quedar `live` nunca, y el silencio del día 0 se
 * levantaba en ese clic, antes de que su agente le contestara a nadie.
 *
 * Desde acá la activación la lleva `tenants.settings.firstReplyAt`, que el
 * panel lee con `isAwaitingFirstReply` del contrato compartido. La etapa se
 * sigue avanzando a `live` en la misma mutación, cuando puede.
 *
 * Reglas:
 * - La PRIMERA escritura gana. Una hora ya registrada no se pisa nunca: es la
 *   fecha de activación de la cuenta, y moverla movería cualquier medición de
 *   tiempo hasta la primera respuesta.
 * - No se estampa en una cuenta anterior al contrato de etapas (sin etapa
 *   guardada) ni en una que ya estaba `live`: su primera respuesta ocurrió
 *   antes de que existiera este campo, y escribir la de hoy publicaría una
 *   fecha falsa. Para esas cuentas no se decide nada con esta hora — sin etapa
 *   guardada no hay día 0, y `live` ya activa sola — y la etapa sí pasa a
 *   `live`, como antes. Por eso la cuenta sin contrato no la recibe tampoco en
 *   la llamada siguiente, cuando ya figura `live`.
 * - `completed` SÍ recibe la hora (la etapa queda `completed`, que tiene más
 *   rango): es exactamente la cuenta que terminó el asistente sin que su
 *   agente le hubiera respondido a nadie, y la que esta hora existe para
 *   activar.
 * - Nunca lanza. Corre dentro de un envío que ya ocurrió (la cola de salida)
 *   o de un turno del chat web; perder la marca cuesta, a lo sumo, que la
 *   próxima respuesta la vuelva a intentar. Perder el recibo de un envío por
 *   esto sería mucho peor.
 * - Es barata de llamar en cada envío: una vez que este proceso dejó la cuenta
 *   saldada, no vuelve a leer la fila. Un reinicio olvida la memoria y la
 *   próxima respuesta relee una vez; la regla de "primera gana" hace que esa
 *   relectura no cambie nada.
 *
 * Restricciones de la base: `tenants.settings` es `jsonb NOT NULL DEFAULT '{}'`
 * sin restricción por clave. Lo único que la base impone acá es el candado de
 * fila (`SELECT … FOR UPDATE` dentro de `mutateTenantSettingsAtomic`), que es lo
 * que hace que dos respuestas simultáneas en dos procesos no escriban dos horas
 * distintas: la segunda espera, relee y ve la primera.
 */

/** Clave en `tenants.settings`. La escribe solo este archivo. */
export const FIRST_REPLY_SETTING_KEY = 'firstReplyAt';

export type FirstReplyOutcome =
    /** Esta llamada escribió la hora y/o movió la etapa. */
    | 'recorded'
    /** La fila ya estaba saldada: hora registrada (o cuenta sin contrato) y etapa en su lugar. */
    | 'already_recorded'
    /** Este proceso ya había saldado (o está saldando) la cuenta: no se leyó nada. */
    | 'remembered'
    /** Sin tenant, o la escritura falló. La próxima respuesta lo reintenta. */
    | 'skipped'
    | 'failed';

export interface FirstReplyOptions {
    /** De dónde salió la respuesta (`dispatch`, `web_widget`), solo para el log. */
    source?: string;
    /** Operational channel when the delivery boundary knows it. */
    channelType?: string;
    /** Reloj inyectable para las pruebas. */
    at?: Date;
}

const logger = new Logger('FirstReply');

/**
 * Cuentas que este proceso ya dejó saldadas (o está saldando ahora mismo).
 * Se agrega ANTES de escribir para que dos respuestas simultáneas del mismo
 * proceso abran una sola transacción, y se quita si la escritura falla.
 */
const settledTenants = new Set<string>();

/** Solo para las pruebas: olvida lo que este proceso recuerda. */
export function forgetFirstReplyMemoryForTests(): void {
    settledTenants.clear();
}

export function isRecordedFirstReply(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

/**
 * La transformación pura, separada para poder probarla sin base. Devuelve el
 * MISMO objeto cuando no hay nada que cambiar: es la señal de no-op de
 * `mutateTenantSettingsAtomic`, que así no reescribe la fila ni toca
 * `updated_at`.
 */
export function applyFirstReply(
    current: Readonly<Record<string, unknown>>,
    at: string,
): Readonly<Record<string, unknown>> {
    const storedStage = current.onboardingStage;
    const stage = advanceOnboardingStage(storedStage, 'live');
    const stageMoves = storedStage !== stage;
    // Solo una cuenta que vive bajo el contrato y todavía no estaba `live`
    // recibe la hora. Una etapa `live` sin hora se escribió antes de que la
    // hora existiera —o es la cuenta sin contrato que la llamada anterior pasó
    // a `live`— y el contrato ya la trata como activa sin ella.
    const stamp = !isRecordedFirstReply(current[FIRST_REPLY_SETTING_KEY])
        && isOnboardingStage(storedStage) && storedStage !== 'live';
    if (!stageMoves && !stamp) return current;
    return {
        ...current,
        ...(stageMoves ? { onboardingStage: stage } : {}),
        ...(stamp ? { [FIRST_REPLY_SETTING_KEY]: at } : {}),
    };
}

/**
 * Registra que el agente le respondió a un cliente real. Idempotente, nunca
 * lanza. Se puede llamar sin esperar (`void recordFirstReply(...)`); devolver
 * el resultado es para las pruebas y para quien quiera loguearlo.
 */
export async function recordFirstReply(
    prisma: PrismaService,
    tenantId: string | null | undefined,
    options: FirstReplyOptions = {},
): Promise<FirstReplyOutcome> {
    if (!tenantId) return 'skipped';
    if (settledTenants.has(tenantId)) return 'remembered';
    settledTenants.add(tenantId);
    try {
        const at = (options.at ?? new Date()).toISOString();
        let changed = false;
        await mutateTenantSettingsAtomic(prisma, tenantId, (current) => {
            const next = applyFirstReply(current, at);
            changed = next !== current;
            return next as Record<string, unknown>;
        });
        if (changed) {
            logger.log(`First reply recorded for tenant ${tenantId} (${options.source ?? 'unknown'})`);
            const reportedChannel = options.channelType ?? (options.source === 'web_widget' ? 'web_widget' : null);
            const channelType = reportedChannel
                && (CERTIFIED_SELF_SERVICE_CHANNELS as readonly string[]).includes(reportedChannel)
                ? reportedChannel
                : null;
            void recordOnboardingEvent(prisma, {
                tenantId,
                event: 'first_operational_reply',
                channelType,
                detail: options.source ?? null,
                occurredAt: options.at,
                dedupeKey: onboardingOnceKey('first_operational_reply', tenantId),
            });
        }
        return changed ? 'recorded' : 'already_recorded';
    } catch (error: any) {
        settledTenants.delete(tenantId);
        logger.warn(`First reply not recorded for tenant ${tenantId} (${options.source ?? 'unknown'}): `
            + String(error?.message ?? error));
        return 'failed';
    }
}
