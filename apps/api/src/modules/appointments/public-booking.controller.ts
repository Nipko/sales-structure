import { Controller, Get, Post, Param, Query, Body, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from './appointments.service';
import { ServicesService } from './services.service';
import { CalendarIntegrationService } from './calendar-integration.service';

/**
 * Public booking endpoints — no auth required.
 * Customers can browse services, check availability, and book appointments.
 * Route: /api/v1/booking/:tenantSlug/...
 */
@ApiTags('public-booking')
@Controller('booking')
export class PublicBookingController {
    constructor(
        private prisma: PrismaService,
        private appointmentsService: AppointmentsService,
        private servicesService: ServicesService,
        private calendarService: CalendarIntegrationService,
    ) {}

    private async resolveSchema(tenantSlug: string): Promise<{ tenantId: string; schemaName: string }> {
        const rows = await this.prisma.$queryRaw<any[]>`
            SELECT id, schema_name FROM tenants
            WHERE slug = ${tenantSlug} AND is_active = true
            LIMIT 1
        `;
        if (!rows?.[0]) throw new BadRequestException('Tenant not found');
        return { tenantId: rows[0].id, schemaName: rows[0].schema_name };
    }

    @Get(':tenantSlug/services')
    @ApiOperation({ summary: 'List active bookable services (public)' })
    async listServices(@Param('tenantSlug') tenantSlug: string) {
        const { schemaName } = await this.resolveSchema(tenantSlug);
        const data = await this.servicesService.list(schemaName, true);
        return { success: true, data };
    }

    @Get(':tenantSlug/services/:serviceId')
    @ApiOperation({ summary: 'Get service details (public)' })
    async getService(
        @Param('tenantSlug') tenantSlug: string,
        @Param('serviceId') serviceId: string,
    ) {
        const { schemaName } = await this.resolveSchema(tenantSlug);
        const data = await this.servicesService.getById(schemaName, serviceId);
        if (!data.isActive) throw new BadRequestException('Service not available');
        return { success: true, data };
    }

    @Get(':tenantSlug/slots')
    @ApiOperation({ summary: 'Get available booking slots for a date and service (public)' })
    async getAvailableSlots(
        @Param('tenantSlug') tenantSlug: string,
        @Query('date') date: string,
        @Query('serviceId') serviceId: string,
    ) {
        if (!date || !serviceId) throw new BadRequestException('date and serviceId are required');

        const { schemaName } = await this.resolveSchema(tenantSlug);
        const svc = await this.servicesService.getById(schemaName, serviceId);
        if (!svc.isActive) throw new BadRequestException('Service not available');

        const slots = await this.appointmentsService.getBookableSlots(
            schemaName, date, svc.durationMinutes, svc.bufferMinutes,
        );
        return { success: true, data: { service: svc, date, slots } };
    }

    @Post(':tenantSlug/book')
    @ApiOperation({ summary: 'Create a public booking (no auth)' })
    async createBooking(
        @Param('tenantSlug') tenantSlug: string,
        @Body() body: {
            serviceId: string;
            date: string;
            startTime: string;
            customerName: string;
            customerPhone: string;
            customerEmail?: string;
            notes?: string;
        },
    ) {
        if (!body.serviceId || !body.date || !body.startTime || !body.customerName || !body.customerPhone) {
            throw new BadRequestException('serviceId, date, startTime, customerName, and customerPhone are required');
        }

        const { schemaName } = await this.resolveSchema(tenantSlug);
        const svc = await this.servicesService.getById(schemaName, body.serviceId);
        if (!svc.isActive) throw new BadRequestException('Service not available');

        // Calculate end time based on service duration
        const [h, m] = body.startTime.split(':').map(Number);
        const totalMin = h * 60 + m + svc.durationMinutes;
        const endH = Math.floor(totalMin / 60);
        const endM = totalMin % 60;
        const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        const startAt = `${body.date}T${body.startTime}:00`;
        const endAt = `${body.date}T${endTime}:00`;

        // Create or find contact
        let contactId: string | null = null;
        const existingContacts = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT id FROM contacts WHERE phone = $1 LIMIT 1`,
            [body.customerPhone],
        );
        if (existingContacts?.[0]) {
            contactId = existingContacts[0].id;
        }

        const appointment = await this.appointmentsService.create(schemaName, {
            contactId: contactId || undefined,
            serviceName: svc.name,
            startAt,
            endAt,
            location: undefined,
            notes: body.notes,
            metadata: {
                source: 'public_booking',
                customerName: body.customerName,
                customerPhone: body.customerPhone,
                customerEmail: body.customerEmail,
            },
        });

        // Update source column
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE appointments SET source = 'public_booking',
                    customer_name = $2, customer_phone = $3, customer_email = $4
             WHERE id = $1::uuid`,
            [appointment.id, body.customerName, body.customerPhone, body.customerEmail || null],
        );

        return {
            success: true,
            data: {
                appointmentId: appointment.id,
                service: svc.name,
                date: body.date,
                startTime: body.startTime,
                endTime,
            },
        };
    }
}
