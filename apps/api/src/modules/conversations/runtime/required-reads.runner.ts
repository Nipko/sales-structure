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
import { getOperation, TOOL_READ_ERROR_CODES, type OperationDefinition, type OperationReadProjection } from '@parallext/shared';
import { readFailed } from '../../../common/contracts/tool-read-result.util';
import { toolBatchRequiresSequentialExecution } from '../tool-policy-registry';
import { isFailedToolResult } from '../trusted-price-context';
import { OPERATION_CONFIDENCE_THRESHOLD, type OperationShadowVerdict } from './operation-classifier.service';

export type RequiredReadsPilot = 'restaurants' | 'catalog';

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

/** Industry (prefix of the subtype profile id) each pilot is limited to. */
export const REQUIRED_READS_PILOT_INDUSTRY: Readonly<Record<RequiredReadsPilot, string>> = Object.freeze({
    restaurants: 'restaurantes',
    catalog: 'retail',
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
});

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
});

/** Record statuses after which an order is no longer "the one in progress". */
const CLOSED_STATUSES = new Set(['cancelled', 'canceled', 'delivered', 'completed', 'rejected', 'refunded', 'failed', 'expired', 'closed']);

/** What the model is told when a required read broke: an admission, never "none". */
const ADMIT_MESSAGE = 'No pude consultar esta información en este momento. No digas que no hay registros: di que no pudiste consultarlo y ofrece intentarlo de nuevo o pasar con una persona.';

export function requiredReadsPilotForProfile(profileId: string | null | undefined): RequiredReadsPilot | null {
    const industry = typeof profileId === 'string' ? profileId.split('/')[0] : '';
    const match = (Object.keys(REQUIRED_READS_PILOT_INDUSTRY) as RequiredReadsPilot[]).find(p => REQUIRED_READS_PILOT_INDUSTRY[p] === industry);
    return match ?? null;
}

export type RequiredReadsSkipReason =
    | 'no_verdict'
    | `fallback:${string}`
    | 'below_threshold'
    | 'not_pilot_operation'
    | 'pilot_mismatch';

export type RequiredReadsGate =
    | { run: true; operation: OperationDefinition; pilot: RequiredReadsPilot }
    | { run: false; reason: RequiredReadsSkipReason };

/** Whether this verdict moves the turn into forced reads. Pure. */
export function requiredReadsGate(verdict: OperationShadowVerdict | null | undefined, pilot: RequiredReadsPilot): RequiredReadsGate {
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
    | 'upstream_failed';

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
}

interface ReceiptRef { tool: string; container: string; field: string }

function parseReceipt(source: string): ReceiptRef[] {
    return source.split('|').flatMap(part => {
        const match = /^receipt:([a-z0-9_]+)\.([A-Za-z0-9_]+)\[\]\.([A-Za-z0-9_]+)$/.exec(part.trim());
        return match ? [{ tool: match[1], container: match[2], field: match[3] }] : [];
    });
}

/**
 * The one record id a receipt names: the only row, or the only still-open row.
 * `null` with a reason when there is none or more than one.
 */
export function pickReceiptId(result: any, ref: ReceiptRef): { id: string } | { reason: 'no_receipt' | 'ambiguous_receipt' } {
    const rows: any[] = Array.isArray(result?.[ref.container]) ? result[ref.container] : [];
    const ids = (list: any[]) => list.map(row => row?.[ref.field]).filter((id): id is string => typeof id === 'string' && !!id.trim());
    const all = ids(rows);
    if (!all.length) return { reason: 'no_receipt' };
    if (all.length === 1) return { id: all[0] };
    const open = ids(rows.filter(row => typeof row?.status !== 'string' || !CLOSED_STATUSES.has(row.status.toLowerCase())));
    return open.length === 1 ? { id: open[0] } : { reason: 'ambiguous_receipt' };
}

/** The list of a customer-records read, with its completeness made explicit for the model and the ledger. */
export function withListEvidence(name: string, args: Record<string, unknown>, result: any): { result: any; rows?: number; complete?: boolean; total?: number } {
    if (!result || typeof result !== 'object' || isFailedToolResult(result) || !/^list_/.test(name)) return { result };
    const entry = Object.entries(result).find(([, value]) => Array.isArray(value));
    if (!entry) return { result };
    const rows = (entry[1] as unknown[]).length;
    const limit = Number(args.limit);
    const complete = typeof result.hasMore === 'boolean' ? !result.hasMore
        : typeof result.total === 'number' ? result.total === rows
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

    const plan = operation.requiredReads.map(read => {
        const receipts = Object.entries(read.argsFrom).flatMap(([arg, source]) => {
            const refs = parseReceipt(source);
            return refs.length ? [{ arg, refs }] : [];
        });
        return { read, receipts };
    });

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
        const args = { ...(DEFAULT_ARGS[read.tool] ?? {}) };
        if (!published.has(read.tool)) { reads.push({ tool: read.tool, args, status: 'unpublished' }); continue; }
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
        let blocked: RequiredReadStatus | null = null;
        for (const { arg, refs } of receipts) {
            const ref = refs.find(candidate => answers.has(candidate.tool));
            if (!ref) {
                blocked = refs.some(candidate => failed.has(candidate.tool)) ? 'upstream_failed' : 'no_receipt';
                break;
            }
            const picked = pickReceiptId(answers.get(ref.tool), ref);
            if ('reason' in picked) { blocked = picked.reason; break; }
            args[arg] = picked.id;
        }
        if (blocked) { reads.push({ tool: read.tool, args, status: blocked }); continue; }
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
}): Record<string, unknown> {
    return {
        pilot: input.pilot,
        operation: input.verdict?.operationKey ?? null,
        confidence: input.verdict?.confidence ?? null,
        threshold: REQUIRED_READS_CONFIDENCE_THRESHOLD,
        outcome: input.gate.run ? input.run?.outcome ?? 'nothing_to_run' : 'skipped',
        ...(input.gate.run ? {} : { reason: input.gate.reason }),
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
