/**
 * One row per handoff effect and destination.
 *
 * The receipt carried a single `effects` object with four aggregate keys, and
 * `announced` was one boolean covering a fan-out to six different consumers:
 * the inbox socket, an external CRM, tenant webhooks, web push, Slack and SMS.
 * With `emitAsync`, one consumer failing rejects the whole call, so the flag is
 * never written and a resumed transfer announces itself to all six again — a
 * second Slack message, a second CRM note, a second paid SMS. With `emit`, the
 * flag can be written before anyone knows whether the consumers finished at
 * all. An aggregate boolean cannot say what happened to each destination, so it
 * cannot authorise repeating one without repeating the rest.
 *
 * These rows can. Identity is `(receipt, destination)`; `admitted` is
 * permission for exactly ONE attempt and commits before the external call; and
 * an admitted lease that runs out does not become available again — the effect
 * may have happened, so it becomes `unknown` and waits for a person, the same
 * invariant the dispatch outbox holds.
 */

export type HandoffEffectQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

export const HANDOFF_EFFECT_DESTINATIONS = [
    'assignment', 'cache', 'inbox', 'crm', 'webhooks', 'push', 'slack', 'sms', 'email',
] as const;
export type HandoffEffectDestination = (typeof HANDOFF_EFFECT_DESTINATIONS)[number];

export const HANDOFF_EFFECT_STATES = ['prepared', 'admitted', 'accepted', 'rejected', 'unknown'] as const;
export type HandoffEffectState = (typeof HANDOFF_EFFECT_STATES)[number];

/** Nothing may attempt these again: the effect happened, or nobody can say. */
export const HANDOFF_EFFECT_TERMINAL_STATES: readonly HandoffEffectState[] =
    Object.freeze(['accepted', 'unknown']);

export const HANDOFF_EFFECT_LEASE_SECONDS = 120;

export const HANDOFF_EFFECTS_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS agent_handoff_effects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        receipt_id UUID NOT NULL,
        destination TEXT NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_token UUID,
        lease_expires_at TIMESTAMPTZ,
        receipt TEXT,
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT agent_handoff_effects_identity UNIQUE (receipt_id, destination),
        CONSTRAINT agent_handoff_effects_state
            CHECK (state IN ('prepared','admitted','accepted','rejected','unknown')),
        CONSTRAINT agent_handoff_effects_destination
            CHECK (destination IN ('assignment','cache','inbox','crm','webhooks','push','slack','sms','email')),
        CONSTRAINT agent_handoff_effects_attempts CHECK (attempts >= 0),
        CONSTRAINT agent_handoff_effects_lease
            CHECK ((state = 'admitted') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_handoff_effects_receipt
        ON agent_handoff_effects(receipt_id, destination)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_handoff_effects_unsettled
        ON agent_handoff_effects(updated_at) WHERE state NOT IN ('accepted','unknown')`,
]);

export interface HandoffEffectRow {
    readonly id: string;
    readonly destination: HandoffEffectDestination;
    readonly state: HandoffEffectState;
    readonly attempts: number;
    /** What the destination gave back: an agent id, a cache id, an SMTP id. */
    readonly receipt: string | null;
    readonly errorCode: string | null;
}

export type HandoffEffectOutcome =
    | { kind: 'accepted'; receipt?: string | null }
    | { kind: 'rejected'; errorCode: string }
    | { kind: 'unknown'; errorCode: string };

export class HandoffEffectError extends Error {
    constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new HandoffEffectError(code); };

const SCHEMA = /^tenant_[a-z0-9_]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapRow(row: any): HandoffEffectRow {
    return Object.freeze({
        id: String(row.id),
        destination: row.destination as HandoffEffectDestination,
        state: row.state as HandoffEffectState,
        attempts: Number(row.attempts),
        receipt: row.receipt ?? null,
        errorCode: row.error_code ?? null,
    });
}

/**
 * Written with the transition, not after it.
 *
 * The list of what this transfer owes exists the moment the transfer does, so a
 * process that dies before reaching any of them still leaves the work behind
 * where recovery can find it.
 */
export async function prepareHandoffEffects(query: HandoffEffectQuery, schema: string,
    receiptId: string, destinations: readonly HandoffEffectDestination[]): Promise<void> {
    if (!SCHEMA.test(schema) || !UUID.test(String(receiptId))) fail('handoff_effect_invalid_reference');
    const wanted = [...new Set(destinations)];
    if (!wanted.length || wanted.some(value => !HANDOFF_EFFECT_DESTINATIONS.includes(value))) {
        fail('handoff_effect_invalid_destination');
    }
    await query(
        `INSERT INTO agent_handoff_effects (receipt_id, destination, state)
         SELECT $1::uuid, destination, 'prepared' FROM unnest($2::text[]) AS destination
         ON CONFLICT (receipt_id, destination) DO NOTHING`,
        [receiptId, wanted]);
}

export async function readHandoffEffects(query: HandoffEffectQuery, schema: string,
    receiptId: string): Promise<readonly HandoffEffectRow[]> {
    if (!SCHEMA.test(schema) || !UUID.test(String(receiptId))) fail('handoff_effect_invalid_reference');
    const rows = await query<any[]>(
        'SELECT * FROM agent_handoff_effects WHERE receipt_id = $1::uuid ORDER BY destination', [receiptId]);
    return Object.freeze(rows.map(mapRow));
}

/**
 * Permission for exactly one attempt, committed before the attempt happens.
 *
 * Returns the row, and the CALLER checks whether it was granted: a row that
 * comes back in any state other than `admitted` was not. That shape exists
 * because of the lapsed-lease case, which has to WRITE — the previous holder
 * may have reached the destination and died before it could say so, so the row
 * becomes `unknown` and stays there. Throwing that refusal, as this used to,
 * rolled the transition back with it whenever the caller wrapped the call in a
 * transaction, and the row sat `admitted` behind a dead lease forever: safe,
 * because every later admission still refused, but invisible, because nobody
 * ever learned the effect was uncertain.
 *
 * The refusals that need no write still throw.
 */
export async function admitHandoffEffect(query: HandoffEffectQuery, schema: string, input: {
    receiptId: string; destination: HandoffEffectDestination;
    leaseToken: string; leaseSeconds?: number;
}): Promise<HandoffEffectRow> {
    if (!SCHEMA.test(schema) || !UUID.test(String(input?.receiptId)) || !UUID.test(String(input?.leaseToken))
        || !HANDOFF_EFFECT_DESTINATIONS.includes(input?.destination)) fail('handoff_effect_invalid_reference');
    const seconds = Number(input.leaseSeconds ?? HANDOFF_EFFECT_LEASE_SECONDS);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) fail('handoff_effect_invalid_reference');

    const [row] = await query<any[]>(
        `SELECT *, (lease_expires_at IS NOT NULL AND lease_expires_at <= NOW()) AS lease_expired
         FROM agent_handoff_effects WHERE receipt_id = $1::uuid AND destination = $2 FOR UPDATE`,
        [input.receiptId, input.destination]);
    if (!row) fail('handoff_effect_unprepared');
    if (HANDOFF_EFFECT_TERMINAL_STATES.includes(row.state)) return mapRow(row);
    if (row.state === 'admitted') {
        if (!row.lease_expired) fail('handoff_effect_leased');
        // The attempt that held this lease may have reached the destination, so
        // the row becomes uncertain and is RETURNED rather than thrown: a throw
        // from here takes its own transition down with it.
        const [abandoned] = await query<any[]>(
            `UPDATE agent_handoff_effects
                SET state='unknown', lease_token=NULL, lease_expires_at=NULL,
                    error_code=COALESCE(error_code,'lease_expired_after_admission'), updated_at=NOW()
              WHERE id=$1::uuid RETURNING *`, [row.id]);
        return mapRow(abandoned);
    }
    const [admitted] = await query<any[]>(
        `UPDATE agent_handoff_effects
            SET state='admitted', attempts = attempts + 1, lease_token=$2::uuid,
                lease_expires_at = NOW() + make_interval(secs => $3::double precision), updated_at=NOW()
          WHERE id=$1::uuid RETURNING *`, [row.id, input.leaseToken, seconds]);
    return mapRow(admitted);
}

/**
 * The result of an attempt that already happened. Never discarded: a settle
 * that cannot be written leaves the row `admitted`, and the expiry of that
 * lease is what turns it into `unknown` instead of into a second attempt.
 */
export async function settleHandoffEffect(query: HandoffEffectQuery, schema: string, input: {
    receiptId: string; destination: HandoffEffectDestination;
    leaseToken: string; outcome: HandoffEffectOutcome;
}): Promise<HandoffEffectRow> {
    if (!SCHEMA.test(schema) || !UUID.test(String(input?.receiptId)) || !UUID.test(String(input?.leaseToken))
        || !HANDOFF_EFFECT_DESTINATIONS.includes(input?.destination)) fail('handoff_effect_invalid_reference');
    const outcome = input.outcome;
    if (!outcome || !['accepted', 'rejected', 'unknown'].includes(outcome.kind)) fail('handoff_effect_invalid_outcome');

    const [row] = await query<any[]>(
        `SELECT * FROM agent_handoff_effects
          WHERE receipt_id = $1::uuid AND destination = $2 FOR UPDATE`, [input.receiptId, input.destination]);
    if (!row) fail('handoff_effect_unprepared');
    // A lease that is no longer ours settled elsewhere; saying so twice would
    // overwrite the answer whoever holds it is about to write. The receipt is
    // still evidence, though — an acceptance that arrives after its lease
    // lapsed is the only record that the destination was reached, and dropping
    // it sends an operator looking for it by hand.
    if (row.state !== 'admitted' || row.lease_token !== input.leaseToken) {
        // An acceptance whose lease lapsed carries the only record that the
        // destination was reached, and dropping it sends an operator looking for
        // it by hand. It is recorded and the CURRENT row returned — throwing
        // here would roll the record back with the refusal, which is the same
        // mistake the admission used to make with its own `unknown` transition.
        if (outcome.kind === 'accepted' && typeof outcome.receipt === 'string' && outcome.receipt && !row.receipt) {
            const [kept] = await query<any[]>(
                'UPDATE agent_handoff_effects SET receipt=$2, updated_at=NOW() WHERE id=$1::uuid RETURNING *',
                [row.id, outcome.receipt.slice(0, 300)]);
            return mapRow(kept);
        }
        fail(`handoff_effect_not_leased:${row.state}`);
    }

    const state: HandoffEffectState = outcome.kind === 'accepted' ? 'accepted'
        : outcome.kind === 'unknown' ? 'unknown' : 'rejected';
    const receipt = outcome.kind === 'accepted' && typeof outcome.receipt === 'string'
        ? outcome.receipt.slice(0, 300) : null;
    const errorCode = outcome.kind === 'accepted' ? null : String(outcome.errorCode || outcome.kind).slice(0, 120);
    const [settled] = await query<any[]>(
        `UPDATE agent_handoff_effects
            SET state=$2, receipt=$3, error_code=$4, lease_token=NULL, lease_expires_at=NULL, updated_at=NOW()
          WHERE id=$1::uuid RETURNING *`, [row.id, state, receipt, errorCode]);
    return mapRow(settled);
}

/** Rows an operator has to decide on: the destination may or may not have run. */
export async function readUncertainHandoffEffects(query: HandoffEffectQuery, schema: string,
    limit = 50): Promise<readonly (HandoffEffectRow & { receiptId: string; updatedAt: Date })[]> {
    if (!SCHEMA.test(schema)) fail('handoff_effect_invalid_reference');
    const rows = await query<any[]>(
        `SELECT * FROM agent_handoff_effects WHERE state = 'unknown'
          ORDER BY updated_at ASC LIMIT $1`, [Math.min(Math.max(Number(limit) || 50, 1), 200)]);
    return Object.freeze(rows.map(row => Object.freeze({
        ...mapRow(row), receiptId: String(row.receipt_id), updatedAt: new Date(row.updated_at),
    })));
}

/** The six consumers the single `announced` flag used to cover between them. */
export const HANDOFF_ANNOUNCEMENT_DESTINATIONS: readonly HandoffEffectDestination[] =
    Object.freeze(['inbox', 'crm', 'webhooks', 'push', 'slack', 'sms']);

/**
 * The four aggregate keys the receipt has always carried, recomputed from the
 * rows in the transaction that settles one.
 *
 * They stay because the resume gate and the widget notice read them, but they
 * are a projection now: the rows are the authority, and nothing decides from
 * this object whether an effect may run. `announced` only appears once every
 * consumer it stood for has finished, which is the claim it was making all
 * along and could not support.
 */
export async function projectHandoffEffects(query: HandoffEffectQuery, schema: string,
    receiptId: string): Promise<void> {
    const rows = await readHandoffEffects(query, schema, receiptId);
    const byName = new Map(rows.map(row => [row.destination, row]));
    const settled = (destination: HandoffEffectDestination) => {
        const row = byName.get(destination);
        return !!row && HANDOFF_EFFECT_TERMINAL_STATES.includes(row.state);
    };
    const projection: Record<string, unknown> = {};
    if (settled('assignment')) projection.assignment = byName.get('assignment')!.receipt ?? null;
    if (settled('cache')) projection.cache = byName.get('cache')!.receipt ?? true;
    const announced = HANDOFF_ANNOUNCEMENT_DESTINATIONS.filter(destination => byName.has(destination));
    if (announced.length && announced.every(settled)) projection.announced = true;
    if (settled('email')) {
        const row = byName.get('email')!;
        projection.notified = row.receipt ?? (row.state === 'unknown' ? 'unknown' : true);
    }
    if (!Object.keys(projection).length) return;
    await query(
        `UPDATE agent_handoff_receipts SET effects = COALESCE(effects, '{}'::jsonb) || $2::jsonb
          WHERE id = $1::uuid`, [receiptId, JSON.stringify(projection)]);
}

/**
 * Turn permissions nobody settled into uncertainty a person can see.
 *
 * A transfer that dies holding a permission leaves the row `admitted` behind a
 * lease that will never be renewed. Every later admission refuses it, so nothing
 * is repeated — but nothing surfaces either, and `readUncertainHandoffEffects`
 * never sees it. This is the pass that moves it, and it is deliberately the
 * same shape as `expireDispatchLeases`: an expired permission becomes uncertain,
 * never available again.
 */
export async function expireHandoffEffectLeases(query: HandoffEffectQuery, schema: string,
    limit = 200): Promise<number> {
    if (!SCHEMA.test(schema)) fail('handoff_effect_invalid_reference');
    const [present] = await query<any[]>('SELECT to_regclass($1)::text AS name', [`${schema}.agent_handoff_effects`]);
    if (!present?.name) return 0;
    const rows = await query<any[]>(
        `UPDATE agent_handoff_effects
            SET state='unknown', lease_token=NULL, lease_expires_at=NULL,
                error_code=COALESCE(error_code,'lease_expired_after_admission'), updated_at=NOW()
          WHERE id IN (
              SELECT id FROM agent_handoff_effects
               WHERE state='admitted' AND lease_expires_at IS NOT NULL AND lease_expires_at <= NOW()
               ORDER BY lease_expires_at ASC LIMIT $1)
          RETURNING id`, [Math.min(Math.max(Number(limit) || 200, 1), 500)]);
    return rows.length;
}
