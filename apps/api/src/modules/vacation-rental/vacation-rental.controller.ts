import {
    Controller, Get, Post, Put, Delete, Param, Body, Query,
    UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PropertiesService } from './properties.service';
import { IcalSyncService } from './ical-sync.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('vacation-rental')
@Controller('vacation-rental')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class VacationRentalController {
    constructor(
        private readonly propertiesService: PropertiesService,
        private readonly icalSyncService: IcalSyncService,
        private readonly prisma: PrismaService,
    ) {}

    // ── Properties CRUD ─────────────────────────────────────────

    @Get(':tenantId/properties')
    @ApiOperation({ summary: 'List all active properties' })
    async listProperties(@Param('tenantId') tenantId: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.propertiesService.list(schemaName);
        return { success: true, data };
    }

    @Post(':tenantId/properties')
    @ApiOperation({ summary: 'Create a new property' })
    async createProperty(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.propertiesService.create(tenantId, schemaName, body);
        return { success: true, data };
    }

    @Get(':tenantId/properties/:propertyId')
    @ApiOperation({ summary: 'Get property by ID' })
    async getProperty(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.propertiesService.getById(schemaName, propertyId);
        if (!data) throw new BadRequestException('Property not found');
        return { success: true, data };
    }

    @Put(':tenantId/properties/:propertyId')
    @ApiOperation({ summary: 'Update a property' })
    async updateProperty(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.propertiesService.update(schemaName, propertyId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/properties/:propertyId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft-delete a property' })
    async deleteProperty(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.propertiesService.delete(schemaName, propertyId);
        return { success: true };
    }

    // ── Availability & Calendar ─────────────────────────────────

    @Get(':tenantId/properties/:propertyId/availability')
    @ApiOperation({ summary: 'Check property availability for given dates' })
    async checkAvailability(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
        @Query('checkIn') checkIn: string,
        @Query('checkOut') checkOut: string,
    ) {
        if (!checkIn || !checkOut) throw new BadRequestException('checkIn and checkOut query params are required');
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.propertiesService.checkAvailability(schemaName, propertyId, checkIn, checkOut);
        return { success: true, data };
    }

    @Get(':tenantId/properties/:propertyId/calendar')
    @ApiOperation({ summary: 'Get monthly calendar view with availability status' })
    async getCalendar(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
        @Query('month') month: string,
    ) {
        if (!month) throw new BadRequestException('month query param is required (format: YYYY-MM)');
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.propertiesService.getCalendar(schemaName, propertyId, month);
        return { success: true, data };
    }

    @Post(':tenantId/properties/:propertyId/blocks')
    @ApiOperation({ summary: 'Create a manual calendar block' })
    async createBlock(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
        @Body() body: { checkIn: string; checkOut: string; summary?: string },
    ) {
        if (!body.checkIn || !body.checkOut) {
            throw new BadRequestException('checkIn and checkOut are required');
        }
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.propertiesService.createBlock(schemaName, propertyId, body);
        return { success: true, data };
    }

    // Same reasoning as the sync endpoint: this now reaches imported blocks
    // too, so it can free a date an OTA still holds.
    @Delete(':tenantId/blocks/:blockId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Delete a calendar block (manual or imported)' })
    async deleteBlock(
        @Param('tenantId') tenantId: string,
        @Param('blockId') blockId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.propertiesService.deleteBlock(schemaName, blockId);
        return { success: true };
    }

    // ── Bookings ────────────────────────────────────────────────

    @Get(':tenantId/properties/:propertyId/bookings')
    @ApiOperation({ summary: 'List bookings for a property' })
    async listBookings(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.propertiesService.listBookings(schemaName, propertyId);
        return { success: true, data };
    }

    @Post(':tenantId/properties/:propertyId/bookings')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Create a direct booking' })
    async createBooking(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.propertiesService.createBooking(schemaName, propertyId, body);
        return { success: true, data };
    }

    @Put(':tenantId/bookings/:bookingId/cancel')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Cancel a booking' })
    async cancelBooking(
        @Param('tenantId') tenantId: string,
        @Param('bookingId') bookingId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.propertiesService.cancelBooking(schemaName, bookingId);
        return { success: true };
    }

    // ── iCal Feeds ──────────────────────────────────────────────

    @Get(':tenantId/properties/:propertyId/feeds')
    @ApiOperation({ summary: 'List iCal feeds for a property' })
    async listFeeds(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM ical_feeds WHERE property_id = $1::uuid AND is_active = true ORDER BY created_at DESC`,
            [propertyId],
        );
        return { success: true, data };
    }

    @Post(':tenantId/properties/:propertyId/feeds')
    @ApiOperation({ summary: 'Add an iCal feed for a property' })
    async addFeed(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
        @Body() body: { feedName: string; source: string; importUrl: string },
    ) {
        if (!body.feedName || !body.source) {
            throw new BadRequestException('feedName and source are required');
        }

        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        // Generate an export token for the reverse feed
        const crypto = await import('crypto');
        const exportToken = crypto.randomBytes(32).toString('hex');

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO ical_feeds (property_id, feed_name, source, import_url, export_token)
             VALUES ($1::uuid, $2, $3, $4, $5)
             RETURNING *`,
            [propertyId, body.feedName, body.source, body.importUrl || null, exportToken],
        );

        const created = rows?.[0];

        // Trigger an initial sync immediately so users see imported blocks
        // without waiting up to 30 min for the cron. Failures are reflected
        // in last_sync_status but do NOT roll back the feed creation —
        // the user can fix the URL and retry from the UI.
        let syncResult: { imported: number; deleted: number } | null = null;
        if (created?.id && body.importUrl) {
            try {
                syncResult = await this.icalSyncService.syncFeed(schemaName, created.id);
            } catch (err: any) {
                // syncFeed already persists the error state; just log here
                console.error(`[addFeed] initial sync failed for ${created.id}:`, err?.message);
            }

            // Re-read the row to include last_sync_at / events_imported
            const refreshed = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM ical_feeds WHERE id = $1::uuid`,
                [created.id],
            );
            return { success: true, data: refreshed?.[0] || created, sync: syncResult };
        }

        return { success: true, data: created };
    }

    @Put(':tenantId/feeds/:feedId')
    @ApiOperation({ summary: 'Update an iCal feed' })
    async updateFeed(
        @Param('tenantId') tenantId: string,
        @Param('feedId') feedId: string,
        @Body() body: { feedName?: string; importUrl?: string },
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (body.feedName !== undefined) {
            sets.push(`feed_name = $${idx}`);
            params.push(body.feedName);
            idx++;
        }
        if (body.importUrl !== undefined) {
            sets.push(`import_url = $${idx}`);
            params.push(body.importUrl);
            idx++;
        }

        if (sets.length === 0) return { success: true };

        sets.push(`updated_at = NOW()`);
        params.push(feedId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE ical_feeds SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            params,
        );

        return { success: true, data: rows?.[0] };
    }

    @Delete(':tenantId/feeds/:feedId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Delete an iCal feed' })
    async deleteFeed(
        @Param('tenantId') tenantId: string,
        @Param('feedId') feedId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE ical_feeds SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [feedId],
        );
        return { success: true };
    }

    // Freeing dates is the expensive direction (it can produce a double
    // booking), and a sync — `force` especially — can free them in bulk.
    // RolesGuard waves through any handler with no @Roles metadata, so without
    // this the lowest role in the tenant could clear a whole calendar.
    @Post(':tenantId/feeds/:feedId/sync')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Manually trigger iCal feed sync' })
    async syncFeed(
        @Param('tenantId') tenantId: string,
        @Param('feedId') feedId: string,
        // `force=true` skips the empty-calendar grace period. The owner has
        // already checked the OTA and knows the dates are free — this is the
        // escape hatch for a feed that emptied out and left blocks stranded.
        @Query('force') force?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const result = await this.icalSyncService.syncFeed(schemaName, feedId, {
            force: force === 'true',
        });
        return { success: true, data: result };
    }
}
