import { EVAL_WRITER_SANDBOX_FAMILIES } from './agent-test-tool-policy';
import type { CommitmentAction, CommitmentProposal, CommitmentQuery } from './commitment-proposal';

/**
 * Which tools commit the business, and how to read what they are committing it
 * to.
 *
 * One entry per family, each saying three things: the action, whether money can
 * move, and how to rebuild the proposal from the catalogue as it stands right
 * now. The rebuild is the point — a proposal is only worth hashing if it can be
 * recomputed at execution time from the same source, so that a price edited in
 * between is caught rather than trusted.
 *
 * `payable: false` is a statement, not an omission. A service request or a photo
 * quote commits the business to showing up, not to a number, so there is no
 * amount to freeze and pretending otherwise would put a zero in a charge path.
 *
 * A family with no builder cannot be gated, so the spec requires every
 * committing family in the registry to have one here: adding a vertical without
 * one fails a test rather than shipping a writer nobody can hold to terms.
 */

export interface CommitmentFamily {
    readonly family: string;
    readonly tools: readonly string[];
    readonly action: CommitmentAction;
    /** Can money move for this family? Decides whether a price must be frozen. */
    readonly payable: boolean;
    /** The table the writer's row lands in, for linking the accepted proposal. */
    readonly table: string;
    /** States in which a row is not going to be charged, for the orphan count. */
    readonly settledStates: readonly string[];
    /**
     * The tables the builder reads.
     *
     * Probed before it runs, because the build happens INSIDE the transaction
     * the write is using: a query against a table this tenant does not have
     * does not return nothing, it aborts everything after it. `to_regclass`
     * cannot fail, so asking first is the only safe order.
     */
    readonly reads: readonly string[];
    /**
     * Rebuilds the proposal from the catalogue. Returns `null` when the args do
     * not name something that exists — the write would fail anyway, and a
     * proposal for a resource that is gone is not a proposal.
     */
    readonly build: (
        query: CommitmentQuery, args: Record<string, any>, contactId: string,
    ) => Promise<Omit<CommitmentProposal, 'version' | 'family' | 'action' | 'contactId' | 'authority'> | null>;
}

const cents = (value: unknown): string => {
    const text = String(value ?? '0');
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return '0';
    const [whole, fraction = ''] = text.split('.');
    return String(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
};
const currency = (value: unknown): string => {
    const code = String(value ?? 'COP').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : 'COP';
};
const iso = (value: unknown): string => (value ? new Date(value as string).toISOString() : '');
const uuid = (value: unknown): string | null => {
    const text = String(value ?? '').toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text) ? text : null;
};

/**
 * Conditions the customer actually heard, as codes.
 *
 * Prose would make the hash depend on wording and change every time somebody
 * fixed a typo. A code changes when the RULE changes, which is the thing that
 * invalidates an agreement.
 */
const paymentConditions = (row: Record<string, any>): string[] => {
    const policy = String(row?.payment_policy ?? 'none');
    const out: string[] = [`payment_${policy}`];
    if (row?.deposit_percent != null) out.push(`deposit_percent_${Number(row.deposit_percent)}`);
    if (row?.deposit_amount != null) out.push(`deposit_amount_${cents(row.deposit_amount)}`);
    return out;
};

export const COMMITMENT_FAMILIES: readonly CommitmentFamily[] = Object.freeze([
    {
        family: 'property_bookings', reads: ['properties'], tools: ['create_property_booking'], action: 'create',
        payable: true, table: 'property_bookings', settledStates: ['cancelled', 'refunded', 'expired'],
        build: async (query, args, _contactId) => {
            const id = uuid(args?.propertyId);
            if (!id) return null;
            const [property] = await query<any[]>(
                `SELECT id, name, night_price, cleaning_fee, currency, min_nights, max_guests,
                        payment_policy, deposit_percent, deposit_amount
                   FROM properties WHERE id = $1::uuid AND is_active = true`, [id]);
            if (!property) return null;
            const checkIn = iso(args?.checkIn), checkOut = iso(args?.checkOut);
            if (!checkIn || !checkOut) return null;
            const nights = Math.max(1, Math.round(
                (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000));
            const total = BigInt(cents(property.night_price)) * BigInt(nights) + BigInt(cents(property.cleaning_fee));
            return {
                resources: [{ kind: 'property', id: String(property.id), name: String(property.name ?? ''),
                    quantity: Number(args?.guests ?? 1) }],
                window: { startAt: checkIn, endAt: checkOut },
                price: { amountCents: String(total), currency: currency(property.currency) },
                // The nightly rate and the cleaning fee are read out to the guest
                // and are part of the agreement, not just inputs to the total: a
                // total that stays the same because one went up and the other
                // down is still a different quote.
                conditions: [`nights_${nights}`, `night_price_${cents(property.night_price)}`,
                    `cleaning_fee_${cents(property.cleaning_fee)}`, ...paymentConditions(property)],
            };
        },
    },
    {
        family: 'tour_bookings', reads: ['tour_packages'], tools: ['create_tour_booking'], action: 'create',
        payable: true, table: 'tour_bookings', settledStates: ['cancelled', 'refunded', 'expired'],
        build: async (query, args) => {
            const id = uuid(args?.packageId ?? args?.tourPackageId);
            if (!id) return null;
            const [pack] = await query<any[]>(
                `SELECT id, name, price, currency, cancellation_policy, child_discount_pct, max_capacity,
                        payment_policy, deposit_percent, deposit_amount
                   FROM tour_packages WHERE id = $1::uuid AND is_active = true`, [id]);
            if (!pack) return null;
            const travellers = Math.max(1, Number(args?.travelers ?? args?.travellers ?? args?.people ?? 1));
            const departure = iso(args?.departureDate ?? args?.date);
            const total = BigInt(cents(pack.price)) * BigInt(travellers);
            return {
                resources: [{ kind: 'tour_package', id: String(pack.id), name: String(pack.name ?? ''),
                    quantity: travellers }],
                window: departure ? { startAt: departure, endAt: departure } : null,
                price: { amountCents: String(total), currency: currency(pack.currency) },
                conditions: [`unit_price_${cents(pack.price)}`,
                    `cancellation_${String(pack.cancellation_policy ?? 'none').slice(0, 40)}`,
                    `child_discount_${Number(pack.child_discount_pct ?? 0)}`,
                    ...paymentConditions(pack)],
            };
        },
    },
    {
        family: 'restaurant_orders', reads: ['menu_items'], tools: ['place_order'], action: 'create',
        payable: true, table: 'food_orders', settledStates: ['cancelled', 'refunded'],
        build: async (query, args) => {
            const items = Array.isArray(args?.items) ? args.items : [];
            if (!items.length) return null;
            const ids = items.map((item: any) => uuid(item?.menuItemId ?? item?.itemId)).filter(Boolean) as string[];
            if (ids.length !== items.length) return null;
            const rows = await query<any[]>(
                `SELECT id, name, price, currency FROM menu_items
                  WHERE id = ANY($1::uuid[]) AND is_active = true AND is_available = true`, [ids]);
            if (rows.length !== new Set(ids).size) return null;
            const byId = new Map(rows.map(row => [String(row.id), row]));
            let total = 0n;
            const resources = items.map((item: any) => {
                const menuItem = byId.get(uuid(item?.menuItemId ?? item?.itemId)!)!;
                const quantity = Math.max(1, Number(item?.quantity ?? 1));
                total += BigInt(cents(menuItem.price)) * BigInt(quantity);
                return { kind: 'menu_item', id: String(menuItem.id), name: String(menuItem.name ?? ''), quantity };
            });
            return {
                resources,
                window: null,
                price: { amountCents: String(total), currency: currency(rows[0]?.currency) },
                conditions: resources.map(resource =>
                    `unit_${resource.id}_${cents(byId.get(resource.id)!.price)}`).sort(),
            };
        },
    },
    {
        family: 'class_bookings', reads: ['fitness_classes'], tools: ['book_class'], action: 'create',
        payable: false, table: 'class_bookings', settledStates: ['cancelled'],
        build: async (query, args) => {
            const id = uuid(args?.classId ?? args?.gymClassId);
            if (!id) return null;
            const [row] = await query<any[]>(
                `SELECT id, name, scheduled_at, duration_minutes, max_capacity, credits_required, is_cancelled
                   FROM fitness_classes WHERE id = $1::uuid`, [id]);
            if (!row) return null;
            const startAt = iso(row.scheduled_at);
            const endAt = startAt
                ? new Date(new Date(startAt).getTime() + Number(row.duration_minutes ?? 0) * 60_000).toISOString()
                : '';
            return {
                resources: [{ kind: 'fitness_class', id: String(row.id), name: String(row.name ?? '') }],
                window: startAt ? { startAt, endAt: endAt || startAt } : null,
                price: null,
                // The seat is the commitment. A class that moved to another day,
                // whose capacity was cut, that now costs more credits or that has
                // since been cancelled is not the class the member said yes to.
                conditions: [`capacity_${Number(row.max_capacity ?? 0)}`,
                    `credits_${Number(row.credits_required ?? 0)}`,
                    `cancelled_${row.is_cancelled === true}`],
            };
        },
    },
    {
        family: 'insurance_quotes', reads: ['insurance_plans'], tools: ['calculate_quote'], action: 'quote',
        payable: false, table: 'insurance_quotes', settledStates: ['expired', 'rejected'],
        build: async (query, args) => {
            const id = uuid(args?.planId ?? args?.insurancePlanId);
            if (!id) return null;
            const [plan] = await query<any[]>(
                `SELECT id, name, monthly_premium_min, monthly_premium_max, deductible, currency,
                        covers, excludes, min_age, max_age
                   FROM insurance_plans WHERE id = $1::uuid AND is_active = true`, [id]);
            if (!plan) return null;
            return {
                resources: [{ kind: 'insurance_plan', id: String(plan.id), name: String(plan.name ?? '') }],
                window: null,
                // The floor of the range, because that is the number a customer
                // repeats back. The rest of the range and the deductible are
                // conditions: a plan whose ceiling moved is a different quote
                // even when the number that was said out loud did not change.
                price: { amountCents: cents(plan.monthly_premium_min), currency: currency(plan.currency) },
                conditions: [`premium_max_${cents(plan.monthly_premium_max)}`,
                    `deductible_${cents(plan.deductible)}`,
                    `covers_${(Array.isArray(plan.covers) ? [...plan.covers].sort() : []).join('-') || 'none'}`,
                    `excludes_${(Array.isArray(plan.excludes) ? [...plan.excludes].sort() : []).join('-') || 'none'}`,
                    `age_${Number(plan.min_age ?? 0)}_${Number(plan.max_age ?? 0)}`],
            };
        },
    },
    {
        family: 'service_requests', reads: ['services'], tools: ['create_service_request'], action: 'create',
        payable: false, table: 'service_requests', settledStates: ['cancelled', 'completed'],
        build: async (query, args) => {
            const id = uuid(args?.serviceId);
            if (!id) return null;
            const [service] = await query<any[]>(
                `SELECT id, name, duration_minutes, price, currency, payment_policy
                   FROM services WHERE id = $1::uuid AND is_active = true`, [id]);
            if (!service) return null;
            const visit = iso(args?.preferredDate ?? args?.scheduledAt);
            return {
                resources: [{ kind: 'service', id: String(service.id), name: String(service.name ?? '') }],
                window: visit ? { startAt: visit, endAt: visit } : null,
                // No price: the visit is committed, the quote comes from a person
                // afterwards. Freezing a zero here would put a zero in a till.
                price: null,
                // The catalogue price is a condition and not a price: it is what
                // the customer was told the visit usually costs, and the binding
                // amount comes from the quote a person writes afterwards.
                conditions: [`duration_${Number(service.duration_minutes ?? 0)}`, 'quote_after_visit',
                    `list_price_${cents(service.price)}_${currency(service.currency)}`,
                    `payment_${String(service.payment_policy ?? 'none')}`],
            };
        },
    },
    {
        family: 'photo_sessions', reads: ['services'], tools: ['request_photo_quote'], action: 'quote',
        payable: false, table: 'photo_sessions', settledStates: ['cancelled', 'completed'],
        build: async (query, args) => {
            const id = uuid(args?.serviceId ?? args?.packageId);
            if (!id) return null;
            const [service] = await query<any[]>(
                `SELECT id, name FROM services WHERE id = $1::uuid AND is_active = true`, [id]);
            if (!service) return null;
            const date = iso(args?.sessionDate ?? args?.date);
            return {
                resources: [{ kind: 'service', id: String(service.id), name: String(service.name ?? '') }],
                window: date ? { startAt: date, endAt: date } : null,
                price: null,
                conditions: ['quote_from_photographer'],
            };
        },
    },
    {
        family: 'resource_rentals', reads: ['vehicles', 'services'], tools: ['create_vehicle_rental', 'create_pet_boarding'], action: 'create',
        payable: false, table: 'resource_rentals', settledStates: ['cancelled', 'completed'],
        // Two tools, two catalogues: a vehicle rental names a row in `vehicles`
        // and a pet boarding names a row in `services`. One builder that assumed
        // a single resource table would have quietly refused half the family.
        build: async (query, args) => {
            const vehicleId = uuid(args?.vehicleId);
            const serviceId = uuid(args?.serviceId ?? args?.resourceId);
            const [resource] = vehicleId
                ? await query<any[]>(
                    `SELECT id, COALESCE(NULLIF(btrim(COALESCE(make,'') || ' ' || COALESCE(model,'')), ''), 'vehicle') AS name,
                            'vehicle' AS kind, status
                       FROM vehicles WHERE id = $1::uuid`, [vehicleId])
                : serviceId
                    ? await query<any[]>(
                        `SELECT id, name, 'service' AS kind, 'active' AS status
                           FROM services WHERE id = $1::uuid AND is_active = true`, [serviceId])
                    : [];
            if (!resource) return null;
            const from = iso(args?.startAt ?? args?.checkIn), to = iso(args?.endAt ?? args?.checkOut);
            return {
                resources: [{ kind: String(resource.kind), id: String(resource.id),
                    name: String(resource.name ?? '') }],
                window: from && to ? { startAt: from, endAt: to } : null,
                // Born `pending_review`: a person sets the price, so there is no
                // agreed amount for a charge to bind to yet, and saying so is
                // part of what the customer is told.
                price: null,
                conditions: ['pending_review', 'price_set_by_staff', `resource_status_${String(resource.status)}`],
            };
        },
    },
    {
        family: 'appointment_transitions', reads: ['appointments'], tools: ['cancel_appointment', 'reschedule_appointment'],
        action: 'reschedule', payable: false, table: 'appointments',
        settledStates: ['cancelled', 'no_show', 'completed', 'expired'],
        build: async (query, args) => {
            const id = uuid(args?.appointmentId);
            if (!id) return null;
            // `start_at`/`end_at`, and the row already carries `service_name`:
            // the first version of this joined `services` on columns that do not
            // exist, which does not merely return nothing — it poisons the
            // transaction the whole write is running in.
            const [row] = await query<any[]>(
                `SELECT id, start_at, end_at, status, service_id, service_name
                   FROM appointments WHERE id = $1::uuid`, [id]);
            if (!row) return null;
            const target = iso(args?.newStartTime ?? args?.startTime ?? args?.startAt);
            return {
                resources: [{ kind: 'appointment', id: String(row.id), name: String(row.service_name ?? '') }],
                window: target
                    ? { startAt: target, endAt: target }
                    : { startAt: iso(row.start_at), endAt: iso(row.end_at ?? row.start_at) },
                price: null,
                // The state it is in when the customer is told what will happen.
                // Cancelling something that has since been completed is a
                // different act from cancelling something still pending.
                conditions: [`from_status_${String(row.status ?? 'unknown')}`],
            };
        },
    },
    {
        family: 'repair_orders', reads: ['vehicles'], tools: ['create_repair_order'], action: 'create',
        payable: false, table: 'repair_orders', settledStates: ['cancelled', 'completed', 'delivered'],
        build: async (query, args) => {
            const id = uuid(args?.vehicleId ?? args?.assetId);
            if (!id) return null;
            const [vehicle] = await query<any[]>(
                `SELECT id, COALESCE(make || ' ' || model, model, make, '') AS name
                   FROM vehicles WHERE id = $1::uuid`, [id]);
            if (!vehicle) return null;
            return {
                resources: [{ kind: 'vehicle', id: String(vehicle.id), name: String(vehicle.name ?? '') }],
                window: null,
                price: null,
                conditions: ['diagnosis_before_quote'],
            };
        },
    },
] as const satisfies readonly CommitmentFamily[]);

const BY_TOOL = new Map<string, CommitmentFamily>(
    COMMITMENT_FAMILIES.flatMap(family => family.tools.map(tool => [tool, family] as const)));

export function commitmentFamilyForTool(toolName: string): CommitmentFamily | null {
    return BY_TOOL.get(toolName) ?? null;
}

/** Every family the sandbox registry declares. The universe the spec compares against. */
export function declaredWriterFamilies(): readonly string[] {
    return Object.freeze(Object.keys(EVAL_WRITER_SANDBOX_FAMILIES).sort());
}
