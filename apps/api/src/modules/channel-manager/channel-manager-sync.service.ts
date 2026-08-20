import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { ChannelManagerService } from './channel-manager.service';
import { LodgingSourceOfTruthService } from './lodging-source-of-truth.service';

/**
 * Keeps the Channel Manager mirror fresh.
 *
 * `syncInterval` was a configurable field nothing read: the only way a listing
 * or a reservation ever reached `cm_*` was a tenant admin pressing "sync" by
 * hand. A mirror nobody refreshes is worse than no mirror, because availability
 * answers get more confidently wrong over time.
 *
 * Pull-only by design. Write-back to the provider needs verified credentials
 * and a certified mapping per provider version; until then the local writer
 * stays blocked for bridged units (see `LodgingSourceOfTruthService`) rather
 * than writing bookings the PMS will never see.
 */
@Injectable()
export class ChannelManagerSyncService {
    private readonly logger = new Logger(ChannelManagerSyncService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly channelManager: ChannelManagerService,
        private readonly lodgingSor: LodgingSourceOfTruthService,
        private readonly cronLock: CronLockService,
    ) {}

    /**
     * Runs every 15 minutes and syncs only the tenants whose own
     * `syncInterval` has elapsed, so a tenant asking for hourly sync is not
     * polled four times an hour.
     *
     * TTL is half the tick, per the CronLock rule: long enough that the twin
     * process does not double-run, short enough that the next tick is not
     * skipped. API and worker both boot AppModule, so without this every sync
     * would fire twice against the provider's rate limit.
     */
    @Cron('*/15 * * * *')
    async syncDueTenantsCron(): Promise<void> {
        await this.cronLock.runExclusive(
            'channel-manager.syncDueTenants',
            450,
            () => this.syncDueTenants(),
            { prefer: 'worker' },
        );
    }

    async syncDueTenants(): Promise<{ tenants: number; synced: number; failed: number }> {
        let tenants: Array<{ id: string; schemaName: string; settings: any }> = [];
        try {
            tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, schemaName: true, settings: true },
            }) as any;
        } catch (error: any) {
            this.logger.error(`[CM Sync] tenant enumeration failed: ${error?.message}`);
            return { tenants: 0, synced: 0, failed: 0 };
        }

        let synced = 0;
        let failed = 0;
        let considered = 0;

        for (const tenant of tenants) {
            const config = (tenant.settings as any)?.channelManager;
            // Only providers we actually pull from. `direct` and `ical` are
            // handled by the tenant's own calendar and the iCal sync service.
            if (!config || config.provider !== 'hostaway') continue;
            considered++;

            const intervalMinutes = Number(config.syncInterval) > 0 ? Number(config.syncInterval) : 60;
            const lastSyncedAt = await this.lastSyncedAt(tenant.schemaName);
            if (lastSyncedAt && (Date.now() - lastSyncedAt) < intervalMinutes * 60_000) continue;

            try {
                const result = await this.channelManager.syncHostaway(tenant.id);
                synced++;
                this.logger.log(
                    `[CM Sync] ${tenant.id}: ${result.listings} listings, ${result.reservations} reservations`,
                );
            } catch (error: any) {
                failed++;
                // A provider outage must not stop the other tenants, and it must
                // not silently look like a successful empty sync: the staleness
                // of `last_synced_at` is what degrades availability answers.
                this.logger.warn(`[CM Sync] ${tenant.id} failed: ${error?.message}`);
            }
            await this.lodgingSor.invalidate(tenant.id).catch(() => undefined);
        }

        return { tenants: considered, synced, failed };
    }

    /** Most recent successful mirror write for a tenant, in epoch ms. */
    private async lastSyncedAt(schemaName: string): Promise<number | null> {
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT MAX(last_synced_at) AS last_synced_at FROM cm_listings`,
            );
            const value = rows?.[0]?.last_synced_at;
            if (!value) return null;
            const parsed = new Date(value).getTime();
            return Number.isNaN(parsed) ? null : parsed;
        } catch {
            // No mirror table yet: treat as never synced so the first run pulls.
            return null;
        }
    }
}
