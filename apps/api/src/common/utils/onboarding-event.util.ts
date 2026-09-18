import { Logger } from '@nestjs/common';
import type {
    OnboardingClientEventRecord,
    OnboardingEventSource,
    OnboardingServerEvent,
} from '@parallext/shared';
import { onboardingClientKey } from '@parallext/shared';
import type { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * El único escritor de `public.onboarding_events`.
 *
 * Mismas reglas que `recordFirstReply`, por las mismas razones:
 * - **Nunca lanza.** Se llama desde caminos que ya hicieron su trabajo (un
 *   canal conectado, una respuesta enviada); perder una medición cuesta un
 *   punto en un gráfico, romper la conexión por medirla sería inaceptable.
 * - **La primera escritura gana.** Un hito lleva `dedupeKey` y el índice único
 *   parcial descarta el segundo, así que el tiempo hasta el primer canal no se
 *   mueve cuando la dueña reconecta.
 * - **Barata en caminos calientes.** Una clave ya escrita por este proceso no
 *   vuelve a la base. Un reinicio la olvida; la base la vuelve a descartar.
 *
 * Nunca se llama dentro del transformador de `mutateTenantSettingsAtomic`:
 * ese corre con la fila del tenant tomada (`SELECT … FOR UPDATE`) y cualquier
 * espera ahí la extiende. Se llama después del commit.
 */

export interface OnboardingEventInput {
    tenantId: string | null | undefined;
    event: OnboardingServerEvent;
    channelType?: string | null;
    step?: string | null;
    /** Un código de la lista del contrato (superficie, respuesta, código de error). Nunca texto libre. */
    detail?: string | null;
    userId?: string | null;
    /**
     * Cuándo ocurrió de verdad. Solo lo pasa quien registra algo que pasó
     * antes (la reparación de calidad descubre una conexión vieja): usar la
     * hora de ahora inventaría un tiempo hasta el primer canal.
     */
    occurredAt?: Date | null;
    /** Con clave, el evento queda una sola vez. Sin clave, se repite. */
    dedupeKey?: string | null;
    source?: Extract<OnboardingEventSource, 'server' | 'derived'>;
}

const logger = new Logger('OnboardingEvents');

/** Claves que este proceso ya escribió. Acotado: es un atajo, no la verdad. */
const writtenKeys = new Set<string>();
const WRITTEN_KEYS_CAP = 20_000;

/** Solo para las pruebas. */
export function forgetOnboardingEventMemoryForTests(): void {
    writtenKeys.clear();
}

const INSERT_SQL = `INSERT INTO public.onboarding_events
    (tenant_id, user_id, event, channel_type, step, detail, source, session_id, dedupe_key, occurred_at)
    VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid, $9, COALESCE($10::timestamptz, clock_timestamp()))
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`;

function remember(key: string): void {
    if (writtenKeys.size >= WRITTEN_KEYS_CAP) writtenKeys.clear();
    writtenKeys.add(key);
}

/**
 * Registra un hito del servidor. Idempotente con `dedupeKey`, nunca lanza.
 * Se puede llamar sin esperar (`void recordOnboardingEvent(...)`).
 */
export async function recordOnboardingEvent(
    prisma: PrismaService,
    input: OnboardingEventInput,
): Promise<'recorded' | 'remembered' | 'skipped' | 'failed'> {
    if (!input.tenantId) return 'skipped';
    // Several isolated domain tests use a deliberately narrow Prisma double.
    // Telemetry is optional for the business action and should stay silent
    // when that writer is not part of the supplied boundary.
    if (typeof (prisma as any)?.$executeRawUnsafe !== 'function') return 'skipped';
    const key = input.dedupeKey ?? null;
    if (key && writtenKeys.has(key)) return 'remembered';
    try {
        await prisma.$executeRawUnsafe(
            INSERT_SQL,
            input.tenantId,
            input.userId ?? null,
            input.event,
            input.channelType ?? null,
            input.step ?? null,
            input.detail ?? null,
            input.source ?? 'server',
            null,
            key,
            input.occurredAt ? input.occurredAt.toISOString() : null,
        );
        if (key) remember(key);
        return 'recorded';
    } catch (error: any) {
        logger.warn(`Onboarding event ${input.event} not recorded for tenant ${input.tenantId}: `
            + String(error?.message ?? error));
        return 'failed';
    }
}

/**
 * Registra un lote ya saneado del panel. La hora es SIEMPRE la del servidor:
 * un reloj del navegador no mide nada. Devuelve cuántos entraron.
 */
export async function recordOnboardingClientEvents(
    prisma: PrismaService,
    tenantId: string,
    userId: string | null,
    sessionId: string,
    events: readonly OnboardingClientEventRecord[],
): Promise<number> {
    if (typeof (prisma as any)?.$executeRawUnsafe !== 'function') return 0;
    let accepted = 0;
    for (const record of events) {
        const key = onboardingClientKey(tenantId, sessionId, record);
        if (writtenKeys.has(key)) continue;
        try {
            const inserted = await prisma.$executeRawUnsafe(
                INSERT_SQL,
                tenantId,
                userId,
                record.event,
                record.channelType ?? null,
                record.step ?? null,
                record.detail ?? null,
                'client',
                sessionId,
                key,
                null,
            );
            remember(key);
            accepted += Number(inserted) > 0 ? 1 : 0;
        } catch (error: any) {
            logger.warn(`Onboarding client event ${record.event} not recorded for tenant ${tenantId}: `
                + String(error?.message ?? error));
        }
    }
    return accepted;
}
