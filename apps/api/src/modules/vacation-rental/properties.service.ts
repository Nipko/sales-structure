import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StayRange {
    checkIn: string;
    checkOut: string;
    nights: number;
}

@Injectable()
export class PropertiesService {
    private readonly logger = new Logger(PropertiesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
        private readonly emailTemplates: EmailTemplatesService,
    ) {}

    private assertDateOnly(value: unknown, field: string): string {
        if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
            throw new BadRequestException(`${field} must be a valid date in YYYY-MM-DD format`);
        }

        const parsed = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
            throw new BadRequestException(`${field} must be a valid date in YYYY-MM-DD format`);
        }
        return value;
    }

    private assertUuid(value: unknown, field: string): string {
        if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
            throw new BadRequestException(`${field} must be a valid UUID`);
        }
        return value;
    }

    private validateStayRange(checkIn: unknown, checkOut: unknown): StayRange {
        const validCheckIn = this.assertDateOnly(checkIn, 'checkIn');
        const validCheckOut = this.assertDateOnly(checkOut, 'checkOut');
        const checkInMs = Date.parse(`${validCheckIn}T00:00:00.000Z`);
        const checkOutMs = Date.parse(`${validCheckOut}T00:00:00.000Z`);
        const nights = (checkOutMs - checkInMs) / 86_400_000;

        if (nights <= 0) {
            throw new BadRequestException('checkOut must be after checkIn');
        }
        return { checkIn: validCheckIn, checkOut: validCheckOut, nights };
    }

    private assertPropertyBookable(property: any): void {
        if (!property) throw new NotFoundException('Property not found');
        if (property.is_active !== true) {
            throw new BadRequestException('Property is inactive and cannot be booked');
        }
    }

    /** Resolve a date-only value in the tenant timezone (never in server/UTC time). */
    async getTenantLocalDate(tenantId: string, now: Date = new Date()): Promise<string> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const settings = (tenant.settings as any) || {};
        const timezone = settings.businessHours?.timezone || settings.timezone || 'America/Bogota';
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).formatToParts(now);
            const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
            return this.assertDateOnly(`${values.year}-${values.month}-${values.day}`, 'from');
        } catch (error) {
            if (error instanceof BadRequestException) throw error;
            throw new BadRequestException(`Tenant timezone is invalid: ${timezone}`);
        }
    }

    async list(schemaName: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM properties WHERE is_active = true ORDER BY sort_order, name`,
        );
    }

    async getById(schemaName: string, propertyId: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM properties WHERE id = $1::uuid`,
            [propertyId],
        );
        return rows?.[0] || null;
    }

    async create(tenantId: string, schemaName: string, data: any): Promise<any> {
        const existing = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int as cnt FROM properties WHERE is_active = true`,
        );
        await this.throttle.enforcePlanLimit(tenantId, 'maxProperties', existing?.[0]?.cnt || 0, 'propiedades');

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO properties (name, description, address, city, max_guests, bedrooms, bathrooms,
             night_price, cleaning_fee, currency, min_nights, check_in_time, check_out_time,
             amenities, house_rules, check_in_instructions, images, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::time, $13::time, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb)
             RETURNING *`,
            [
                data.name, data.description ?? null, data.address ?? null, data.city ?? null,
                data.maxGuests ?? 4, data.bedrooms ?? 1, data.bathrooms ?? 1,
                data.nightPrice ?? 0, data.cleaningFee ?? 0, data.currency ?? 'COP',
                data.minNights ?? 1, data.checkInTime ?? '15:00', data.checkOutTime ?? '11:00',
                JSON.stringify(data.amenities || []), data.houseRules || null,
                data.checkInInstructions || null, JSON.stringify(data.images || []),
                JSON.stringify(data.metadata || {}),
            ],
        );
        return rows?.[0];
    }

    async update(schemaName: string, propertyId: string, data: any): Promise<any> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        const fields: Record<string, string> = {
            name: 'name', description: 'description', address: 'address', city: 'city',
            maxGuests: 'max_guests', bedrooms: 'bedrooms', bathrooms: 'bathrooms',
            nightPrice: 'night_price', cleaningFee: 'cleaning_fee', currency: 'currency',
            minNights: 'min_nights', checkInTime: 'check_in_time', checkOutTime: 'check_out_time',
            houseRules: 'house_rules', checkInInstructions: 'check_in_instructions', isActive: 'is_active',
        };

        const timeCols = new Set(['check_in_time', 'check_out_time']);
        for (const [jsKey, dbKey] of Object.entries(fields)) {
            if (data[jsKey] !== undefined) {
                const cast = timeCols.has(dbKey) ? '::time' : '';
                sets.push(`"${dbKey}" = $${idx}${cast}`);
                params.push(data[jsKey]);
                idx++;
            }
        }
        if (data.amenities !== undefined) { sets.push(`amenities = $${idx}::jsonb`); params.push(JSON.stringify(data.amenities)); idx++; }
        if (data.images !== undefined) { sets.push(`images = $${idx}::jsonb`); params.push(JSON.stringify(data.images)); idx++; }

        if (sets.length === 0) return this.getById(schemaName, propertyId);

        sets.push(`updated_at = NOW()`);
        params.push(propertyId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE properties SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            params,
        );
        return rows?.[0];
    }

    async delete(schemaName: string, propertyId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE properties SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [propertyId],
        );
    }

    /**
     * Check if a property is available for given dates.
     * Checks both ical_blocks (external) and property_bookings (direct).
     */
    async checkAvailability(schemaName: string, propertyId: string, checkIn: string, checkOut: string): Promise<any> {
        this.assertUuid(propertyId, 'propertyId');
        const stay = this.validateStayRange(checkIn, checkOut);
        const property = await this.getById(schemaName, propertyId);
        this.assertPropertyBookable(property);

        // Hotel semantics: both persisted and requested ranges are half-open.
        // A departure on D therefore does not conflict with a new arrival on D.
        const conflicts = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT source, check_in, check_out FROM (
                SELECT source, check_in, check_out FROM ical_blocks
                WHERE property_id = $1::uuid AND is_deleted = false
                  AND check_in < $3::date
                  AND CASE WHEN date_range_semantics < 2
                           THEN check_out >= $2::date
                           ELSE check_out > $2::date END
                UNION ALL
                SELECT 'direct' as source, check_in, check_out FROM property_bookings
                WHERE property_id = $1::uuid AND status != 'cancelled'
                  AND check_in < $3::date AND check_out > $2::date
            ) conflicts LIMIT 1`,
            [propertyId, stay.checkIn, stay.checkOut],
        );

        return {
            available: !conflicts || conflicts.length === 0,
            conflictSource: conflicts?.[0]?.source || null,
            nightPrice: Number(property.night_price),
            nights: stay.nights,
            cleaningFee: Number(property.cleaning_fee),
            totalPrice: Number(property.night_price) * stay.nights + Number(property.cleaning_fee),
            currency: property.currency,
            minNights: property.min_nights,
        };
    }

    /**
     * Get calendar view for a month — returns array of dates with status.
     */
    async getCalendar(schemaName: string, propertyId: string, month: string): Promise<any[]> {
        this.assertUuid(propertyId, 'propertyId');
        const match = /^(\d{4})-(\d{2})$/.exec(month || '');
        const year = Number(match?.[1]);
        const monthNumber = Number(match?.[2]);
        if (!match || monthNumber < 1 || monthNumber > 12) {
            throw new BadRequestException('month must be valid and use YYYY-MM format');
        }
        const startDate = `${match[1]}-${match[2]}-01`;
        const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
        const nextMonthStart = nextMonthDate.toISOString().slice(0, 10);
        const endDate = new Date(nextMonthDate.getTime() - 86_400_000).toISOString().slice(0, 10);

        // Fetch intervals that overlap the half-open month range.
        const blocks = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, check_in, check_out, source, summary, date_range_semantics FROM ical_blocks
             WHERE property_id = $1::uuid AND is_deleted = false
               AND check_in < $3::date
               AND CASE WHEN date_range_semantics < 2
                        THEN check_out >= $2::date
                        ELSE check_out > $2::date END
             UNION ALL
             SELECT id, check_in, check_out, 'direct' as source, NULL as summary,
                    2::smallint as date_range_semantics
               FROM property_bookings
             WHERE property_id = $1::uuid AND status != 'cancelled'
               AND check_in < $3::date AND check_out > $2::date`,
            [propertyId, startDate, nextMonthStart],
        );

        // Build day-by-day calendar
        const calendar: any[] = [];
        const start = new Date(`${startDate}T00:00:00.000Z`);
        const end = new Date(`${endDate}T00:00:00.000Z`);

        for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            let status = 'available';
            let source: string | null = null;
            let blockId: string | null = null;
            let summary: string | null = null;

            for (const block of blocks || []) {
                const bIn = new Date(block.check_in).toISOString().split('T')[0];
                const bOut = new Date(block.check_out).toISOString().split('T')[0];
                const occupiesDate = Number(block.date_range_semantics ?? 1) < 2
                    ? dateStr >= bIn && dateStr <= bOut
                    : dateStr >= bIn && dateStr < bOut;
                if (occupiesDate) {
                    status = block.source === 'direct' ? 'booked' : 'blocked';
                    source = block.source;
                    blockId = block.id;
                    summary = block.summary || null;
                    break;
                }
            }

            calendar.push({ date: dateStr, status, source, blockId, summary });
        }

        return calendar;
    }

    /**
     * Create a manual calendar block. The dashboard selects an inclusive date
     * range (a one-day block sends checkIn === checkOut), so manual rows retain
     * v1 semantics even though bookings and synced iCal events are half-open.
     */
    async createBlock(schemaName: string, propertyId: string, data: { checkIn: string, checkOut: string, summary?: string }): Promise<any> {
        this.assertUuid(propertyId, 'propertyId');
        const checkIn = this.assertDateOnly(data?.checkIn, 'checkIn');
        const inclusiveCheckOut = this.assertDateOnly(data?.checkOut, 'checkOut');
        if (inclusiveCheckOut < checkIn) {
            throw new BadRequestException('checkOut must be on or after checkIn');
        }
        const exclusiveEnd = new Date(`${inclusiveCheckOut}T00:00:00.000Z`);
        exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
        const requestedCheckOut = exclusiveEnd.toISOString().slice(0, 10);

        const externalUid = 'manual-' + Math.random().toString(36).substring(2, 15);
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
                [`${schemaName}:${propertyId}`],
            );
            const propertyRows = await query<any[]>(
                `SELECT * FROM properties WHERE id = $1::uuid FOR UPDATE`,
                [propertyId],
            );
            this.assertPropertyBookable(propertyRows?.[0]);

            const conflicts = await query<any[]>(
                `SELECT source FROM (
                    SELECT source FROM ical_blocks
                     WHERE property_id = $1::uuid AND is_deleted = false
                       AND check_in < $3::date
                       AND CASE WHEN date_range_semantics < 2
                                THEN check_out >= $2::date
                                ELSE check_out > $2::date END
                    UNION ALL
                    SELECT 'direct' AS source FROM property_bookings
                     WHERE property_id = $1::uuid AND status != 'cancelled'
                       AND check_in < $3::date AND check_out > $2::date
                 ) conflicts LIMIT 1`,
                [propertyId, checkIn, requestedCheckOut],
            );
            if (conflicts?.length) {
                throw new ConflictException({
                    message: 'Property is not available for these dates',
                    conflictSource: conflicts[0].source || 'unknown',
                });
            }

            const rows = await query<any[]>(
                `INSERT INTO ical_blocks
                 (property_id, external_uid, source, check_in, check_out, date_range_semantics, summary)
                 VALUES ($1::uuid, $2, 'Manual', $3::date, $4::date, 1, $5)
                 RETURNING *`,
                [propertyId, externalUid, checkIn, inclusiveCheckOut, data.summary || 'Bloqueo Manual'],
            );
            return rows?.[0];
        });
    }

    /**
     * Delete a calendar block (manual or imported).
     *
     * Imported blocks are legitimately removable — an OTA that stops exporting
     * an event can leave a block stranded — but the next sync re-creates it if
     * the feed still carries the UID, so the UI has to say so.
     */
    async deleteBlock(schemaName: string, blockId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            // No `updated_at` here: ical_blocks never had that column, so the
            // old query raised 42703 and the 500 was swallowed by the dashboard
            // — unblocking silently did nothing for every block, ever.
            `UPDATE ical_blocks SET is_deleted = true WHERE id = $1::uuid`,
            [blockId],
        );
    }

    /**
     * Create a direct booking.
     */
    async createBooking(schemaName: string, propertyId: string, data: any): Promise<any> {
        this.assertUuid(propertyId, 'propertyId');
        if (!data || typeof data !== 'object') {
            throw new BadRequestException('Booking payload is required');
        }
        if (data.contactId != null) this.assertUuid(data.contactId, 'contactId');
        if (data.conversationId != null) this.assertUuid(data.conversationId, 'conversationId');
        const stay = this.validateStayRange(data.checkIn, data.checkOut);
        const guestsCount = data.guestsCount ?? 1;
        if (!Number.isInteger(guestsCount) || guestsCount < 1) {
            throw new BadRequestException('guestsCount must be an integer greater than or equal to 1');
        }

        // Lock, read, conflict check and insert all share one tenant-scoped
        // transaction. Concurrent attempts for the same property serialize on
        // the xact lock; the loser observes the winner before it can insert.
        const created = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
                [`${schemaName}:${propertyId}`],
            );

            const propertyRows = await query<any[]>(
                `SELECT * FROM properties WHERE id = $1::uuid FOR UPDATE`,
                [propertyId],
            );
            const property = propertyRows?.[0];
            this.assertPropertyBookable(property);

            const minNights = Number(property.min_nights ?? 1);
            if (stay.nights < minNights) {
                throw new BadRequestException(`Stay must be at least ${minNights} night${minNights === 1 ? '' : 's'}`);
            }
            const maxGuests = Number(property.max_guests ?? 1);
            if (guestsCount > maxGuests) {
                throw new BadRequestException(`Property accommodates a maximum of ${maxGuests} guests`);
            }

            const conflicts = await query<any[]>(
                `SELECT source, check_in, check_out FROM (
                    SELECT source, check_in, check_out FROM ical_blocks
                    WHERE property_id = $1::uuid AND is_deleted = false
                      AND check_in < $3::date
                      AND CASE WHEN date_range_semantics < 2
                               THEN check_out >= $2::date
                               ELSE check_out > $2::date END
                    UNION ALL
                    SELECT 'direct' as source, check_in, check_out FROM property_bookings
                    WHERE property_id = $1::uuid AND status != 'cancelled'
                      AND check_in < $3::date AND check_out > $2::date
                 ) conflicts LIMIT 1`,
                [propertyId, stay.checkIn, stay.checkOut],
            );
            if (conflicts?.length) {
                throw new ConflictException({
                    message: 'Property is not available for these dates',
                    conflictSource: conflicts[0].source || 'unknown',
                });
            }

            const nightPrice = Number(property.night_price ?? 0);
            const cleaningFee = Number(property.cleaning_fee ?? 0);
            const totalPrice = nightPrice * stay.nights + cleaningFee;
            const rows = await query<any[]>(
                `INSERT INTO property_bookings
                 (property_id, contact_id, conversation_id, guest_name, guest_email, guest_phone,
                  guests_count, check_in, check_out, nights, night_price, cleaning_fee, total_price, currency, status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::date, $9::date, $10, $11, $12, $13, $14, 'confirmed')
                 RETURNING *`,
                [
                    propertyId,
                    data.contactId || null, data.conversationId || null,
                    data.guestName, data.guestEmail || null, data.guestPhone || null,
                    guestsCount, stay.checkIn, stay.checkOut,
                    stay.nights, nightPrice, cleaningFee, totalPrice, property.currency,
                ],
            );
            if (!rows?.[0]) throw new Error('Property booking was not created');
            return { booking: rows[0], property };
        });

        const booking = created.booking;
        const property = created.property;
        const totalPrice = Number(booking.total_price ?? 0);
        this.logger.log(`Direct booking created for property ${propertyId}: ${stay.checkIn} to ${stay.checkOut}`);

        // After successful booking insert, try to send confirmation email (fire-and-forget)
        try {
            if (data.guestEmail) {
                // Check if confirmation emails are enabled for properties
                let emailConfirmationsEnabled = true;
                try {
                    const personaRows = await this.prisma.executeInTenantSchema<any[]>(
                        schemaName,
                        `SELECT config_json FROM agent_personas WHERE is_active = true LIMIT 1`,
                        []
                    );
                    if (personaRows && personaRows.length > 0) {
                        const config = personaRows[0].config_json || {};
                        const propertiesTool = config.tools?.properties;
                        if (propertiesTool && propertiesTool.emailConfirmations === false) {
                            emailConfirmationsEnabled = false;
                        }
                    }
                } catch (err) {
                    this.logger.error(`Error checking persona settings for properties: ${err.message}`);
                }

                if (emailConfirmationsEnabled) {
                    // TODO(i18n): this is a guest-facing email — pass the guest's
                    // detected/preferred language as the trailing `lang` arg once
                    // it's captured. Defaults to 'es' (unchanged behaviour).
                    await this.emailTemplates.renderAndSend(schemaName, 'property_booking_confirmation', data.guestEmail, {
                        guest_name: data.guestName || 'Huésped',
                        property_name: property?.name || '',
                        check_in: stay.checkIn,
                        check_out: stay.checkOut,
                        nights: String(stay.nights),
                        total_price: String(totalPrice),
                        currency: booking.currency,
                        check_in_instructions: property?.check_in_instructions || '',
                    });
                }
            }
        } catch (e: any) {
            this.logger.warn(`Booking confirmation email failed: ${e.message}`);
        }

        return booking;
    }

    async cancelBooking(schemaName: string, bookingId: string): Promise<void> {
        this.assertUuid(bookingId, 'bookingId');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE property_bookings
                SET status = 'cancelled', updated_at = NOW()
              WHERE id = $1::uuid
              RETURNING id`,
            [bookingId],
        );
        if (!rows?.length) throw new NotFoundException('Booking not found');
    }

    async listBookings(schemaName: string, propertyId: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM property_bookings WHERE property_id = $1::uuid ORDER BY check_in DESC`,
            [propertyId],
        );
    }

    /**
     * Reservas de TODAS las propiedades (con nombre de propiedad), para la
     * agenda del agente (app móvil): estadías vigentes o futuras, próximas
     * primero. En semántica half-open, una estadía sigue vigente mientras
     * `check_out > fromDate`; el día de salida ya está libre.
     */
    async listUpcomingBookings(schemaName: string, fromDate: string): Promise<any[]> {
        const validFromDate = this.assertDateOnly(fromDate, 'from');
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT b.*, p.name as property_name
               FROM property_bookings b
               LEFT JOIN properties p ON p.id = b.property_id
              WHERE b.status != 'cancelled' AND b.check_out > $1::date
              ORDER BY b.check_in ASC, b.check_out ASC, b.created_at ASC
              LIMIT 200`,
            [validFromDate],
        );
    }
}
