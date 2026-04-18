import { Controller, Get, Post, Param, Query, Body, Req, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AppointmentsService } from './appointments.service';
import { ServicesService } from './services.service';
import { CalendarIntegrationService } from './calendar-integration.service';

/**
 * Public booking endpoints — no auth required.
 * Rate limited to prevent abuse.
 * Route: /api/v1/booking/:tenantSlug/...
 */
@ApiTags('public-booking')
@Controller('booking')
export class PublicBookingController {
    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private appointmentsService: AppointmentsService,
        private servicesService: ServicesService,
        private calendarService: CalendarIntegrationService,
    ) {}

    /** Simple IP-based rate limit: max 10 bookings per minute per IP */
    private async checkRateLimit(ip: string): Promise<void> {
        const key = `ratelimit:booking:${ip}`;
        const count = await this.redis.get(key);
        if (count && parseInt(count) >= 10) {
            throw new BadRequestException('Too many requests. Please try again later.');
        }
        const pipeline = await this.redis.get(key);
        if (pipeline) {
            await this.redis.set(key, String(parseInt(pipeline) + 1), 60);
        } else {
            await this.redis.set(key, '1', 60);
        }
    }

    private async resolveSchema(tenantSlug: string): Promise<{
        tenantId: string; schemaName: string;
        tenantName: string; tenantLogo: string | null; tenantColor: string | null;
    }> {
        const rows = await this.prisma.$queryRaw<any[]>`
            SELECT id, schema_name, company_name, logo_url,
                   COALESCE((settings::jsonb)->>'brandColor', NULL) as brand_color
            FROM tenants
            WHERE slug = ${tenantSlug} AND is_active = true
            LIMIT 1
        `;
        if (!rows?.[0]) throw new BadRequestException('Tenant not found');
        return {
            tenantId: rows[0].id,
            schemaName: rows[0].schema_name,
            tenantName: rows[0].company_name || tenantSlug,
            tenantLogo: rows[0].logo_url || null,
            tenantColor: rows[0].brand_color || null,
        };
    }

    @Get(':tenantSlug/info')
    @ApiOperation({ summary: 'Get tenant branding info for booking page (public)' })
    async getTenantInfo(@Param('tenantSlug') tenantSlug: string) {
        const { tenantName, tenantLogo, tenantColor } = await this.resolveSchema(tenantSlug);
        return { success: true, data: { name: tenantName, logo: tenantLogo, color: tenantColor } };
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

        const rawSlots = await this.appointmentsService.getBookableSlots(
            schemaName, date, svc.durationMinutes, svc.bufferMinutes,
            undefined, [], svc.maxConcurrent,
        );
        const slots = rawSlots.map(s => ({ start: s.time, end: s.endTime, display: s.time }));
        return { success: true, data: { service: svc, date, slots } };
    }

    @Post(':tenantSlug/book')
    @ApiOperation({ summary: 'Create a public booking (no auth, rate limited: 10/min)' })
    async createBooking(
        @Param('tenantSlug') tenantSlug: string,
        @Req() req: any,
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
        // Rate limit: 10 bookings per minute per IP
        await this.checkRateLimit(req.ip || req.connection?.remoteAddress || 'unknown');

        if (!body.serviceId || !body.date || !body.startTime || !body.customerName || !body.customerPhone) {
            throw new BadRequestException('serviceId, date, startTime, customerName, and customerPhone are required');
        }

        const { schemaName } = await this.resolveSchema(tenantSlug);
        const svc = await this.servicesService.getById(schemaName, body.serviceId);
        if (!svc.isActive) throw new BadRequestException('Service not available');

        // Validate required fields defined on the service
        if (svc.requiredFields?.length) {
            for (const field of svc.requiredFields) {
                if (field === 'email' && !body.customerEmail) {
                    throw new BadRequestException('Email is required for this service');
                }
                if (field === 'notes' && !body.notes) {
                    throw new BadRequestException('Notes are required for this service');
                }
            }
        }

        // Calculate end time
        const [h, m] = body.startTime.split(':').map(Number);
        const totalMin = h * 60 + m + svc.durationMinutes;
        const endH = Math.floor(totalMin / 60);
        const endM = totalMin % 60;
        const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        const startAt = `${body.date}T${body.startTime}:00`;
        const endAt = `${body.date}T${endTime}:00`;

        // Find existing contact
        let contactId: string | null = null;
        const existingContacts = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT id FROM contacts WHERE phone = $1 LIMIT 1`,
            [body.customerPhone],
        );
        if (existingContacts?.[0]) contactId = existingContacts[0].id;

        const appointment = await this.appointmentsService.create(schemaName, {
            contactId: contactId || undefined,
            serviceName: svc.name,
            startAt,
            endAt,
            notes: body.notes,
            metadata: {
                source: 'public_booking',
                customerName: body.customerName,
                customerPhone: body.customerPhone,
                customerEmail: body.customerEmail,
            },
        });

        // Update source + customer fields
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
