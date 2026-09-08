/**
 * Durable outbox for the normal outbound turn.
 *
 * Today a turn enqueues the whole payload into Redis and calls saveAiMessage
 * separately, so a failure can leave one of the two writes; the job carries the
 * recipient and the words outside the storage erasure governs; a lost Redis
 * acknowledgement can produce two jobs; and the only thing standing between a
 * re-run job and a second delivery is a marker written after the provider
 * answered. None of that can say, durably, whether one concrete attempt was
 * authorized or what came back from it.
 *
 * This table is that record. One row per remote effect — never per call, because
 * a Messenger image and its caption are two POSTs and one receipt cannot
 * describe both. A row is the only thing that authorizes an attempt, and its
 * state is the only thing that says what happened.
 *
 * Three rules the states exist to keep:
 *
 *   - `admitted` is permission for ONE concrete attempt. When its lease expires
 *     the row does not become available again: the attempt may have reached the
 *     provider, so it becomes `reconciliation_required`. Silence is not evidence
 *     of failure, and a stale permission is never a fresh one.
 *   - `attempts` is incremented in the admission transaction, which commits
 *     before the external call. A rolled-back send therefore cannot reset the
 *     count and loop forever.
 *   - An accepted receipt is a historical fact. It can be read without passing
 *     the guards meant for a NEW admission, and no later check turns it back
 *     into a retryable failure.
 */
export type DispatchOutboxQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SCHEMA = /^tenant_[a-z0-9_]+$/;
/** Bounded preflight failures. A definite refusal must not retry forever. */
export const DISPATCH_MAX_ATTEMPTS = 5;

export const DISPATCH_ITEM_KINDS = ['text', 'media', 'payment_link', 'flow'] as const;
export type DispatchItemKind = (typeof DISPATCH_ITEM_KINDS)[number];

export const DISPATCH_STATES = [
    'prepared', 'queued', 'admitted', 'sent', 'stored', 'suppressed', 'failed', 'reconciliation_required',
] as const;
export type DispatchState = (typeof DISPATCH_STATES)[number];

/** No new admission may be granted from these. */
export const DISPATCH_TERMINAL_STATES: readonly DispatchState[] =
    Object.freeze(['sent', 'stored', 'suppressed', 'reconciliation_required']);
/** A row here is eligible for a new admission, subject to attempts and time. */
export const DISPATCH_AVAILABLE_STATES: readonly DispatchState[] =
    Object.freeze(['prepared', 'queued', 'failed']);

/**
 * Bootstrap outside any privacy or admission transaction. No cascading contact
 * or message foreign key: erasure clears the payload, and the row must survive
 * as the fact that stops a recovered job from delivering the same effect twice.
 */
export const DISPATCH_OUTBOX_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS agent_dispatch_outbox (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id UUID NOT NULL,
        conversation_id UUID,
        contact_id UUID,
        inbound_message_id UUID NOT NULL,
        channel_type TEXT NOT NULL,
        channel_account_id TEXT NOT NULL,
        recipient TEXT,
        item_index INTEGER NOT NULL,
        item_kind TEXT NOT NULL,
        payload JSONB,
        operational_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
        learning_footprint JSONB,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_token UUID,
        lease_expires_at TIMESTAMPTZ,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        error_code TEXT,
        receipt TEXT,
        settled_lease_token UUID,
        message_id UUID,
        redacted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT agent_dispatch_outbox_identity UNIQUE (inbound_message_id, item_index),
        CONSTRAINT agent_dispatch_outbox_state
            CHECK (state IN ('prepared','queued','admitted','sent','stored','suppressed','failed','reconciliation_required')),
        CONSTRAINT agent_dispatch_outbox_kind
            CHECK (item_kind IN ('text','media','payment_link','flow')),
        CONSTRAINT agent_dispatch_outbox_item_index CHECK (item_index >= 0),
        CONSTRAINT agent_dispatch_outbox_lease
            CHECK ((state = 'admitted') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
        CONSTRAINT agent_dispatch_outbox_redaction
            CHECK (redacted_at IS NOT NULL OR (conversation_id IS NOT NULL AND contact_id IS NOT NULL
                AND recipient IS NOT NULL AND payload IS NOT NULL))
    )`,
    `CREATE TABLE IF NOT EXISTS agent_dispatch_outbox_sources (
        dispatch_id UUID NOT NULL REFERENCES agent_dispatch_outbox(id) ON DELETE CASCADE,
        source_id UUID NOT NULL, source_contact_id UUID,
        PRIMARY KEY (dispatch_id, source_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_pending
        ON agent_dispatch_outbox(available_at, id)
        WHERE state IN ('prepared','queued','failed')`,
    `CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_lease
        ON agent_dispatch_outbox(lease_expires_at) WHERE state = 'admitted'`,
    `CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_batch
        ON agent_dispatch_outbox(batch_id, item_index)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_contact
        ON agent_dispatch_outbox(contact_id) WHERE redacted_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_sources_source
        ON agent_dispatch_outbox_sources(source_id, dispatch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_sources_contact
        ON agent_dispatch_outbox_sources(source_contact_id, dispatch_id)`,
]);

export interface DispatchBinding {
    readonly conversationId: string;
    readonly contactId: string;
    readonly inboundMessageId: string;
    readonly channelType: string;
    readonly channelAccountId: string;
    readonly recipient: string;
}

export interface DispatchItem {
    readonly kind: DispatchItemKind;
    /** Exactly one remote effect. Immutable once prepared. */
    readonly payload: Record<string, any>;
}

export interface DispatchRow {
    readonly id: string;
    /** The history row this effect was recorded as, in the same transaction. */
    readonly messageId: string | null;
    readonly batchId: string;
    readonly itemIndex: number;
    readonly itemKind: DispatchItemKind;
    readonly state: DispatchState;
    readonly attempts: number;
    readonly receipt: string | null;
    readonly errorCode: string | null;
    /** When this row may next be admitted. PostgreSQL is the only scheduler. */
    readonly availableAt: Date;
    readonly redacted: boolean;
    readonly binding: DispatchBinding | null;
    readonly payload: Record<string, any> | null;
    readonly operationalScope: Record<string, any>;
    readonly learningFootprint: any[] | null;
}

export class DispatchOutboxError extends Error {
    constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new DispatchOutboxError(code); };

function mapRow(row: any): DispatchRow {
    const redacted = row.redacted_at !== null && row.redacted_at !== undefined;
    return Object.freeze({
        id: String(row.id),
        messageId: row.message_id ? String(row.message_id) : null,
        batchId: String(row.batch_id),
        itemIndex: Number(row.item_index),
        itemKind: row.item_kind,
        state: row.state,
        attempts: Number(row.attempts),
        receipt: row.receipt ?? null,
        errorCode: row.error_code ?? null,
        availableAt: row.available_at instanceof Date ? row.available_at : new Date(row.available_at),
        redacted,
        binding: redacted ? null : Object.freeze({
            conversationId: String(row.conversation_id),
            contactId: String(row.contact_id),
            inboundMessageId: String(row.inbound_message_id),
            channelType: String(row.channel_type),
            channelAccountId: String(row.channel_account_id),
            recipient: String(row.recipient),
        }),
        payload: redacted ? null : row.payload,
        operationalScope: row.operational_scope || {},
        learningFootprint: Array.isArray(row.learning_footprint) ? row.learning_footprint : null,
    });
}

/** What the inbox shows for one effect. A Flow is recorded by its body text. */
function historyContent(item: DispatchItem): { contentType: string; text: string | null; mediaUrl: string | null } {
    const payload = item.payload || {};
    if (item.kind === 'media') {
        const requested = String(payload.mediaType ?? 'image');
        return {
            contentType: ['image', 'document', 'audio', 'video'].includes(requested) ? requested : 'image',
            text: null, mediaUrl: String(payload.mediaUrl ?? '') || null,
        };
    }
    return { contentType: 'text', text: String(payload.text ?? '') || null, mediaUrl: null };
}

function validBinding(binding: DispatchBinding): boolean {
    return !!binding
        && [binding.conversationId, binding.contactId, binding.inboundMessageId].every(id => UUID.test(String(id)))
        && typeof binding.channelType === 'string' && /^[a-z_]{2,40}$/.test(binding.channelType)
        && typeof binding.channelAccountId === 'string' && !!binding.channelAccountId.trim() && binding.channelAccountId.length <= 300
        && typeof binding.recipient === 'string' && !!binding.recipient.trim() && binding.recipient.length <= 300;
}

/**
 * Record the whole batch and its pending history in ONE transaction, before any
 * job identifier reaches BullMQ. Re-preparing the same inbound returns what was
 * already recorded: the words and their order belong to the original result, not
 * to whichever attempt happens to run next.
 */
export async function prepareDispatchBatch(query: DispatchOutboxQuery, schema: string, input: {
    binding: DispatchBinding;
    items: readonly DispatchItem[];
    operationalScope: Record<string, any>;
    learningFootprint?: readonly any[];
    sources?: readonly { id: string; sourceContactId?: string | null }[];
}): Promise<{ batchId: string; rows: DispatchRow[] }> {
    if (!SCHEMA.test(schema) || !input || !validBinding(input.binding)
        || !Array.isArray(input.items) || !input.items.length || input.items.length > 32
        || input.items.some(item => !item || !DISPATCH_ITEM_KINDS.includes(item.kind)
            || !item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload))
        || !input.operationalScope || typeof input.operationalScope !== 'object') fail('dispatch_invalid_batch');
    // Rows that do not exist yet cannot be locked, so two turns preparing the
    // same inbound would both insert and one would surface a raw unique
    // violation. Serialize them on the inbound itself: the loser then sees the
    // winner's batch and returns it, which is the same answer a replay gets.
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
        [`dispatch-batch:${schema}:${input.binding.inboundMessageId}`]);
    const existing = await query<any[]>(
        `SELECT * FROM agent_dispatch_outbox WHERE inbound_message_id = $1::uuid ORDER BY item_index
         FOR UPDATE`, [input.binding.inboundMessageId]);
    if (existing.length) {
        const rows = existing.map(mapRow);
        // A different shape for the same inbound means two different results are
        // claiming one turn. Neither may silently replace the other.
        if (rows.length !== input.items.length
            || rows.some((row, index) => row.itemKind !== input.items[index].kind)) fail('dispatch_batch_conflict');
        return { batchId: rows[0].batchId, rows };
    }
    // The inbound must already be persisted, so a recovered batch can always be
    // tied back to the customer message that caused it.
    const [inbound] = await query<any[]>(
        `SELECT id FROM messages WHERE id = $1::uuid AND conversation_id = $2::uuid
         AND direction = 'inbound' FOR SHARE`,
        [input.binding.inboundMessageId, input.binding.conversationId]);
    if (!inbound) fail('dispatch_inbound_unavailable');
    const [conversation] = await query<any[]>(
        'SELECT id FROM conversations WHERE id = $1::uuid AND contact_id = $2::uuid FOR SHARE',
        [input.binding.conversationId, input.binding.contactId]);
    if (!conversation) fail('dispatch_binding_changed');
    const footprint = Array.isArray(input.learningFootprint) ? input.learningFootprint : [];
    const sources = [...new Map((input.sources || []).map(source => [String(source.id), source])).values()];
    if (sources.some(source => !UUID.test(String(source.id))
        || (source.sourceContactId != null && !UUID.test(String(source.sourceContactId))))) fail('dispatch_invalid_batch');
    const rows: DispatchRow[] = [];
    const [identifiers] = await query<any[]>(
        `SELECT gen_random_uuid() AS batch_id, to_regclass($1)::text AS dedupe_index`,
        [`${schema}.uidx_messages_external_id`]);
    const batchId = identifiers.batch_id, dedupeIndex = !!identifiers.dedupe_index;
    for (const [index, item] of input.items.entries()) {
        // History and dispatch commit together. They used to be two independent
        // writes, so a failure could leave one of them; and the history row said
        // 'delivered' before anything had been sent. It now says 'pending' until
        // a provider actually accepts the effect it describes.
        const externalId = `out:dispatch:${input.binding.inboundMessageId}:${index}`;
        const content = historyContent(item);
        const columns = `INSERT INTO messages(conversation_id, direction, content_type, content_text, media_url,
                status, external_id, created_at)
             VALUES($1::uuid,'outbound',$2,$3,$4,'pending',$5,NOW())`;
        const values = [input.binding.conversationId, content.contentType, content.text, content.mediaUrl, externalId];
        // uidx_messages_external_id is PARTIAL, and Postgres only matches a
        // partial index when ON CONFLICT repeats its predicate. It is checked
        // rather than attempted: a failed statement aborts the whole
        // transaction, so there is no catching it and trying again in here. A
        // schema whose index lagged the deploy loses this second line of
        // defence, never the reply — the outbox identity is the first line, and
        // re-preparing the same inbound returns before ever reaching this.
        const [message] = await query<any[]>(
            dedupeIndex ? `${columns} ON CONFLICT ("external_id") WHERE "external_id" IS NOT NULL DO NOTHING RETURNING id`
                : `${columns} RETURNING id`,
            values);
        const [{ id: messageId }] = message
            ? [message]
            : await query<any[]>('SELECT id FROM messages WHERE external_id=$1 AND conversation_id=$2::uuid',
                [externalId, input.binding.conversationId]);
        if (!messageId) fail('dispatch_history_unavailable');
        const [inserted] = await query<any[]>(
            `INSERT INTO agent_dispatch_outbox(batch_id, conversation_id, contact_id, inbound_message_id,
                channel_type, channel_account_id, recipient, item_index, item_kind, payload,
                operational_scope, learning_footprint, message_id, state)
             VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::uuid,'prepared')
             RETURNING *`,
            [batchId, input.binding.conversationId, input.binding.contactId, input.binding.inboundMessageId,
                input.binding.channelType, input.binding.channelAccountId, input.binding.recipient,
                index, item.kind, JSON.stringify(item.payload),
                JSON.stringify(input.operationalScope), JSON.stringify(footprint), messageId]);
        for (const source of sources) {
            await query(`INSERT INTO agent_dispatch_outbox_sources(dispatch_id, source_id, source_contact_id)
                VALUES($1::uuid,$2::uuid,$3::uuid)`,
            [inserted.id, source.id, source.sourceContactId ?? null]);
        }
        rows.push(mapRow(inserted));
    }
    return { batchId: String(batchId), rows };
}

/**
 * The canonical question: does a batch already own the answer to this inbound?
 *
 * It must be answerable before anything else a turn decides, and independently
 * of any rollout switch. A batch that committed keeps the reply forever: if the
 * switch is later turned off, or a lost COMMIT acknowledgement makes a producer
 * believe nothing was written, the only thing standing between the customer and
 * two copies of the same answer is this lookup.
 *
 * `null` means no batch exists. It never means "could not tell": an unreadable
 * answer throws, so a caller cannot mistake uncertainty for absence.
 *
 * The recorded payload wins, but the binding is checked rather than trusted: a
 * batch describing another conversation, contact, channel, account or recipient
 * is a conflict to refuse, not a result to deliver.
 */
export async function readDispatchBatchForInbound(query: DispatchOutboxQuery, schema: string,
    binding: DispatchBinding): Promise<DispatchRow[] | null> {
    if (!SCHEMA.test(schema) || !validBinding(binding)) fail('dispatch_invalid_reference');
    const [tables] = await query<any[]>(
        'SELECT current_schema() AS schema, to_regclass($1)::text AS outbox',
        [`${schema}.agent_dispatch_outbox`]);
    if (tables?.schema !== schema) fail('dispatch_invalid_reference');
    // A tenant that never took this path has no table, and therefore no batch.
    if (!tables.outbox) return null;
    const rows = await query<any[]>(
        `SELECT * FROM agent_dispatch_outbox WHERE inbound_message_id = $1::uuid ORDER BY item_index`,
        [binding.inboundMessageId]);
    if (!rows.length) return null;
    const mapped = rows.map(mapRow);
    if (new Set(rows.map(row => String(row.batch_id))).size !== 1) fail('dispatch_batch_conflict');
    // Contiguous from zero: a gap means a partially recorded result, which must
    // not be delivered as if it were the whole answer.
    if (mapped.some((row, index) => row.itemIndex !== index)) fail('dispatch_batch_conflict');
    for (const row of mapped) {
        // A redacted row keeps no binding to compare; erasure already removed it,
        // and the batch still owns the reply so nothing is sent a second time.
        if (row.redacted) continue;
        const stored = row.binding!;
        if (stored.conversationId !== binding.conversationId || stored.contactId !== binding.contactId
            || stored.inboundMessageId !== binding.inboundMessageId
            || stored.channelType !== binding.channelType
            || stored.channelAccountId !== binding.channelAccountId
            || stored.recipient !== binding.recipient) fail('dispatch_batch_binding_changed');
    }
    return mapped;
}

/**
 * Read one row without applying any guard meant for a new admission. An accepted
 * receipt must stay consultable: it is what tells a recovered job to stop.
 */
export async function readDispatchRow(query: DispatchOutboxQuery, schema: string,
    dispatchId: string): Promise<DispatchRow | null> {
    if (!SCHEMA.test(schema) || !UUID.test(String(dispatchId))) fail('dispatch_invalid_reference');
    const [row] = await query<any[]>('SELECT * FROM agent_dispatch_outbox WHERE id = $1::uuid', [dispatchId]);
    return row ? mapRow(row) : null;
}

/**
 * Grant permission for ONE attempt, on the caller's transaction, after it has
 * checked privacy, tenant, connection authority and sources with the same query.
 * The caller performs the external call only after observing this COMMIT.
 */
export async function admitDispatch(query: DispatchOutboxQuery, schema: string, input: {
    dispatchId: string; leaseToken: string; leaseSeconds: number;
}): Promise<DispatchRow> {
    if (!SCHEMA.test(schema) || !UUID.test(String(input?.dispatchId)) || !UUID.test(String(input?.leaseToken))
        || !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 5 || input.leaseSeconds > 900)
        fail('dispatch_invalid_reference');
    // Both deadlines are evaluated by the database clock, in the same statement
    // that locks the row: an application clock skewed against PostgreSQL must
    // never be what decides that a permission is still alive.
    const [row] = await query<any[]>(
        `SELECT *, (lease_expires_at IS NOT NULL AND lease_expires_at > NOW()) AS lease_active,
            (available_at > NOW()) AS waiting_backoff
         FROM agent_dispatch_outbox WHERE id = $1::uuid FOR UPDATE`, [input.dispatchId]);
    if (!row) fail('dispatch_unavailable');
    if (row.redacted_at) fail('dispatch_redacted');
    const state: DispatchState = row.state;
    if (DISPATCH_TERMINAL_STATES.includes(state)) fail(`dispatch_terminal:${state}`);
    if (state === 'admitted') {
        // The previous permission may have reached the provider. A lease that ran
        // out is missing information, not proof that nothing happened.
        if (row.lease_active === true) fail('dispatch_lease_active');
        // Deliberately no write here. This transaction is about to be rolled
        // back by the refusal, so the transition would be lost; and moving a
        // row nobody reconciled, from inside somebody else's admission attempt,
        // would also destroy the lease evidence a reconciler needs.
        fail('dispatch_reconciliation_required');
    }
    if (Number(row.attempts) >= DISPATCH_MAX_ATTEMPTS) {
        await query(`UPDATE agent_dispatch_outbox SET state='suppressed', error_code='attempts_exhausted',
            updated_at=NOW() WHERE id=$1::uuid`, [input.dispatchId]);
        fail('dispatch_attempts_exhausted');
    }
    if (row.waiting_backoff === true) fail('dispatch_not_available_yet');
    const [admitted] = await query<any[]>(
        `UPDATE agent_dispatch_outbox SET state='admitted', lease_token=$2::uuid,
            lease_expires_at=NOW() + make_interval(secs => $3::double precision), attempts=attempts+1,
            error_code=NULL, updated_at=NOW()
         WHERE id=$1::uuid RETURNING *`,
        [input.dispatchId, input.leaseToken, input.leaseSeconds]);
    return mapRow(admitted);
}

export type DispatchOutcome =
    | { kind: 'sent'; receipt: string }
    | { kind: 'failed'; errorCode: string; retryInSeconds?: number }
    | { kind: 'suppressed'; errorCode: string }
    | { kind: 'reconciliation_required'; errorCode: string };

/**
 * Record what one admitted attempt produced, keyed to that exact lease. A lease
 * somebody else replaced cannot write an outcome, and an already accepted
 * receipt is never downgraded by a late failure report.
 */
export async function settleDispatch(query: DispatchOutboxQuery, schema: string, input: {
    dispatchId: string; leaseToken: string; outcome: DispatchOutcome;
}): Promise<DispatchRow> {
    if (!SCHEMA.test(schema) || !UUID.test(String(input?.dispatchId)) || !UUID.test(String(input?.leaseToken))
        || !input.outcome) fail('dispatch_invalid_reference');
    const [row] = await query<any[]>(
        'SELECT * FROM agent_dispatch_outbox WHERE id = $1::uuid FOR UPDATE', [input.dispatchId]);
    if (!row) fail('dispatch_unavailable');
    // Acceptance already recorded for this attempt: report it, never resend and
    // never rewrite it as a failure a later check happened to observe.
    if (row.state === 'sent' && row.settled_lease_token === input.leaseToken) return mapRow(row);
    if (row.state !== 'admitted' || row.lease_token !== input.leaseToken) fail('dispatch_lease_lost');
    const outcome = input.outcome;
    // The history row follows the real outcome, not the hope. It was written
    // 'pending' at prepare; only an accepted receipt makes it delivered, and a
    // definitely refused effect is marked failed rather than left looking sent.
    const markHistory = async (status: string) => {
        if (!row.message_id) return;
        await query(`UPDATE messages SET status=$2 WHERE id=$1::uuid AND status<>'redacted'`,
            [row.message_id, status]);
    };
    if (outcome.kind === 'sent') {
        if (typeof outcome.receipt !== 'string' || !outcome.receipt.trim() || outcome.receipt.length > 300)
            fail('dispatch_receipt_required');
        const [sent] = await query<any[]>(
            `UPDATE agent_dispatch_outbox SET state='sent', receipt=$2, error_code=NULL,
                settled_lease_token=lease_token, lease_token=NULL, lease_expires_at=NULL, updated_at=NOW()
             WHERE id=$1::uuid RETURNING *`, [input.dispatchId, outcome.receipt.trim()]);
        await markHistory('delivered');
        return mapRow(sent);
    }
    const errorCode = String(outcome.errorCode || 'unknown').slice(0, 120);
    if (outcome.kind === 'failed') {
        // Exhausting the budget here rather than leaving a row that looks
        // retryable forever: the count already survived the rolled-back send.
        const exhausted = Number(row.attempts) >= DISPATCH_MAX_ATTEMPTS;
        const delay = Math.min(Math.max(Number(outcome.retryInSeconds ?? 30), 0), 3600);
        const [failed] = await query<any[]>(
            `UPDATE agent_dispatch_outbox SET state=$3, error_code=$2, settled_lease_token=lease_token,
                lease_token=NULL, lease_expires_at=NULL,
                available_at=NOW() + make_interval(secs => $4::double precision), updated_at=NOW()
             WHERE id=$1::uuid RETURNING *`,
            [input.dispatchId, errorCode, exhausted ? 'suppressed' : 'failed', exhausted ? 0 : delay]);
        if (exhausted) await markHistory('failed');
        return mapRow(failed);
    }
    const [settled] = await query<any[]>(
        `UPDATE agent_dispatch_outbox SET state=$3, error_code=$2, settled_lease_token=lease_token,
            lease_token=NULL, lease_expires_at=NULL, updated_at=NOW() WHERE id=$1::uuid RETURNING *`,
        [input.dispatchId, errorCode, outcome.kind]);
    // An uncertain outcome stays 'pending' on purpose: claiming failure would be
    // as wrong as claiming delivery when the provider may well have acted.
    if (outcome.kind === 'suppressed') await markHistory('failed');
    return mapRow(settled);
}

/**
 * Rows a recovery pass may re-publish. An `admitted` row whose lease ran out is
 * deliberately NOT here: it needs reconciliation, not another attempt.
 */
export async function readPendingDispatch(query: DispatchOutboxQuery, schema: string,
    limit = 100): Promise<DispatchRow[]> {
    if (!SCHEMA.test(schema) || !Number.isInteger(limit) || limit < 1 || limit > 1000)
        fail('dispatch_invalid_reference');
    const rows = await query<any[]>(
        `SELECT * FROM agent_dispatch_outbox
         WHERE state IN ('prepared','queued','failed') AND redacted_at IS NULL AND available_at <= NOW()
         ORDER BY available_at, id LIMIT $1`, [limit]);
    return rows.map(mapRow);
}

/**
 * Record a failure that happened BEFORE any permission was granted — no
 * credential, no entitlement, no transport for this channel.
 *
 * It spends an attempt on purpose. A preflight that keeps failing must run out
 * the same budget as a failed send, otherwise a rolled-back attempt leaves a row
 * that looks retryable forever and recovery loops on it without end.
 */
export async function recordDispatchPreflightFailure(query: DispatchOutboxQuery, schema: string, input: {
    dispatchId: string; errorCode: string; retryInSeconds?: number; permanent?: boolean;
}): Promise<DispatchRow> {
    if (!SCHEMA.test(schema) || !UUID.test(String(input?.dispatchId))
        || typeof input.errorCode !== 'string' || !input.errorCode.trim()) fail('dispatch_invalid_reference');
    const [row] = await query<any[]>(
        'SELECT * FROM agent_dispatch_outbox WHERE id = $1::uuid FOR UPDATE', [input.dispatchId]);
    if (!row) fail('dispatch_unavailable');
    // A permission already granted is not a preflight. Its outcome belongs to
    // whoever holds the lease, and its lapse belongs to the reconciliation pass.
    if (row.state === 'admitted') fail('dispatch_lease_active');
    if (DISPATCH_TERMINAL_STATES.includes(row.state as DispatchState)) fail(`dispatch_terminal:${row.state}`);
    const attempts = Number(row.attempts) + 1;
    const exhausted = input.permanent === true || attempts >= DISPATCH_MAX_ATTEMPTS;
    const delay = Math.min(Math.max(Number(input.retryInSeconds ?? 30), 0), 3600);
    const [updated] = await query<any[]>(
        `UPDATE agent_dispatch_outbox SET state=$3, attempts=$4, error_code=$2,
            available_at=NOW() + make_interval(secs => $5::double precision), updated_at=NOW()
         WHERE id=$1::uuid RETURNING *`,
        [input.dispatchId, String(input.errorCode).slice(0, 120),
            exhausted ? 'suppressed' : 'failed', attempts, exhausted ? 0 : delay]);
    return mapRow(updated);
}

/**
 * Move permissions whose lease ran out into reconciliation. This is a committed
 * pass of its own, never a side effect of somebody else's admission attempt:
 * the attempt these rows describe may have reached the provider, and the lease
 * they carried is evidence a reconciler needs. They never become available again.
 */
export async function expireDispatchLeases(query: DispatchOutboxQuery, schema: string,
    limit = 100): Promise<DispatchRow[]> {
    if (!SCHEMA.test(schema) || !Number.isInteger(limit) || limit < 1 || limit > 1000)
        fail('dispatch_invalid_reference');
    const rows = await query<any[]>(
        `UPDATE agent_dispatch_outbox SET state='reconciliation_required',
            settled_lease_token=lease_token, error_code='lease_expired_after_admission',
            lease_token=NULL, lease_expires_at=NULL, updated_at=NOW()
         WHERE id IN (
            SELECT id FROM agent_dispatch_outbox WHERE state='admitted' AND lease_expires_at <= NOW()
            ORDER BY lease_expires_at, id LIMIT $1 FOR UPDATE SKIP LOCKED)
         RETURNING *`, [limit]);
    return rows.map(mapRow);
}

/** Mark a prepared row as published to the work queue. Never a permission. */
export async function markDispatchQueued(query: DispatchOutboxQuery, schema: string,
    dispatchIds: readonly string[]): Promise<number> {
    if (!SCHEMA.test(schema) || !Array.isArray(dispatchIds)
        || dispatchIds.some(id => !UUID.test(String(id)))) fail('dispatch_invalid_reference');
    if (!dispatchIds.length) return 0;
    const rows = await query<any[]>(
        `UPDATE agent_dispatch_outbox SET state='queued', updated_at=NOW()
         WHERE id=ANY($1::uuid[]) AND state='prepared' RETURNING id`, [[...dispatchIds]]);
    return rows.length;
}

export interface DispatchRedactionScope {
    contactIds?: string[];
    sourceIds?: string[];
    releaseIds?: string[];
}

/**
 * Redact on the caller's SAME tenant transaction, under the exclusive privacy
 * fence, exactly like the Web Chat reply copies. The row identity and its state
 * survive: a late finalizer must still find the fact that stops a resend, and a
 * recovered job must not repopulate a payload erasure removed.
 */
export async function redactDispatchOutbox(query: DispatchOutboxQuery, schema: string,
    input: DispatchRedactionScope): Promise<number> {
    const contactIds = [...new Set(input?.contactIds || [])].sort();
    const sourceIds = [...new Set(input?.sourceIds || [])].sort();
    const releaseIds = [...new Set(input?.releaseIds || [])].sort();
    if (!SCHEMA.test(schema) || [...contactIds, ...sourceIds, ...releaseIds].some(id => !UUID.test(id)))
        fail('dispatch_redaction_scope_invalid');
    if (!contactIds.length && !sourceIds.length && !releaseIds.length) return 0;
    const [tables] = await query<any[]>(`SELECT current_schema() AS schema,
        to_regclass($1)::text AS outbox, to_regclass($2)::text AS sources`,
    [`${schema}.agent_dispatch_outbox`, `${schema}.agent_dispatch_outbox_sources`]);
    if (tables?.schema !== schema) fail('dispatch_redaction_scope_invalid');
    if (!tables.outbox) return 0;
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
    // A missing source index beside an existing outbox is a partial migration,
    // not evidence that no derived payload exists.
    if (!tables.sources) fail('dispatch_source_index_unavailable');
    const rows = await query<any[]>(`SELECT d.id FROM agent_dispatch_outbox d
        WHERE d.redacted_at IS NULL AND (
            d.contact_id=ANY($1::uuid[])
            OR EXISTS(SELECT 1 FROM agent_dispatch_outbox_sources s WHERE s.dispatch_id=d.id
                AND (s.source_contact_id=ANY($1::uuid[]) OR s.source_id=ANY($2::uuid[])))
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE
                WHEN jsonb_typeof(d.learning_footprint)='array' THEN d.learning_footprint ELSE '[]'::jsonb END) footprint
                CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(footprint->'entries')='array'
                    THEN footprint->'entries' ELSE '[]'::jsonb END) entry WHERE entry->>'releaseId'=ANY($3::text[])))
        ORDER BY d.id FOR UPDATE OF d`, [contactIds, sourceIds, releaseIds]);
    if (!rows.length) return 0;
    const ids = rows.map(row => row.id);
    await query(`UPDATE agent_dispatch_outbox SET redacted_at=NOW(), payload=NULL, recipient=NULL,
        conversation_id=NULL, contact_id=NULL, operational_scope='{}'::jsonb, learning_footprint=NULL,
        lease_token=NULL, lease_expires_at=NULL,
        state=CASE WHEN state='admitted' THEN 'reconciliation_required' ELSE state END,
        updated_at=NOW() WHERE id=ANY($1::uuid[])`, [ids]);
    await query('DELETE FROM agent_dispatch_outbox_sources WHERE dispatch_id=ANY($1::uuid[])', [ids]);
    return rows.length;
}
