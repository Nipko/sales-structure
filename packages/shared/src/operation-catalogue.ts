/**
 * The operation catalogue: what a customer turn can be ABOUT, and what has to
 * be read before the agent may answer it.
 *
 * ── Why it exists ───────────────────────────────────────────────────────
 *
 * Production QA (image 8e7c45b1) kept finding the same failure in different
 * clothes: a price question answered without reading the catalogue. A
 * real-estate «¿cuánto cuesta el apartamento que tienen en venta?» ran only
 * the automatic `search_faqs` and denied the price from stale history; a hotel
 * «quel est le prix de la nuit ?» never called `list_properties` and said the
 * price "varies" (`night_price` is fixed); a restaurant «Quanto custa o prato do
 * cardápio?» never called `get_menu`. In every case the item NAME came from the
 * history, not from a read, and whenever the reader WAS called the price was
 * right. The fix is not an eleventh `requires*()` regex — that family is frozen —
 * but declaring, per operation, which reads it needs. This module is that
 * declaration.
 *
 * ── Derived, not written ────────────────────────────────────────────────
 *
 * Most operations are the domain contract's intents
 * (`vertical-domain-contract.ts`), so their tool plan, commitment and
 * verticals come from there; their workflow class from
 * `intent-workflow-contract.ts`; and, when they commit, their required reads
 * from `CORE_TOOL_PREREQUISITES` (moved here so both the runtime and the
 * catalogue read one table). Only the READ operations the domain contract does
 * not name — "how much is X", "where is my order" — are declared by hand, and
 * `READ_TOOL_CONTRACTS` declares once per reader where its arguments come from
 * and which facts it can source. The API spec
 * `domain-contract-tool-plan.spec.ts` pins every one of these against the tool
 * policy registry, the published tool families and `COMMITMENT_FAMILIES`.
 *
 * ── Status ──────────────────────────────────────────────────────────────
 *
 * PR4 of the operations runtime plan: the catalogue plus a SHADOW classifier
 * that only writes a trace (`operation_shadow`). Nothing here changes a reply,
 * the visible tools or the routing yet. A read with a `projection` declares
 * that a deterministic pre-read in the turn context satisfies it (see
 * `OperationReadProjection`): live for store products and salon services,
 * planned for listings, properties, menu items and packages.
 */

import { listDomainContractDrafts, intentToolGroup, type IntentContract } from './vertical-domain-contract';
import { classifyIntentWorkflow, type IntentWorkflowClass } from './intent-workflow-contract';
import { ASSURANCE_LEVEL_MATRIX, type VerticalAssuranceLevel } from './vertical-capability-manifest';

export const OPERATION_CATALOGUE_VERSION = 1 as const;

// ── Core prerequisites ───────────────────────────────────────────────────

/**
 * The readers a committing tool needs before it runs, whatever vertical owns it.
 *
 * This was `CORE_PREREQUISITES` in `apps/api/.../tool-task-dependencies.ts`; it
 * lives here so the catalogue derives committing operations' required reads
 * from the SAME table tool retrieval keeps alive, instead of a copy of it. The
 * API re-exports it under its old name.
 */
export const CORE_TOOL_PREREQUISITES: Readonly<Record<string, readonly string[]>> = Object.freeze({
    create_appointment: ['list_services', 'check_availability'],
    schedule_test_drive: ['search_vehicles', 'get_vehicle_details', 'list_services', 'check_availability'],
    cancel_appointment: ['list_customer_appointments', 'get_appointment_details'],
    reschedule_appointment: ['list_customer_appointments', 'get_appointment_details', 'check_availability'],
    create_payment_link: ['get_payment_status'],
    book_class: ['get_class_schedule', 'get_my_membership'],
    cancel_class_booking: ['get_my_class_bookings'],
    freeze_membership: ['get_my_membership'],
    enroll_student: ['get_courses', 'get_course_schedule'],
    cancel_enrollment: ['list_my_enrollments'],
    create_property_booking: ['list_properties', 'check_property_availability'],
    cancel_property_booking: ['list_my_property_bookings'],
    create_tour_booking: ['search_packages', 'get_package_details', 'check_package_availability'],
    cancel_tour_booking: ['list_my_tour_bookings'],
    place_order: ['get_menu'],
    cancel_order: ['list_my_orders', 'check_order_status'],
    place_catalog_order: ['search_products', 'get_product', 'check_stock'],
    approve_repair: ['list_my_repair_orders', 'get_repair_order'],
    cancel_repair_order: ['list_my_repair_orders', 'get_repair_order'],
    register_pet: ['list_pets_for_contact'],
    update_pet: ['list_pets_for_contact'],
});

// ── Facts ────────────────────────────────────────────────────────────────

/** What kind of statement a reply may make once the read that sources it ran. */
export type OperationFactKind =
    | 'price'
    | 'stock'
    | 'availability'
    | 'area'
    | 'capacity'
    | 'duration'
    | 'schedule'
    | 'item_attributes'
    | 'record_list'
    | 'record_status'
    | 'instructions'
    | 'faq_answer'
    | 'contact_profile'
    | 'triage'
    /** The receipt of a committing tool: what was booked/ordered/created. */
    | 'commit_receipt';

/**
 * A deterministic pre-read, projected into the turn context, that satisfies
 * the read without the model having to call it.
 *
 * QA after 8e7c45b1 is unambiguous: where the catalogue is IN the turn (the
 * store's `<catalog>`, the salon's `<available_services>`) the price was right
 * 4/4 with no tool call; where it is not (listings, hotel properties, menu,
 * travel packages) it was right 0/12 — the model never called the reader and
 * repeated "not confirmed" from the history. So the declared path for a
 * catalogue-price read is a bounded projection with `priceStatus`, not a
 * model-initiated call.
 *
 * - `context`: where it lands — `turn_catalog` (`<turn><catalog>`) or
 *   `available_services` (`<available_services>`).
 * - `status`: `live` = the runtime projects it today (`loadOwnCatalogForTurn`,
 *   `projectAvailableServices`), so the shadow trace counts it as satisfied;
 *   `planned` = PR5/PR7 must add it, and until then the read stays `missing`.
 *
 * The pattern to generalise already exists for travel packages: a
 * deterministic, read-only `search_packages` before the model, whose rows go
 * into `<catalog>` (`canonicalPackageCatalogue`). QA confirmed it gets the
 * price right (125 EUR, 129.000 COP) — but it is gated by a per-domain keyword
 * recogniser (`requiresCanonicalPackagePrice`), so the trace shows it as
 * `auto` only when the word matched. PR5/PR7 should run that same pre-read
 * from the operation's declared required reads (catalogue, not keyword), for
 * listings, properties and menu items too; that is what `planned` marks.
 */
export interface OperationReadProjection {
    context: 'turn_catalog' | 'available_services';
    status: 'live' | 'planned';
}

const LIVE_CATALOG: OperationReadProjection = Object.freeze({ context: 'turn_catalog', status: 'live' });
const LIVE_SERVICES: OperationReadProjection = Object.freeze({ context: 'available_services', status: 'live' });
const PLANNED_CATALOG: OperationReadProjection = Object.freeze({ context: 'turn_catalog', status: 'planned' });

/**
 * Where a reader's argument comes from. Grammar (validated by the API spec):
 *   `slot:<key>`                 a value the customer gives (may be absent → ask)
 *   `context:<key>`              something the turn already knows
 *   `receipt:<tool>.<path>`      an id from an earlier read in the same plan
 */
export type OperationArgSource = string;

export interface ReadToolContract {
    /** Must equal the tool policy's `assurance` (pinned by the API spec). */
    assurance: VerticalAssuranceLevel;
    /** The facts this reader can source. */
    facts: readonly OperationFactKind[];
    /** Every REQUIRED parameter of the tool must have a source here. */
    argsFrom: Readonly<Record<string, OperationArgSource>>;
    projection?: OperationReadProjection;
}

const read = (
    assurance: VerticalAssuranceLevel,
    facts: readonly OperationFactKind[],
    argsFrom: Record<string, OperationArgSource> = {},
    projection?: OperationReadProjection,
): ReadToolContract => Object.freeze({
    assurance, facts: Object.freeze([...facts]), argsFrom: Object.freeze({ ...argsFrom }),
    ...(projection ? { projection } : {}),
});

/**
 * Every reader an operation may require. A reader missing here makes the
 * catalogue unable to say what it sources — the API spec fails on it.
 */
export const READ_TOOL_CONTRACTS: Readonly<Record<string, ReadToolContract>> = Object.freeze({
    // horizontal
    get_customer_context: read('A1', ['contact_profile']),
    search_faqs: read('A0', ['faq_answer'], { query: 'slot:question' }),
    search_knowledge_base: read('A0', ['faq_answer'], { query: 'slot:question' }),
    get_payment_status: read('A1', ['record_status'], { payableReference: 'context:payableReference' }),
    // appointments
    list_services: read('A0', ['price', 'duration', 'item_attributes'], {}, LIVE_SERVICES),
    check_availability: read('A0', ['availability'], { date: 'slot:date', serviceId: 'receipt:list_services.services[].id' }),
    list_customer_appointments: read('A2', ['record_list', 'record_status', 'schedule']),
    get_appointment_details: read('A2', ['record_status', 'schedule'], { appointmentId: 'receipt:list_customer_appointments.appointments[].id' }),
    // catalog (store)
    search_products: read('A0', ['price', 'stock', 'item_attributes'], { query: 'slot:product_query' }, LIVE_CATALOG),
    get_product: read('A0', ['price', 'stock', 'item_attributes'], { productId: 'receipt:search_products.products[].id' }, LIVE_CATALOG),
    check_stock: read('A0', ['stock'], { productId: 'receipt:search_products.products[].id' }),
    list_my_catalog_orders: read('A1', ['record_list', 'record_status']),
    get_catalog_order: read('A1', ['record_status', 'price'], { orderId: 'receipt:list_my_catalog_orders.orders[].id' }),
    // real estate
    search_listings: read('A0', ['price', 'area', 'item_attributes', 'availability'], {
        transactionType: 'slot:operation', neighborhood: 'slot:zone', maxPrice: 'slot:budget',
    }, PLANNED_CATALOG),
    get_listing_details: read('A0', ['price', 'area', 'item_attributes'], { listingId: 'receipt:search_listings.listings[].id' }, PLANNED_CATALOG),
    // restaurants
    get_menu: read('A0', ['price', 'item_attributes', 'duration'], { query: 'slot:item_query' }, PLANNED_CATALOG),
    get_promotions: read('A0', ['price']),
    list_my_orders: read('A1', ['record_list', 'record_status']),
    check_order_status: read('A1', ['record_status', 'price', 'schedule'], { orderId: 'receipt:list_my_orders.orders[].id' }),
    // vehicles & repair orders & rentals
    search_vehicles: read('A0', ['price', 'item_attributes', 'availability']),
    get_vehicle_details: read('A0', ['price', 'item_attributes'], { vehicleId: 'receipt:search_vehicles.vehicles[].id' }),
    list_my_repair_orders: read('A1', ['record_list', 'record_status']),
    get_repair_order: read('A1', ['record_status', 'price'], { repairOrderId: 'receipt:list_my_repair_orders.repairOrders[].id' }),
    check_vehicle_rental_availability: read('A0', ['availability', 'price'], {
        // The rental profile does not publish `search_vehicles`: the customer names the vehicle.
        vehicleId: 'receipt:search_vehicles.vehicles[].id|slot:vehicle_id', startDate: 'slot:pickup_at', endDate: 'slot:return_at',
    }),
    // tours
    search_packages: read('A0', ['price', 'availability', 'item_attributes', 'duration'], {}, PLANNED_CATALOG),
    get_package_details: read('A0', ['price', 'capacity', 'item_attributes', 'schedule'], { packageId: 'receipt:search_packages.packages[].id' }, PLANNED_CATALOG),
    check_package_availability: read('A0', ['availability', 'price'], {
        packageId: 'receipt:search_packages.packages[].id', date: 'slot:starts_at', partySize: 'slot:travellers',
    }),
    list_my_tour_bookings: read('A1', ['record_list', 'record_status']),
    // properties (lodging): without dates `list_properties` still returns the
    // fixed nightly price, which is the "desde" price a guest asks for.
    list_properties: read('A0', ['price', 'capacity', 'item_attributes', 'availability'], {
        guests: 'slot:guests', checkIn: 'slot:check_in', checkOut: 'slot:check_out',
    }, PLANNED_CATALOG),
    check_property_availability: read('A0', ['availability', 'price'], {
        propertyId: 'receipt:list_properties.properties[].id', checkIn: 'slot:check_in', checkOut: 'slot:check_out', guests: 'slot:guests',
    }),
    get_property_details: read('A0', ['price', 'capacity', 'item_attributes'], {
        propertyId: 'receipt:list_properties.properties[].id|receipt:list_my_property_bookings.bookings[].propertyId',
    }, PLANNED_CATALOG),
    list_my_property_bookings: read('A1', ['record_list', 'record_status']),
    get_check_in_instructions: read('A2', ['instructions'], { propertyId: 'receipt:list_my_property_bookings.bookings[].propertyId' }),
    // treatments
    get_treatment_plan: read('A2', ['record_status', 'schedule']),
    list_upcoming_sessions: read('A2', ['record_list', 'schedule']),
    // education
    get_courses: read('A0', ['price', 'item_attributes', 'schedule']),
    get_course_schedule: read('A0', ['schedule', 'availability']),
    list_my_enrollments: read('A1', ['record_list', 'record_status']),
    // professional services
    get_case_status: read('A2', ['record_status']),
    // pets
    list_pets_for_contact: read('A1', ['record_list']),
    triage_pet_emergency: read('A0', ['triage'], { symptoms: 'slot:symptoms' }),
    list_pet_services: read('A0', ['price', 'item_attributes', 'duration']),
    check_daycare_availability: read('A0', ['availability'], { checkIn: 'slot:date' }),
    list_my_pet_boardings: read('A1', ['record_list', 'record_status']),
    // gyms
    get_class_schedule: read('A0', ['schedule', 'availability']),
    get_my_membership: read('A1', ['record_status']),
    get_my_class_bookings: read('A1', ['record_list', 'record_status']),
    // insurance
    get_insurance_plans: read('A0', ['price', 'item_attributes']),
    check_policy_status: read('A2', ['record_status'], { policyNumber: 'slot:policy_number' }),
    // home services
    check_request_status: read('A1', ['record_status'], { requestId: 'receipt:create_service_request.requestId' }),
    // photography
    list_photo_packages: read('A0', ['price', 'item_attributes']),
    check_date_availability: read('A0', ['availability'], { date: 'slot:event_date' }),
});

// ── Safety ───────────────────────────────────────────────────────────────

/**
 * - `none`: no clinical risk in the operation itself.
 * - `red_flag_triage`: in a health business the turn first goes through the
 *   red-flag triage (PR2); alarm signs always hand off to a person.
 * - `emergency`: the operation IS the emergency path.
 */
export type OperationSafetyClass = 'none' | 'red_flag_triage' | 'emergency';

export interface OperationSafety {
    default: OperationSafetyClass;
    /** Required for every operation a health business publishes (pinned in CI). */
    health?: OperationSafetyClass;
}

/** Industries whose every business type is a health business. */
export const HEALTH_INDUSTRIES: readonly string[] = Object.freeze(['salud', 'veterinaria', 'pet_services']);

/**
 * The safety class a tool group's operations carry in a health business. A
 * group a health business starts publishing without an entry here leaves its
 * operations without `safety.health`, and the catalogue spec fails: the
 * decision has to be taken, not defaulted.
 */
export const HEALTH_SAFETY_CLASS_BY_TOOL_GROUP: Readonly<Record<string, OperationSafetyClass>> = Object.freeze({
    crm: 'red_flag_triage',
    faqs: 'red_flag_triage',
    appointments: 'red_flag_triage',
    treatments: 'red_flag_triage',
    catalog: 'red_flag_triage',
    pets: 'red_flag_triage',
    petServices: 'red_flag_triage',
    petBoarding: 'red_flag_triage',
});

/** Operations that are an emergency path by definition, wherever they are published. */
const EMERGENCY_OPERATIONS: ReadonlySet<string> = new Set(['pet_emergency']);

export function operationSafetyClassFor(operation: OperationDefinition, industry?: string | null): OperationSafetyClass | undefined {
    return industry && HEALTH_INDUSTRIES.includes(industry) ? operation.safety.health : operation.safety.default;
}

// ── Operations ───────────────────────────────────────────────────────────

export interface OperationRequiredRead {
    tool: string;
    argsFrom: Readonly<Record<string, OperationArgSource>>;
    projection?: OperationReadProjection;
}

/** What the turn does when a required read fails: never "there are none". */
export type OperationReadFailure = 'admit' | 'ask' | 'handoff';

export interface OperationDefinition {
    key: string;
    /** One line the classifier reads: what the customer wants. */
    description: string;
    /** `domain_intent`: derived from the domain contract. `read_operation`: declared here. */
    source: 'domain_intent' | 'read_operation';
    toolGroup: string;
    /** Industries that publish it. */
    verticals: readonly string[];
    /** Profile ids (`industry/subtype`) that publish it. */
    profiles: readonly string[];
    requiredReads: readonly OperationRequiredRead[];
    requiredReadsSource: 'core_prerequisites' | 'intent_tool_plan' | 'declared' | 'waived';
    /** Tools the operation may show the decider (MVP: one set, not yet per state). */
    visibleTools: readonly string[];
    /** Non-read tools of the plan (writers, identity step-up, media). */
    writers: readonly string[];
    commits: boolean;
    workflowClass: IntentWorkflowClass;
    /** The highest assurance among the required reads. */
    assurance: VerticalAssuranceLevel;
    safety: OperationSafety;
    /** Facts a reply may assert, each sourced by a required read (or the writer's receipt). */
    factKinds: readonly OperationFactKind[];
    onReadFailure: OperationReadFailure;
}

/**
 * Operations whose plan has no reader at all: a pure intake. Each one names
 * why, and a new reader-less operation fails CI until it is listed here.
 */
export const OPERATIONS_WITHOUT_READS: Readonly<Record<string, string>> = Object.freeze({
    open_repair_order: 'Pure intake: the customer describes the vehicle and the concern; nothing exists to read before it.',
    request_service: 'Pure intake: the request is created from the customer\'s description; check_request_status is a read AFTER the write.',
    board_pet: 'The intent plan writes first (create_pet_boarding); capacity is checked inside the boarding workflow, not by a prior read. Gap to close in PR7.',
});

/**
 * The identity step-up pair. Not readers and not business writers: they gate a
 * sensitive read. Pinned against the API's `identityStepUpToolNames()`.
 */
export const IDENTITY_STEP_UP_TOOL_NAMES: readonly string[] = Object.freeze(['request_identity_code', 'verify_identity_code']);

interface DeclaredReadOperation {
    key: string;
    toolGroup: string;
    description: string;
    reads: readonly string[];
    factKinds: readonly OperationFactKind[];
    /** Extra tools the decider may see beside the reads. */
    alsoVisible?: readonly string[];
    onReadFailure?: OperationReadFailure;
}

/**
 * The read operations the domain contract does not name. Each answers a
 * question about ONE thing the business has, and its first read is what the
 * QA turns above skipped.
 */
const DECLARED_READ_OPERATIONS: readonly DeclaredReadOperation[] = Object.freeze([
    {
        key: 'product_info', toolGroup: 'catalog',
        description: 'The customer asks the price, stock or details of a specific product of the store ("how much is X?", "do you have X?").',
        reads: ['search_products', 'get_product'], factKinds: ['price', 'stock', 'item_attributes'],
        alsoVisible: ['check_stock'],
    },
    {
        key: 'service_info', toolGroup: 'appointments',
        description: 'The customer asks the price, duration or details of a service, without asking to book it yet.',
        reads: ['list_services'], factKinds: ['price', 'duration', 'item_attributes'],
    },
    {
        key: 'view_my_appointments', toolGroup: 'appointments',
        description: 'The customer asks which appointments they have, or when their appointment is.',
        reads: ['list_customer_appointments'], factKinds: ['record_list', 'record_status', 'schedule'],
        alsoVisible: ['get_appointment_details'],
    },
    {
        key: 'menu_info', toolGroup: 'restaurants',
        description: 'The customer asks what is on the menu, or the price, ingredients, allergens or preparation time of a dish or drink.',
        reads: ['get_menu'], factKinds: ['price', 'item_attributes', 'duration'],
        alsoVisible: ['get_promotions'],
    },
    {
        key: 'check_my_orders', toolGroup: 'restaurants',
        description: 'The customer asks to see their food orders ("my orders", "what did I order").',
        reads: ['list_my_orders'], factKinds: ['record_list', 'record_status'],
        alsoVisible: ['check_order_status'],
    },
    {
        key: 'property_info', toolGroup: 'properties',
        description: 'The guest asks the nightly price, capacity, amenities or details of a property/room, with or without dates (no dates: the price "from" the fixed nightly price).',
        reads: ['list_properties', 'get_property_details'], factKinds: ['price', 'capacity', 'item_attributes'],
        alsoVisible: ['check_property_availability'],
    },
    {
        key: 'listing_info', toolGroup: 'realEstate',
        description: 'The customer asks the price, area (m2), rooms or details of a specific property listing for sale or rent.',
        reads: ['search_listings', 'get_listing_details'], factKinds: ['price', 'area', 'item_attributes'],
        alsoVisible: ['send_listing_image'],
    },
    {
        key: 'package_info', toolGroup: 'tours',
        description: 'The customer asks the price, duration, what is included or details of a specific tour/travel package.',
        reads: ['search_packages', 'get_package_details'], factKinds: ['price', 'item_attributes', 'capacity', 'schedule'],
    },
    {
        key: 'package_availability', toolGroup: 'tours',
        description: 'The customer asks whether a tour/package has availability (seats) for a date and group size.',
        reads: ['search_packages', 'check_package_availability'], factKinds: ['availability', 'price'],
        onReadFailure: 'ask',
    },
]);

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

function requiredReadsFor(tools: readonly string[]): OperationRequiredRead[] {
    return tools.map(tool => {
        const contract = READ_TOOL_CONTRACTS[tool];
        return Object.freeze({
            tool,
            argsFrom: contract?.argsFrom ?? Object.freeze({}),
            ...(contract?.projection ? { projection: contract.projection } : {}),
        });
    });
}

function maxAssurance(tools: readonly string[]): VerticalAssuranceLevel {
    let best: VerticalAssuranceLevel = 'A0';
    for (const tool of tools) {
        const level = READ_TOOL_CONTRACTS[tool]?.assurance;
        if (level && ASSURANCE_LEVEL_MATRIX[level].rank > ASSURANCE_LEVEL_MATRIX[best].rank) best = level;
    }
    return best;
}

function factsOf(tools: readonly string[]): OperationFactKind[] {
    return unique(tools.flatMap(tool => READ_TOOL_CONTRACTS[tool]?.facts ?? []));
}

function safetyFor(key: string, toolGroup: string): OperationSafety {
    if (EMERGENCY_OPERATIONS.has(key)) return Object.freeze({ default: 'emergency', health: 'emergency' });
    const health = HEALTH_SAFETY_CLASS_BY_TOOL_GROUP[toolGroup];
    return Object.freeze(health ? { default: 'none', health } : { default: 'none' });
}

function fromIntent(intent: IntentContract, toolGroup: string, profiles: readonly string[]): OperationDefinition {
    const plan = intent.toolPlan;
    const writers = plan.filter(tool => !READ_TOOL_CONTRACTS[tool] && !IDENTITY_STEP_UP_TOOL_NAMES.includes(tool));
    // Only the reads BEFORE the first writer are required: a read after it
    // (the status of what was just created) is a post-read, visible but not owed.
    const firstWriter = plan.findIndex(tool => writers.includes(tool));
    const planReads = (firstWriter < 0 ? plan : plan.slice(0, firstWriter)).filter(tool => !!READ_TOOL_CONTRACTS[tool]);
    const prerequisites = unique(writers.flatMap(writer => CORE_TOOL_PREREQUISITES[writer] ?? []));
    const waived = !prerequisites.length && !planReads.length && intent.key in OPERATIONS_WITHOUT_READS;
    const readTools = prerequisites.length ? prerequisites : planReads;
    const facts = factsOf(readTools);
    if (intent.commits) facts.push('commit_receipt');
    return Object.freeze({
        key: intent.key,
        description: intent.description,
        source: 'domain_intent',
        toolGroup,
        verticals: Object.freeze(unique(profiles.map(id => id.split('/')[0]))),
        profiles: Object.freeze([...profiles]),
        requiredReads: Object.freeze(requiredReadsFor(readTools)),
        requiredReadsSource: prerequisites.length ? 'core_prerequisites' : waived ? 'waived' : 'intent_tool_plan',
        visibleTools: Object.freeze(unique([...readTools, ...plan])),
        writers: Object.freeze(writers),
        commits: intent.commits,
        workflowClass: classifyIntentWorkflow(intent),
        assurance: maxAssurance(readTools),
        safety: safetyFor(intent.key, toolGroup),
        factKinds: Object.freeze(unique(facts)),
        onReadFailure: intent.fallback === 'ask' ? 'ask' : intent.fallback === 'handoff' ? 'handoff' : 'admit',
    });
}

function fromDeclared(op: DeclaredReadOperation, profiles: readonly string[]): OperationDefinition {
    return Object.freeze({
        key: op.key,
        description: op.description,
        source: 'read_operation',
        toolGroup: op.toolGroup,
        verticals: Object.freeze(unique(profiles.map(id => id.split('/')[0]))),
        profiles: Object.freeze([...profiles]),
        requiredReads: Object.freeze(requiredReadsFor(op.reads)),
        requiredReadsSource: 'declared',
        visibleTools: Object.freeze(unique([...op.reads, ...(op.alsoVisible ?? [])])),
        writers: Object.freeze([]),
        commits: false,
        workflowClass: 'informational',
        assurance: maxAssurance(op.reads),
        safety: safetyFor(op.key, op.toolGroup),
        factKinds: Object.freeze([...op.factKinds]),
        onReadFailure: op.onReadFailure ?? 'admit',
    });
}

let memo: readonly OperationDefinition[] | null = null;

/**
 * The whole catalogue, built once on first use (deriving it walks every
 * domain contract, which nothing should pay for at import time).
 */
export function getOperationCatalogue(): readonly OperationDefinition[] {
    if (memo) return memo;
    const intents = new Map<string, { intent: IntentContract; profiles: string[] }>();
    const profilesByGroup = new Map<string, Set<string>>();
    for (const draft of listDomainContractDrafts()) {
        for (const intent of draft.intents) {
            const entry = intents.get(intent.key) ?? { intent, profiles: [] };
            entry.profiles.push(draft.profileId);
            intents.set(intent.key, entry);
            const group = intentToolGroup(intent.key);
            if (group) {
                const set = profilesByGroup.get(group) ?? new Set<string>();
                set.add(draft.profileId);
                profilesByGroup.set(group, set);
            }
        }
    }
    const operations: OperationDefinition[] = [];
    for (const { intent, profiles } of intents.values()) {
        operations.push(fromIntent(intent, intentToolGroup(intent.key) ?? 'unknown', profiles));
    }
    for (const op of DECLARED_READ_OPERATIONS) {
        if (intents.has(op.key)) throw new Error(`Operation ${op.key} is both a domain intent and a declared read operation`);
        operations.push(fromDeclared(op, [...(profilesByGroup.get(op.toolGroup) ?? [])]));
    }
    memo = Object.freeze(operations);
    return memo;
}

export function getOperation(key: unknown): OperationDefinition | undefined {
    return typeof key === 'string' ? getOperationCatalogue().find(op => op.key === key) : undefined;
}

/**
 * The operations a turn can classify into: those with at least one required
 * read (or, for a waived intake, one visible tool) among the tools this turn
 * actually publishes. Never widens what the turn may do — it only narrows the
 * labels the classifier chooses from.
 */
export function operationsForPublishedTools(publishedTools: readonly string[]): OperationDefinition[] {
    const published = new Set(publishedTools);
    return getOperationCatalogue().filter(op => {
        const anchors = op.requiredReads.length ? op.requiredReads.map(r => r.tool) : op.visibleTools;
        return anchors.some(tool => published.has(tool));
    });
}
