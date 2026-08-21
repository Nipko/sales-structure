import {
    BadRequestException,
    Body,
    ConflictException,
    Controller,
    ForbiddenException,
    Get,
    HttpException,
    HttpStatus,
    Param,
    Post,
    Query,
    Req,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AppointmentsService } from './appointments.service';
import { ServicesService } from './services.service';
import { CalendarIntegrationService } from './calendar-integration.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { IdentityService } from '../identity/identity.service';
import { resolveTrustedClientIp } from '../../common/utils/trusted-client-ip.util';
import {
    evaluateSubscriptionAccess,
    type SubscriptionAccessMode,
} from '../../common/utils/subscription-entitlement.util';

interface PublicBookingRequestBody {
    serviceId: string;
    date: string;
    startTime: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    notes?: string;
    staffId?: string;
    idempotencyKey?: string;
}

interface ExistingPublicBooking {
    id: string;
    assigned_to: string | null;
    metadata: Record<string, unknown> | null;
}

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
        private identityService: IdentityService,
        private regionalProfile: RegionalProfileService,
    ) {}

    /** Max 10 attempts per tenant/IP and 30 total attempts per IP each minute. */
    private async checkRateLimit(tenantSlug: string, ip: string): Promise<void> {
        // Atomic INCR + EXPIRE — the previous GET/check/GET/SET had a TOCTOU window
        // that let concurrent requests slip past the limit.
        const scope = createHash('sha256').update(`${tenantSlug.toLowerCase()}\0${ip}`).digest('hex');
        const globalScope = createHash('sha256').update(ip).digest('hex');
        const [tenantCount, globalCount] = await Promise.all([
            this.redis.incrementRateLimit(`ratelimit:booking:tenant:${scope}`, 60),
            // Prevent an attacker from bypassing the limiter by rotating random
            // tenant slugs while retaining a less disruptive per-tenant budget.
            this.redis.incrementRateLimit(`ratelimit:booking:global:${globalScope}`, 60),
        ]);
        if (tenantCount > 10 || globalCount > 30) {
            throw new HttpException({
                error: 'rate_limited',
                message: 'Too many requests. Please try again later.',
                retryAfter: 60,
            }, HttpStatus.TOO_MANY_REQUESTS);
        }
    }

    /** Slot discovery calls external calendars, so it has its own read budget. */
    private async checkSlotRateLimit(tenantSlug: string, ip: string): Promise<void> {
        const scope = createHash('sha256').update(`${tenantSlug.toLowerCase()}\0${ip}`).digest('hex');
        const globalScope = createHash('sha256').update(ip).digest('hex');
        const [tenantCount, globalCount] = await Promise.all([
            this.redis.incrementRateLimit(`ratelimit:booking-slots:tenant:${scope}`, 60),
            this.redis.incrementRateLimit(`ratelimit:booking-slots:global:${globalScope}`, 60),
        ]);
        if (tenantCount > 30 || globalCount > 90) {
            throw new HttpException({
                error: 'rate_limited',
                message: 'Too many availability requests. Please try again later.',
                retryAfter: 60,
            }, HttpStatus.TOO_MANY_REQUESTS);
        }
    }

    private resolveClientIp(req: any): string {
        return resolveTrustedClientIp(req, {
            trustedProxyCidrs: process.env.PUBLIC_BOOKING_TRUSTED_PROXY_CIDRS
                || process.env.TRUSTED_PROXY_CIDRS,
            // In production the API is only `expose`d to the Docker network and
            // Cloudflare Tunnel is its ingress peer. Direct public peers are not
            // private and therefore cannot make their forwarding headers trusted.
            trustPrivateProductionProxy: process.env.NODE_ENV === 'production',
        });
    }

    private requestHeader(req: any, name: string): string | undefined {
        const value = req?.headers?.[name];
        return (Array.isArray(value) ? value[0] : value)?.toString().trim() || undefined;
    }

    private buildIdempotency(body: PublicBookingRequestBody, tenantId: string, phoneNormalized: string, req: any) {
        const clientKey = this.requestHeader(req, 'idempotency-key')
            || this.requestHeader(req, 'x-idempotency-key')
            || body.idempotencyKey?.trim();
        if (clientKey && (clientKey.length > 200 || /[^\x20-\x7E]/.test(clientKey))) {
            throw new BadRequestException('idempotencyKey must contain at most 200 printable characters');
        }

        const canonicalRequest = JSON.stringify({
            tenantId,
            serviceId: body.serviceId.toLowerCase(),
            date: body.date,
            startTime: body.startTime,
            staffId: body.staffId?.toLowerCase() || null,
            phone: phoneNormalized,
            name: body.customerName.trim().replace(/\s+/g, ' ').toLowerCase(),
            email: body.customerEmail?.trim().toLowerCase() || null,
            notes: body.notes?.trim() || null,
        });
        const requestFingerprint = createHash('sha256').update(canonicalRequest).digest('hex');
        const idempotencyKey = clientKey
            ? createHash('sha256').update(`${tenantId}\0client\0${clientKey}`).digest('hex')
            : requestFingerprint;
        return { idempotencyKey, requestFingerprint };
    }

    private async findExistingBooking(
        schemaName: string,
        idempotencyKey: string,
    ): Promise<ExistingPublicBooking | null> {
        const rows = await this.prisma.executeInTenantSchema<ExistingPublicBooking[]>(
            schemaName,
            `SELECT id, assigned_to, metadata
               FROM appointments
              WHERE source = 'public_booking'
                AND metadata->>'publicBookingIdempotencyKey' = $1
                AND status <> 'cancelled'
              ORDER BY created_at ASC, id ASC
              LIMIT 1`,
            [idempotencyKey],
        );
        return rows?.[0] || null;
    }

    private assertSameIdempotentRequest(
        appointment: ExistingPublicBooking,
        requestFingerprint: string,
    ): void {
        const stored = appointment.metadata?.publicBookingRequestFingerprint;
        if (stored !== requestFingerprint) {
            throw new ConflictException({
                error: 'idempotency_key_reused',
                message: 'This idempotency key was already used for a different booking request.',
            });
        }
    }

    private bookingResponse(input: {
        appointmentId: string;
        serviceName: string;
        date: string;
        startTime: string;
        endTime: string;
        staffId: string | null;
    }) {
        return {
            success: true,
            data: {
                appointmentId: input.appointmentId,
                service: input.serviceName,
                date: input.date,
                startTime: input.startTime,
                endTime: input.endTime,
                staffId: input.staffId,
            },
        };
    }

    private async resolveSchema(tenantSlug: string, mode: SubscriptionAccessMode = 'read'): Promise<{
        tenantId: string; schemaName: string;
        tenantName: string; tenantLogo: string | null; tenantColor: string | null;
        publicBookingEnabled: boolean;
        welcomeText: string | null;
    }> {
        const rows = await this.prisma.$queryRaw<any[]>`
            SELECT t.id, t.schema_name, t.name, t.is_internal,
                   bs.status AS subscription_status,
                   bs.trial_ends_at,
                   bs.cancel_at_period_end,
                   bs.current_period_end AS subscription_period_end,
                   bs.cancellation_reason,
                   bs.dunning_started_at,
                   (settings::jsonb)->>'logoUrl' as logo_url,
                   COALESCE((settings::jsonb)->>'brandColor', NULL) as brand_color,
                   COALESCE((settings::jsonb)->'publicBooking'->>'enabled', 'false')::boolean as public_booking_enabled,
                   (settings::jsonb)->'publicBooking'->>'welcomeText' as welcome_text
            FROM tenants t
            LEFT JOIN billing_subscriptions bs ON bs.tenant_id = t.id
            WHERE t.slug = ${tenantSlug} AND t.is_active = true
            LIMIT 1
        `;
        if (!rows?.[0]) throw new BadRequestException('Tenant not found');
        const row = rows[0];
        const entitlement = evaluateSubscriptionAccess({
            isInternal: row.is_internal === true,
            status: row.subscription_status ?? null,
            trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
            cancelAtPeriodEnd: row.cancel_at_period_end === true,
            currentPeriodEnd: row.subscription_period_end
                ? new Date(row.subscription_period_end)
                : null,
            cancellationReason: row.cancellation_reason ?? null,
            dunningStartedAt: row.dunning_started_at ? new Date(row.dunning_started_at) : null,
        }, mode);
        if (!entitlement.allowed) {
            const body = {
                error: entitlement.error,
                restrictionLevel: entitlement.restrictionLevel,
                message: 'This booking page is unavailable for the current subscription state.',
            };
            if (entitlement.restrictionLevel === 'unavailable') {
                throw new ServiceUnavailableException(body);
            }
            throw new ForbiddenException(body);
        }
        return {
            tenantId: row.id,
            schemaName: row.schema_name,
            tenantName: row.name || tenantSlug,
            tenantLogo: row.logo_url || null,
            tenantColor: row.brand_color || null,
            publicBookingEnabled: row.public_booking_enabled ?? false,
            welcomeText: row.welcome_text || null,
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

    private async upsertPublicBookingContact(schemaName: string, input: {
        name: string;
        phone: string;
        email?: string;
        /** País del negocio dueño del formulario. Null = no declarado. */
        phoneRegion?: string | null;
    }): Promise<{ id: string; channelType: string; externalId: string; phoneAmbiguous: boolean }> {
        const phoneNormalized = normalizePhoneE164(input.phone, input.phoneRegion);
        if (!phoneNormalized) {
            throw new BadRequestException('customerPhone must be a valid phone number');
        }

        const contact = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            // Serialize public-form retries for this normalized number. The
            // IdentityService later uses a shared cross-channel phone lock, so a
            // channel webhook and this form cannot create parallel profiles.
            await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock_acquired`, [
                `public-booking-contact:${phoneNormalized}`,
            ]);
            const matching = await query<Array<{
                id: string;
                channel_type: string;
                external_id: string;
            }>>(
                `SELECT id, channel_type, external_id
                   FROM contacts
                  WHERE phone_normalized = $1
                  ORDER BY created_at ASC, id ASC
                  LIMIT 2
                  FOR UPDATE`,
                [phoneNormalized],
            );
            let phoneAmbiguous = false;
            if (matching.length > 1) {
                const identityState = await query<Array<{
                    contact_count: number;
                    linked_contact_count: number;
                    profile_count: number;
                }>>(
                    `SELECT COUNT(*)::int AS contact_count,
                            COUNT(ci.contact_id)::int AS linked_contact_count,
                            COUNT(DISTINCT ci.customer_profile_id)::int AS profile_count
                       FROM contacts c
                       LEFT JOIN contact_identities ci ON ci.contact_id = c.id
                      WHERE c.phone_normalized = $1`,
                    [phoneNormalized],
                );
                const state = identityState?.[0];
                const contactCount = Number(state?.contact_count || 0);
                phoneAmbiguous = !(
                    contactCount > 1
                    && Number(state?.linked_contact_count || 0) === contactCount
                    && Number(state?.profile_count || 0) === 1
                );
            }

            // Reuse an unambiguous cross-channel contact. This keeps an existing
            // WhatsApp/Instagram deal and the appointment on the same CRM
            // identity instead of manufacturing a parallel public_booking row.
            if (matching.length === 1) {
                const rows = await query<Array<{
                    id: string;
                    channel_type: string;
                    external_id: string;
                    phone_ambiguous?: boolean;
                }>>(
                    `UPDATE contacts
                        SET name = COALESCE(NULLIF(name, ''), $2),
                            phone = COALESCE(NULLIF(phone, ''), $3),
                            phone_normalized = $1,
                            email = COALESCE(email, $4),
                            metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
                            updated_at = NOW()
                      WHERE id = $6::uuid
                      RETURNING id, channel_type, external_id`,
                    [
                        phoneNormalized,
                        input.name,
                        input.phone,
                        input.email || null,
                        JSON.stringify({ publicBookingSeen: true }),
                        matching[0].id,
                    ],
                );
                return { ...rows[0], phone_ambiguous: false };
            }

            // When several people legitimately share a phone number there is no
            // safe contact to guess. Keep a stable source contact and let the
            // identity layer link/flag it instead of attaching the booking to an
            // arbitrary deal.
            const rows = await query<Array<{
                id: string;
                channel_type: string;
                external_id: string;
                phone_ambiguous?: boolean;
            }>>(
                `INSERT INTO contacts
                    (external_id, channel_type, name, phone, phone_normalized, email, metadata, created_at, updated_at)
                 VALUES ($1, 'public_booking', $2, $3, $1, $4, $5::jsonb, NOW(), NOW())
                 ON CONFLICT (channel_type, external_id) DO UPDATE SET
                    name = COALESCE(NULLIF(EXCLUDED.name, ''), contacts.name),
                    phone = EXCLUDED.phone,
                    phone_normalized = EXCLUDED.phone_normalized,
                    email = COALESCE(EXCLUDED.email, contacts.email),
                    metadata = COALESCE(contacts.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                    updated_at = NOW()
                 RETURNING id, channel_type, external_id`,
                [
                    phoneNormalized,
                    input.name,
                    input.phone,
                    input.email || null,
                    JSON.stringify({ source: 'public_booking' }),
                ],
            );
            return { ...rows[0], phone_ambiguous: phoneAmbiguous };
        });
        if (!contact?.id) {
            throw new BadRequestException('Unable to resolve the booking contact');
        }
        return {
            id: contact.id,
            channelType: contact.channel_type,
            externalId: contact.external_id,
            phoneAmbiguous: contact.phone_ambiguous === true,
        };
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
        @Req() req: any,
    ) {
        await this.checkSlotRateLimit(tenantSlug, this.resolveClientIp(req));
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
        @Body() body: PublicBookingRequestBody,
    ) {
        // Rate limit: 10 bookings per minute per IP
        await this.checkRateLimit(tenantSlug, this.resolveClientIp(req));

        if (!body.serviceId || !body.date || !body.startTime || !body.customerName || !body.customerPhone) {
            throw new BadRequestException('serviceId, date, startTime, customerName, and customerPhone are required');
        }
        // El tenant se resuelve ANTES de normalizar: sin su país, un número
        // escrito sin prefijo se volvía colombiano y la reserva quedaba
        // atada al contacto equivocado.
        const t = await this.resolveSchema(tenantSlug, 'write');
        const phoneRegion = await this.regionalProfile.phoneRegionFor(t.tenantId);
        const phoneNormalized = normalizePhoneE164(body.customerPhone, phoneRegion);
        if (!phoneNormalized) {
            throw new BadRequestException('customerPhone must be a valid phone number');
        }

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
        const idempotency = this.buildIdempotency(body, t.tenantId, phoneNormalized, req);

        // A completed first request is returned before slot lookup. Otherwise a
        // harmless network retry would see its own appointment occupying the
        // slot and incorrectly report that the slot disappeared.
        const prior = await this.findExistingBooking(schemaName, idempotency.idempotencyKey);
        if (prior) {
            this.assertSameIdempotentRequest(prior, idempotency.requestFingerprint);
            return this.bookingResponse({
                appointmentId: prior.id,
                serviceName: svc.name,
                date: body.date,
                startTime: body.startTime,
                endTime,
                staffId: prior.assigned_to,
            });
        }

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

        const contact = await this.upsertPublicBookingContact(schemaName, {
            phoneRegion,
            name: body.customerName,
            phone: body.customerPhone,
            email: body.customerEmail,
        });
        await this.identityService.resolveOrCreateProfile(t.tenantId, {
            id: contact.id,
            name: body.customerName,
            phone: body.customerPhone,
            email: body.customerEmail,
            channelType: contact.channelType,
            externalId: contact.externalId,
            allowPhoneAutoLink: !contact.phoneAmbiguous,
        });

        try {
            const appointment = await this.appointmentsService.create(schemaName, {
                contactId: contact.id,
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
                    publicBookingIdempotencyKey: idempotency.idempotencyKey,
                    publicBookingRequestFingerprint: idempotency.requestFingerprint,
                },
            });

            return this.bookingResponse({
                appointmentId: appointment.id,
                serviceName: svc.name,
                date: body.date,
                startTime: body.startTime,
                endTime,
                staffId: selectedSlot.agentId,
            });
        } catch (error) {
            // The canonical writer serializes capacity. For maxConcurrent=1 a
            // duplicate retry loses at capacity; for maxConcurrent>1 it loses at
            // the unique idempotency index. In either case, return the winner.
            const winner = await this.findExistingBooking(schemaName, idempotency.idempotencyKey);
            if (!winner) throw error;
            this.assertSameIdempotentRequest(winner, idempotency.requestFingerprint);
            return this.bookingResponse({
                appointmentId: winner.id,
                serviceName: svc.name,
                date: body.date,
                startTime: body.startTime,
                endTime,
                staffId: winner.assigned_to,
            });
        }
    }
}
