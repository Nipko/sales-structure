import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as ical from 'node-ical';
import ICalGenerator, { ICalCalendarMethod, ICalEventStatus } from 'ical-generator';
import axios from 'axios';
import {
    type PinnedHttpsTarget,
    prepareSafeHttpsTarget,
    safeAxiosOptions,
} from '../../common/utils/safe-outbound-url.util';

export interface IcalSyncResult {
    imported: number;
    deleted: number;
    /** The feed answered with a well-formed calendar that carries zero events. */
    empty: boolean;
    /**
     * Blocks this sync WOULD have freed but held back, because losing that many
     * at once looks more like a broken export than a wave of cancellations.
     * 0 when nothing is on hold.
     */
    pendingSweep: number;
    /** Minutes left on the hold before the sweep goes through on its own. */
    holdMinutesLeft: number;
    /** Another run already had this feed locked; nothing was done. */
    skipped: boolean;
}

const EMPTY_RESULT: IcalSyncResult = {
    imported: 0, deleted: 0, empty: false, pendingSweep: 0, holdMinutesLeft: 0, skipped: false,
};

@Injectable()
export class IcalSyncService {
    private readonly logger = new Logger(IcalSyncService.name);

    /**
     * How long a suspicious mass-removal has to keep saying the same thing
     * before we act on it.
     *
     * An OTA that genuinely emptied its calendar and one whose export broke
     * answer identically in a single poll, so a poll count is no evidence at
     * all — the manual sync button would let three clicks in ten seconds
     * "confirm" it. Wall-clock is the only thing that can't be rushed.
     *
     * Freeing a date that is still booked causes a double booking; holding a
     * stale block another hour just annoys the owner. The tie breaks toward
     * holding, and `force` exists for when the owner has checked the OTA.
     */
    private static readonly SWEEP_HOLD_MINUTES = 90;

    /**
     * A sweep is "suspicious" when it would remove at least this many blocks
     * AND more than half of everything the feed currently holds. An ordinary
     * cancellation (one or two nights out of many) never trips it and lands
     * immediately; a feed that drops to zero — or to near-zero — does.
     */
    private static readonly BULK_SWEEP_MIN = 2;

    /** Schemas whose late-added columns we've already reconciled this process. */
    private readonly ensuredSchemas = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    /**
     * `feed_id` and `sweep_hold_since` landed after the tables shipped. The
     * deploy re-applies tenant-schema.sql per tenant but swallows failures
     * (`|| true`), so one tenant can silently miss them and every later sync
     * would 42703. Reconcile lazily instead of trusting that pass.
     *
     * Returns false when the schema is still missing them, so the caller can
     * bail BEFORE writing — a half-applied schema that fails only at step 5
     * would leave the tombstones committed and the feed marked 'error'.
     */
    private async ensureColumns(schemaName: string): Promise<boolean> {
        if (this.ensuredSchemas.has(schemaName)) return true;
        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `ALTER TABLE ical_blocks ADD COLUMN IF NOT EXISTS feed_id UUID`,
            );
            await this.prisma.executeInTenantSchema(
                schemaName,
                `ALTER TABLE ical_feeds ADD COLUMN IF NOT EXISTS sweep_hold_since TIMESTAMP`,
            );
            this.ensuredSchemas.add(schemaName);
            return true;
        } catch (e: any) {
            this.logger.error(`ensureColumns failed on ${schemaName}, skipping sync: ${e.message}`);
            return false;
        }
    }

    /**
     * Sync a single iCal feed — fetch URL, parse events, upsert blocks,
     * tombstone whatever the feed no longer carries.
     *
     * `force` skips the empty-streak grace so the dashboard can offer a
     * one-click cleanup when the owner has already confirmed on the OTA that
     * the dates are free.
     */
    async syncFeed(
        schemaName: string,
        feedId: string,
        opts: { force?: boolean } = {},
    ): Promise<IcalSyncResult> {
        if (!(await this.ensureColumns(schemaName))) return { ...EMPTY_RESULT, skipped: true };

        // One run per feed at a time. The cron fires in both the api and the
        // worker container, and the dashboard button can land on top of either;
        // two runs interleaving between "read the feed" and "tombstone what it
        // omits" is exactly how a stale snapshot frees a live booking.
        const feedLock = `lock:ical-feed:${feedId}`;
        const lockToken = await this.redis.acquireLockToken(feedLock, 120);
        if (!lockToken) {
            this.logger.debug(`Feed ${feedId} is already syncing; skipping`);
            return { ...EMPTY_RESULT, skipped: true };
        }

        try {
            return await this.runSync(schemaName, feedId, opts);
        } finally {
            await this.redis.releaseLockToken(feedLock, lockToken);
        }
    }

    private async runSync(
        schemaName: string,
        feedId: string,
        opts: { force?: boolean },
    ): Promise<IcalSyncResult> {
        // 1. Load feed config
        const feeds = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM ical_feeds WHERE id = $1::uuid AND is_active = true`,
            [feedId],
        );
        const feed = feeds?.[0];
        if (!feed || !feed.import_url) {
            this.logger.warn(`Feed ${feedId} not found or no import URL`);
            return { ...EMPTY_RESULT };
        }

        try {
            // 2. Fetch and parse .ics
            let url = feed.import_url.trim().replace(/&amp;/g, '&');
            url = url.replace(/[\u200B-\u200D\uFEFF]/g, '');

            // Resolve once and pin the public address used by the socket. A
            // syntactic hostname check is insufficient against DNS rebinding.
            let target: PinnedHttpsTarget;
            try {
                target = await prepareSafeHttpsTarget(url, 'feed iCal');
                url = target.url.toString();
            } catch {
                this.logger.warn(`Feed ${feedId}: URL insegura o invalida: ${url.substring(0, 80)}`);
                return { ...EMPTY_RESULT };
            }

            this.logger.log(`Fetching feed ${feedId} from ${url.substring(0, 50)}...`);

            const response = await axios.get(url, {
                ...safeAxiosOptions(target, 20000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Google-Calendar-Importer; +http://www.google.com/bot.html)',
                    'Accept': 'text/calendar, text/plain, */*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                },
                responseType: 'text',
                // Default axios only rejects >=300, but a proxy/login wall can
                // answer 2xx with HTML. The VCALENDAR check below is the real
                // gate; this just stops redirect bodies from getting that far.
                validateStatus: (s) => s >= 200 && s < 300,
            });

            this.logger.log(`Feed ${feedId} response status: ${response.status}, length: ${response.data?.length || 0}`);

            // A body that isn't a complete calendar must be an ERROR, never
            // "zero events" — otherwise it reads as "the OTA cancelled
            // everything" and the sweep below frees dates that are still booked.
            //
            // END:VCALENDAR is the load-bearing half: BEGIN alone still accepts
            // a TRUNCATED response (proxy flushing a partial object, a short
            // gzip decode), and node-ical happily parses a body that stops
            // mid-VEVENT and returns only the events it got. That yields a
            // plausible-looking SUBSET, which is far more dangerous than
            // garbage — garbage is obvious, a subset looks like cancellations.
            const body = String(response.data ?? '');
            if (!/BEGIN:VCALENDAR/i.test(body) || !/END:VCALENDAR/i.test(body)) {
                throw new Error(
                    `Response is not a complete iCalendar feed (${body.length} bytes): ` +
                    body.substring(0, 120).replace(/\s+/g, ' '),
                );
            }
            this.logger.debug(`Feed ${feedId} preview: ${body.substring(0, 200).replace(/\n/g, ' ')}`);

            const events = await ical.async.parseICS(body);
            const now = new Date();
            let imported = 0;
            const seenUids = new Set<string>();

            for (const event of Object.values(events)) {
                if ((event as any).type !== 'VEVENT') continue;
                const vevent = event as any;
                const uid = vevent.uid;
                if (!uid) continue;

                seenUids.add(uid);

                // DTEND is exclusive in iCal — subtract 1 day for our inclusive check_out
                let checkIn: string;
                let checkOut: string;

                if (vevent.datetype === 'date' || !vevent.start.getHours) {
                    // All-day event (VALUE=DATE) — Airbnb/Booking style
                    checkIn = vevent.start.toISOString().split('T')[0];
                    const endDate = new Date(vevent.end);
                    endDate.setDate(endDate.getDate() - 1); // DTEND exclusive → inclusive
                    checkOut = endDate.toISOString().split('T')[0];
                } else {
                    checkIn = vevent.start.toISOString().split('T')[0];
                    checkOut = vevent.end ? vevent.end.toISOString().split('T')[0] : checkIn;
                }

                // We import all events provided by the feed (including past ones) 
                // so the user can see historical blocks and recent checkouts in their calendar.

                // 3. UPSERT into ical_blocks
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `INSERT INTO ical_blocks (property_id, external_uid, source, check_in, check_out, summary, last_seen_at, is_deleted, feed_id)
                     VALUES ($1::uuid, $2, $3, $4::date, $5::date, $6, NOW(), false, $7::uuid)
                     ON CONFLICT (property_id, external_uid) DO UPDATE SET
                       check_in = EXCLUDED.check_in,
                       check_out = EXCLUDED.check_out,
                       summary = EXCLUDED.summary,
                       last_seen_at = NOW(),
                       is_deleted = false,
                       feed_id = EXCLUDED.feed_id`,
                    [feed.property_id, uid, feed.source, checkIn, checkOut, vevent.summary || 'Blocked', feedId],
                );
                imported++;
            }

            // 4. Tombstone whatever this feed no longer carries.
            //
            // Scoped to THIS feed, not to `source`. `source` is a free-text
            // label and the UI even offers a shared "Otro" bucket, so scoping
            // by it let two feeds on one property wipe each other's blocks.
            // The `feed_id IS NULL` arm only covers rows written before the
            // column existed, and only when no OTHER active feed could claim
            // them — the same ambiguity test the backfill in tenant-schema.sql
            // uses, so the two never disagree about who owns a row. Those rows
            // adopt a feed_id the next time their own feed re-exports them.
            //
            // `source <> 'Manual'` is hoisted over BOTH arms: createBlock
            // writes that literal, and addFeed takes `source` as free text, so
            // a feed named "Manual" must not be able to reach hand-made blocks
            // through either arm.
            const scope = `source <> 'Manual' AND (
                    feed_id = $2::uuid
                 OR (feed_id IS NULL AND source = $3 AND NOT EXISTS (
                        SELECT 1 FROM ical_feeds f2
                         WHERE f2.property_id = ical_blocks.property_id
                           AND f2.source = ical_blocks.source
                           AND f2.is_active = true
                           AND f2.id <> $2::uuid))
            )`;

            const uids = Array.from(seenUids);
            const isEmpty = seenUids.size === 0;

            // How much this sweep would remove, against how much the feed
            // holds. The ratio — not the emptiness — is what separates a wave
            // of cancellations from an export that broke. The hold clock is
            // read from the DB so app/DB clock skew can't shorten it.
            const stats = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT COUNT(*)::int AS live,
                        COUNT(*) FILTER (WHERE NOT (external_uid = ANY($4::text[])))::int AS stale
                   FROM ical_blocks
                  WHERE property_id = $1::uuid AND ${scope} AND is_deleted = false`,
                [feed.property_id, feedId, feed.source, uids],
            );
            const live = stats?.[0]?.live ?? 0;
            const stale = stats?.[0]?.stale ?? 0;

            // The hold clock is read from the DB, never from Date.now(): the
            // whole point is that it can't be shortened, and app/DB skew would
            // do exactly that. COALESCE so a hold that hasn't started yet
            // reports the FULL window remaining rather than 0.
            const holdRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT sweep_hold_since IS NOT NULL
                        AND sweep_hold_since < NOW() - ($2::int * INTERVAL '1 minute') AS elapsed,
                        GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
                            COALESCE(sweep_hold_since, NOW()) + ($2::int * INTERVAL '1 minute') - NOW()
                        )) / 60))::int AS minutes_left
                   FROM ical_feeds WHERE id = $1::uuid`,
                [feedId, IcalSyncService.SWEEP_HOLD_MINUTES],
            );
            const holdElapsed = holdRows?.[0]?.elapsed === true;
            const holdMinutesLeft = holdRows?.[0]?.minutes_left ?? IcalSyncService.SWEEP_HOLD_MINUTES;

            const bulk = stale >= IcalSyncService.BULK_SWEEP_MIN && stale * 2 > live;
            const sweep = !bulk || opts.force === true || holdElapsed;
            const holding = bulk && !sweep;

            let deleted = 0;
            if (sweep && stale > 0) {
                const result = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `UPDATE ical_blocks SET is_deleted = true
                     WHERE property_id = $1::uuid
                       AND ${scope}
                       AND is_deleted = false
                       AND NOT (external_uid = ANY($4::text[]))
                     RETURNING id`,
                    [feed.property_id, feedId, feed.source, uids],
                );
                deleted = result?.length || 0;
            } else if (holding) {
                this.logger.warn(
                    `Feed ${feedId} (${feed.source}) would free ${stale}/${live} block(s) in one pass ` +
                    `— holding for up to ${IcalSyncService.SWEEP_HOLD_MINUTES}min before trusting it`,
                );
            }

            // 5. Update feed status. `sweep_hold_since` starts the clock on the
            // first suspicious pass and is computed with NOW() rather than a JS
            // Date so repeated polls can't keep resetting it forward.
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE ical_feeds SET last_sync_at = NOW(), last_sync_status = 'success',
                   last_sync_error = NULL, events_imported = $1, updated_at = NOW(),
                   sweep_hold_since = CASE WHEN $2::boolean THEN COALESCE(sweep_hold_since, NOW()) ELSE NULL END
                 WHERE id = $3::uuid`,
                [imported, holding, feedId],
            );

            this.logger.log(
                `Synced feed ${feedId} (${feed.source}): ${imported} imported, ${deleted} deleted` +
                (holding ? `, ${stale} held` : ''),
            );
            return {
                imported,
                deleted,
                empty: isEmpty,
                pendingSweep: holding ? stale : 0,
                holdMinutesLeft: holding ? holdMinutesLeft : 0,
                skipped: false,
            };
        } catch (error: any) {
            // Update feed with error
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE ical_feeds SET last_sync_at = NOW(), last_sync_status = 'error',
                 last_sync_error = $1, updated_at = NOW()
                 WHERE id = $2::uuid`,
                [error.message?.substring(0, 500), feedId],
            );
            this.logger.error(`Feed sync failed ${feedId}: ${error.message}`);
            if (error.response) {
                this.logger.error(`Feed sync failed ${feedId} with response: ${error.response.status} - ${typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : JSON.stringify(error.response.data).substring(0, 200)}`);
            }
            // Deliberately NOT touching sweep_hold_since: a failed fetch says
            // nothing either way about what the calendar holds, so it must
            // neither start the hold clock nor reset one already running.
            return { ...EMPTY_RESULT };
        }
    }

    /**
     * Cron: sync all active feeds across all tenants every 30 minutes
     */
    @Cron('*/30 * * * *')
    async syncAllFeeds(): Promise<void> {
        // API and worker load the SAME AppModule with ScheduleModule, so every
        // @Cron fires in both containers.
        //
        // The TTL deliberately EXCEEDS the 30-min cadence: the loop is serial
        // across every tenant and every feed, and each fetch can burn the full
        // 20s timeout, so a slow run can outlive a sub-cadence TTL — at which
        // point the next tick starts a second full pass over the same feeds,
        // which is precisely what the lock exists to prevent. The token API
        // lets us release in `finally` so an early finish doesn't idle the
        // next tick, while a crashed holder still expires on its own.
        const lockKey = 'lock:ical-sync-all';
        const lockToken = await this.redis.acquireLockToken(lockKey, 55 * 60);
        if (!lockToken) {
            this.logger.debug('[Cron] another instance is already syncing iCal feeds');
            return;
        }

        this.logger.log('[Cron] Syncing all iCal feeds...');
        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;

            let totalSynced = 0;
            for (const tenant of tenants || []) {
                try {
                    const feeds = await this.prisma.executeInTenantSchema<any[]>(
                        tenant.schema_name,
                        `SELECT id FROM ical_feeds WHERE is_active = true AND import_url IS NOT NULL`,
                    );
                    for (const feed of feeds || []) {
                        await this.syncFeed(tenant.schema_name, feed.id);
                        totalSynced++;
                    }
                } catch (e: any) {
                    this.logger.warn(`Feed sync failed for tenant ${tenant.id}: ${e.message}`);
                }
            }
            this.logger.log(`[Cron] iCal sync complete: ${totalSynced} feeds processed`);
        } catch (e: any) {
            this.logger.error(`[Cron] iCal sync failed: ${e.message}`);
        } finally {
            await this.redis.releaseLockToken(lockKey, lockToken);
        }
    }

    /**
     * Generate .ics feed for a property (export to Airbnb/Booking)
     */
    async generateFeed(schemaName: string, propertyId: string): Promise<string> {
        // Load property info
        const properties = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT name FROM properties WHERE id = $1::uuid`,
            [propertyId],
        );
        const propertyName = properties?.[0]?.name || 'Property';

        // Load all blocks + bookings
        const blocks = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, check_in, check_out, source, summary FROM ical_blocks
             WHERE property_id = $1::uuid AND is_deleted = false`,
            [propertyId],
        );

        const bookings = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, check_in, check_out FROM property_bookings
             WHERE property_id = $1::uuid AND status != 'cancelled'`,
            [propertyId],
        );

        // Generate iCal
        const calendar = ICalGenerator({
            name: `${propertyName} - Parallly`,
            prodId: { company: 'Parallly', product: 'Vacation Rental', language: 'EN' },
            method: ICalCalendarMethod.PUBLISH,
        });

        // Add blocks from external sources
        for (const block of blocks || []) {
            const endDate = new Date(block.check_out);
            endDate.setDate(endDate.getDate() + 1); // Convert inclusive → exclusive DTEND

            const evt = calendar.createEvent({
                start: new Date(block.check_in),
                end: endDate,
                allDay: true,
                summary: 'BLOCKED',
                status: ICalEventStatus.CONFIRMED,
            });
            evt.uid(`block-${block.id}@parallly-chat.cloud`);
        }

        // Add direct bookings
        for (const booking of bookings || []) {
            const endDate = new Date(booking.check_out);
            endDate.setDate(endDate.getDate() + 1);

            const evt = calendar.createEvent({
                start: new Date(booking.check_in),
                end: endDate,
                allDay: true,
                summary: 'BLOCKED',
                status: ICalEventStatus.CONFIRMED,
            });
            evt.uid(`booking-${booking.id}@parallly-chat.cloud`);
        }

        return calendar.toString();
    }

    /**
     * Validate export token for public feed
     */
    async validateExportToken(schemaName: string, propertyId: string, token: string): Promise<boolean> {
        const result = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT 1 FROM ical_feeds WHERE property_id = $1::uuid AND export_token = $2 AND is_active = true LIMIT 1`,
            [propertyId, token],
        );
        return (result?.length || 0) > 0;
    }
}
