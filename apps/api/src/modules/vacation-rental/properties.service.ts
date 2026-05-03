import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';

@Injectable()
export class PropertiesService {
    private readonly logger = new Logger(PropertiesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
        private readonly emailTemplates: EmailTemplatesService,
    ) {}

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
        // Plan-gate: check property limit
        const planFeatures = this.throttle.getPlanFeatures(tenantId);
        const maxProperties = (planFeatures as any)?.maxProperties || 2;
        const existing = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int as cnt FROM properties WHERE is_active = true`,
        );
        if ((existing?.[0]?.cnt || 0) >= maxProperties) {
            throw new BadRequestException(`Property limit reached (max ${maxProperties} for your plan)`);
        }

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO properties (name, description, address, city, max_guests, bedrooms, bathrooms,
             night_price, cleaning_fee, currency, min_nights, check_in_time, check_out_time,
             amenities, house_rules, check_in_instructions, images, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::time, $13::time, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb)
             RETURNING *`,
            [
                data.name, data.description || null, data.address || null, data.city || null,
                data.maxGuests || 4, data.bedrooms || 1, data.bathrooms || 1,
                data.nightPrice || 0, data.cleaningFee || 0, data.currency || 'COP',
                data.minNights || 1, data.checkInTime || '15:00', data.checkOutTime || '11:00',
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
        const property = await this.getById(schemaName, propertyId);
        if (!property) throw new BadRequestException('Property not found');

        // Check for overlapping blocks/bookings
        const conflicts = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT source, check_in, check_out FROM (
                SELECT source, check_in, check_out FROM ical_blocks
                WHERE property_id = $1::uuid AND is_deleted = false
                  AND NOT (check_out < $2::date OR check_in > $3::date)
                UNION ALL
                SELECT 'direct' as source, check_in, check_out FROM property_bookings
                WHERE property_id = $1::uuid AND status != 'cancelled'
                  AND NOT (check_out < $2::date OR check_in > $3::date)
            ) conflicts LIMIT 1`,
            [propertyId, checkIn, checkOut],
        );

        const ci = new Date(checkIn);
        const co = new Date(checkOut);
        const nights = Math.max(1, Math.round((co.getTime() - ci.getTime()) / 86400000));

        return {
            available: !conflicts || conflicts.length === 0,
            conflictSource: conflicts?.[0]?.source || null,
            nightPrice: Number(property.night_price),
            nights,
            cleaningFee: Number(property.cleaning_fee),
            totalPrice: Number(property.night_price) * nights + Number(property.cleaning_fee),
            currency: property.currency,
            minNights: property.min_nights,
        };
    }

    /**
     * Get calendar view for a month — returns array of dates with status.
     */
    async getCalendar(schemaName: string, propertyId: string, month: string): Promise<any[]> {
        const startDate = `${month}-01`;
        const endDate = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0)
            .toISOString().split('T')[0];

        // Get all blocks + bookings for this month
        const blocks = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, check_in, check_out, source, summary FROM ical_blocks
             WHERE property_id = $1::uuid AND is_deleted = false
               AND NOT (check_out < $2::date OR check_in > $3::date)
             UNION ALL
             SELECT id, check_in, check_out, 'direct' as source, NULL as summary FROM property_bookings
             WHERE property_id = $1::uuid AND status != 'cancelled'
               AND NOT (check_out < $2::date OR check_in > $3::date)`,
            [propertyId, startDate, endDate],
        );

        // Build day-by-day calendar
        const calendar: any[] = [];
        const start = new Date(startDate);
        const end = new Date(endDate);

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            let status = 'available';
            let source: string | null = null;
            let blockId: string | null = null;
            let summary: string | null = null;

            for (const block of blocks || []) {
                const bIn = new Date(block.check_in).toISOString().split('T')[0];
                const bOut = new Date(block.check_out).toISOString().split('T')[0];
                if (dateStr >= bIn && dateStr <= bOut) {
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
     * Create a manual calendar block.
     */
    async createBlock(schemaName: string, propertyId: string, data: { checkIn: string, checkOut: string, summary?: string }): Promise<any> {
        // First check availability
        const avail = await this.checkAvailability(schemaName, propertyId, data.checkIn, data.checkOut);
        if (!avail.available) {
            throw new BadRequestException(`Property not available for these dates (conflict: ${avail.conflictSource})`);
        }

        const externalUid = 'manual-' + Math.random().toString(36).substring(2, 15);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO ical_blocks (property_id, external_uid, source, check_in, check_out, summary)
             VALUES ($1::uuid, $2, 'Manual', $3::date, $4::date, $5)
             RETURNING *`,
            [propertyId, externalUid, data.checkIn, data.checkOut, data.summary || 'Bloqueo Manual'],
        );
        return rows?.[0];
    }

    /**
     * Delete a manual calendar block.
     */
    async deleteBlock(schemaName: string, blockId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE ical_blocks SET is_deleted = true, updated_at = NOW() WHERE id = $1::uuid`,
            [blockId],
        );
    }

    /**
     * Create a direct booking.
     */
    async createBooking(schemaName: string, propertyId: string, data: any): Promise<any> {
        // First check availability
        const avail = await this.checkAvailability(schemaName, propertyId, data.checkIn, data.checkOut);
        if (!avail.available) {
            throw new BadRequestException(`Property not available for these dates (conflict: ${avail.conflictSource})`);
        }

        const nights = avail.nights;
        const totalPrice = avail.totalPrice;

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO property_bookings
             (property_id, contact_id, conversation_id, guest_name, guest_email, guest_phone,
              guests_count, check_in, check_out, nights, night_price, cleaning_fee, total_price, currency, status)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11, $12, $13, $14, 'confirmed')
             RETURNING *`,
            [
                propertyId,
                data.contactId || null, data.conversationId || null,
                data.guestName, data.guestEmail || null, data.guestPhone || null,
                data.guestsCount || 1, data.checkIn, data.checkOut,
                nights, avail.nightPrice, avail.cleaningFee, totalPrice, avail.currency,
            ],
        );

        this.logger.log(`Direct booking created for property ${propertyId}: ${data.checkIn} to ${data.checkOut}`);

        // After successful booking insert, try to send confirmation email (fire-and-forget)
        try {
            const property = await this.getById(schemaName, propertyId);
            if (data.guestEmail) {
                await this.emailTemplates.renderAndSend(schemaName, 'property_booking_confirmation', data.guestEmail, {
                    guest_name: data.guestName || 'Huésped',
                    property_name: property?.name || '',
                    check_in: data.checkIn,
                    check_out: data.checkOut,
                    nights: String(nights),
                    total_price: String(totalPrice),
                    currency: avail.currency,
                    check_in_instructions: property?.check_in_instructions || '',
                });
            }
        } catch (e: any) {
            this.logger.warn(`Booking confirmation email failed: ${e.message}`);
        }

        return rows?.[0];
    }

    async cancelBooking(schemaName: string, bookingId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE property_bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1::uuid`,
            [bookingId],
        );
    }

    async listBookings(schemaName: string, propertyId: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM property_bookings WHERE property_id = $1::uuid ORDER BY check_in DESC`,
            [propertyId],
        );
    }
}
