import { createHash } from 'crypto';
import { resolvePaymentPolicy } from '../../common/utils/payment-policy.util';
import { notAgreedSql } from '../conversations/commitment-proposal';

/** Canonical service facts that can materially change a customer's booking. */
export interface AppointmentServiceTerms {
    version: 1;
    serviceId: string;
    name: string;
    price: number;
    currency: string;
    durationType: string;
    durationMinutes: number | null;
    durationMinutesMax: number | null;
    locationType: string;
    locationAddress: string | null;
    meetingLinkHash: string | null;
    paymentPolicy: string;
    requiresPayment: boolean;
    amountDue: number | null;
    customerChooses: boolean;
}

export const APPOINTMENT_SERVICE_TERMS_COLUMNS = 'id, name, price, currency, duration_type, duration_minutes, duration_minutes_max, location_type, location_address, meeting_link, payment_policy, deposit_percent, deposit_amount';

export function appointmentServiceTerms(row: Record<string, any>): AppointmentServiceTerms {
    if (row.price != null && (!Number.isFinite(Number(row.price)) || Number(row.price) < 0)) throw new Error('appointment_service_terms_unavailable');
    const policy = resolvePaymentPolicy(row, row.price);
    const minutes = (value: unknown) => value == null ? null : Number(value);
    return {
        version: 1, serviceId: String(row.id), name: String(row.name ?? ''),
        price: policy.totalAmount, currency: String(row.currency || 'COP').trim().toUpperCase(),
        durationType: String(row.duration_type || 'fixed'), durationMinutes: minutes(row.duration_minutes),
        durationMinutesMax: minutes(row.duration_minutes_max), locationType: String(row.location_type || 'in_person'),
        locationAddress: row.location_address || null, meetingLinkHash: row.meeting_link ? createHash('sha256').update(String(row.meeting_link)).digest('hex') : null,
        paymentPolicy: policy.mode, requiresPayment: policy.requiresPayment, amountDue: policy.dueAmount,
        customerChooses: policy.customerChooses,
    };
}

/** Stable across property ordering, but never across a change of material terms. */
export function appointmentServiceTermsHash(terms: unknown): string | null {
    if (!terms || typeof terms !== 'object' || Array.isArray(terms)) return null;
    const t = terms as AppointmentServiceTerms;
    if (t.version !== 1 || typeof t.serviceId !== 'string' || typeof t.name !== 'string'
        || !Number.isFinite(t.price) || t.price < 0 || !/^[A-Z]{3}$/.test(t.currency)
        || typeof t.requiresPayment !== 'boolean' || typeof t.customerChooses !== 'boolean'
        || !['none', 'full', 'deposit', 'any'].includes(t.paymentPolicy)
        || typeof t.durationType !== 'string' || typeof t.locationType !== 'string'
        || (t.locationAddress !== null && typeof t.locationAddress !== 'string')
        || (t.meetingLinkHash !== null && !/^[a-f0-9]{64}$/.test(t.meetingLinkHash))
        || (t.amountDue !== null && !Number.isFinite(t.amountDue))
        || (t.durationMinutes !== null && !Number.isFinite(t.durationMinutes))
        || (t.durationMinutesMax !== null && !Number.isFinite(t.durationMinutesMax))) return null;
    return createHash('sha256').update(JSON.stringify([
        t.version, t.serviceId, t.name, t.price, t.currency, t.durationType, t.durationMinutes, t.durationMinutesMax,
        t.locationType, t.locationAddress, t.meetingLinkHash, t.paymentPolicy, t.requiresPayment, t.amountDue, t.customerChooses,
    ])).digest('hex');
}

export class AppointmentTermsChangedError extends Error {
    readonly code = 'appointment_terms_changed';
    constructor(readonly currentTerms: AppointmentServiceTerms) {
        super('The service terms changed or were not explicitly proposed. Review the current terms before booking.');
    }
}

export function assertAppointmentServiceTerms(expected: unknown, row: Record<string, any>): AppointmentServiceTerms {
    const current = appointmentServiceTerms(row);
    const expectedHash = appointmentServiceTermsHash(expected);
    if (!expectedHash || expectedHash !== appointmentServiceTermsHash(current)) throw new AppointmentTermsChangedError(current);
    return current;
}

export function appointmentTermsReviewResult(terms: AppointmentServiceTerms, error = 'appointment_terms_changed'): Record<string, unknown> {
    return { error, persisted: false, retryable: false, requiresConfirmation: true,
        message: 'Review the current service, price, payment terms, duration and location with the customer and request a new confirmation. No appointment was created.',
        service: { id: terms.serviceId, name: terms.name, price: terms.price, currency: terms.currency,
            durationType: terms.durationType, durationMinutes: terms.durationMinutes, durationMinutesMax: terms.durationMinutesMax,
            requiresPaymentToConfirm: terms.requiresPayment, amountDueToConfirm: terms.amountDue, appointmentTerms: terms } };
}

/**
 * The price a CHARGE may use: the one the customer agreed to, or none.
 *
 * A legacy appointment carries no `serviceTerms`, so there is no recoverable
 * historical quote — and the catalogue's price today is not it. Charging that is
 * charging a number nobody agreed to, and if the tenant has since raised prices
 * it is charging more. The sibling family already refuses: `enrollmentPriceSql`
 * returns NULL for a legacy row and the reference stops being payable, which is
 * the correct direction to err in.
 *
 * Kept separate from `appointmentPriceSql` on purpose. That one still falls back
 * to the catalogue and is right to, because a screen showing "the price of this
 * service" is a different statement from "the amount we are about to take". Two
 * meanings, two names; the money path gets the one that cannot guess.
 */
/**
 * The one condition under which an appointment carries an agreement a charge
 * may read. Everything else — the price, the currency, the orphan count, the
 * operator listing and the pre-deploy gate — is written from this.
 *
 * Each clause is a shape that was silently uncounted before, and every one of
 * them is a real legacy row rather than a hypothetical:
 *
 *   · `metadata IS NOT NULL`      — the column is nullable, and `NULL ? 'x'` is
 *                                   NULL, so `NOT (metadata ? 'serviceTerms')`
 *                                   never matched those rows at all;
 *   · `jsonb_typeof(...) = 'object'` — `{"serviceTerms": null}` and
 *                                   `{"serviceTerms": "later"}` both satisfy `?`;
 *   · the price matches a number  — `NULLIF(...,'')::numeric` refuses an empty
 *                                   string and THROWS on `"a convenir"`, which
 *                                   aborts the sweep it appears in;
 *   · the currency is non-blank   — half an agreement is not an agreement, and
 *                                   the resolver refuses on the three-letter
 *                                   check anyway.
 */
export function appointmentAgreedTermsSql(appointment = 'target'): string {
    if (!/^[a-z_]+$/.test(appointment)) throw new Error('invalid_sql_alias');
    const terms = `${appointment}.metadata->'serviceTerms'`;
    return `COALESCE(${appointment}.metadata IS NOT NULL
        AND jsonb_typeof(${terms}) = 'object'
        AND NULLIF(btrim(${terms}->>'price'), '') ~ '^-?[0-9]+([.][0-9]+)?$'
        AND NULLIF(btrim(${terms}->>'currency'), '') IS NOT NULL, false)`;
}

export function appointmentAgreedPriceSql(appointment = 'target'): string {
    if (!/^[a-z_]+$/.test(appointment)) throw new Error('invalid_sql_alias');
    // Guarded by the predicate, so the cast only ever runs on text that is a
    // number. Unguarded it was one malformed row away from a 500 in the till and
    // an aborted statement in the gate.
    return `(CASE WHEN ${appointmentAgreedTermsSql(appointment)}
        THEN btrim(${appointment}.metadata->'serviceTerms'->>'price')::numeric END)`;
}
export function appointmentAgreedCurrencySql(appointment = 'target'): string {
    if (!/^[a-z_]+$/.test(appointment)) throw new Error('invalid_sql_alias');
    return `(CASE WHEN ${appointmentAgreedTermsSql(appointment)}
        THEN btrim(${appointment}.metadata->'serviceTerms'->>'currency') END)`;
}

/**
 * How many appointments predate the binding, so the size of the gap above is a
 * number rather than a worry.
 *
 * Failing closed on a legacy row is only responsible if somebody can see how
 * many rows that is before it bites. Nothing counted them; this is the query
 * that does, and the sibling families get the same treatment through
 * `TERMS_BINDING_FAMILIES`.
 */
export const APPOINTMENT_LIVE_STATES: readonly string[] =
    Object.freeze(['cancelled', 'no_show', 'completed', 'expired']);

export function appointmentsWithoutAgreedTermsSql(): string {
    return `SELECT count(*)::int AS orphans FROM appointments target
             WHERE ${notAgreedSql(appointmentAgreedTermsSql())}
               AND target.status NOT IN (${APPOINTMENT_LIVE_STATES.map(s => `'${s}'`).join(', ')})`;
}

/** The same rows, listed by id and status. Ids only: never a name or a number. */
export function appointmentsWithoutAgreedTermsDetailSql(): string {
    return `SELECT target.id::text AS id, target.status, target.created_at
              FROM appointments target
             WHERE ${notAgreedSql(appointmentAgreedTermsSql())}
               AND target.status NOT IN (${APPOINTMENT_LIVE_STATES.map(s => `'${s}'`).join(', ')})
             ORDER BY target.created_at DESC`;
}

/** New appointments retain their sale terms. Legacy rows have no recoverable
 * historical quote and keep the catalogue fallback for DISPLAY only — the charge
 * uses `appointmentAgreedPriceSql`, which refuses instead of guessing. */
export function appointmentPriceSql(appointment = 'target', service = 'service'): string {
    if (![appointment, service].every(alias => /^[a-z_]+$/.test(alias))) throw new Error('invalid_sql_alias');
    // Guarded by the same predicate the till uses. Unguarded, a stored
    // `"a convenir"` made `::numeric` throw and the SCREEN 500 — a display path
    // has even less business dying on a malformed row than the till does. An
    // unreadable stored term is not a term, so it falls back to the catalogue,
    // which is exactly what a legacy row already does.
    return `(CASE WHEN ${appointmentAgreedTermsSql(appointment)} THEN btrim(${appointment}.metadata->'serviceTerms'->>'price')::numeric ELSE ${service}.price END)`;
}
export function appointmentCurrencySql(appointment = 'target', service = 'service'): string {
    if (![appointment, service].every(alias => /^[a-z_]+$/.test(alias))) throw new Error('invalid_sql_alias');
    return `(CASE WHEN ${appointmentAgreedTermsSql(appointment)} THEN btrim(${appointment}.metadata->'serviceTerms'->>'currency') ELSE ${service}.currency END)`;
}
