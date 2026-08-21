import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChannelManagerService } from './channel-manager.service';

/**
 * Which system owns a lodging unit's calendar.
 *
 * Two independent registries existed for the same nights. The agent read and
 * wrote `properties`/`property_bookings`; Channel Manager kept
 * `cm_listings`/`cm_reservations` fed from Hostaway. Nothing bridged them and
 * nothing wrote back, so a Hostaway booking was invisible to the agent and an
 * agent booking never reached the PMS. Both registries could sell the same
 * night — the one failure mode that costs a host a guest and a review.
 *
 * The rule is deliberately asymmetric because the write direction is the
 * dangerous one:
 *
 * - **Reads always merge.** A property mapped to a Channel Manager listing adds
 *   `cm_reservations` to its conflict set, so the agent never offers a night the
 *   PMS already sold.
 * - **Writes fail closed.** When the Channel Manager owns a unit, the local
 *   writer is disabled and the turn goes to a human. Writing locally would
 *   create a booking the PMS never learns about; that is a double booking with
 *   extra steps. Write-back to Hostaway needs verified credentials and a
 *   certified mapping, so until then the honest answer is "the team confirms".
 *
 * ═══ Y "NO PUDE AVERIGUARLO" NO ES "ES LOCAL" ═══
 *
 * Esa asimetría estaba escrita y no se cumplía. La versión anterior de este
 * archivo afirmaba que *"una propiedad que se sabe mapeada nunca se degrada a
 * local por un error transitorio, porque la fila del mapeo se lee en la misma
 * consulta que la config"*. Las dos cosas eran falsas: son **dos** lecturas
 * separadas y **las dos** devolvían `local` al fallar.
 *
 * Tres caminos llevaban a escribir localmente una unidad que el PMS administra:
 * que fallara `getConfig` —que además **descifra**, así que una clave rotada
 * bastaba—, que fallara la consulta a `cm_listings`, o que fallara la
 * resolución entera en el llamador. Los tres terminaban en "es local", que es
 * el estado que **permite escribir**.
 *
 * Ahora hay tres estados y el orden de lectura está invertido:
 *
 * 1. Se lee **primero el mapeo**, que es la verdad sobre quién administra la
 *    unidad. No depende de poder leer ni descifrar la config.
 * 2. `42P01` —la tabla no existe— es una respuesta definitiva: este tenant no
 *    tiene ninguna unidad puenteada. Es la única falla que puede concluir
 *    `local`.
 * 3. Cualquier otra falla es `unknown`, y `unknown` **no escribe**.
 */

export type LodgingSystemOfRecord = 'local' | 'channel_manager' | 'unknown';

export interface LodgingSorResolution {
    sor: LodgingSystemOfRecord;
    /** True when a Channel Manager connection exists for the tenant at all. */
    connected: boolean;
    provider?: string;
    /** Mapped `cm_listings.id`, when this property is bridged. */
    listingId?: string;
    lastSyncedAt?: string;
    /** `asOf` older than the tenant's own `syncInterval` window. */
    stale: boolean;
    health: 'healthy' | 'degraded' | 'unknown';
    /** Why the local writer is blocked, when it is. */
    writerBlockedReason?: 'channel_manager_owns_calendar' | 'ownership_unknown';
}

/**
 * Si este estado permite que el escritor local cree una reserva.
 *
 * Se pregunta así y no comparando contra `'channel_manager'`: la comparación
 * que había —`sor === 'channel_manager'` para bloquear— dejaba pasar cualquier
 * estado nuevo por omisión, y el estado nuevo es justamente el que no debe
 * pasar.
 */
export function localWriterAllowed(resolution: LodgingSorResolution): boolean {
    return resolution.sor === 'local';
}

/** El código de PostgreSQL para "esa tabla no existe". */
const UNDEFINED_TABLE = '42P01';

function tableIsAbsent(error: any): boolean {
    const code = error?.code ?? error?.meta?.code ?? error?.originalError?.code;
    if (code === UNDEFINED_TABLE) return true;
    // Prisma envuelve el error crudo y el código no siempre sobrevive; el texto
    // de PostgreSQL sí. Se acepta sólo esta forma, no cualquier mensaje que
    // hable de tablas: confundirse acá abre la puerta que esto cierra.
    return /relation .*cm_listings.* does not exist/i.test(String(error?.message ?? ''));
}

const CACHE_TTL_SECONDS = 60;
/** A mirror this old cannot be trusted to answer "is this night free?". */
const DEFAULT_SYNC_INTERVAL_MINUTES = 60;
const STALE_MULTIPLIER = 3;

@Injectable()
export class LodgingSourceOfTruthService {
    private readonly logger = new Logger(LodgingSourceOfTruthService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly channelManager: ChannelManagerService,
    ) {}

    /**
     * Resolve who owns this property's calendar.
     *
     * Concluye `local` sólo con una respuesta **definitiva**: no hay mapeo, o
     * la tabla de mapeos no existe en este tenant. Un tenant sin Channel
     * Manager es el caso común y sigue reservando directo sin fricción.
     *
     * Lo que ya no pasa es lo contrario: una falla al averiguarlo devuelve
     * `unknown`, y `unknown` no escribe. Bloquear una reserva directa que se
     * podía hacer cuesta un mensaje; escribir una que el PMS nunca ve cuesta la
     * noche vendida dos veces.
     */
    async resolveForProperty(
        tenantId: string,
        schemaName: string,
        propertyId: string,
    ): Promise<LodgingSorResolution> {
        const cacheKey = `lodging:sor:${tenantId}:${propertyId}`;
        try {
            const cached = await this.redis.getJson<LodgingSorResolution>(cacheKey);
            if (cached) return cached;
        } catch {
            // Cache misses are not failures; fall through to the live read.
        }

        const resolution = await this.readResolution(tenantId, schemaName, propertyId);
        // `unknown` NO se cachea. Es un "no pude averiguarlo", y guardarlo
        // convertiría un tropiezo de una consulta en un minuto entero de
        // reservas directas bloqueadas para ese alojamiento. La próxima llamada
        // vuelve a preguntar.
        if (resolution.sor !== 'unknown') {
            try {
                await this.redis.setJson(cacheKey, resolution, CACHE_TTL_SECONDS);
            } catch {
                // Nothing to do: the value is correct, only uncached.
            }
        }
        return resolution;
    }

    /** Drop the cached decision after a mapping or config change. */
    async invalidate(tenantId: string, propertyId?: string): Promise<void> {
        if (propertyId) {
            await this.redis.del(`lodging:sor:${tenantId}:${propertyId}`).catch(() => undefined);
            return;
        }
        // Without a property we cannot enumerate keys cheaply; the 60s TTL
        // bounds how long a stale decision can survive.
    }

    private async readResolution(
        tenantId: string,
        schemaName: string,
        propertyId: string,
    ): Promise<LodgingSorResolution> {
        const notBridged: LodgingSorResolution = {
            sor: 'local',
            connected: false,
            stale: false,
            health: 'unknown',
        };

        // ── (1) El mapeo primero ──────────────────────────────────────────
        //
        // Es la verdad sobre quién administra ESTA unidad, y se lee sin
        // depender de poder leer ni **descifrar** la config del tenant. Antes
        // la config iba primero: una clave de cifrado rotada bastaba para que
        // una unidad de Hostaway pasara a escribirse localmente.
        let listing: any = null;
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, provider, last_synced_at
                   FROM cm_listings
                  WHERE property_id = $1::uuid AND status = 'active'
                  ORDER BY last_synced_at DESC NULLS LAST
                  LIMIT 1`,
                [propertyId],
            );
            listing = rows?.[0] ?? null;
        } catch (error: any) {
            if (tableIsAbsent(error)) {
                // Definitivo: este tenant nunca puenteó nada.
                this.logger.debug?.(`[LodgingSoR] sin cm_listings en ${schemaName}`);
                return this.withConnectionInfo(tenantId, notBridged);
            }
            // Cualquier otra cosa —permisos, timeout, la conexión caída— es no
            // saber. Y no saber quién administra el calendario no autoriza a
            // escribir en él.
            this.logger.error(
                `[LodgingSoR] no se pudo determinar el dueño del calendario de ${propertyId} `
                + `en ${schemaName}: ${error?.message}`,
            );
            return {
                sor: 'unknown',
                connected: false,
                stale: true,
                health: 'unknown',
                writerBlockedReason: 'ownership_unknown',
            };
        }

        if (!listing) return this.withConnectionInfo(tenantId, notBridged);

        // ── (2) Mapeada. La config sólo enriquece ─────────────────────────
        //
        // El proveedor sale de la fila, no de la config: la unidad está
        // puenteada aunque la config no se pueda leer, y el bloqueo no depende
        // de un dato que sólo sirve para el mensaje.
        const lastSyncedAt = listing.last_synced_at
            ? new Date(listing.last_synced_at).toISOString()
            : undefined;
        const config = await this.safeConfig(tenantId);
        const intervalMinutes = Number(config?.syncInterval) > 0
            ? Number(config?.syncInterval)
            : DEFAULT_SYNC_INTERVAL_MINUTES;
        const stale = !lastSyncedAt
            || (Date.now() - Date.parse(lastSyncedAt)) > intervalMinutes * STALE_MULTIPLIER * 60_000;

        return {
            sor: 'channel_manager',
            connected: true,
            provider: listing.provider ?? config?.provider,
            listingId: listing.id,
            lastSyncedAt,
            stale,
            health: stale ? 'degraded' : 'healthy',
            writerBlockedReason: 'channel_manager_owns_calendar',
        };
    }

    /**
     * Completa "¿este tenant tiene un channel manager conectado?" para una
     * unidad que NO está puenteada.
     *
     * Es informativo: la decisión de escritura ya está tomada por la ausencia
     * de mapeo. Por eso un fallo acá no cambia el veredicto — a diferencia de
     * antes, cuando esta misma lectura decidía.
     */
    private async withConnectionInfo(
        tenantId: string,
        base: LodgingSorResolution,
    ): Promise<LodgingSorResolution> {
        const config = await this.safeConfig(tenantId);
        if (!config?.provider || config.provider === 'direct') return base;
        return { ...base, connected: true, provider: config.provider };
    }

    private async safeConfig(
        tenantId: string,
    ): Promise<Awaited<ReturnType<ChannelManagerService['getConfig']>>> {
        try {
            return await this.channelManager.getConfig(tenantId);
        } catch (error: any) {
            this.logger.warn(`[LodgingSoR] config read failed for ${tenantId}: ${error?.message}`);
            return null;
        }
    }
}
