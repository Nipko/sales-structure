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
        // Atomic INCR + EXPIRE — the previous GET/check/GET/SET had a TOCTOU window
        // that let concurrent requests slip past the limit.
        const key = `ratelimit:booking:${ip}`;
        const count = await this.redis.incrementRateLimit(key, 60);
        if (count > 10) {
            throw new BadRequestException('Too many requests. Please try again later.');
        }
    }

    private async resolveSchema(tenantSlug: string): Promise<{
        tenantId: string; schemaName: string;
        tenantName: string; tenantLogo: string | null; tenantColor: string | null;
        publicBookingEnabled: boolean;
        welcomeText: string | null;
    }> {
        const rows = await this.prisma.$queryRaw<any[]>`
            SELECT id, schema_name, name,
                   (settings::jsonb)->>'logoUrl' as logo_url,
                   COALESCE((settings::jsonb)->>'brandColor', NULL) as brand_color,
                   COALESCE((settings::jsonb)->'publicBooking'->>'enabled', 'false')::boolean as public_booking_enabled,
                   (settings::jsonb)->'publicBooking'->>'welcomeText' as welcome_text
            FROM tenants
            WHERE slug = ${tenantSlug} AND is_active = true
            LIMIT 1
        `;
        if (!rows?.[0]) throw new BadRequestException('Tenant not found');
        return {
            tenantId: rows[0].id,
            schemaName: rows[0].schema_name,
            tenantName: rows[0].name || tenantSlug,
            tenantLogo: rows[0].logo_url || null,
            tenantColor: rows[0].brand_color || null,
            publicBookingEnabled: rows[0].public_booking_enabled ?? false,
            welcomeText: rows[0].welcome_text || null,
        };
    }

    /** Throws when public booking is disabled for this tenant. */
    private requireBookingEnabled(t: { publicBookingEnabled: boolean }): void {
        if (!t.publicBookingEnabled) {
            throw new BadRequestException({
                error: 'public_booking_disabled',
                message: 'This business has not enabled public booking yet.',
            });
        }
    }

    @Get(':tenantSlug/info')
    @ApiOperation({ summary: 'Get tenant branding info for booking page (public)' })
    async getTenantInfo(@Param('tenantSlug') tenantSlug: string) {
        const t = await this.resolveSchema(tenantSlug);
        return {
            success: true,
            data: {
                name: t.tenantName,
                logo: t.tenantLogo,
                color: t.tenantColor,
                enabled: t.publicBookingEnabled,
                welcomeText: t.welcomeText,
            },
        };
    }

    @Get(':tenantSlug/services')
    @ApiOperation({ summary: 'List active bookable services (public)' })
    async listServices(@Param('tenantSlug') tenantSlug: string) {
        const t = await this.resolveSchema(tenantSlug);
        this.requireBookingEnabled(t);
        const data = await this.servicesService.list(t.schemaName, true);
        return { success: true, data };
    }

    @Get(':tenantSlug/services/:serviceId')
    @ApiOperation({ summary: 'Get service details (public)' })
    async getService(
        @Param('tenantSlug') tenantSlug: string,
        @Param('serviceId') serviceId: string,
    ) {
        const t = await this.resolveSchema(tenantSlug);
        this.requireBookingEnabled(t);
        const data = await this.servicesService.getById(t.schemaName, serviceId);
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

        const t = await this.resolveSchema(tenantSlug);
        this.requireBookingEnabled(t);
        const svc = await this.servicesService.getById(t.schemaName, serviceId);
        if (!svc.isActive) throw new BadRequestException('Service not available');

        const calendarBusy = await this.calendarService.getFreeBusyForDate(
            t.schemaName,
            date,
            { serviceId },
        );
        const rawSlots = await this.appointmentsService.getBookableSlots(
            t.schemaName, date, serviceId, svc.durationMinutes, svc.bufferMinutes,
            undefined, calendarBusy, svc.maxConcurrent,
        );
        const slots = rawSlots.map(s => ({
            start: s.time,
            end: s.endTime,
            display: s.time,
            staffId: s.agentId,
        }));
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
            staffId?: string;
        },
    ) {
        // Rate limit: 10 bookings per minute per IP
        await this.checkRateLimit(req.ip || req.connection?.remoteAddress || 'unknown');

        if (!body.serviceId || !body.date || !body.startTime || !body.customerName || !body.customerPhone) {
            throw new BadRequestException('serviceId, date, startTime, customerName, and customerPhone are required');
        }

        const t = await this.resolveSchema(tenantSlug);
        this.requireBookingEnabled(t);
        const schemaName = t.schemaName;
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

        // Re-resolve the exact offered resource immediately before the canonical
        // writer. The writer then serializes/rechecks again under advisory locks.
        const calendarBusy = await this.calendarService.getFreeBusyForDate(
            schemaName,
            body.date,
            { serviceId: body.serviceId, ...(body.staffId ? { staffId: body.staffId } : {}) },
        );
        const liveSlots = await this.appointmentsService.getBookableSlots(
            schemaName,
            body.date,
            body.serviceId,
            svc.durationMinutes,
            svc.bufferMinutes,
            body.staffId,
            calendarBusy,
            svc.maxConcurrent,
        );
        const selectedSlot = liveSlots.find((slot) => slot.time === body.startTime);
        if (!selectedSlot) {
            throw new BadRequestException({
                error: 'appointment_slot_unavailable',
                message: 'That time slot is no longer available.',
            });
        }

        // Find existing contact
        let contactId: string | null = null;
        const existingContacts = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT id FROM contacts WHERE phone = $1 LIMIT 1`,
            [body.customerPhone],
        );
        if (existingContacts?.[0]) contactId = existingContacts[0].id;

        const appointment = await this.appointmentsService.create(schemaName, {
            contactId: contactId || undefined,
            assignedTo: selectedSlot.agentId,
            serviceId: body.serviceId,
            serviceName: svc.name,
            startAt,
            endAt,
            notes: body.notes,
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            customerEmail: body.customerEmail,
            source: 'public_booking',
            metadata: {
                source: 'public_booking',
                customerName: body.customerName,
                customerPhone: body.customerPhone,
                customerEmail: body.customerEmail,
            },
        });

        return {
            success: true,
            data: {
                appointmentId: appointment.id,
                service: svc.name,
                date: body.date,
                startTime: body.startTime,
                endTime,
                staffId: selectedSlot.agentId,
            },
        };
    }
}
