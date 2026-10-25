/**
 * Required reads (operations runtime PR5, pilot: restaurant and store).
 *
 * The shadow classifier (PR4) says which operation a customer turn is; the
 * catalogue (`packages/shared/src/operation-catalogue.ts`) says which reads that
 * operation owes. Production QA (image 7f9826aa, 3/3 every round) showed the gap
 * is the model skipping exactly those reads:
 *
 *   - store «¿cuántos pedidos tengo y en qué estado están?» → «tres pedidos, todos
 *     cancelados» (six, all cancelled) with no order read at all;
 *   - restaurant «¿cómo va mi pedido?» → asked for a number, then «no tengo
 *     registrado un pedido con ese número» without list_my_orders/check_order_status;
 *   - restaurant «¿cuánto cuesta el plato que tienen?» → get_menu about 1 time in 3,
 *     otherwise the confirmed 13.500 COP was denied.
 *
 * So, when the tenant's pilot flag is on and the classifier is confident, the
 * runtime runs those reads BEFORE the model call, through the same executor and
 * read-only execution context the automatic reads use, and hands the results to
 * the model as synthetic tool messages. The caller does the I/O; everything here
 * is planning, argument resolution and bookkeeping.
 *
 * PR7 extends the same runner to hotel / vacation rental (`properties`) and travel (`tours`). Production QA (Telegram):
 *   - hotel «¿cuánto cuesta la noche?» with no dates → asked for dates, then «no tengo un precio base», while list_properties
 *     returns `nightPrice` (150.000 COP, minNights 1): without dates the answer is the "desde" price;
 *   - hotel «¿tienen disponible del 3 al 5 de diciembre para 2?» → availability claimed with no availability read: dates in the
 *     message now read the list for those dates and `check_property_availability` for the one property;
 *   - hotel «¿a qué hora es el check-in?» → only `get_property_details` has checkInTime/checkOutTime, so it runs on the one
 *     property (the only one, or the one the customer named);
 *   - travel: availability needs `check_package_availability` (a date) or the upcoming departures; price and what is included
 *     come from `search_packages`, read unfiltered so «¿qué planes manejan?» lists the packages instead of asking for filters.
 *
 * The `listings` pilot extends it to real estate (`inmobiliaria`, tool family `realEstate`). Production QA (real-estate QA
 * tenant, gpt-4.1-mini, after #177): with `search_listings` in the turn the price, operation, bathrooms and area were right 2/2;
 * without it «El precio del apartamento no está confirmado» and an advisor 0/3, «2 baños» invented with no
 * `get_listing_details`, and «¿qué propiedades tienen?» answered with three filter questions while the agency has one listing:
 *   - `listing_info` (price, area, rooms, bathrooms, sale or rent, details) reads `search_listings` with the filters the message
 *     states (operation, property kind, bedrooms; none → unfiltered), then `get_listing_details` on the listing the customer
 *     named or the only match, otherwise `ambiguous_receipt`;
 *   - `find_listing` (an open «¿qué propiedades tienen?») reads only `search_listings`, so the model lists what exists; a
 *     filter that is too strict comes back with `closestMatches` (listing-closest-matches.ts), never an empty «no hay»;
 *   - a visit is the appointment flow: its writes are not touched.
 *
 * Invariants:
 *   - Only reads, only the pilot operations, only tools the turn publishes.
 *   - A failed read is an ADMIT ("no pude consultar"), never an empty list: the
 *     model must not turn a lookup that broke into "no tiene pedidos".
 *   - A list carries its completeness: rows read with a bounded limit, the total
 *     when the list is complete, `hasMore` otherwise.
 *   - An id another read needs (`receipt:` in the catalogue) is taken only when
 *     the receipt names exactly one record (or exactly one still-open record);
 *     anything ambiguous is left to the model, which has the whole list.
 */
import {
    getOperation, getOperationCatalogue, normalizeForIntent, READ_TOOL_CONTRACTS, TOOL_READ_ERROR_CODES,
    type OperationDefinition, type OperationReadProjection, type OperationRequiredRead,
} from '@parallext/shared';
import { readFailed } from '../../../common/contracts/tool-read-result.util';
import { toolBatchRequiresSequentialExecution } from '../tool-policy-registry';
import { isFailedToolResult } from '../trusted-price-context';
import { OPERATION_CONFIDENCE_THRESHOLD, type OperationShadowVerdict } from './operation-classifier.service';
import type { RequiredReadSlots } from './required-read-slots';
import { isPastOrdersQuestion } from './operation-lexical-cues';

export type RequiredReadsPilot = 'restaurants' | 'catalog' | 'properties' | 'tours' | 'listings';

/**
 * Confidence at or above which the runtime acts on the verdict. The plan names
 * "el umbral" without a number and the classifier only records below 0.6 as a
 * low-confidence fallback; acting is stricter than recording, so the bar is
 * higher. Reads are side-effect free, so a false positive costs latency only —
 * but a forced read the customer did not ask for still clutters the turn.
 */
export const REQUIRED_READS_CONFIDENCE_THRESHOLD = 0.8;
/** Per-read deadline, the same the automatic reads use. */
export const REQUIRED_READ_TIMEOUT_MS = 3_000;

/** Industry (prefix of the subtype profile id) the PR5 pilots are limited to. */
export const REQUIRED_READS_PILOT_INDUSTRY: Readonly<Partial<Record<RequiredReadsPilot, string>>> = Object.freeze({
    restaurants: 'restaurantes',
    catalog: 'retail',
});

/**
 * The PR7 pilots are limited by the profile's tool family, not its industry: `turismo` holds both the hotel and vacation
 * rental profiles (`properties`) and the travel agency and tours profiles (`tours`). A profile belongs to the pilot when the
 * catalogue lists it on an operation of that tool group.
 */
export const REQUIRED_READS_PILOT_TOOL_GROUP: Readonly<Partial<Record<RequiredReadsPilot, string>>> = Object.freeze({
    properties: 'properties',
    tours: 'tours',
    // Real estate: the profiles that publish search_listings / get_listing_details (`inmobiliaria/*`).
    listings: 'realEstate',
});

/**
 * The pilot operations. The store's «mis pedidos» is the catalogue's
 * `track_catalog_order` (list_my_catalog_orders → get_catalog_order); the
 * catalogue's `check_my_orders` is the restaurant's list (list_my_orders).
 */
export const REQUIRED_READS_PILOT_OPERATIONS: Readonly<Record<string, RequiredReadsPilot>> = Object.freeze({
    menu_info: 'restaurants',
    check_my_orders: 'restaurants',
    track_food_order: 'restaurants',
    product_info: 'catalog',
    track_catalog_order: 'catalog',
    // PR7, hotel / vacation rental. `stay_logistics` («a qué hora es el check-in?») runs only its public reads (see
    // PILOT_READ_OVERRIDES); any of the three with stay dates in the message reads the availability first.
    property_info: 'properties',
    book_stay: 'properties',
    stay_logistics: 'properties',
    // PR7, travel agency / tours.
    package_info: 'tours',
    package_availability: 'tours',
    book_tour: 'tours',
    // Real estate. `listing_info`: one listing's price, area, rooms, bathrooms, operation; `find_listing`: what is on offer.
    listing_info: 'listings',
    find_listing: 'listings',
});

/**
 * Where a pilot runs other reads than the catalogue's for an operation. `stay_logistics` owes the guest's own booking and its
 * check-in instructions (A1/A2: identity step-up, PR9). Before the model only its public part runs: the property list and the
 * property's details (check-in and check-out time, house rules, amenities). The booking reads stay visible to the model.
 */
const PILOT_READ_OVERRIDES: Readonly<Record<string, readonly string[]>> = Object.freeze({
    stay_logistics: Object.freeze(['list_properties', 'get_property_details']),
    // An open «¿qué propiedades tienen?»: the list is the answer; the details of one listing are not guessed.
    find_listing: Object.freeze(['search_listings']),
});

/** Arguments a read cannot run without. Absent from the message, the read is not run and the model asks. */
const REQUIRED_SLOT_ARGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    check_property_availability: Object.freeze(['checkIn', 'checkOut']),
    check_package_availability: Object.freeze(['date']),
});

/** Lists the reader returns whole (no limit, no paging): what was read is all there is. */
const UNBOUNDED_LISTS = new Set(['list_properties']);

/**
 * Search readers that return a bounded list under another name than `list_*`. `search_listings` returns at most 8 exact matches
 * (`AiToolExecutorService.searchListings`): fewer than that is the whole match set; 8 may not be.
 */
const BOUNDED_SEARCHES: Readonly<Record<string, { container: string; limit: number }>> = Object.freeze({
    search_listings: Object.freeze({ container: 'listings', limit: 8 }),
});

/** What the model is told about a property list read without dates: the nightly price is a "from" price, not a quote. */
export const FROM_PRICE_NOTE = 'Sin fechas: nightPrice es el precio por noche "desde" de cada alojamiento (minNights es la estadía mínima). Dalo como "desde"; el total depende de las fechas y se consulta con check_property_availability.';

/**
 * Bounded arguments a pilot reader runs with when nothing narrows it. Lists ask
 * for the most the reader returns (list_my_orders caps at 20, the catalog order
 * reader at 50), so "six orders" is read as six, complete, not the default five.
 */
const DEFAULT_ARGS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
    get_menu: Object.freeze({}),
    list_my_orders: Object.freeze({ limit: 20 }),
    list_my_catalog_orders: Object.freeze({ limit: 50 }),
    search_products: Object.freeze({ query: '', limit: 20 }),
    // Unfiltered: «¿qué planes manejan?» lists every package instead of asking for filters first.
    search_packages: Object.freeze({}),
    // Unfiltered unless the message states a filter (operation, property kind, bedrooms): «¿qué propiedades tienen?» lists them.
    search_listings: Object.freeze({}),
});

/** The arguments a required read of `tool` runs with when the message states no filter (a fresh copy). */
export function requiredReadDefaultArgs(tool: string): Record<string, unknown> {
    return { ...(DEFAULT_ARGS[tool] ?? {}) };
}

/** Record statuses after which an order is no longer "the one in progress". */
const CLOSED_STATUSES = new Set(['cancelled', 'canceled', 'delivered', 'completed', 'rejected', 'refunded', 'failed', 'expired', 'closed']);

/** What the model is told when a required read broke: an admission, never "none". */
const ADMIT_MESSAGE = 'No pude consultar esta información en este momento. No digas que no hay registros: di que no pudiste consultarlo y ofrece intentarlo de nuevo o pasar con una persona.';

export function requiredReadsPilotForProfile(profileId: string | null | undefined): RequiredReadsPilot | null {
    const industry = typeof profileId === 'string' ? profileId.split('/')[0] : '';
    if (!industry) return null;
    const byIndustry = (Object.keys(REQUIRED_READS_PILOT_INDUSTRY) as RequiredReadsPilot[]).find(p => REQUIRED_READS_PILOT_INDUSTRY[p] === industry);
    if (byIndustry) return byIndustry;
    const byGroup = (Object.keys(REQUIRED_READS_PILOT_TOOL_GROUP) as RequiredReadsPilot[]).find(pilot => getOperationCatalogue()
        .some(op => op.toolGroup === REQUIRED_READS_PILOT_TOOL_GROUP[pilot] && op.profiles.includes(profileId as string)));
    return byGroup ?? null;
}

export type RequiredReadsSkipReason =
    | 'no_verdict'
    | `fallback:${string}`
    | 'below_threshold'
    | 'not_pilot_operation'
    | 'pilot_mismatch';

export type RequiredReadsGate =
    /** `source: 'lexical_cue'`: the message's own words named the operation (`operation-lexical-cues.ts`), not the classifier. */
    | { run: true; operation: OperationDefinition; pilot: RequiredReadsPilot; source?: 'lexical_cue' }
    | { run: false; reason: RequiredReadsSkipReason };

/**
 * Operations a lexical cue may take a turn from even when the classifier is confident: the FAQ intent. «how much is the
 * Spark dish?» is not "something the business already answered" because the price was said earlier in the conversation.
 */
const LEXICAL_CUE_OVERRIDABLE = new Set(['none', 'ask_question']);

/**
 * A confident read verdict of the same pilot that the message's words narrow to a read that owes more. Production 2026-10-24:
 * «combien de places restent pour le Spark QA Tour ?» answered «no specific number of seats» after search_packages alone; a
 * seats or departure question is `package_availability` (the departures and their seats, and a dated departure's availability)
 * even when the classifier confidently said `package_info`. Only read operations are upgraded, never a booking or another
 * pilot's operation.
 */
const LEXICAL_CUE_UPGRADES: Readonly<Record<string, readonly string[]>> = Object.freeze({
    package_info: Object.freeze(['package_availability']),
});

/**
 * Whether this verdict moves the turn into forced reads. Pure.
 *
 * `lexicalOperation` (from `lexicalRequiredReadsOperation`) is the pilot operation the message's own words name. It runs the
 * reads when the classifier did not (no verdict, a fallback, below the threshold, the FAQ intent), unless the classifier
 * confidently named another business operation. The confidence threshold is the same for every classifier verdict.
 */
export function requiredReadsGate(
    verdict: OperationShadowVerdict | null | undefined,
    pilot: RequiredReadsPilot,
    lexicalOperation?: string | null,
): RequiredReadsGate {
    const byClassifier = classifierGate(verdict, pilot);
    if (byClassifier.run && lexicalOperation && LEXICAL_CUE_UPGRADES[byClassifier.operation.key]?.includes(lexicalOperation)) {
        const upgraded = getOperation(lexicalOperation);
        if (upgraded && REQUIRED_READS_PILOT_OPERATIONS[lexicalOperation] === pilot) return { run: true, operation: upgraded, pilot, source: 'lexical_cue' };
    }
    if (byClassifier.run || !lexicalOperation || REQUIRED_READS_PILOT_OPERATIONS[lexicalOperation] !== pilot) return byClassifier;
    const confidentElsewhere = !!verdict && !verdict.fallback && !LEXICAL_CUE_OVERRIDABLE.has(verdict.operationKey)
        && verdict.confidence >= Math.max(REQUIRED_READS_CONFIDENCE_THRESHOLD, OPERATION_CONFIDENCE_THRESHOLD)
        && verdict.operationKey !== lexicalOperation;
    if (confidentElsewhere) return byClassifier;
    const operation = getOperation(lexicalOperation);
    return operation ? { run: true, operation, pilot, source: 'lexical_cue' } : byClassifier;
}

function classifierGate(verdict: OperationShadowVerdict | null | undefined, pilot: RequiredReadsPilot): RequiredReadsGate {
    if (!verdict) return { run: false, reason: 'no_verdict' };
    if (verdict.fallback) return { run: false, reason: `fallback:${verdict.fallback}` };
    if (!(verdict.confidence >= Math.max(REQUIRED_READS_CONFIDENCE_THRESHOLD, OPERATION_CONFIDENCE_THRESHOLD))) return { run: false, reason: 'below_threshold' };
    const operationPilot = REQUIRED_READS_PILOT_OPERATIONS[verdict.operationKey];
    if (!operationPilot) return { run: false, reason: 'not_pilot_operation' };
    if (operationPilot !== pilot) return { run: false, reason: 'pilot_mismatch' };
    const operation = getOperation(verdict.operationKey);
    if (!operation) return { run: false, reason: 'not_pilot_operation' };
    return { run: true, operation, pilot };
}

export type RequiredReadStatus =
    | 'read'
    | 'failed'
    | 'already_read'
    | 'projected'
    | 'unpublished'
    | 'ambiguous_receipt'
    | 'no_receipt'
    | 'upstream_failed'
    /** A slot the read cannot run without (stay dates, departure date) was not in the message: the model asks. */
    | 'missing_slot';

export interface RequiredReadRecord {
    tool: string;
    args: Record<string, unknown>;
    status: RequiredReadStatus;
    latencyMs?: number;
    /** Lists: rows read, and whether that is all of them. */
    rows?: number;
    complete?: boolean;
    total?: number;
    error?: string;
}

/** A read whose result goes to the model as a synthetic tool message. */
export interface RequiredReadResult {
    name: string;
    args: Record<string, unknown>;
    result: any;
}

export interface RequiredReadsRun {
    operationKey: string;
    reads: RequiredReadRecord[];
    /** In the order they ran; failed reads carry an admit result. */
    results: RequiredReadResult[];
    /** `read`: every read that could run answered. `admit`: at least one failed. `nothing_to_run`: all satisfied/unrunnable. */
    outcome: 'read' | 'admit' | 'nothing_to_run';
    latencyMs: number;
}

export interface RequiredReadsIo {
    /** Runs one read through the turn's executor (read-only context, deadline). May throw: that is a failed read. */
    execute(name: string, args: Record<string, unknown>): Promise<any>;
    /** Tools the turn publishes and authorises. */
    publishedTools: readonly string[];
    /** Reads the runtime already ran this turn (automatic reads): reused, not repeated. */
    alreadyRead: ReadonlyArray<{ name: string; args?: any; result: any }>;
    /** Turn contexts that already carry projected items (`<catalog>`, `<available_services>`). */
    projectedContexts: ReadonlyArray<OperationReadProjection['context']>;
    /** Agent Test / evaluation: an exception is evidence and is rethrown, not swallowed. */
    rethrow?(error: unknown): boolean;
    now?(): number;
    /** Slot values of the customer's current message (`requiredReadSlotsIn`): stay dates, departure date, people. */
    slots?: RequiredReadSlots;
    /** The customer's current message: a receipt with several rows resolves to the one row the customer NAMED. */
    customerText?: string;
}

interface ReceiptRef { tool: string; container: string; field: string }

function parseReceipt(source: string): ReceiptRef[] {
    return source.split('|').flatMap(part => {
        const match = /^receipt:([a-z0-9_]+)\.([A-Za-z0-9_]+)\[\]\.([A-Za-z0-9_]+)$/.exec(part.trim());
        return match ? [{ tool: match[1], container: match[2], field: match[3] }] : [];
    });
}

const fold = (value: unknown) => normalizeForIntent(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The one row whose name the customer said («¿la Cabaña del Lago tiene piscina?»), or none when no name or more than one name
 * appears. A name shorter than three characters never matches: it would match inside ordinary words.
 */
function namedRow(rows: any[], customerText: string | undefined): any | undefined {
    if (!customerText) return undefined;
    const text = ` ${fold(customerText)} `;
    const nameOf = (row: any) => typeof row?.name === 'string' ? fold(row.name) : '';
    const named = rows.filter(row => {
        const name = nameOf(row);
        return name.length >= 3 && text.includes(` ${name} `);
    });
    if (named.length === 1) return named[0];
    if (named.length > 1) return undefined;
    return wordNamedRow(rows.map(row => ({ row, name: nameOf(row) })), text);
}

/**
 * The customer said the name's words but not all of it: production 2026-10-24, «combien de places restent pour le Spark QA
 * Tour ?» for the package «Spark QA Tour 20261018T2140Z», with other packages in the list. A row is named when every word of
 * its name that carries no digit (a code or timestamp suffix is not said aloud) starts a word of the message, and those words
 * are at least four letters in all (so «the tour» never names «Tour»). Among several such rows the one with the most of its
 * words in the message wins (the more specific name), and a tie is no name at all. Pure.
 */
function wordNamedRow(rows: Array<{ row: any; name: string }>, text: string): any | undefined {
    const startsAWord = (word: string) => text.includes(` ${word}`);
    const scored = rows.flatMap(({ row, name }) => {
        const words = name.split(' ').filter(Boolean);
        const spoken = words.filter(word => !/\d/.test(word));
        // F4300-32: «when is the next departure of the Spark tour?» for «Spark QA Tour 20261018T2140Z». A two-letter word (a «QA»,
        // a «de») may go unsaid when at least two longer words of the name are all said; a one-word name still needs its word.
        const long = spoken.filter(word => word.length >= 3);
        const said = spoken.every(startsAWord) || (long.length >= 2 && long.every(startsAWord));
        if (!spoken.length || spoken.join('').length < 4 || !said) return [];
        return [{ row, score: words.filter(startsAWord).length }];
    });
    if (!scored.length) return undefined;
    const best = Math.max(...scored.map(s => s.score));
    const top = scored.filter(s => s.score === best);
    return top.length === 1 ? top[0].row : undefined;
}

/**
 * The one record id a receipt names: the only row, the one row the customer named, or the only still-open row.
 * `null` with a reason when there is none or more than one.
 */
export function pickReceiptId(
    result: any, ref: ReceiptRef, customerText?: string, options: { newest?: boolean } = {},
): { id: string } | { reason: 'no_receipt' | 'ambiguous_receipt' } {
    const rows: any[] = Array.isArray(result?.[ref.container]) ? result[ref.container] : [];
    const ids = (list: any[]) => list.map(row => row?.[ref.field]).filter((id): id is string => typeof id === 'string' && !!id.trim());
    const all = ids(rows);
    if (!all.length) return { reason: 'no_receipt' };
    if (all.length === 1) return { id: all[0] };
    const named = ids([namedRow(rows, customerText)].filter(Boolean));
    if (named.length === 1) return { id: named[0] };
    // «what did I order last time?»: the newest record, whatever its status (F4300-11).
    if (options.newest) {
        const id = newestRow(rows)?.[ref.field];
        if (typeof id === 'string' && id.trim()) return { id };
    }
    const open = ids(rows.filter(row => typeof row?.status !== 'string' || !CLOSED_STATUSES.has(row.status.toLowerCase())));
    return open.length === 1 ? { id: open[0] } : { reason: 'ambiguous_receipt' };
}

/** The most recent row by `createdAt` (or `created_at`); without a date on every row, the first (order readers list newest first). */
function newestRow(rows: any[]): any {
    const time = (row: any) => Date.parse(String(row?.createdAt ?? row?.created_at ?? ''));
    if (!rows.every(row => Number.isFinite(time(row)))) return rows[0];
    return rows.reduce((best, row) => (time(row) > time(best) ? row : best), rows[0]);
}

/**
 * The detail read that holds what a past order contained, for an orders list that does not carry its items: the restaurant's
 * list_my_orders gives only `itemCount` (F4300-11, «qué pedí la última vez?» → «No tengo detalles específicos de los ítems
 * que pidió» about an order with one dish). The store's list_my_catalog_orders carries each order's items already.
 */
const PAST_ORDER_DETAIL_READ: Readonly<Record<string, string>> = Object.freeze({
    check_my_orders: 'check_order_status',
});

/**
 * The reads a pilot runs for an operation and this message. The catalogue's reads, except where the pilot overrides them
 * (`stay_logistics`), plus what the message's slots make owed:
 *   - a lodging operation with stay dates in the message reads `check_property_availability` (and the list is read for those
 *     dates), so availability is never claimed from a dateless list;
 *   - `package_availability` with no departure date reads `get_package_details`, whose upcoming departures are what the customer
 *     can be told (`check_package_availability` cannot run without a date and is left `missing_slot`);
 *   - a tour operation with a departure date in the message reads `check_package_availability` for that date.
 */
export function requiredReadsPlan(operation: OperationDefinition, slots: RequiredReadSlots = {}, customerText?: string): OperationRequiredRead[] {
    const contract = (tool: string): OperationRequiredRead => {
        const found = READ_TOOL_CONTRACTS[tool];
        return { tool, argsFrom: found?.argsFrom ?? {}, ...(found?.projection ? { projection: found.projection } : {}) };
    };
    const override = PILOT_READ_OVERRIDES[operation.key];
    const plan: OperationRequiredRead[] = override ? override.map(contract) : [...operation.requiredReads];
    const has = (tool: string) => plan.some(read => read.tool === tool);
    const pilot = REQUIRED_READS_PILOT_OPERATIONS[operation.key];
    if (pilot === 'properties' && slots.check_in && slots.check_out && !has('check_property_availability')) {
        plan.push(contract('check_property_availability'));
    }
    if (operation.key === 'package_availability' && !slots.starts_at && !has('get_package_details')) {
        plan.push(contract('get_package_details'));
    }
    // A departure date in any tour question («¿cuánto cuesta el tour X el 15 de diciembre?») reads that departure's seats too.
    if (pilot === 'tours' && slots.starts_at && !has('check_package_availability')) {
        plan.push(contract('check_package_availability'));
    }
    // «qué pedí la última vez?» / «what did I order?»: what the order held is in its detail read (of the newest order).
    const detail = PAST_ORDER_DETAIL_READ[operation.key];
    if (detail && !has(detail) && isPastOrdersQuestion(customerText)) plan.push(contract(detail));
    return plan;
}

/** The list of a customer-records read, with its completeness made explicit for the model and the ledger. */
export function withListEvidence(name: string, args: Record<string, unknown>, result: any): { result: any; rows?: number; complete?: boolean; total?: number } {
    if (!result || typeof result !== 'object' || isFailedToolResult(result)) return { result };
    const bounded = BOUNDED_SEARCHES[name];
    if (bounded) {
        if (!Array.isArray(result[bounded.container])) return { result };
        const rows = result[bounded.container].length;
        const complete = rows < bounded.limit;
        return {
            result: { ...result, ...(complete ? { total: rows } : {}), hasMore: !complete, complete },
            rows, complete, ...(complete ? { total: rows } : {}),
        };
    }
    if (!/^list_/.test(name)) return { result };
    const entry = Object.entries(result).find(([, value]) => Array.isArray(value));
    if (!entry) return { result };
    const rows = (entry[1] as unknown[]).length;
    const limit = Number(args.limit);
    const complete = typeof result.hasMore === 'boolean' ? !result.hasMore
        : typeof result.total === 'number' ? result.total === rows
            : UNBOUNDED_LISTS.has(name) ? true
                : Number.isFinite(limit) && limit > 0 ? rows < limit : false;
    const total = complete ? rows : typeof result.total === 'number' ? result.total : undefined;
    return {
        result: { ...result, ...(total !== undefined ? { total } : {}), hasMore: !complete, complete },
        rows, complete, ...(total !== undefined ? { total } : {}),
    };
}

function admitResult(name: string, error: string): any {
    return { ...readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, { message: ADMIT_MESSAGE }), tool: name, requiredRead: true, cause: error };
}

const sameArgs = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/**
 * Runs the operation's required reads. Reads with no `receipt:` argument run
 * first (in parallel unless the batch requires sequential execution); reads that
 * need an id from them run after, only with an unambiguous id. Never throws
 * unless `io.rethrow` says so.
 */
export async function runRequiredReads(operation: OperationDefinition, io: RequiredReadsIo): Promise<RequiredReadsRun> {
    const now = io.now ?? (() => Date.now());
    const started = now();
    const published = new Set(io.publishedTools);
    const projected = new Set(io.projectedContexts);
    const reads: RequiredReadRecord[] = [];
    const results: RequiredReadResult[] = [];
    const answers = new Map<string, any>();
    const failed = new Set<string>();

    const slots = io.slots ?? {};
    // A question about the customer's past orders: an order detail read is of the newest order when several were listed.
    const pastOrders = isPastOrdersQuestion(io.customerText);
    const plan = requiredReadsPlan(operation, slots, io.customerText).map(read => {
        const receipts = Object.entries(read.argsFrom).flatMap(([arg, source]) => {
            const refs = parseReceipt(source);
            return refs.length ? [{ arg, refs }] : [];
        });
        return { read, receipts };
    });
    /** The `slot:` arguments the message gives a value for (a `receipt:…|slot:…` alternative counts too). */
    const slotArgs = (read: OperationRequiredRead): Record<string, unknown> => Object.fromEntries(Object.entries(read.argsFrom).flatMap(([arg, source]) => {
        const key = source.split('|').map(part => /^slot:([a-z0-9_]+)$/.exec(part.trim())?.[1]).find(Boolean);
        const value = key ? (slots as Record<string, unknown>)[key] : undefined;
        return value === undefined || value === null || value === '' ? [] : [[arg, value]];
    }));
    const missingSlot = (tool: string, args: Record<string, unknown>) => (REQUIRED_SLOT_ARGS[tool] ?? []).some(arg => args[arg] === undefined);

    const runOne = async (name: string, args: Record<string, unknown>): Promise<void> => {
        const t0 = now();
        let result: any;
        let thrown: string | undefined;
        try {
            result = await io.execute(name, args);
        } catch (error: any) {
            if (io.rethrow?.(error)) throw error;
            thrown = String(error?.message || error || 'read_failed').slice(0, 120);
        }
        const latencyMs = now() - t0;
        if (thrown !== undefined || isFailedToolResult(result)) {
            failed.add(name);
            const code = thrown ?? String(result?.errorCode ?? result?.error ?? result?.status ?? 'read_failed').slice(0, 80);
            // A refusal the executor explained (identity step-up, ownership) reaches the model as it is; a crash or an
            // unexplained failure becomes the admit. Either way it is never an empty list.
            const explained = !thrown && !!result && typeof result === 'object' && typeof result.message === 'string'
                && !!result.message.trim() && !Object.values(result).some(Array.isArray);
            const modelResult = explained ? { ...result, requiredRead: true } : admitResult(name, code);
            results.push({ name, args, result: modelResult });
            reads.push({ tool: name, args, status: 'failed', latencyMs, error: code });
            return;
        }
        const evidence = withListEvidence(name, args, result);
        if (name === 'list_properties' && !args.checkIn && Array.isArray(evidence.result?.properties) && evidence.result.properties.length) {
            evidence.result = { ...evidence.result, priceBasis: 'from_nightly_price', priceNote: FROM_PRICE_NOTE };
        }
        answers.set(name, evidence.result);
        results.push({ name, args, result: evidence.result });
        reads.push({
            tool: name, args, status: 'read', latencyMs,
            ...(evidence.rows !== undefined ? { rows: evidence.rows, complete: evidence.complete } : {}),
            ...(evidence.total !== undefined ? { total: evidence.total } : {}),
        });
    };

    // Stage 1: reads that need nothing from another read.
    const first: Array<{ name: string; args: Record<string, unknown> }> = [];
    for (const { read, receipts } of plan) {
        if (receipts.length) continue;
        const args = { ...(DEFAULT_ARGS[read.tool] ?? {}), ...slotArgs(read) };
        if (!published.has(read.tool)) { reads.push({ tool: read.tool, args, status: 'unpublished' }); continue; }
        if (missingSlot(read.tool, args)) { reads.push({ tool: read.tool, args, status: 'missing_slot' }); continue; }
        if (read.projection?.status === 'live' && projected.has(read.projection.context)) { reads.push({ tool: read.tool, args, status: 'projected' }); continue; }
        const prior = io.alreadyRead.find(item => item.name === read.tool && sameArgs(item.args ?? {}, args))
            ?? (Object.keys(args).length === 0 ? io.alreadyRead.find(item => item.name === read.tool) : undefined);
        if (prior && !isFailedToolResult(prior.result)) {
            answers.set(read.tool, prior.result);
            reads.push({ tool: read.tool, args, status: 'already_read' });
            continue;
        }
        first.push({ name: read.tool, args });
    }
    if (first.length > 1 && !toolBatchRequiresSequentialExecution(first.map(r => r.name))) {
        await Promise.all(first.map(r => runOne(r.name, r.args)));
    } else {
        for (const r of first) await runOne(r.name, r.args);
    }

    // Stage 2: reads that take an id from a stage-1 receipt.
    for (const { read, receipts } of plan) {
        if (!receipts.length) continue;
        const args: Record<string, unknown> = {};
        if (!published.has(read.tool)) { reads.push({ tool: read.tool, args, status: 'unpublished' }); continue; }
        if (read.projection?.status === 'live' && projected.has(read.projection.context)) { reads.push({ tool: read.tool, args, status: 'projected' }); continue; }
        Object.assign(args, slotArgs(read));
        if (missingSlot(read.tool, args)) { reads.push({ tool: read.tool, args, status: 'missing_slot' }); continue; }
        let blocked: RequiredReadStatus | null = null;
        for (const { arg, refs } of receipts) {
            const ref = refs.find(candidate => answers.has(candidate.tool));
            if (!ref) {
                // `receipt:…|slot:…`: the customer may name the record instead (a vehicle id); then it is not blocked.
                if (args[arg] !== undefined) continue;
                blocked = refs.some(candidate => failed.has(candidate.tool)) ? 'upstream_failed' : 'no_receipt';
                break;
            }
            const picked = pickReceiptId(answers.get(ref.tool), ref, io.customerText, { newest: pastOrders });
            if ('reason' in picked) { blocked = picked.reason; break; }
            args[arg] = picked.id;
        }
        if (blocked) { reads.push({ tool: read.tool, args, status: blocked }); continue; }
        // Already read this turn for the same record (the automatic listing-detail lookup records no args, only the result).
        const prior = io.alreadyRead.find(item => item.name === read.tool && !isFailedToolResult(item.result) && (item.args
            ? sameArgs(item.args, args) : Object.values(args).some(value => typeof value === 'string' && value === item.result?.id)));
        if (prior) {
            answers.set(read.tool, prior.result);
            reads.push({ tool: read.tool, args, status: 'already_read' });
            continue;
        }
        await runOne(read.tool, args);
    }

    const ran = reads.filter(r => r.status === 'read' || r.status === 'failed');
    return {
        operationKey: operation.key,
        reads,
        results,
        outcome: reads.some(r => r.status === 'failed') ? 'admit' : ran.length ? 'read' : 'nothing_to_run',
        latencyMs: now() - started,
    };
}

/** The `decision/required_reads` trace step. Pure. */
export function buildRequiredReadsTrace(input: {
    pilot: RequiredReadsPilot;
    verdict: OperationShadowVerdict | null;
    gate: RequiredReadsGate;
    run?: RequiredReadsRun;
    latencyMs: number;
    /** The message's slots (PR7); only their names reach the trace. */
    slots?: RequiredReadSlots;
}): Record<string, unknown> {
    const slotNames = Object.keys(input.slots ?? {}).sort();
    return {
        pilot: input.pilot,
        operation: input.gate.run ? input.gate.operation.key : input.verdict?.operationKey ?? null,
        confidence: input.verdict?.confidence ?? null,
        // The message's words ran the reads: what the classifier said is kept for the error analysis.
        ...(input.gate.run && input.gate.source === 'lexical_cue'
            ? { source: 'lexical_cue', classifierOperation: input.verdict?.operationKey ?? null, classifierFallback: input.verdict?.fallback ?? null }
            : {}),
        threshold: REQUIRED_READS_CONFIDENCE_THRESHOLD,
        outcome: input.gate.run ? input.run?.outcome ?? 'nothing_to_run' : 'skipped',
        ...(input.gate.run ? {} : { reason: input.gate.reason }),
        ...(slotNames.length ? { slots: slotNames } : {}),
        reads: (input.run?.reads ?? []).map(read => ({
            tool: read.tool, status: read.status,
            ...(read.latencyMs !== undefined ? { latencyMs: read.latencyMs } : {}),
            ...(read.rows !== undefined ? { rows: read.rows, complete: read.complete } : {}),
            ...(read.total !== undefined ? { total: read.total } : {}),
            ...(read.error ? { error: read.error } : {}),
        })),
        readsLatencyMs: input.run?.latencyMs ?? 0,
        latencyMs: input.latencyMs,
    };
}
