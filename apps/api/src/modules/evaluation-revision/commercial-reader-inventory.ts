/**
 * Every read that moves money, and whether a frozen authority stands behind it.
 *
 * An evaluation is only evidence if the thing it evaluated cannot have changed
 * underneath it. For most of the agent that is already true: `capture()` seals
 * a manifest whose dependencies are every table in the tenant schema except the
 * ones the run writes itself, taken in one MVCC transaction, so an evaluation
 * that read a price and a run that was measured against a different price are
 * distinguishable by a hash.
 *
 * What nobody could answer was the narrower and more expensive question:
 * **which reads decide a commercial fact, and is every one of them covered?**
 * `evaluation-reader-inventory.ts` says which tables each tool touches — it is
 * reviewed and a spec keeps it exhaustive — but it does not say which of those
 * answers a customer can be charged for, and its own last line admits it:
 * "full commercial readers remain unproven".
 *
 * ── Why this is derived and not a third hand-written list ───────────────────
 *
 * A hand-written answer to "is this frozen?" is worth nothing: the person
 * writing it is the same person who just added the reader. So exactly one thing
 * here is declared — which commercial DIMENSIONS a group's answer moves, which
 * is a judgement about the product and cannot be computed — and everything else
 * is derived:
 *
 *   · a tenant table is a manifest dependency unless it is in
 *     `EVALUATION_OUTPUT_TABLES`, which is the manifest's own rule, read from
 *     the manifest's own constant;
 *   · a non-table read is classified once, in `OUTSIDE_AUTHORITIES`, with the
 *     reason it is or is not frozen;
 *   · `commercialReadersWithoutFrozenAuthority()` then computes the answer, and
 *     a spec requires the remainder to be exactly the accepted exceptions —
 *     each of which has to say why, in the same file, where it can be argued
 *     with.
 *
 * So a new tool cannot join quietly: the existing coverage spec forces it into
 * a read group, and this file's spec forces that group to be classified.
 *
 * ── What "frozen" means here, precisely ────────────────────────────────────
 *
 * Not "the value cannot change" — a tenant may change a price whenever they
 * like. It means **the value is a dependency of the manifest**, so a result
 * measured before the change and one measured after are not confusable: the
 * revision hash differs, and `assertRevisionIntegrity` refuses the mismatch.
 * A read outside the manifest has no such property, and a result that depends
 * on one cannot be said to have been measured against anything.
 */

import { EVALUATION_OUTPUT_TABLES } from './evaluation-revision';
import { EVALUATION_TOOL_READ_GROUPS, type EvaluationToolReadGroup } from './evaluation-reader-inventory';

export const COMMERCIAL_DIMENSIONS = [
    'price', 'currency', 'stock', 'availability', 'eligibility',
    'coverage', 'quota', 'policy', 'terms', 'outcome',
] as const;
export type CommercialDimension = (typeof COMMERCIAL_DIMENSIONS)[number];

/**
 * The dimensions a validity window can move, as opposed to the ones a value
 * sits in.
 *
 * A price is a number in a row: the clock cannot change it. Whether an offer is
 * still on, whether a policy is still in force, whether a slot is still free —
 * those are statements about NOW, and an unfrozen clock is what they are made
 * of. The distinction is the whole reason `wall_clock` is an accepted exception
 * rather than a hole: it can only reach the dimensions in this list, and a
 * reader that rests on it while deciding nothing in this list would be a defect
 * the inventory has to surface.
 */
export const TIME_BOUNDED_DIMENSIONS: readonly CommercialDimension[] = Object.freeze([
    'availability', 'quota', 'stock', 'eligibility', 'coverage',
]);

/** A group is identified by its first tool: stable, and already unique per the coverage spec. */
export const groupId = (group: EvaluationToolReadGroup): string => group.tools[0];

/**
 * Which commercial facts a group's answer decides.
 *
 * The one declared thing in this file, because it is a judgement about the
 * product rather than a property of the code: only a person can say that
 * `check_stock` decides whether a customer can be charged and `get_case_status`
 * does not. An empty list is a claim too — that nothing this group returns can
 * change what somebody pays or receives — and the spec requires every group to
 * make one or the other.
 */
export const COMMERCIAL_GROUP_DIMENSIONS: Readonly<Record<string, readonly CommercialDimension[]>> = Object.freeze({
    // ── Catalogue and price ─────────────────────────────────────────────────
    list_services: ['price', 'currency', 'policy', 'terms', 'availability'],
    search_products: ['price', 'currency', 'stock'],
    recommend_products: ['price', 'currency', 'stock'],
    list_active_offers: ['price', 'currency', 'eligibility', 'terms'],
    get_menu: ['price', 'currency', 'availability'],
    search_packages: ['price', 'currency', 'availability', 'quota'],
    list_properties: ['price', 'currency', 'availability'],
    get_property_details: ['price', 'currency', 'policy', 'terms'],
    search_listings: ['price', 'currency', 'availability'],
    search_vehicles: ['price', 'currency', 'stock'],
    get_membership_plans: ['price', 'currency', 'eligibility', 'terms'],
    get_courses: ['price', 'currency', 'availability', 'quota'],
    // Also `check_policy_status` and `list_my_claims`, hence `outcome`.
    get_insurance_plans: ['price', 'currency', 'coverage', 'eligibility', 'terms', 'outcome'],
    list_home_services: ['price', 'currency', 'availability'],
    list_pet_services: ['price', 'currency'],
    check_daycare_availability: ['price', 'currency', 'availability', 'quota'],
    get_class_schedule: ['availability', 'quota'],
    check_date_availability: ['availability'],
    get_treatment_plan: ['coverage', 'eligibility', 'outcome'],

    // ── Policy and the rules a commitment is made under ──────────────────────
    get_policy: ['policy', 'terms'],
    search_faqs: ['policy', 'terms'],
    // `eligibility` and not only `policy`: the retrieval gate refuses a
    // regulated document that is not in force today, so this reader decides
    // whether a norm applies at all — a validity window, not just its text.
    // That is also why it is allowed to rest on `CURRENT_DATE`.
    search_knowledge_base: ['policy', 'terms', 'eligibility'],

    // ── What a customer already owes or is owed ──────────────────────────────
    list_my_catalog_orders: ['outcome', 'price', 'currency'],
    list_customer_orders: ['outcome', 'price', 'currency'],
    check_order_status: ['outcome'],
    list_my_property_bookings: ['outcome', 'price', 'currency'],
    list_my_tour_bookings: ['outcome', 'price', 'currency'],
    list_my_repair_orders: ['outcome', 'price', 'currency'],
    check_request_status: ['outcome'],
    list_my_enrollments: ['outcome', 'eligibility'],

    // ── Not commercial, and the claim is explicit ───────────────────────────
    /** Identity and pipeline context. It carries no price, quota or entitlement. */
    get_customer_context: [],
    /** A triage decision, deliberately made without reading any catalogue. */
    triage_pet_emergency: [],
    /** Pet records and vaccination dates: clinical, and nothing here is billable on its own. */
    list_pets_for_contact: [],
    /** A CRM stage. It reports where a deal is, and decides nothing about it. */
    get_case_status: [],
});

export type OutsideAuthorityKind =
    /** Sealed at capture; the evaluation reads the copy, not the source. */
    | 'sealed_capture'
    /** A manifest dependency reached by another name. */
    | 'manifest_dependency'
    /** Changes which row is chosen, never what the row says. */
    | 'ranking_only'
    /** Genuinely unfrozen. Every one of these needs an accepted reason. */
    | 'unfrozen';

export interface OutsideAuthority {
    readonly kind: OutsideAuthorityKind;
    readonly because: string;
}

/**
 * The non-table reads the groups declare, classified once.
 *
 * `evaluation-reader-inventory.ts` already lists them per group as
 * `outsideNamespace`; what it does not say is whether any of them can move a
 * commercial answer without moving the revision. That is what this decides, and
 * the spec fails on a token that appears in a group and not here — so a new
 * outside read cannot arrive unclassified.
 */
export const OUTSIDE_AUTHORITIES: Readonly<Record<string, OutsideAuthority>> = Object.freeze({
    wall_clock: { kind: 'unfrozen',
        because: 'the instant is not frozen anywhere in this system, and the manifest says so in its own '
            + 'limitations (`wall_clock_not_frozen`). It moves availability and nothing else' },
    CURRENT_DATE: { kind: 'unfrozen',
        because: 'the database clock, same reason and same scope as `wall_clock`' },
    sealed_eligible_collection: { kind: 'sealed_capture',
        because: 'the complete published FAQ/policy collection, copied in one read-only MVCC transaction '
            + 'by `captureStructuredKnowledge` and hashed into the snapshot' },
    PostgreSQL_recordset_search: { kind: 'sealed_capture',
        because: 'the sealed recordset keeps the PostgreSQL predicate and ranking, so the search runs '
            + 'against the copy rather than the live table' },
    PostgreSQL_recordset_query: { kind: 'sealed_capture',
        because: 'same as the search recordset, for the policy reader' },
    sealed_managed_knowledge_replica: { kind: 'sealed_capture',
        because: 'a server-side MVCC copy of the RAG corpus in an owned namespace, with per-table content '
            + 'hashes re-checked at use by `assertKnowledgeReplicaInTransaction`' },
    live_source_authority: { kind: 'ranking_only',
        because: 'a permission to spend on a provider call. It gates whether retrieval runs, not what any '
            + 'retrieved passage says — and the passage itself is a manifest dependency' },
    embedding_provider: { kind: 'ranking_only',
        because: 'a different vector changes WHICH passage is chosen; the price or policy inside the chosen '
            + 'passage is a manifest dependency either way' },
    reranker_router: { kind: 'ranking_only',
        because: 'reordering, for the same reason as the embedding provider' },
    'public.tenants.settings.channelManager': { kind: 'manifest_dependency',
        because: '`public.tenants` is one of the manifest\'s public dependencies, so its settings move the '
            + 'revision like any tenant table' },
    readonly_channel_manager_ownership_projection: { kind: 'unfrozen',
        because: 'a mirror of a third party\'s calendar. Nothing in this platform decides when it changes, '
            + 'and a lodging availability answer depends on it' },
});

export interface CommercialReader {
    readonly id: string;
    readonly tools: readonly string[];
    readonly readers: readonly string[];
    readonly dimensions: readonly CommercialDimension[];
    /** Tables whose contents the answer is built from, and what stands behind each. */
    readonly tables: Readonly<Record<string, 'manifest_dependency' | 'excluded_output'>>;
    /** Non-table reads, classified. */
    readonly outside: Readonly<Record<string, OutsideAuthority>>;
    /** Computed: every value authority is frozen and no unfrozen read is left. */
    readonly frozen: boolean;
    /** The unfrozen reads, if any. Named so they can be argued with. */
    readonly unfrozen: readonly string[];
}

/**
 * What stands behind one table.
 *
 * Read straight off the manifest's own rule rather than restated: a tenant
 * relation is a dependency unless the run writes it, and `EVALUATION_OUTPUT_TABLES`
 * is that list. Restating it here would let the two drift, and the drift would
 * be invisible — a table quietly added to the output set would silently stop
 * being an authority behind a price.
 */
export const commercialAuthorityForTable = (table: string): 'manifest_dependency' | 'excluded_output' =>
    EVALUATION_OUTPUT_TABLES.has(table) ? 'excluded_output' : 'manifest_dependency';

/** The inventory, computed from the reviewed read groups. */
export function commercialReaders(): readonly CommercialReader[] {
    return Object.freeze(EVALUATION_TOOL_READ_GROUPS.map(group => {
        const id = groupId(group);
        const dimensions = COMMERCIAL_GROUP_DIMENSIONS[id] ?? [];
        const tables = Object.fromEntries(group.tables.map(table => [table, commercialAuthorityForTable(table)]));
        const outside = Object.fromEntries(group.outsideNamespace.map(token =>
            [token, OUTSIDE_AUTHORITIES[token] ?? { kind: 'unfrozen' as const, because: 'unclassified' }]));
        const unfrozen = [
            ...Object.entries(tables).filter(([, authority]) => authority !== 'manifest_dependency').map(([table]) => table),
            ...Object.entries(outside).filter(([, authority]) => authority.kind === 'unfrozen').map(([token]) => token),
        ].sort();
        return Object.freeze({
            id, tools: group.tools, readers: group.readers,
            dimensions: Object.freeze([...dimensions]),
            tables: Object.freeze(tables), outside: Object.freeze(outside),
            frozen: dimensions.length > 0 && unfrozen.length === 0,
            unfrozen: Object.freeze(unfrozen),
        });
    }));
}

/** The commercial half of it: the readers whose answer can move money. */
export const commercialOnly = (): readonly CommercialReader[] =>
    commercialReaders().filter(reader => reader.dimensions.length > 0);

/**
 * The remainder: commercial readers with something unfrozen behind them.
 *
 * This is the number the acceptance criterion is about, and it is computed
 * rather than declared so it cannot be talked down. The spec requires every
 * member of it to appear in `ACCEPTED_UNFROZEN` with a reason — which is not
 * the same as zero, and is deliberately not written as if it were.
 */
export const commercialReadersWithoutFrozenAuthority = (): readonly CommercialReader[] =>
    commercialOnly().filter(reader => !reader.frozen);

/**
 * The unfrozen reads a commercial answer is allowed to rest on, and why.
 *
 * Two, and both are the same kind of thing: a clock nobody in this system owns.
 * Neither can be frozen by capturing harder, and pretending otherwise would be
 * worse than the gap — an availability answer sealed against a frozen instant
 * is a promise about a moment that has passed.
 *
 * What closes them instead is that the result says WHEN it was taken. An
 * evaluation that records its instant beside its revision is checkable for
 * staleness; one that records only the revision is not, and that is the
 * difference between an accepted limit and an unstated one.
 */
export const ACCEPTED_UNFROZEN: Readonly<Record<string, string>> = Object.freeze({
    wall_clock: 'availability is a statement about now, and now is not a value anybody can capture. The '
        + 'evaluation records the instant it ran beside the revision, so a stale result is detectable '
        + 'rather than indistinguishable from a fresh one',
    CURRENT_DATE: 'the database half of the same clock. A predicate like `valid_to >= CURRENT_DATE` is '
        + 'evaluated by PostgreSQL at statement time, so it cannot be captured either, and it is closed the '
        + 'same way: the instant travels with the result',
    readonly_channel_manager_ownership_projection: 'a third party owns this calendar and changes it without '
        + 'telling us. The platform records the mirror\'s own freshness stamp with the answer, which is the '
        + 'most that can honestly be said about a fact somebody else controls',
});

export interface CommercialCoverage {
    readonly readers: number;
    readonly commercial: number;
    readonly frozen: number;
    readonly unfrozen: number;
    readonly dimensions: Readonly<Record<CommercialDimension, number>>;
    /** Unfrozen reads, with how many commercial readers rest on each. */
    readonly restingOn: Readonly<Record<string, number>>;
}

/** The one table a reader of the report actually wants. */
export function commercialCoverage(): CommercialCoverage {
    const all = commercialReaders();
    const commercial = all.filter(reader => reader.dimensions.length > 0);
    const dimensions = Object.fromEntries(COMMERCIAL_DIMENSIONS.map(dimension =>
        [dimension, commercial.filter(reader => reader.dimensions.includes(dimension)).length]));
    const restingOn: Record<string, number> = {};
    for (const reader of commercial) for (const token of reader.unfrozen) {
        restingOn[token] = (restingOn[token] ?? 0) + 1;
    }
    return Object.freeze({
        readers: all.length,
        commercial: commercial.length,
        frozen: commercial.filter(reader => reader.frozen).length,
        unfrozen: commercial.filter(reader => !reader.frozen).length,
        dimensions: Object.freeze(dimensions) as Readonly<Record<CommercialDimension, number>>,
        restingOn: Object.freeze(restingOn),
    });
}
