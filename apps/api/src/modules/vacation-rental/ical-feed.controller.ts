import { Controller, Get, Param, Res, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { IcalSyncService } from './ical-sync.service';

/**
 * Public iCal feed endpoint — no auth required.
 * Serves .ics calendar files for Airbnb/Booking.com to import.
 * Route: /api/v1/public/ical/:tenantSlug/:propertyId/:token/calendar.ics
 */
@ApiTags('public-ical')
@Controller('public/ical')
export class IcalFeedController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly icalSyncService: IcalSyncService,
    ) {}

    private async resolveSchema(tenantSlug: string): Promise<string> {
        const rows = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants
            WHERE slug = ${tenantSlug} AND is_active = true
            LIMIT 1
        `;
        if (!rows?.[0]) throw new BadRequestException('Tenant not found');
        return rows[0].schema_name;
    }

    @Get(':tenantSlug/:propertyId/:token/calendar.ics')
    @ApiOperation({ summary: 'Public iCal feed for a property (no auth, token validated)' })
    async getCalendarFeed(
        @Param('tenantSlug') tenantSlug: string,
        @Param('propertyId') propertyId: string,
        @Param('token') token: string,
        @Res() res: Response,
    ) {
        const schemaName = await this.resolveSchema(tenantSlug);

        // Validate export token
        const isValid = await this.icalSyncService.validateExportToken(schemaName, propertyId, token);
        if (!isValid) {
            throw new BadRequestException('Invalid or expired feed token');
        }

        // Generate .ics content
        const icsContent = await this.icalSyncService.generateFeed(schemaName, propertyId);

        res.set({
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="calendar.ics"`,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.send(icsContent);
    }
}
