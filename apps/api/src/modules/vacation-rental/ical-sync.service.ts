import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import * as ical from 'node-ical';
import ICalGenerator, { ICalCalendarMethod, ICalEventStatus } from 'ical-generator';

@Injectable()
export class IcalSyncService {
    private readonly logger = new Logger(IcalSyncService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Sync a single iCal feed — fetch URL, parse events, upsert blocks
     */
    async syncFeed(schemaName: string, feedId: string): Promise<{imported: number, deleted: number}> {
        // 1. Load feed config
        const feeds = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM ical_feeds WHERE id = $1::uuid AND is_active = true`,
            [feedId],
        );
        const feed = feeds?.[0];
        if (!feed || !feed.import_url) {
            this.logger.warn(`Feed ${feedId} not found or no import URL`);
            return { imported: 0, deleted: 0 };
        }

        try {
            // 2. Fetch and parse .ics
            const events = await ical.async.fromURL(feed.import_url);
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

                // Skip past events
                if (new Date(checkOut) < now) continue;

                // 3. UPSERT into ical_blocks
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `INSERT INTO ical_blocks (property_id, external_uid, source, check_in, check_out, summary, last_seen_at, is_deleted)
                     VALUES ($1::uuid, $2, $3, $4::date, $5::date, $6, NOW(), false)
                     ON CONFLICT (property_id, external_uid) DO UPDATE SET
                       check_in = EXCLUDED.check_in,
                       check_out = EXCLUDED.check_out,
                       summary = EXCLUDED.summary,
                       last_seen_at = NOW(),
                       is_deleted = false`,
                    [feed.property_id, uid, feed.source, checkIn, checkOut, vevent.summary || 'Blocked'],
                );
                imported++;
            }

            // 4. Mark blocks NOT seen in this sync as deleted (cancellations)
            let deleted = 0;
            if (seenUids.size > 0) {
                const result = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `UPDATE ical_blocks SET is_deleted = true
                     WHERE property_id = $1::uuid
                       AND source = $2
                       AND is_deleted = false
                       AND last_seen_at < NOW() - INTERVAL '2 hours'
                     RETURNING id`,
                    [feed.property_id, feed.source],
                );
                deleted = result?.length || 0;
            }

            // 5. Update feed status
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE ical_feeds SET last_sync_at = NOW(), last_sync_status = 'success',
                 last_sync_error = NULL, events_imported = $1, updated_at = NOW()
                 WHERE id = $2::uuid`,
                [imported, feedId],
            );

            this.logger.log(`Synced feed ${feedId} (${feed.source}): ${imported} imported, ${deleted} deleted`);
            return { imported, deleted };
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
            return { imported: 0, deleted: 0 };
        }
    }

    /**
     * Cron: sync all active feeds across all tenants every 30 minutes
     */
    @Cron('*/30 * * * *')
    async syncAllFeeds(): Promise<void> {
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
