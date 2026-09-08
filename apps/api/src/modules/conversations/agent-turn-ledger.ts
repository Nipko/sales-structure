import type { RuntimeLearningFootprint } from '../learning/learning-runtime-footprint';

/**
 * The durable record of what one inbound message produced.
 *
 * Redis held the words of an interrupted turn and nothing else, so a crash
 * between generating and dispatching replayed the text and lost the payment
 * link, the pictures, the learned sources and the identity of the writers that
 * had already run. Those are not decorations of the answer: the link is the
 * result of a tool receipt and the pictures were requested by id. An answer
 * that arrives without them is a different answer.
 *
 * This table is the authority. A row exists before the model is asked anything,
 * so a replay can tell "nothing ran yet" from "the writers ran and the answer
 * was never delivered", and the envelope is written before a single effect
 * leaves the process. Redis stays as a cache in front of it and is never
 * consulted to decide whether business may run again.
 */

export type TurnLedgerQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

export const TURN_LEDGER_STATES = ['open', 'result_recorded', 'dispatch_owned', 'settled'] as const;
export type TurnLedgerState = (typeof TURN_LEDGER_STATES)[number];

/** How the envelope reached the customer, or why it did not. */
export const TURN_DELIVERY_ROUTES = ['unknown', 'durable', 'legacy', 'draft', 'none'] as const;
export type TurnDeliveryRoute = (typeof TURN_DELIVERY_ROUTES)[number];

/**
 * No foreign key to messages or contacts: erasure clears the payload and the
 * row survives as the fact that stops a replay from re-running a turn. Bootstrap
 * outside every privacy or admission transaction.
 */
export const TURN_LEDGER_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS agent_turn_ledger (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        inbound_message_id UUID NOT NULL UNIQUE,
        conversation_id UUID NOT NULL,
        contact_id UUID NOT NULL,
        channel_type TEXT NOT NULL,
        channel_account_id TEXT,
        recipient TEXT,
        provider_message_id TEXT,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        agent_id UUID,
        agent_version INTEGER,
        operational_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
        envelope JSONB,
        writers JSONB NOT NULL DEFAULT '[]'::jsonb,
        handoff JSONB,
        delivery_route TEXT NOT NULL DEFAULT 'unknown',
        redacted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT agent_turn_ledger_state
            CHECK (state IN ('open','result_recorded','dispatch_owned','settled')),
        CONSTRAINT agent_turn_ledger_route
            CHECK (delivery_route IN ('unknown','durable','legacy','draft','none')),
        CONSTRAINT agent_turn_ledger_attempts CHECK (attempts >= 1),
        CONSTRAINT agent_turn_ledger_result
            CHECK (state = 'open' OR envelope IS NOT NULL OR redacted_at IS NOT NULL)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_turn_ledger_conversation
        ON agent_turn_ledger(conversation_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_turn_ledger_contact
        ON agent_turn_ledger(contact_id) WHERE redacted_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_agent_turn_ledger_unsettled
        ON agent_turn_ledger(updated_at) WHERE state <> 'settled'`,
]);

export interface TurnBinding {
    readonly conversationId: string;
    readonly contactId: string;
    readonly inboundMessageId: string;
    readonly channelType: string;
    readonly channelAccountId?: string | null;
    readonly recipient?: string | null;
    readonly providerMessageId?: string | null;
}

/** Exactly what the customer is owed for this inbound, effects included. */
export interface TurnEnvelope {
    readonly text: string;
    readonly chunks: readonly string[];
    readonly paymentLinks: readonly string[];
    readonly media: readonly { url: string; caption?: string }[];
    readonly learningFootprints: readonly RuntimeLearningFootprint[];
    /** The interactive form a turn can send instead of words. */
    readonly flow?: Record<string, any> | null;
}

/** One business effect this turn already produced. Identity, not description. */
export interface TurnWriterRecord {
    readonly tool: string;
    readonly status: 'succeeded' | 'failed' | 'uncertain';
    readonly ledgerId?: string | null;
    /** The business object the writer produced, when it named one. */
    readonly receipt?: string | null;
}

export interface TurnHandoffRecord {
    readonly receiptId?: string | null;
    readonly reason?: string | null;
    readonly noticeKind?: string | null;
}

export interface TurnLedgerRow {
    readonly id: string;
    readonly state: TurnLedgerState;
    readonly attempts: number;
    readonly binding: TurnBinding | null;
    readonly agentId: string | null;
    readonly agentVersion: number | null;
    readonly operationalScope: Record<string, any>;
    readonly envelope: TurnEnvelope | null;
    readonly writers: readonly TurnWriterRecord[];
    readonly handoff: TurnHandoffRecord | null;
    readonly deliveryRoute: TurnDeliveryRoute;
    readonly redacted: boolean;
    readonly createdAt: Date;
}

export class TurnLedgerError extends Error {
    constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new TurnLedgerError(code); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normaliseEnvelope(value: any): TurnEnvelope | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.text !== 'string') return null;
    const chunks = Array.isArray(value.chunks) ? value.chunks.filter((c: any) => typeof c === 'string') : [];
    const paymentLinks = Array.isArray(value.paymentLinks)
        ? value.paymentLinks.filter((c: any) => typeof c === 'string') : [];
    const media = Array.isArray(value.media)
        ? value.media.filter((entry: any) => entry && typeof entry.url === 'string')
            .map((entry: any) => Object.freeze(entry.caption === undefined || entry.caption === null
                ? { url: String(entry.url) }
                : { url: String(entry.url), caption: String(entry.caption) }))
        : [];
    const learningFootprints = Array.isArray(value.learningFootprints) ? value.learningFootprints : [];
    const flow = value.flow && typeof value.flow === 'object' && !Array.isArray(value.flow)
        && typeof value.flow.flowId === 'string' && typeof value.flow.flowToken === 'string'
        ? Object.freeze({ ...value.flow }) : null;
    return Object.freeze({
        text: value.text,
        chunks: Object.freeze(chunks.map(String)),
        paymentLinks: Object.freeze(paymentLinks.map(String)),
        media: Object.freeze(media),
        learningFootprints: Object.freeze(learningFootprints),
        flow,
    }) as TurnEnvelope;
}

function normaliseWriters(value: any): readonly TurnWriterRecord[] {
    if (!Array.isArray(value)) return Object.freeze([]);
    return Object.freeze(value
        .filter(entry => entry && typeof entry.tool === 'string')
        .map(entry => Object.freeze({
            tool: String(entry.tool),
            status: (['succeeded', 'failed', 'uncertain'].includes(entry.status) ? entry.status : 'uncertain') as TurnWriterRecord['status'],
            ledgerId: entry.ledgerId ? String(entry.ledgerId) : null,
            receipt: entry.receipt ? String(entry.receipt) : null,
        })));
}

function mapRow(row: any): TurnLedgerRow {
    const redacted = !!row.redacted_at;
    return Object.freeze({
        id: String(row.id),
        state: row.state as TurnLedgerState,
        attempts: Number(row.attempts),
        binding: redacted ? null : Object.freeze({
            conversationId: String(row.conversation_id),
            contactId: String(row.contact_id),
            inboundMessageId: String(row.inbound_message_id),
            channelType: String(row.channel_type),
            channelAccountId: row.channel_account_id ?? null,
            recipient: row.recipient ?? null,
            providerMessageId: row.provider_message_id ?? null,
        }),
        agentId: row.agent_id ?? null,
        agentVersion: row.agent_version === null || row.agent_version === undefined ? null : Number(row.agent_version),
        operationalScope: row.operational_scope || {},
        envelope: redacted ? null : normaliseEnvelope(row.envelope),
        writers: normaliseWriters(row.writers),
        handoff: row.handoff && typeof row.handoff === 'object' ? Object.freeze(row.handoff) : null,
        deliveryRoute: (TURN_DELIVERY_ROUTES as readonly string[]).includes(row.delivery_route)
            ? row.delivery_route as TurnDeliveryRoute : 'unknown',
        redacted,
        createdAt: new Date(row.created_at),
    });
}

function assertBinding(binding: TurnBinding): void {
    if (!UUID.test(binding.inboundMessageId || '')) fail('turn_ledger_inbound_invalid');
    if (!UUID.test(binding.conversationId || '')) fail('turn_ledger_conversation_invalid');
    if (!UUID.test(binding.contactId || '')) fail('turn_ledger_contact_invalid');
    if (!binding.channelType) fail('turn_ledger_channel_invalid');
}

/**
 * Claim this inbound. A second attempt returns the row the first one left, with
 * its attempt count raised — the caller learns from the returned state whether
 * anything already ran, before it asks a model or a tool for anything.
 *
 * The binding is compared, not overwritten: a row whose conversation, contact,
 * channel, account or recipient differs from the caller's is a different turn
 * wearing the same message id, and inheriting its envelope would send one
 * customer's answer to another.
 */
export async function openTurnLedger(query: TurnLedgerQuery, schema: string,
    binding: TurnBinding): Promise<TurnLedgerRow> {
    assertBinding(binding);
    const rows = await query<any[]>(
        `INSERT INTO "${schema}".agent_turn_ledger
            (inbound_message_id, conversation_id, contact_id, channel_type,
             channel_account_id, recipient, provider_message_id, state)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,'open')
         ON CONFLICT (inbound_message_id) DO UPDATE
            SET attempts = "${schema}".agent_turn_ledger.attempts + 1, updated_at = NOW()
         RETURNING *`,
        [binding.inboundMessageId, binding.conversationId, binding.contactId, binding.channelType,
            binding.channelAccountId ?? null, binding.recipient ?? null, binding.providerMessageId ?? null]);
    const row = mapRow(rows[0]);
    if (row.binding && (row.binding.conversationId !== binding.conversationId
        || row.binding.contactId !== binding.contactId
        || row.binding.channelType !== binding.channelType
        || (row.binding.channelAccountId ?? null) !== (binding.channelAccountId ?? null)
        || (row.binding.recipient ?? null) !== (binding.recipient ?? null))) fail('turn_ledger_binding_mismatch');
    return row;
}

export async function readTurnLedger(query: TurnLedgerQuery, schema: string,
    inboundMessageId: string): Promise<TurnLedgerRow | null> {
    if (!UUID.test(inboundMessageId || '')) fail('turn_ledger_inbound_invalid');
    const rows = await query<any[]>(
        `SELECT * FROM "${schema}".agent_turn_ledger WHERE inbound_message_id = $1::uuid`,
        [inboundMessageId]);
    return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * Write the whole result before any of it is delivered.
 *
 * The first result wins. A second attempt that generated its own answer before
 * discovering this row keeps the stored one: two answers to one message is the
 * defect this table exists to prevent, and the stored one is the only one the
 * customer may already have started receiving.
 */
export async function recordTurnResult(query: TurnLedgerQuery, schema: string, input: {
    inboundMessageId: string;
    envelope: TurnEnvelope;
    writers?: readonly TurnWriterRecord[];
    agentId?: string | null;
    agentVersion?: number | null;
    operationalScope?: Record<string, any>;
}): Promise<TurnLedgerRow> {
    if (!UUID.test(input.inboundMessageId || '')) fail('turn_ledger_inbound_invalid');
    if (!input.envelope || typeof input.envelope.text !== 'string') fail('turn_ledger_envelope_invalid');
    // A turn that produced nothing at all has nothing to recover, and recording
    // it would let a replay adopt an empty answer as the final one.
    if (!input.envelope.text && !input.envelope.chunks.length && !input.envelope.paymentLinks.length
        && !input.envelope.media.length && !input.envelope.flow) fail('turn_ledger_envelope_empty');
    const rows = await query<any[]>(
        `UPDATE "${schema}".agent_turn_ledger
            SET envelope = $2::jsonb, writers = $3::jsonb, agent_id = $4::uuid,
                agent_version = $5, operational_scope = $6::jsonb,
                state = 'result_recorded', updated_at = NOW()
          WHERE inbound_message_id = $1::uuid AND state = 'open' AND redacted_at IS NULL
          RETURNING *`,
        [input.inboundMessageId, JSON.stringify(input.envelope), JSON.stringify(input.writers ?? []),
            input.agentId && UUID.test(input.agentId) ? input.agentId : null,
            input.agentVersion ?? null, JSON.stringify(input.operationalScope ?? {})]);
    if (rows[0]) return mapRow(rows[0]);
    const current = await readTurnLedger(query, schema, input.inboundMessageId);
    if (!current) fail('turn_ledger_missing');
    return current as TurnLedgerRow;
}

/** Record which path owns delivery. Never moves a settled turn backwards. */
export async function recordTurnDelivery(query: TurnLedgerQuery, schema: string, input: {
    inboundMessageId: string; route: TurnDeliveryRoute;
}): Promise<TurnLedgerRow | null> {
    if (!UUID.test(input.inboundMessageId || '')) fail('turn_ledger_inbound_invalid');
    if (!(TURN_DELIVERY_ROUTES as readonly string[]).includes(input.route)) fail('turn_ledger_route_invalid');
    const rows = await query<any[]>(
        `UPDATE "${schema}".agent_turn_ledger
            SET delivery_route = $2,
                state = CASE WHEN state = 'settled' THEN state ELSE 'dispatch_owned' END,
                updated_at = NOW()
          WHERE inbound_message_id = $1::uuid
          RETURNING *`, [input.inboundMessageId, input.route]);
    return rows[0] ? mapRow(rows[0]) : null;
}

export async function recordTurnHandoff(query: TurnLedgerQuery, schema: string, input: {
    inboundMessageId: string; handoff: TurnHandoffRecord;
}): Promise<TurnLedgerRow | null> {
    if (!UUID.test(input.inboundMessageId || '')) fail('turn_ledger_inbound_invalid');
    const rows = await query<any[]>(
        `UPDATE "${schema}".agent_turn_ledger
            SET handoff = $2::jsonb, updated_at = NOW()
          WHERE inbound_message_id = $1::uuid RETURNING *`,
        [input.inboundMessageId, JSON.stringify(input.handoff || {})]);
    return rows[0] ? mapRow(rows[0]) : null;
}

/** The turn is over. Equivalent in meaning to the Redis marker, and durable. */
export async function settleTurnLedger(query: TurnLedgerQuery, schema: string,
    inboundMessageId: string): Promise<TurnLedgerRow | null> {
    if (!UUID.test(inboundMessageId || '')) fail('turn_ledger_inbound_invalid');
    const rows = await query<any[]>(
        `UPDATE "${schema}".agent_turn_ledger
            SET state = 'settled', updated_at = NOW()
          WHERE inbound_message_id = $1::uuid RETURNING *`, [inboundMessageId]);
    return rows[0] ? mapRow(rows[0]) : null;
}

export interface TurnLedgerRedactionScope {
    readonly contactId?: string;
    readonly releaseId?: string;
}

/**
 * Erasure reaches the envelope like it reaches the outbox: the words, the
 * links, the pictures and the learned sources go, the row stays. A release
 * withdrawal clears only the turns that derived from it.
 */
export async function redactTurnLedger(query: TurnLedgerQuery, schema: string,
    scope: TurnLedgerRedactionScope): Promise<number> {
    if (scope.contactId && !UUID.test(scope.contactId)) fail('turn_ledger_contact_invalid');
    if (scope.releaseId && !UUID.test(scope.releaseId)) fail('turn_ledger_release_invalid');
    if (!scope.contactId && !scope.releaseId) fail('turn_ledger_redaction_scope_required');
    const rows = await query<any[]>(
        `UPDATE "${schema}".agent_turn_ledger
            SET envelope = NULL, writers = '[]'::jsonb, handoff = NULL,
                recipient = NULL, provider_message_id = NULL,
                redacted_at = COALESCE(redacted_at, NOW()), updated_at = NOW()
          WHERE redacted_at IS NULL
            AND ($1::uuid IS NULL OR contact_id = $1::uuid)
            AND ($2::uuid IS NULL OR envelope -> 'learningFootprints' @> $3::jsonb)
          RETURNING id`,
        [scope.contactId ?? null, scope.releaseId ?? null,
            JSON.stringify([{ entries: [{ releaseId: scope.releaseId ?? null }] }])]);
    return rows.length;
}
