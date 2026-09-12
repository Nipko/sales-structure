import type { VerticalReadinessKey } from '@parallext/shared';

/**
 * What each readiness key claims, against what its tool actually asks.
 *
 * `VerticalReadinessService` counts rows: one table, one WHERE, "is there at
 * least one". That is a fine shape, and it was never audited against the query
 * the TOOL runs, so the two drifted in every direction at once — and the drift
 * is invisible from either side. Readiness says "you have a service"; the
 * availability read never touches `services` and answers out of
 * `availability_slots`. Readiness says "you have a listing"; the listing search
 * also requires `is_active`, and archiving is a soft delete. Readiness says "you
 * have no FAQs" to a tenant looking at three, because the column it filters on
 * does not exist on that table and PostgreSQL reports an absent column with the
 * same words it uses for an absent table.
 *
 * This file makes the comparison MECHANICAL instead of a claim in prose. Every
 * key declares:
 *
 *  · the predicate the runtime tool evaluates, and where it is evaluated,
 *  · which of the seven dimensions that predicate actually decides,
 *  · the screen whose write really moves the check, which is not always the one
 *    the repair CTA opens, and
 *  · a declared divergence when the two disagree, with the correction and the
 *    file that has to change.
 *
 * The columns a readiness predicate reads are NOT declared here. They are
 * derived from the shipped predicate by `readinessPredicateColumns`, because a
 * second hand-written copy of a WHERE clause is a second thing to go stale — and
 * the whole defect this file describes is two predicates nobody compared.
 *
 * Two rules keep the register honest, both enforced by
 * `readinessPredicateRegisterDefects`:
 *
 *  1. A key implemented in `READINESS` with no entry here is a defect. Adding a
 *     readiness key without saying what its tool asks is how this started.
 *  2. A declared divergence that no longer diverges is a defect too. A register
 *     that only ever grows is a register nobody has to update.
 *
 * Nothing here evaluates authority. It is a description of two predicates and
 * the difference between them, so that "readiness was audited against the real
 * predicate" becomes something a test can fail.
 */

/** The dimensions a readiness answer can be about. */
export type ReadinessPredicateDimension =
    /** The row is switched on / not soft-deleted. */
    | 'active'
    /** There is a free slot, night, seat or date — not merely a sellable row. */
    | 'availability'
    /** The concurrency or seat count the quote would honour. */
    | 'capacity'
    /** There is a number to quote. */
    | 'price'
    /** That number carries a currency. */
    | 'currency'
    /** The row belongs to the subject the tool answers for. */
    | 'ownership'
    /** The row relates to the account, connection or agent asking. */
    | 'account_relation';

export type ReadinessDivergenceKind =
    /** The readiness predicate cannot execute: it names a column that is absent. */
    | 'unexecutable'
    /** Both execute; the readiness predicate decides fewer dimensions. */
    | 'weaker_predicate'
    /**
     * The two predicates agree, and neither decides a dimension the complete
     * task needs — so the tenant is not blocked, they are answered wrongly. A
     * property with no rate is quoted at zero; a course with no cohort is listed
     * and cannot be enrolled in. "Una cuenta sin capacidad no está lista por
     * tener un servicio" is this row, not a weaker predicate.
     */
    | 'undecided_dimension'
    /** Readiness counts rows of a different subject than the tool answers for. */
    | 'different_subject'
    /** The repair CTA leads to a screen that cannot write the counted row. */
    | 'repair_route_cannot_write';

export interface ReadinessDivergence {
    readonly kind: ReadinessDivergenceKind;
    /** The dimensions readiness leaves undecided that its tool decides. */
    readonly missingDimensions: readonly ReadinessPredicateDimension[];
    /** What a tenant experiences because of it. Not a restatement of the kind. */
    readonly consequence: string;
    /** The exact change that closes it. One sentence, actionable. */
    readonly correction: string;
    /** The file that has to change. */
    readonly owner: string;
    /**
     * For `unexecutable` only: the column the shipped predicate names and the
     * table does not have. The divergence is stale the moment the predicate
     * stops naming it.
     */
    readonly absentColumn?: string;
}

export interface ReadinessPredicateEntry {
    /** Table the runtime tool reads to answer the question readiness gates. */
    readonly toolTable: string;
    /** The tool's own WHERE, verbatim enough to compare. */
    readonly toolPredicate: string;
    /** Where that predicate lives, so a reader can check this file. */
    readonly toolSource: string;
    /** What the tool's predicate decides. */
    readonly dimensions: readonly ReadinessPredicateDimension[];
    /** The screen whose write actually moves this check. */
    readonly writePath: string;
    readonly divergence: ReadinessDivergence | null;
}

/** Shape of one `READINESS` definition, as this file needs to read it. */
export interface ShippedReadinessDefinition {
    readonly table: string;
    readonly where?: string;
    readonly repairRoute?: string;
}

const READINESS_OWNER = 'apps/api/src/modules/verticals/vertical-readiness.service.ts';

export const READINESS_PREDICATE_AUTHORITY:
    Readonly<Partial<Record<VerticalReadinessKey, ReadinessPredicateEntry>>> = Object.freeze({
    business_identity: {
        toolTable: 'companies',
        toolPredicate: 'is_primary = true',
        toolSource: 'business-info/business-info.service.ts::getPrimary',
        dimensions: ['ownership'],
        writePath: '/admin/settings/business-info',
        divergence: null,
    },
    faq_content: {
        toolTable: 'faqs',
        toolPredicate: 'is_published = true',
        toolSource: 'faqs/faqs.service.ts::search',
        dimensions: ['active'],
        writePath: '/admin/knowledge/faqs',
        divergence: null,
    },
    appointment_services: {
        toolTable: 'availability_slots',
        toolPredicate: 'is_active = true AND day_of_week = $1 AND the owning platform user and tenant are active',
        toolSource: 'conversations/ai-tool-executor.service.ts::check_availability',
        dimensions: ['active', 'availability', 'account_relation'],
        writePath: '/admin/appointments/config',
        divergence: {
            kind: 'different_subject',
            missingDimensions: ['availability', 'account_relation'],
            consequence: 'The availability read never touches `services`: the slot grid comes from '
                + '`availability_slots` joined to an active platform user of an active tenant. One active service '
                + 'and zero slots satisfies readiness, publishes the family, and every `check_availability` returns '
                + '`appointments_not_configured` — the "no hay disponibilidad" loop.',
            correction: 'Require a service AND at least one active `availability_slots` row owned by an active user '
                + 'of this tenant, or split the key so the slot requirement has its own check and its own repair.',
            owner: READINESS_OWNER,
        },
    },
    catalog_items: {
        toolTable: 'products',
        toolPredicate: 'is_available = true',
        toolSource: 'conversations/ai-tool-executor.service.ts::search_products',
        dimensions: ['active'],
        writePath: '/admin/inventory',
        divergence: null,
    },
    listings: {
        toolTable: 'real_estate_listings',
        toolPredicate: "is_active = true AND status = 'available'",
        toolSource: 'listings/listings.service.ts::search',
        dimensions: ['active', 'availability'],
        writePath: '/admin/listings',
        divergence: null,
    },
    menu_items: {
        toolTable: 'menu_items',
        toolPredicate: 'is_active = true AND is_available = true',
        toolSource: 'restaurants/restaurants.service.ts::searchMenu',
        dimensions: ['active', 'availability'],
        writePath: '/admin/menu',
        divergence: null,
    },
    vehicle_inventory: {
        toolTable: 'vehicles',
        toolPredicate: "status = 'available'",
        toolSource: 'conversations/ai-tool-executor.service.ts::search_vehicles',
        dimensions: ['active', 'availability'],
        writePath: '/admin/vehicles',
        // The sales family matches exactly. The rental family shares this key and
        // answers "is it free" out of `resource_rentals`; that is recorded as a
        // family-level gap in the report rather than as a divergence of this
        // predicate, which is right for the tool it was written for.
        divergence: null,
    },
    tour_packages: {
        toolTable: 'tour_packages',
        toolPredicate: 'is_active = true',
        toolSource: 'tours/tours.service.ts::searchPackages',
        dimensions: ['active'],
        writePath: '/admin/tours',
        divergence: null,
    },
    properties: {
        toolTable: 'properties',
        toolPredicate: 'is_active = true',
        toolSource: 'conversations/ai-tool-executor.service.ts::list_properties',
        dimensions: ['active'],
        writePath: '/admin/properties',
        divergence: {
            kind: 'undecided_dimension',
            missingDimensions: ['price'],
            consequence: 'The repair text promises "con su tarifa" and nothing enforces it: an active property with '
                + 'no `night_price` satisfies readiness and is quoted at zero, so the customer is told a stay costs '
                + 'only the cleaning fee.',
            correction: 'Add `night_price IS NOT NULL AND night_price > 0`, or drop the rate promise from the '
                + 'repair text so the check and the sentence agree.',
            owner: READINESS_OWNER,
        },
    },
    courses: {
        toolTable: 'courses',
        toolPredicate: 'is_active = true',
        toolSource: 'education/education.service.ts::listCourses',
        dimensions: ['active'],
        writePath: '/admin/courses',
        divergence: {
            kind: 'undecided_dimension',
            missingDimensions: ['capacity'],
            consequence: 'The sellable unit is a cohort. With zero `course_cohorts` rows readiness is satisfied and '
                + '`get_courses` lists courses, while `get_course_schedule` has nothing to show and `enroll_student` '
                + 'cannot even waitlist.',
            correction: 'Require an open future `course_cohorts` row, or give the cohort requirement its own key so '
                + 'the catalogue check keeps its own meaning.',
            owner: READINESS_OWNER,
        },
    },
    pets: {
        toolTable: 'services',
        toolPredicate: 'is_active = true',
        toolSource: 'conversations/ai-tool-executor.service.ts::list_pet_services',
        dimensions: ['active'],
        writePath: '/admin/appointments/config',
        divergence: null,
    },
    membership_plans: {
        toolTable: 'membership_plans',
        toolPredicate: 'is_active = true',
        toolSource: 'gyms/gyms.service.ts::listPlans',
        dimensions: ['active'],
        writePath: '/admin/memberships',
        divergence: null,
    },
    insurance_plans: {
        toolTable: 'insurance_plans',
        toolPredicate: 'is_active = true',
        toolSource: 'insurance/insurance.service.ts::listPlans',
        dimensions: ['active'],
        writePath: '/admin/insurance',
        divergence: {
            kind: 'undecided_dimension',
            missingDimensions: ['price', 'currency'],
            consequence: 'The repair text says "cotizable" and nothing checks a premium. A plan with null premiums '
                + 'satisfies readiness, and `calculate_quote` writes a quote of zero into `insurance_quotes`.',
            correction: 'Add `monthly_premium_min IS NOT NULL AND currency IS NOT NULL`, or stop calling the row '
                + 'quotable in the repair text.',
            owner: READINESS_OWNER,
        },
    },
    service_catalog: {
        toolTable: 'services',
        toolPredicate: 'is_active = true',
        toolSource: 'home-services/home-services.service.ts::listCapacityServices',
        dimensions: ['active'],
        writePath: '/admin/service-catalog',
        divergence: null,
    },
    photo_sessions: {
        toolTable: 'services',
        toolPredicate: 'is_active = true',
        toolSource: 'conversations/ai-tool-executor.service.ts::list_photo_packages',
        dimensions: ['active'],
        writePath: '/admin/service-catalog',
        divergence: null,
    },
    boarding_capacity: {
        toolTable: 'services',
        toolPredicate: "is_active = true AND accent-normalised category IN ('hotel','guarderia') "
            + 'AND max_concurrent is an integer >= 1',
        toolSource: 'resource-rentals/resource-rentals.service.ts::checkAvailability',
        dimensions: ['active', 'capacity'],
        writePath: '/admin/service-catalog',
        divergence: {
            kind: 'different_subject',
            missingDimensions: ['account_relation'],
            consequence: 'The runtime strips accents before comparing the category; readiness compares the literals. '
                + "A service stored as 'guardería' fails readiness and passes the runtime. And the family this key "
                + 'gates carries no read tool: the availability read is `check_daycare_availability`, which belongs '
                + 'to `petServices` and is gated by the bare `pets` predicate, so boarding availability publishes '
                + 'with `boarding_capacity` unmet.',
            correction: 'Compare the category with the same accent normalisation the runtime uses, and gate the '
                + 'daycare availability read on this key instead of on `pets`.',
            owner: READINESS_OWNER,
        },
    },
});

/**
 * Words that appear in a WHERE clause and are not columns.
 *
 * Deliberately a small list of SQL, not of this schema: a column name that
 * happened to be listed here would be dropped from the executability check and
 * the check would pass on a predicate that cannot run.
 */
const SQL_NON_COLUMNS = new Set([
    'and', 'or', 'not', 'is', 'null', 'true', 'false', 'in', 'like', 'ilike', 'between',
    'coalesce', 'nullif', 'lower', 'upper', 'trim', 'exists', 'any', 'all', 'distinct',
    'from', 'cast', 'as', 'case', 'when', 'then', 'else', 'end', 'select', 'where',
    'int', 'integer', 'text', 'boolean', 'uuid', 'date', 'timestamp', 'numeric',
]);

/**
 * The columns a shipped readiness predicate reads.
 *
 * Derived from the predicate rather than declared beside it, so the answer
 * cannot be a stale copy of the thing it is checking. String literals are
 * removed first: `status = 'available'` names one column, not two.
 */
export function readinessPredicateColumns(where: string | undefined): readonly string[] {
    if (!where) return Object.freeze([]);
    const withoutLiterals = where.replace(/'[^']*'/g, ' ').replace(/\$\d+/g, ' ');
    const tokens = withoutLiterals.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [];
    return Object.freeze([...new Set(tokens.filter(token => !SQL_NON_COLUMNS.has(token)))].sort());
}

/**
 * The keys `READINESS` implements that this register does not describe, and the
 * declared divergences that are no longer true.
 *
 * Both directions matter. A key with no entry is an unaudited predicate, which
 * is the state this file exists to end. A divergence that has been fixed and
 * still stands here is a register nobody maintains, and the next reader cannot
 * tell which half is stale.
 */
export function readinessPredicateRegisterDefects(
    readiness: Readonly<Partial<Record<VerticalReadinessKey, ShippedReadinessDefinition>>>,
): readonly string[] {
    const defects: string[] = [];
    for (const [key, definition] of Object.entries(readiness) as Array<[VerticalReadinessKey, ShippedReadinessDefinition]>) {
        const entry = READINESS_PREDICATE_AUTHORITY[key];
        if (!entry) {
            defects.push(`${key}: implemented by READINESS and not audited against its tool's predicate`);
            continue;
        }
        const divergence = entry.divergence;
        if (!divergence) continue;
        if (!divergence.correction.trim()) defects.push(`${key}: divergence declared with no correction`);
        if (!divergence.consequence.trim()) defects.push(`${key}: divergence declared with no consequence`);
        if (divergence.kind !== 'repair_route_cannot_write' && !divergence.missingDimensions.length) {
            defects.push(`${key}: ${divergence.kind} without naming a dimension it leaves undecided`);
        }
        if (divergence.kind === 'unexecutable') {
            if (!divergence.absentColumn) {
                defects.push(`${key}: unexecutable without naming the absent column`);
            } else if (!readinessPredicateColumns(definition.where).includes(divergence.absentColumn)) {
                defects.push(`${key}: the predicate no longer reads ${divergence.absentColumn}; the divergence is stale`);
            }
        }
        if (divergence.kind === 'repair_route_cannot_write' && definition.repairRoute === entry.writePath) {
            defects.push(`${key}: repairRoute already points at ${entry.writePath}; the divergence is stale`);
        }
        if (divergence.kind === 'weaker_predicate' && predicateCovers(definition.where ?? '', entry.toolPredicate)) {
            defects.push(`${key}: the readiness predicate now covers its tool's; the divergence is stale`);
        }
        // The inverse check, and it is not decoration. `undecided_dimension`
        // claims the two predicates agree and both miss something the task
        // needs. If they stop agreeing, the entry is describing a state that no
        // longer exists and has to be reclassified rather than left to read as
        // "readiness matches, we just want more".
        if (divergence.kind === 'undecided_dimension' && !predicateCovers(definition.where ?? '', entry.toolPredicate)) {
            defects.push(`${key}: declared as an undecided dimension, but the readiness predicate no longer matches its tool's`);
        }
    }
    return Object.freeze(defects);
}

/**
 * Does the readiness predicate already say everything the tool's does?
 *
 * Deliberately crude: it compares the `column op value` fragments of both, so it
 * can only ever answer "yes, this is now at least as strict". It is used in one
 * direction — to notice that a declared divergence went away — never to declare
 * a predicate correct.
 */
function predicateCovers(readinessWhere: string, toolPredicate: string): boolean {
    const fragments = (text: string) => new Set(text
        .split(/\bAND\b/i)
        .map(part => part.replace(/\s+/g, ' ').trim().toLowerCase())
        .filter(Boolean));
    const tool = fragments(toolPredicate);
    if (!tool.size) return false;
    const shipped = fragments(readinessWhere);
    return [...tool].every(fragment => shipped.has(fragment));
}

/** The keys whose shipped predicate disagrees with the predicate its tool runs. */
export function readinessPredicateDivergences(
    readiness: Readonly<Partial<Record<VerticalReadinessKey, ShippedReadinessDefinition>>>,
): readonly VerticalReadinessKey[] {
    return Object.freeze((Object.keys(readiness) as VerticalReadinessKey[])
        .filter(key => READINESS_PREDICATE_AUTHORITY[key]?.divergence)
        .sort());
}

/**
 * Why a readiness answer says what it says.
 *
 * Three words, not two. `VerticalReadinessService` reports a failed lookup by
 * pushing `satisfied: true, count: 0` and raising a report-wide `degraded` flag,
 * which is the right instinct — unknown is not unmet — but by the time the
 * answer reaches a person it has become one boolean, and a boolean cannot say
 * "nobody could read this". The distinction is the whole point: "load a product"
 * is a thing the owner can do, and "this check could not be read" is neither
 * their fault nor their task.
 */
export type ReadinessSourceVerdict = 'satisfied' | 'missing_data' | 'read_error';

export interface ReadinessSourceInput {
    /** The key was reported unmet by the readiness evaluation. */
    readonly unmet: boolean;
    /**
     * Columns that exist on the readiness table in THIS tenant's schema, or
     * `null` when the schema itself could not be inspected. `null` is not an
     * empty set: an uninspectable schema proves nothing either way.
     */
    readonly availableColumns: ReadonlySet<string> | null;
    /** The contract as a whole could not be evaluated. */
    readonly contractDegraded: boolean;
    /** The shipped predicate, whose columns decide whether it could execute. */
    readonly readinessWhere?: string;
}

/**
 * Classify one readiness key for one tenant.
 *
 * A predicate that names a column the tenant's schema does not have cannot have
 * answered the question, whatever number came back: PostgreSQL reports the
 * absent column with the same "does not exist" wording it uses for an absent
 * table, and the lookup's missing-table branch turns that into a count of zero.
 * So the classification is made from the schema, not from the count.
 */
export function classifyReadinessSource(
    key: VerticalReadinessKey,
    input: ReadinessSourceInput,
): ReadinessSourceVerdict {
    const columns = readinessPredicateColumns(input.readinessWhere);
    if (input.availableColumns && columns.some(column => !input.availableColumns!.has(column))) {
        return 'read_error';
    }
    if (input.contractDegraded) return 'read_error';
    return input.unmet ? 'missing_data' : 'satisfied';
}

export interface ReadinessCitation {
    readonly key: VerticalReadinessKey;
    /** The predicate the TOOL evaluates, so the answer cites what it is about. */
    readonly predicate: string;
    readonly table: string;
    readonly dimensions: readonly ReadinessPredicateDimension[];
    readonly verdict: ReadinessSourceVerdict;
    /** The screen whose write moves this check, which is not always the CTA's. */
    readonly writePath: string;
    /** Present when the shipped check decides less than its tool does. */
    readonly auditedDivergence: ReadinessDivergence | null;
}

/**
 * The citation a surface renders instead of a bare key name.
 *
 * `faq_content` told an owner nothing. "faqs, is_published = true, could not be
 * read" tells them what was asked and that the answer is not about them.
 */
export function citeReadiness(
    key: VerticalReadinessKey,
    input: ReadinessSourceInput,
): ReadinessCitation | null {
    const entry = READINESS_PREDICATE_AUTHORITY[key];
    if (!entry) return null;
    return Object.freeze({
        key,
        predicate: entry.toolPredicate,
        table: entry.toolTable,
        dimensions: Object.freeze([...entry.dimensions]),
        verdict: classifyReadinessSource(key, input),
        writePath: entry.writePath,
        auditedDivergence: entry.divergence,
    });
}

/** Every table whose columns must be inspected to classify these keys. */
export function readinessTablesToInspect(
    keys: readonly VerticalReadinessKey[],
    readiness: Readonly<Partial<Record<VerticalReadinessKey, ShippedReadinessDefinition>>>,
): readonly string[] {
    return Object.freeze([...new Set(keys
        .map(key => readiness[key]?.table)
        .filter((table): table is string => typeof table === 'string' && /^[a-z_][a-z0-9_]*$/.test(table)))].sort());
}
