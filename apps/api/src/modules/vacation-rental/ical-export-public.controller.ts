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

    /**
     * Calendario para UNA OTA: no le devuelve lo que ella misma nos mandó.
     *
     * Es la ÚNICA ruta de exportación. La versión sin token —que servía el
     * calendario entero a cualquiera que supiera el id de la propiedad— se
     * eliminó por decisión del dueño: mientras existiera, una URL vieja pegada
     * en una extranet seguía devolviéndole a esa OTA sus propios bloqueos sin
     * que nadie pudiera notarlo. Ahora, si una URL quedó sin migrar, falla de
     * frente en vez de mentir en silencio.
     */
    @Get(':tenantId/properties/:propertyId/ical/:exportToken')
    @ApiOperation({ summary: 'Public iCal export scoped to one OTA (excludes its own blocks)' })
    async getCalendarForConsumer(
        @Param('tenantId') tenantId: string,
        @Param('propertyId') propertyId: string,
        @Param('exportToken') exportToken: string,
        @Res() res: Response,
    ) {
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'read');
        if (!entitlement.allowed) throw new NotFoundException('Tenant not found');
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');

        // El token identifica al consumidor. Un token que no existe devuelve 404
        // y NO el calendario completo: si no sabemos quién pregunta, no podemos
        // saber qué ocultarle.
        const feeds = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT f.id FROM ical_feeds f
               JOIN properties p ON p.id = f.property_id
              WHERE f.property_id = $1::uuid AND f.export_token = $2
                AND f.is_active = true AND p.is_active = true
              LIMIT 1`,
            [propertyId, exportToken],
        );
        if (!feeds?.length) throw new NotFoundException('Calendar not found');

        const ics = await this.icalSyncService.generateFeed(schemaName, propertyId, feeds[0].id);

        res.set({
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="calendar.ics"`,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.send(ics);
    }
}
