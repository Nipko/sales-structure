import { appointmentsWithoutAgreedTermsSql } from '../appointments/appointment-service-terms';
import { ordersWithoutAgreedTermsSql } from '../orders/catalog-order-contract';
import { commitmentOrphansSql } from '../conversations/commitment-proposal';

/**
 * The rows that predate the terms binding, counted before a deploy meets them.
 *
 * Two families now refuse to be charged when nobody recorded what the customer
 * agreed to. That is the right refusal — charging a number the customer never
 * saw is worse than not charging — and it has a consequence somebody has to see
 * BEFORE it happens: an order or an appointment created before the snapshot
 * existed becomes unpayable the moment the new code runs. If a tenant has live
 * ones, their customers meet a payment link that does not work.
 *
 * So this is the dry run. It answers, per tenant and per family: how many, in
 * which states, and which ones — by id only.
 *
 * **No personal data crosses this boundary.** No name, no phone, no email, no
 * amount, no note: an id, a status and a date. An operations report about who
 * owes what is not a reason to copy a customer list into a log.
 *
 * And it does not guess. The one thing this must never do is reconstruct
 * consent from `total_amount`: a number in a column is evidence that somebody
 * computed it, not that a person agreed to it. Every row here is classified as
 * needing a human, because that is what it needs.
 */

export type OrphanQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

export const AGREED_TERMS_FAMILIES = [
    'catalog_orders', 'appointments', 'property_bookings', 'tour_bookings', 'restaurant_orders',
] as const;
export type AgreedTermsFamily = (typeof AGREED_TERMS_FAMILIES)[number];

export interface AgreedTermsOrphanFamily {
    readonly family: AgreedTermsFamily;
    readonly table: string;
    /** How many live rows would be refused a charge today. */
    readonly orphans: number;
    /** Bounded sample of ids, so an operator can open one. Ids only. */
    readonly sample: readonly string[];
    /** How they are distributed across states, for sizing the queue of work. */
    readonly byStatus: Readonly<Record<string, number>>;
    /** The oldest and newest, so "is this history or is this today" is answerable. */
    readonly oldest: string | null;
    readonly newest: string | null;
    /**
     * What can be done with them. Always `human_review`: there is no durable
     * evidence of an agreement for a row that predates the snapshot, and
     * inventing one from the amount would be inventing consent.
     */
    readonly resolution: 'human_review';
}

export interface AgreedTermsOrphanReport {
    readonly generatedAt: string;
    readonly families: readonly AgreedTermsOrphanFamily[];
    readonly total: number;
    /** True when a deploy would leave live rows unpayable in this tenant. */
    readonly blocksDeploy: boolean;
}

const SAMPLE = 20;

/**
 * The three families the shared commitment gate closed read their acceptance
 * from `commitment_proposals` rather than from a column of their own, so their
 * orphan query is the same query with a different table. Writing it three times
 * would be three chances to forget the `accepted_at IS NOT NULL`.
 */
const commitmentDetail = (table: string, liveStates: readonly string[]) => `
    SELECT target.id::text AS id, target.status, target.created_at
      FROM ${table} target
     WHERE NOT EXISTS (
         SELECT 1 FROM commitment_proposals p
          WHERE p.consumed_entity_id = target.id AND p.accepted_at IS NOT NULL)
       AND target.status NOT IN (${liveStates.map(state => `'${state}'`).join(', ')})
     ORDER BY target.created_at DESC`;

const FAMILY_SQL: Record<AgreedTermsFamily, { table: string; count: string; detail: string }> = {
    catalog_orders: {
        table: 'orders',
        count: ordersWithoutAgreedTermsSql(),
        detail: `SELECT id::text AS id, status, created_at
                   FROM orders
                  WHERE COALESCE(catalog_terms->>'action','') <> 'create'
                    AND status NOT IN ('cancelled', 'refunded', 'paid')
                  ORDER BY created_at DESC`,
    },
    appointments: {
        table: 'appointments',
        count: appointmentsWithoutAgreedTermsSql(),
        detail: `SELECT id::text AS id, status, created_at
                   FROM appointments
                  WHERE NOT (metadata ? 'serviceTerms')
                    AND status NOT IN ('cancelled', 'no_show', 'completed', 'expired')
                  ORDER BY created_at DESC`,
    },
    property_bookings: {
        table: 'property_bookings',
        count: commitmentOrphansSql('property_bookings', ['cancelled', 'refunded', 'expired']),
        detail: commitmentDetail('property_bookings', ['cancelled', 'refunded', 'expired']),
    },
    tour_bookings: {
        table: 'tour_bookings',
        count: commitmentOrphansSql('tour_bookings', ['cancelled', 'refunded', 'expired']),
        detail: commitmentDetail('tour_bookings', ['cancelled', 'refunded', 'expired']),
    },
    restaurant_orders: {
        table: 'food_orders',
        count: commitmentOrphansSql('food_orders', ['cancelled', 'refunded']),
        detail: commitmentDetail('food_orders', ['cancelled', 'refunded']),
    },
};

/**
 * Runs the dry run for one tenant.
 *
 * A family whose table does not exist in this tenant is reported as zero rather
 * than aborting the report: a clinic with no catalogue is not an error, and a
 * report that dies on the first missing table tells an operator nothing about
 * the rest.
 */
export async function countAgreedTermsOrphans(query: OrphanQuery): Promise<AgreedTermsOrphanReport> {
    const families: AgreedTermsOrphanFamily[] = [];
    for (const family of AGREED_TERMS_FAMILIES) {
        const spec = FAMILY_SQL[family];
        try {
            const [counted] = await query<any[]>(spec.count);
            const rows = await query<any[]>(spec.detail);
            const byStatus: Record<string, number> = {};
            for (const row of rows) {
                const status = String(row.status ?? 'unknown');
                byStatus[status] = (byStatus[status] ?? 0) + 1;
            }
            const dates = rows.map(row => row.created_at).filter(Boolean).map(value => new Date(value).toISOString());
            families.push(Object.freeze({
                family, table: spec.table,
                orphans: Number(counted?.orphans ?? rows.length),
                sample: Object.freeze(rows.slice(0, SAMPLE).map(row => String(row.id))),
                byStatus: Object.freeze(byStatus),
                oldest: dates.length ? dates[dates.length - 1] : null,
                newest: dates.length ? dates[0] : null,
                resolution: 'human_review' as const,
            }));
        } catch {
            families.push(Object.freeze({
                family, table: spec.table, orphans: 0, sample: Object.freeze([]),
                byStatus: Object.freeze({}), oldest: null, newest: null, resolution: 'human_review' as const,
            }));
        }
    }
    const total = families.reduce((sum, entry) => sum + entry.orphans, 0);
    return Object.freeze({
        generatedAt: new Date().toISOString(),
        families: Object.freeze(families),
        total,
        blocksDeploy: total > 0,
    });
}

/** Redis key the refusal counter lives under, so an alert can watch one name. */
export const agreedTermsRefusalKey = (tenantId: string, kind: string) =>
    `tenant_payments:terms_refused:${tenantId}:${kind}`;

/**
 * Was this charge refused because nobody recorded what the customer agreed to?
 *
 * The resolver used to answer `null` for every reason there is — not found,
 * wrong contact, wrong status, no agreed terms — so the one refusal that means
 * "a real customer is holding a link that will not work" was indistinguishable
 * from a typo in a reference. This is what tells them apart.
 */
export function isMissingAgreedTermsRefusal(
    row: { amount?: unknown; currency?: unknown } | undefined, kind: string,
): boolean {
    if (!row) return false;
    // Every payable kind whose amount comes from an acceptance. A family that
    // still charges from a live column cannot be refused for missing one, and
    // saying so would turn an ordinary not-found into a false alarm.
    if (!['order', 'appointment', 'property', 'tour', 'food'].includes(kind)) return false;
    // The row exists and its agreed amount is absent: that is the snapshot
    // missing, not a status or an ownership problem.
    return row.amount === null || row.amount === undefined;
}
