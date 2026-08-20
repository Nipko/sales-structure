import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import {
    normalizeCurrencyCode,
    requirePositiveIntegerUnit,
} from '../../common/utils/commercial-units.util';
import {
    assertOptionalContactId,
    requireTenantContact,
} from '../../common/utils/tenant-contact.util';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';
import {
    PAYMENT_HOLD_MS,
    PENDING_PAYMENT_STATUS,
    resolvePaymentPolicy,
} from '../../common/utils/payment-policy.util';

/**
 * Tours / travel packages module — supports both same-day experiences
 * (duration_type='hours') and multi-day packages (duration_type='days').
 *
 * Inventory model: tour_inventory rows are OPTIONAL. A package without rows
 * is treated as "any-date / unlimited capacity" (typical for custom multi-day
 * packages built per-customer). A package with rows uses per-departure caps,
 * decremented at booking time and restored on cancellation.
 */
@Injectable()
export class ToursService {
    private readonly logger = new Logger(ToursService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
        private readonly emailTemplates: EmailTemplatesService,
    ) {}

    // ── Packages CRUD ──────────────────────────────────────────────

    async listPackages(schemaName: string, includeInactive = false): Promise<any[]> {
        const filter = includeInactive ? '' : ` WHERE is_active = true`;
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM tour_packages${filter} ORDER BY sort_order, name`,
        );
    }

    async getPackage(schemaName: string, packageId: string): Promise<any | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM tour_packages WHERE id = $1::uuid`,
            [packageId],
        );
        return rows?.[0] || null;
    }

    async createPackage(tenantId: string, schemaName: string, data: any): Promise<any> {
        const used = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                (SELECT COUNT(*) FROM properties WHERE is_active = true)::int +
                (SELECT COUNT(*) FROM tour_packages WHERE is_active = true)::int AS cnt`,
        );
        await this.throttle.enforcePlanLimit(tenantId, 'maxProperties', used?.[0]?.cnt || 0, 'propiedades + tours');

        if (!data.name) throw new BadRequestException('name is required');
        if (data.durationType !== undefined && !['hours', 'days'].includes(data.durationType)) {
            throw new BadRequestException('durationType must be hours or days');
        }
        const durationType = data.durationType || 'hours';
        const durationValue = requirePositiveIntegerUnit(data.durationValue ?? 1, 'durationValue');
        const currency = normalizeCurrencyCode(data.currency);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO tour_packages (
                name, description, duration_type, duration_value, price, currency,
                max_capacity, min_party_size, departure_location, destination,
                languages, includes, excludes, what_to_bring, child_discount_pct,
                cancellation_policy, images, tags, sort_order, metadata
             ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16, $17::jsonb, $18::jsonb, $19, $20::jsonb
             ) RETURNING *`,
            [
                data.name, data.description || null, durationType, durationValue,
                data.price || 0, currency,
                data.maxCapacity || 10, data.minPartySize || 1,
                data.departureLocation || null, data.destination || null,
                JSON.stringify(data.languages || []),
                JSON.stringify(data.includes || []),
                JSON.stringify(data.excludes || []),
                data.whatToBring || null, data.childDiscountPct || 0,
                data.cancellationPolicy || null,
                JSON.stringify(data.images || []),
                JSON.stringify(data.tags || []),
                data.sortOrder || 0,
                JSON.stringify(data.metadata || {}),
            ],
        );
        return rows?.[0];
    }

    async updatePackage(schemaName: string, packageId: string, data: any): Promise<any> {
        if (data.durationType !== undefined && !['hours', 'days'].includes(data.durationType)) {
            throw new BadRequestException('durationType must be hours or days');
        }
        if (data.durationValue !== undefined) {
            data = { ...data, durationValue: requirePositiveIntegerUnit(data.durationValue, 'durationValue') };
        }
        if (data.currency !== undefined) {
            data = { ...data, currency: normalizeCurrencyCode(data.currency) };
        }
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        const fields: Record<string, string> = {
            name: 'name', description: 'description',
            durationType: 'duration_type', durationValue: 'duration_value',
            price: 'price', currency: 'currency',
            maxCapacity: 'max_capacity', minPartySize: 'min_party_size',
            departureLocation: 'departure_location', destination: 'destination',
            whatToBring: 'what_to_bring', childDiscountPct: 'child_discount_pct',
            cancellationPolicy: 'cancellation_policy', sortOrder: 'sort_order',
            isActive: 'is_active',
        };

        for (const [jsKey, dbKey] of Object.entries(fields)) {
            if (data[jsKey] !== undefined) {
                sets.push(`"${dbKey}" = $${idx}`);
                params.push(data[jsKey]);
                idx++;
            }
        }
        const jsonFields: Record<string, string> = {
            languages: 'languages', includes: 'includes', excludes: 'excludes',
            images: 'images', tags: 'tags', metadata: 'metadata',
        };
        for (const [jsKey, dbKey] of Object.entries(jsonFields)) {
            if (data[jsKey] !== undefined) {
                sets.push(`"${dbKey}" = $${idx}::jsonb`);
                params.push(JSON.stringify(data[jsKey]));
                idx++;
            }
        }

        if (sets.length === 0) return this.getPackage(schemaName, packageId);

        sets.push(`updated_at = NOW()`);
        params.push(packageId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE tour_packages SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            params,
        );
        return rows?.[0];
    }

    async deletePackage(schemaName: string, packageId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE tour_packages SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [packageId],
        );
    }

    // ── Inventory (per-departure capacity) ─────────────────────────

    async listInventory(schemaName: string, packageId: string, fromDate?: string): Promise<any[]> {
        const dateFilter = fromDate ? ` AND departure_date >= $2::date` : '';
        const params: any[] = [packageId];
        if (fromDate) params.push(fromDate);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM tour_inventory
             WHERE package_id = $1::uuid AND is_active = true${dateFilter}
             ORDER BY departure_date, departure_time`,
            params,
        );
    }

    async createInventory(schemaName: string, packageId: string, data: any): Promise<any> {
        if (!data.departureDate) throw new BadRequestException('departureDate is required');
        const seats = data.totalSeats || data.availableSeats || 0;
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO tour_inventory (package_id, departure_date, departure_time,
                available_seats, total_seats, price_override, notes)
             VALUES ($1::uuid, $2::date, $3, $4, $5, $6, $7)
             ON CONFLICT (package_id, departure_date, departure_time)
             DO UPDATE SET available_seats = EXCLUDED.available_seats,
                           total_seats = EXCLUDED.total_seats,
                           price_override = EXCLUDED.price_override,
                           notes = EXCLUDED.notes,
                           is_active = true,
                           updated_at = NOW()
             RETURNING *`,
            [
                packageId, data.departureDate, data.departureTime || null,
                seats, seats, data.priceOverride || null, data.notes || null,
            ],
        );
        return rows?.[0];
    }

    async deleteInventory(schemaName: string, inventoryId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE tour_inventory SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [inventoryId],
        );
    }

    // ── Availability check ─────────────────────────────────────────

    async checkAvailability(
        schemaName: string,
        packageId: string,
        departureDate: string,
        partySize: number,
    ): Promise<{ available: boolean; seatsLeft: number | 'unlimited'; reason?: string }> {
        const pkg = await this.getPackage(schemaName, packageId);
        if (!pkg || !pkg.is_active) {
            return { available: false, seatsLeft: 0, reason: 'package_not_found' };
        }
        if (partySize < (pkg.min_party_size || 1)) {
            return { available: false, seatsLeft: 0, reason: 'party_size_too_small' };
        }

        const inv = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM tour_inventory
             WHERE package_id = $1::uuid AND departure_date = $2::date AND is_active = true
             ORDER BY departure_time NULLS FIRST LIMIT 1`,
            [packageId, departureDate],
        );

        // No inventory row = unlimited capacity (custom packages)
        if (!inv?.length) {
            return { available: true, seatsLeft: 'unlimited' };
        }

        const seatsLeft = inv[0].available_seats;
        if (seatsLeft < partySize) {
            return { available: false, seatsLeft, reason: 'not_enough_seats' };
        }
        return { available: true, seatsLeft };
    }

    // ── Bookings ───────────────────────────────────────────────────

    async listBookings(schemaName: string, packageId?: string): Promise<any[]> {
        const where = packageId ? `WHERE b.package_id = $1::uuid` : '';
        const params = packageId ? [packageId] : [];
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT b.*, p.name AS package_name, p.duration_type, p.duration_value
             FROM tour_bookings b
             JOIN tour_packages p ON p.id = b.package_id
             ${where}
             ORDER BY b.departure_date DESC, b.created_at DESC`,
            params,
        );
    }

    async createBooking(schemaName: string, data: {
        packageId: string;
        departureDate: string;
        departureTime?: string;
        partySize: number;
        adults?: number;
        children?: number;
        guestName?: string;
        guestPhone?: string;
        guestEmail?: string;
        contactId?: string;
        conversationId?: string;
        opportunityId?: string;
        language?: string;
        specialRequests?: string;
    }): Promise<any> {
        const partySize = requirePositiveIntegerUnit(data.partySize, 'partySize');
        const suppliedAdults = data.adults === undefined
            ? null
            : this.requireNonNegativeInteger(data.adults, 'adults');
        const suppliedChildren = data.children === undefined
            ? null
            : this.requireNonNegativeInteger(data.children, 'children');
        const adults = suppliedAdults ?? (suppliedChildren === null ? partySize : partySize - suppliedChildren);
        const children = suppliedChildren ?? (suppliedAdults === null ? 0 : partySize - suppliedAdults);
        if (adults < 0 || children < 0 || adults + children !== partySize) {
            throw new BadRequestException('adults + children must equal partySize');
        }
        const contactId = assertOptionalContactId(data.contactId);
        const created = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            // Contact ownership, package state, inventory claim and booking
            // insertion form one compatibility unit. Any later failure rolls
            // the seat decrement back; no best-effort compensation is needed.
            const canonicalContactId = await requireTenantContact(query, contactId);
            const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                contactId: canonicalContactId,
                conversationId: data.conversationId,
                trustedOpportunityId: data.opportunityId,
            });
            const packages = await query<any[]>(
                `SELECT * FROM tour_packages
                  WHERE id = $1::uuid AND is_active = true
                  FOR SHARE`,
                [data.packageId],
            );
            const pkg = packages?.[0];
            if (!pkg) throw new NotFoundException('Package not found');

            // The same contact, the same package, the same departure: one booking.
            //
            // Capacity is only enforced when the operator loaded a tour_inventory
            // row; without one the seats are unlimited, so nothing stopped a
            // re-issued call from writing a second identical reservation. The
            // appointment path has had this guard for months — the tour path was
            // simply never given one.
            const duplicate = canonicalContactId ? await query<any[]>(
                `SELECT id FROM tour_bookings
                  WHERE contact_id = $1::uuid
                    AND package_id = $2::uuid
                    AND departure_date = $3::date
                    AND status NOT IN ('cancelled')
                  LIMIT 1`,
                [canonicalContactId, data.packageId, data.departureDate],
            ) : [];
            if (duplicate?.length) {
                throw new BadRequestException({
                    error: 'duplicate_tour_booking',
                    bookingId: duplicate[0].id,
                    message: 'Este contacto ya tiene una reserva para ese paquete y esa fecha.',
                });
            }

            const inventory = await query<any[]>(
                `SELECT * FROM tour_inventory
                  WHERE package_id = $1::uuid
                    AND departure_date = $2::date
                    AND is_active = true
                  ORDER BY departure_time NULLS FIRST
                  LIMIT 1
                  FOR UPDATE`,
                [data.packageId, data.departureDate],
            );

            let inventoryId: string | null = null;
            if (inventory?.length) {
                const inv = inventory[0];
                if (Number(inv.available_seats) < partySize) {
                    throw new BadRequestException({
                        error: 'not_enough_seats',
                        seatsLeft: Number(inv.available_seats),
                        requested: partySize,
                    });
                }
                const claimed = await query<any[]>(
                    `UPDATE tour_inventory
                        SET available_seats = available_seats - $1,
                            updated_at = NOW()
                      WHERE id = $2::uuid AND available_seats >= $1
                      RETURNING id`,
                    [partySize, inv.id],
                );
                if (!claimed.length) {
                    throw new BadRequestException({
                        error: 'not_enough_seats',
                        seatsLeft: Number(inv.available_seats),
                        requested: partySize,
                    });
                }
                inventoryId = inv.id;
            }

            // Pricing: inventory override > package price; child discount if applicable.
            const unitPrice = inventory?.[0]?.price_override ?? pkg.price ?? 0;
            const childPrice = unitPrice * (1 - (pkg.child_discount_pct || 0) / 100);
            const totalPrice = unitPrice * adults + childPrice * children;
            // Si el dueño exige pago para confirmar, la reserva nace pendiente.
            //
            // Acá la retención es DISTINTA de la de alojamiento: el asiento ya
            // quedó descontado unas líneas más arriba, así que el cupo está
            // tomado desde el minuto cero. Lo que hace falta no es retenerlo —
            // es DEVOLVERLO si nadie paga, y de eso se encarga el barrido.
            const policy = resolvePaymentPolicy(pkg, totalPrice);
            const status = policy.requiresPayment ? PENDING_PAYMENT_STATUS : 'reserved';
            const holdExpiresAt = policy.requiresPayment
                ? new Date(Date.now() + PAYMENT_HOLD_MS)
                : null;
            const amountDue = policy.requiresPayment
                && policy.dueAmount != null
                && policy.dueAmount < totalPrice
                ? policy.dueAmount : null;

            const rows = await query<any[]>(
                `INSERT INTO tour_bookings (
                    package_id, inventory_id, contact_id, opportunity_id, conversation_id,
                    guest_name, guest_email, guest_phone,
                    departure_date, departure_time, party_size, adults, children,
                    unit_price, total_price, currency, language, special_requests,
                    status, amount_due, hold_expires_at
                 ) VALUES (
                    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
                    $6, $7, $8,
                    $9::date, $10, $11, $12, $13,
                    $14, $15, $16, $17, $18,
                    $19, $20, $21
                ) RETURNING *`,
                [
                    data.packageId, inventoryId, canonicalContactId, opportunityId, data.conversationId || null,
                    data.guestName || null, data.guestEmail || null, data.guestPhone || null,
                    data.departureDate, data.departureTime || null,
                    partySize, adults, children,
                    unitPrice, totalPrice, pkg.currency || 'COP',
                    data.language || 'es', data.specialRequests || null,
                    status, amountDue, holdExpiresAt,
                ],
            );
            if (!rows?.[0]) throw new Error('Tour booking was not created');
            return { booking: rows[0], pkg, totalPrice, policy };
        });
        const { booking, pkg, totalPrice, policy } = created;

        // Try to send confirmation email (fire-and-forget)
        try {
            const guestEmail = data.guestEmail;
            if (guestEmail) {
                // Check if confirmation emails are enabled for tours
                let emailConfirmationsEnabled = true;
                try {
                    const personaRows = await this.prisma.executeInTenantSchema<any[]>(
                        schemaName,
                        `SELECT config_json FROM agent_personas WHERE is_active = true LIMIT 1`,
                        []
                    );
                    if (personaRows && personaRows.length > 0) {
                        const config = personaRows[0].config_json || {};
                        const toursTool = config.tools?.tours;
                        if (toursTool && toursTool.emailConfirmations === false) {
                            emailConfirmationsEnabled = false;
                        }
                    }
                } catch (err) {
                    this.logger.error(`Error checking persona settings for tours: ${err.message}`);
                }

                if (emailConfirmationsEnabled) {
                    // TODO(i18n): this is a guest-facing email — pass the guest's
                    // detected/preferred language as the trailing `lang` arg once
                    // it's captured. Defaults to 'es' (unchanged behaviour).
                    await this.emailTemplates.renderAndSend(schemaName, 'tour_booking_confirmation', guestEmail, {
                        guest_name: data.guestName || 'Huésped',
                        package_name: pkg.name,
                        departure_date: data.departureDate,
                        departure_time: data.departureTime || '',
                        party_size: String(partySize),
                        adults: String(adults),
                        children: String(children),
                        total_price: String(totalPrice),
                        currency: pkg.currency || 'COP',
                        departure_location: pkg.departure_location || '',
                    });
                }
            }
        } catch (e: any) {
            this.logger.warn(`Tour confirmation email failed: ${e.message}`);
        }

        return booking;
    }

    async cancelBooking(schemaName: string, bookingId: string): Promise<void> {
        await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            // The booking row is the idempotency guard. Concurrent retries
            // serialize here; only the first live booking restores inventory.
            const booking = await query<any[]>(
                `SELECT * FROM tour_bookings WHERE id = $1::uuid FOR UPDATE`,
                [bookingId],
            );
            const b = booking?.[0];
            if (!b) throw new NotFoundException('Booking not found');
            if (b.status === 'cancelled') return;

            if (b.inventory_id) {
                await query(
                    `UPDATE tour_inventory
                        SET available_seats = available_seats + $1,
                            updated_at = NOW()
                      WHERE id = $2::uuid`,
                    [b.party_size, b.inventory_id],
                );
            }
            await query(
                `UPDATE tour_bookings
                    SET status = 'cancelled', updated_at = NOW()
                  WHERE id = $1::uuid`,
                [bookingId],
            );
        });
    }

    private requireNonNegativeInteger(value: unknown, field: string): number {
        if (value === null || value === '') {
            throw new BadRequestException(`${field} must be a non-negative integer`);
        }
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isInteger(parsed) || parsed < 0) {
            throw new BadRequestException(`${field} must be a non-negative integer`);
        }
        return parsed;
    }

    // ── Search (used by AI tool + dashboard list) ──────────────────

    async searchPackages(schemaName: string, params: {
        destination?: string;
        durationType?: 'hours' | 'days';
        maxPrice?: number;
        date?: string;
        partySize?: number;
    }): Promise<any[]> {
        const conditions: string[] = ['is_active = true'];
        const vals: any[] = [];
        let idx = 1;

        if (params.destination) {
            conditions.push(`(destination ILIKE $${idx} OR name ILIKE $${idx})`);
            vals.push(`%${params.destination}%`);
            idx++;
        }
        if (params.durationType) {
            conditions.push(`duration_type = $${idx}`);
            vals.push(params.durationType);
            idx++;
        }
        if (params.maxPrice) {
            conditions.push(`price <= $${idx}`);
            vals.push(params.maxPrice);
            idx++;
        }

        const packages = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM tour_packages WHERE ${conditions.join(' AND ')}
             ORDER BY sort_order, name LIMIT 20`,
            vals,
        );

        // If a date is provided, filter further by availability.
        if (params.date && params.partySize) {
            const filtered: any[] = [];
            for (const p of packages) {
                const avail = await this.checkAvailability(schemaName, p.id, params.date, params.partySize);
                if (avail.available) filtered.push({ ...p, available_seats: avail.seatsLeft });
            }
            return filtered;
        }
        return packages;
    }
}
