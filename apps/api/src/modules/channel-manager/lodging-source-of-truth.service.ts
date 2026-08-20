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
 */

export type LodgingSystemOfRecord = 'local' | 'channel_manager';

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
    writerBlockedReason?: 'channel_manager_owns_calendar';
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
     * Fails **open to local** on error: a tenant with no Channel Manager at all
     * is the common case, and blocking every direct booking because a lookup
     * hiccuped would break the majority to protect the minority. What never
     * fails open is the opposite direction — a property known to be mapped is
     * never downgraded to local by a transient error, because the mapping row
     * is read in the same query as the config.
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
        try {
            await this.redis.setJson(cacheKey, resolution, CACHE_TTL_SECONDS);
        } catch {
            // Nothing to do: the value is correct, only uncached.
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
        const localOnly: LodgingSorResolution = {
            sor: 'local',
            connected: false,
            stale: false,
            health: 'unknown',
        };

        let config: Awaited<ReturnType<ChannelManagerService['getConfig']>> = null;
        try {
            config = await this.channelManager.getConfig(tenantId);
        } catch (error: any) {
            this.logger.warn(`[LodgingSoR] config read failed for ${tenantId}: ${error?.message}`);
            return localOnly;
        }
        // `direct` means the tenant manages its own calendar through Parallly.
        if (!config || !config.provider || config.provider === 'direct') return localOnly;

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
            // The table may not exist yet for this tenant, which simply means no
            // property is bridged.
            this.logger.debug?.(`[LodgingSoR] no cm_listings for ${schemaName}: ${error?.message}`);
            return { ...localOnly, connected: true, provider: config.provider };
        }

        if (!listing) {
            // Connected, but this unit is not bridged: Parallly still owns it.
            return { ...localOnly, connected: true, provider: config.provider };
        }

        const lastSyncedAt = listing.last_synced_at
            ? new Date(listing.last_synced_at).toISOString()
            : undefined;
        const intervalMinutes = Number(config.syncInterval) > 0
            ? Number(config.syncInterval)
            : DEFAULT_SYNC_INTERVAL_MINUTES;
        const stale = !lastSyncedAt
            || (Date.now() - Date.parse(lastSyncedAt)) > intervalMinutes * STALE_MULTIPLIER * 60_000;

        return {
            sor: 'channel_manager',
            connected: true,
            provider: config.provider,
            listingId: listing.id,
            lastSyncedAt,
            stale,
            health: stale ? 'degraded' : 'healthy',
            writerBlockedReason: 'channel_manager_owns_calendar',
        };
    }
}
