import {
    handoffNoticeLanguage, handoffNoticeText, isHandoffNoticeKind,
    type HandoffNoticeKind, type HandoffNoticeLanguage,
} from './handoff-notice';

/**
 * Canonical durable receipt of a handoff, bound to the exact inbound message and
 * to the exact transition it caused.
 *
 * Why a row and not the existing state: the Redis key `hoff_<timestamp>` and the
 * `metadata.handoff` blob describe that a conversation is with a person, but
 * neither names the inbound that caused it, neither survives as proof once the
 * conversation is handed back, and both are reachable by any writer of public
 * conversation metadata. A deterministic notice that must be admitted into a
 * conversation a person now owns needs an authority that cannot be forged from
 * outside and cannot be replayed onto a different turn.
 *
 * Two properties do the real work:
 *
 *   - `inbound_message_id` is UNIQUE. One inbound can transfer a conversation at
 *     most once, so recovering the notice never repeats the transfer, and a
 *     replayed webhook cannot escalate the same message twice.
 *   - `from_status` is read under the conversation row lock in the same
 *     transaction that performs the transition, and the table refuses to store a
 *     row whose `from_status` is already human-owned or terminal. A receipt is
 *     therefore proof that the agent still owned the conversation when this turn
 *     started, which is what makes admitting the answer of that same turn
 *     bounded rather than an arbitrary injection into a human conversation.
 *
 * The notice text is never stored here. The receipt names a kind and a language;
 * the words are derived from the closed catalogue at admission time.
 */
export type HandoffReceiptQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SCHEMA = /^tenant_[a-z0-9_]+$/;
const MAX_REASON = 500;

/** A person owns the conversation. A receipt may only ever transition INTO these. */
export const HANDOFF_HUMAN_STATUSES: readonly string[] = Object.freeze(['waiting_human', 'with_human']);
/** Nobody is expected to answer. A receipt may never transition OUT OF these. */
export const HANDOFF_TERMINAL_STATUSES: readonly string[] = Object.freeze(['resolved', 'archived', 'closed']);

/**
 * Bootstrap outside any privacy or authority transaction, like the widget reply
 * tables. No foreign key to messages, contacts or conversations: erasure removes
 * the words, and this row must survive as the deduplication fact that stops a
 * replayed inbound from transferring the same conversation a second time.
 */
export const HANDOFF_RECEIPT_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS agent_handoff_receipts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL,
        contact_id UUID NOT NULL,
        inbound_message_id UUID NOT NULL UNIQUE,
        channel_type TEXT NOT NULL,
        channel_account_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        notice_kind TEXT NOT NULL,
        notice_language TEXT NOT NULL,
        trace_id TEXT,
        effects JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT agent_handoff_receipts_to_status
            CHECK (to_status IN ('waiting_human','with_human')),
        CONSTRAINT agent_handoff_receipts_from_status
            CHECK (from_status NOT IN ('waiting_human','with_human','resolved','archived','closed')),
        CONSTRAINT agent_handoff_receipts_notice_kind
            CHECK (notice_kind IN ('queue_head','transferring','inbox_notice','none')),
        CONSTRAINT agent_handoff_receipts_notice_language
            CHECK (notice_language IN ('es','en','pt','fr'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_handoff_receipts_conversation
        ON agent_handoff_receipts(conversation_id, created_at DESC)`,
]);

export interface HandoffReceipt {
    readonly id: string;
    readonly conversationId: string;
    readonly contactId: string;
    readonly inboundMessageId: string;
    /** Recorded from the locked conversation row, not from a caller claim. */
    readonly channelType: string;
    readonly channelAccountId: string;
    readonly reason: string;
    readonly fromStatus: string;
    readonly toStatus: string;
    readonly noticeKind: HandoffNoticeKind;
    readonly noticeLanguage: HandoffNoticeLanguage;
    readonly traceId: string | null;
    /**
     * Which side effects of this transfer already completed.
     *
     * Receipt, status and note commit together, but assignment, the inbox
     * announcement and the notification happen after. A crash in that window
     * used to leave a receipt that made every later attempt return immediately,
     * so nobody was ever assigned and nobody was ever told. Each phase records
     * itself here so a resumed transfer finishes what is missing and repeats
     * nothing that already happened.
     */
    readonly effects: Readonly<Record<string, unknown>>;
}

export const HANDOFF_EFFECT_KEYS = ['assignment', 'cache', 'announced', 'notified'] as const;
export type HandoffEffectKey = (typeof HANDOFF_EFFECT_KEYS)[number];

export interface HandoffReceiptRequest {
    readonly contactId: string;
    readonly inboundMessageId: string;
    readonly noticeKind: HandoffNoticeKind;
    readonly noticeLanguage: HandoffNoticeLanguage;
}

export interface HandoffReceiptLookup {
    readonly conversationId: string;
    readonly contactId: string;
    readonly inboundMessageId: string;
}

/**
 * A concurrent turn already recorded the transfer for this exact inbound. The
 * transition transaction must roll back rather than repeat notes, assignment and
 * notifications; the caller recovers the winning receipt with a fresh read.
 */
export class HandoffReceiptAlreadyRecorded extends Error {
    readonly code = 'handoff_receipt_already_recorded';
    constructor() { super('handoff_receipt_already_recorded'); }
}
/** The stored receipt does not describe the conversation or contact supplied. */
export class HandoffReceiptBindingChanged extends Error {
    readonly code = 'handoff_receipt_binding_changed';
    constructor() { super('handoff_receipt_binding_changed'); }
}

function mapReceipt(row: any): HandoffReceipt {
    if (!row || !isHandoffNoticeKind(row.notice_kind)) throw new HandoffReceiptBindingChanged();
    return Object.freeze({
        id: String(row.id),
        conversationId: String(row.conversation_id),
        contactId: String(row.contact_id),
        inboundMessageId: String(row.inbound_message_id),
        channelType: String(row.channel_type),
        channelAccountId: String(row.channel_account_id),
        reason: String(row.reason),
        fromStatus: String(row.from_status),
        toStatus: String(row.to_status),
        noticeKind: row.notice_kind,
        noticeLanguage: handoffNoticeLanguage(row.notice_language),
        traceId: row.trace_id === null || row.trace_id === undefined ? null : String(row.trace_id),
        effects: Object.freeze(row.effects && typeof row.effects === 'object' && !Array.isArray(row.effects)
            ? { ...row.effects } : {}),
    });
}

/** The words a receipt authorizes. Null only for the `none` kind. */
export function handoffReceiptNotice(receipt: HandoffReceipt): string | null {
    return handoffNoticeText(receipt.noticeKind, receipt.noticeLanguage);
}

/**
 * Record the transfer on the SAME transaction that performs the transition, and
 * before it: `from_status` must be the value the conversation still had when the
 * agent decided to escalate. No schema resolution, lazy DDL, provider call or
 * nested transaction belongs here.
 */
export async function recordHandoffReceipt(query: HandoffReceiptQuery, schema: string, input: {
    conversationId: string; toStatus: string; reason: string; traceId?: string | null;
} & HandoffReceiptRequest): Promise<HandoffReceipt> {
    if (!SCHEMA.test(schema) || !input
        || ![input.conversationId, input.contactId, input.inboundMessageId].every(id => UUID.test(String(id)))
        || !isHandoffNoticeKind(input.noticeKind)
        || !HANDOFF_HUMAN_STATUSES.includes(input.toStatus)
        || typeof input.reason !== 'string' || !input.reason.trim()) {
        throw new HandoffReceiptBindingChanged();
    }
    // The reason is evidence, not authority. A long one (a procedure name, an
    // approved tool label) is truncated rather than allowed to abort a transfer
    // the customer is already waiting on.
    const reason = input.reason.slice(0, MAX_REASON);
    const language = handoffNoticeLanguage(input.noticeLanguage);
    const [conversation] = await query<any[]>(
        `SELECT id, contact_id, channel_type, channel_account_id, status
         FROM conversations WHERE id = $1::uuid FOR UPDATE`, [input.conversationId]);
    if (!conversation || String(conversation.contact_id) !== input.contactId) throw new HandoffReceiptBindingChanged();
    const fromStatus = String(conversation.status || 'active');
    // A conversation a person already owns cannot be transferred again, and a
    // closed one has nobody waiting. Both are refused here and by the CHECK.
    if (HANDOFF_HUMAN_STATUSES.includes(fromStatus) || HANDOFF_TERMINAL_STATUSES.includes(fromStatus))
        throw new HandoffReceiptBindingChanged();
    // The inbound must already be persisted: a receipt naming a message that
    // never landed could not be recovered, and would leave the notice unbounded.
    const [inbound] = await query<any[]>(
        `SELECT id FROM messages WHERE id = $1::uuid AND conversation_id = $2::uuid
         AND direction = 'inbound' FOR SHARE`, [input.inboundMessageId, input.conversationId]);
    if (!inbound) throw new HandoffReceiptBindingChanged();
    const [inserted] = await query<any[]>(
        `INSERT INTO agent_handoff_receipts(conversation_id, contact_id, inbound_message_id, channel_type,
            channel_account_id, reason, from_status, to_status, notice_kind, notice_language, trace_id)
         VALUES($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (inbound_message_id) DO NOTHING RETURNING *`,
        [input.conversationId, input.contactId, input.inboundMessageId,
            String(conversation.channel_type), String(conversation.channel_account_id),
            reason, fromStatus, input.toStatus, input.noticeKind, language,
            input.traceId === undefined || input.traceId === null ? null : String(input.traceId).slice(0, 128)]);
    if (!inserted) throw new HandoffReceiptAlreadyRecorded();
    return mapReceipt(inserted);
}

/**
 * Record that one side effect of a transfer completed.
 *
 * Written per phase, immediately after the phase, so a crash costs at most the
 * phase in flight. An `unknown` value is deliberate and terminal for that phase:
 * a notification whose outcome was never confirmed must not be sent again.
 */
export async function markHandoffEffect(query: HandoffReceiptQuery, schema: string,
    receiptId: string, key: HandoffEffectKey, value: unknown): Promise<void> {
    if (!SCHEMA.test(schema) || !UUID.test(String(receiptId))
        || !HANDOFF_EFFECT_KEYS.includes(key)) throw new HandoffReceiptBindingChanged();
    await query(
        `UPDATE agent_handoff_receipts
         SET effects = jsonb_set(COALESCE(effects, '{}'::jsonb), $2::text[], $3::jsonb, true)
         WHERE id = $1::uuid`,
        // `null` is a real answer here — "nobody was assigned" — so only an
        // absent value defaults to true. `value ?? true` erased that distinction.
        [receiptId, [key], JSON.stringify(value === undefined ? true : value)]);
}

/**
 * Recover an existing receipt. Absence means this inbound never transferred the
 * conversation, never that a transfer is safe to repeat under a new authority.
 */
export async function readHandoffReceipt(query: HandoffReceiptQuery, schema: string,
    lookup: HandoffReceiptLookup): Promise<HandoffReceipt | null> {
    if (!SCHEMA.test(schema) || !lookup
        || ![lookup.conversationId, lookup.contactId, lookup.inboundMessageId].every(id => UUID.test(String(id))))
        throw new HandoffReceiptBindingChanged();
    const [row] = await query<any[]>(
        'SELECT * FROM agent_handoff_receipts WHERE inbound_message_id = $1::uuid', [lookup.inboundMessageId]);
    if (!row) return null;
    if (String(row.conversation_id) !== lookup.conversationId || String(row.contact_id) !== lookup.contactId)
        throw new HandoffReceiptBindingChanged();
    return mapReceipt(row);
}
