import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { IcalSyncService } from './ical-sync.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';

/**
 * Public iCal export — no auth required. Path matches what the dashboard shows
 * to users so they can paste it into Airbnb/Booking/etc. Security relies on the
 * unguessability of the tenant + property UUIDs (same model as Airbnb's own
 * exportable calendar URLs).
 */
@ApiTags('public-ical')
@Controller('vacation-rental')
export class IcalExportPublicController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly icalSyncService: IcalSyncService,
    ) {}

    @Get(':tenantId/properties/:propertyId/ical')
    @ApiOperation({ summary: 'Public iCal export for a property (no auth, UUID-protected)' })
    async getCalendar(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
        @Res() res: Response,
    ) {
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'read');
        if (!entitlement.allowed) throw new NotFoundException('Tenant not found');
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');

        const props = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT 1 FROM properties WHERE id = $1::uuid AND is_active = true LIMIT 1`,
            [propertyId],
        );
        if (!props?.length) throw new NotFoundException('Property not found');

        const ics = await this.icalSyncService.generateFeed(schemaName, propertyId);

        res.set({
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="calendar.ics"`,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.send(ics);
    }
}
