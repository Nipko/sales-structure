/**
 * Where the agent's words went when they left the platform.
 *
 * A transfer to a human writes a summary of the customer's conversation and
 * pushes it into the tenant's HubSpot or Pipedrive as a note. The adapter
 * returns the id of the note it created, and `runJob` assigned it to a local
 * variable, logged it, and dropped it: `persistLink` is called for a contact
 * and for a deal, never for an activity. So the copy outside the platform had
 * no address. An erasure could clear `conversations.handoff_summary` and delete
 * the internal notes and still leave the same paragraph — the customer's
 * problem, in their words, summarised by the agent — sitting in a third-party
 * CRM with nothing able to point at it.
 *
 * This is the address. One row per note actually created, holding what the
 * provider gave back and who it was about, and the state of taking it back.
 *
 * Three things it exists to make possible, and each is a state, not a hope:
 *
 *   · **An erasure can name it.** `contact_id` is the key, in the tenant schema
 *     where the erasure already runs, so marking every note of one person for
 *     retraction is part of the same transaction that clears everything else;
 *   · **The result is stated, not assumed.** A retraction settles as `accepted`,
 *     `rejected` or `unknown` — never as "we tried". `unknown` is a real answer:
 *     a timeout leaves the note possibly deleted and possibly not, and an
 *     erasure that reported success on that would be a lie somebody would
 *     eventually rely on;
 *   · **It is idempotent.** One row per (connection, source), and a settled row
 *     is not re-settled, so a reconcile pass over a queue of retractions can run
 *     as often as it likes without deleting one note twice or losing the reason
 *     the last attempt failed.
 *
 * What it deliberately does NOT do is retract on a RETRACTION of a release. A
 * summary is about the CONVERSATION, not about a release: withdrawing a style
 * the agent was trained on does not unwrite what a person was told when their
 * conversation was handed over. That is the same line the rest of this codebase
 * draws between a release being withdrawn and a person being erased.
 */

export type CrmReceiptQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

/** What the provider said when asked to take the note back. */
export const CRM_RETRACTION_OUTCOMES = ['accepted', 'rejected', 'unknown'] as const;
export type CrmRetractionOutcome = (typeof CRM_RETRACTION_OUTCOMES)[number];

export const CRM_NOTE_RECEIPT_STATES = [
    /** Pushed and addressable. Nothing has asked for it back. */
    'recorded',
    /** An erasure has asked for it back; the provider has not answered yet. */
    'retract_pending',
    /** The provider confirmed it is gone. */
    'retracted',
    /** The provider refused. Terminal, and visible: somebody has to act. */
    'rejected',
    /** The provider did not say. NOT a failure and NOT a success. */
    'unknown',
] as const;
export type CrmNoteReceiptState = (typeof CRM_NOTE_RECEIPT_STATES)[number];

export const CRM_NOTE_RECEIPT_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS crm_note_receipts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        /** The tenant's connection, from the global catalog. No FK across schemas. */
        connection_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        /** What produced the note. One kind today; the column is what keeps it open. */
        source_kind TEXT NOT NULL,
        /** Stable across attempts — the handoff receipt id, not a fresh UUID. */
        source_id TEXT NOT NULL,
        conversation_id UUID,
        /** The erasure key. A note about nobody cannot be erased by contact. */
        contact_id UUID,
        /** What the provider called it. This is the whole point of the row. */
        external_id TEXT NOT NULL,
        external_url TEXT,
        state TEXT NOT NULL DEFAULT 'recorded',
        attempts INTEGER NOT NULL DEFAULT 0,
        retract_reason TEXT,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT crm_note_receipts_state CHECK (state IN
            ('recorded','retract_pending','retracted','rejected','unknown')),
        CONSTRAINT crm_note_receipts_attempts CHECK (attempts >= 0)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_crm_note_receipt_source
        ON crm_note_receipts (connection_id, source_kind, source_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_note_receipt_contact
        ON crm_note_receipts (contact_id) WHERE state <> 'retracted'`,
    `CREATE INDEX IF NOT EXISTS idx_crm_note_receipt_pending
        ON crm_note_receipts (updated_at) WHERE state = 'retract_pending'`,
]);

/**
 * Does this tenant have the table yet?
 *
 * Asked before every read and every mark, because these run inside somebody
 * else's transaction — a contact erasure — where a query against a missing
 * relation does not return nothing: it aborts every statement after it and the
 * COMMIT with them. Catching the error does not help. `to_regclass` answers
 * NULL instead of failing, which is why it goes first.
 */
async function hasReceipts(query: CrmReceiptQuery): Promise<boolean> {
    const [row] = await query<any[]>("SELECT to_regclass('crm_note_receipts')::text AS name");
    return !!row?.name;
}

export async function ensureCrmNoteReceipts(query: CrmReceiptQuery): Promise<void> {
    for (const statement of CRM_NOTE_RECEIPT_DDL) await query(statement);
}

export interface CrmNoteReceipt {
    readonly id: string;
    readonly connectionId: string;
    readonly provider: string;
    readonly sourceKind: string;
    readonly sourceId: string;
    readonly externalId: string;
    readonly contactId: string | null;
    readonly state: CrmNoteReceiptState;
    readonly attempts: number;
    readonly lastError: string | null;
}

const project = (row: any): CrmNoteReceipt => Object.freeze({
    id: String(row.id),
    connectionId: String(row.connection_id),
    provider: String(row.provider),
    sourceKind: String(row.source_kind),
    sourceId: String(row.source_id),
    externalId: String(row.external_id),
    contactId: row.contact_id ? String(row.contact_id) : null,
    state: row.state as CrmNoteReceiptState,
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error ?? null,
});

/**
 * Records where a note landed.
 *
 * Idempotent by `(connection, source_kind, source_id)`: the same handoff pushed
 * twice resolves to one row. A second push that returns a DIFFERENT external id
 * overwrites it and says so in `retract_reason`, because the newer id is the one
 * a retraction has to use — and losing the older one is worth knowing about,
 * which is why it is written down rather than dropped in silence.
 *
 * A row already asked to be retracted is not resurrected to `recorded`. An
 * erasure that has begun does not get undone by a queued push arriving late.
 */
export async function recordCrmNoteReceipt(
    query: CrmReceiptQuery,
    input: {
        connectionId: string; provider: string; sourceKind: string; sourceId: string;
        externalId: string; externalUrl?: string | null;
        conversationId?: string | null; contactId?: string | null;
    },
): Promise<string | null> {
    if (!input.externalId || !input.sourceId) return null;
    if (!await hasReceipts(query)) return null;
    const rows = await query<any[]>(
        `INSERT INTO crm_note_receipts
            (connection_id, provider, source_kind, source_id, conversation_id, contact_id,
             external_id, external_url)
         VALUES ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8)
         ON CONFLICT (connection_id, source_kind, source_id) DO UPDATE
             SET external_id = EXCLUDED.external_id,
                 external_url = COALESCE(EXCLUDED.external_url, crm_note_receipts.external_url),
                 contact_id = COALESCE(EXCLUDED.contact_id, crm_note_receipts.contact_id),
                 retract_reason = CASE
                     WHEN crm_note_receipts.external_id <> EXCLUDED.external_id
                     THEN 'superseded:' || crm_note_receipts.external_id
                     ELSE crm_note_receipts.retract_reason END,
                 updated_at = NOW()
         RETURNING id`,
        [input.connectionId, input.provider, input.sourceKind, input.sourceId,
            input.conversationId ?? null, input.contactId ?? null,
            input.externalId, input.externalUrl ?? null]);
    return rows[0] ? String(rows[0].id) : null;
}

/**
 * Asks for every note about these people back.
 *
 * Runs on the erasure's own transaction, so the request to retract commits with
 * everything else the erasure clears — there is no window where the internal
 * copy is gone and nothing remembers that an external one exists.
 *
 * It only MARKS. The provider call belongs outside this transaction: an
 * erasure must not be held open across somebody else's HTTP timeout, and must
 * not be rolled back by one either.
 */
export async function requestCrmNoteRetraction(
    query: CrmReceiptQuery, contactIds: readonly string[], reason = 'contact_erasure',
): Promise<number> {
    const ids = [...new Set(contactIds.map(value => String(value)).filter(Boolean))];
    if (!ids.length) return 0;
    if (!await hasReceipts(query)) return 0;
    const rows = await query<any[]>(
        `UPDATE crm_note_receipts
            SET state = 'retract_pending', retract_reason = $2, attempts = 0,
                last_error = NULL, updated_at = NOW()
          WHERE contact_id = ANY($1::uuid[]) AND state <> 'retracted'
      RETURNING id`, [ids, reason]);
    return rows?.length ?? 0;
}

/**
 * The notes still owed a retraction, oldest first.
 *
 * `rejected` and `unknown` are NOT included: they are terminal answers somebody
 * has to look at, not work to retry forever. A reconcile that swept them back
 * up would turn a refusal into an infinite loop against the tenant's CRM.
 */
export async function pendingCrmNoteRetractions(
    query: CrmReceiptQuery, limit = 100,
): Promise<readonly CrmNoteReceipt[]> {
    if (!await hasReceipts(query)) return Object.freeze([]);
    const rows = await query<any[]>(
        `SELECT * FROM crm_note_receipts WHERE state = 'retract_pending'
          ORDER BY updated_at ASC LIMIT $1`, [Math.min(Math.max(limit, 1), 500)]);
    return Object.freeze(rows.map(project));
}

/**
 * Writes down what the provider actually said.
 *
 * Strict on purpose. There are three answers and each lands in its own state:
 * `accepted` means the note is gone and the row can stop being work; `rejected`
 * means the provider refused and a person has to decide; `unknown` means nobody
 * knows, which is the honest state for a timeout and the one that must never be
 * quietly rounded up to success.
 *
 * A row that is not pending is left exactly as it is, and the count says so, so
 * two reconcile passes racing over the same receipt settle it once.
 */
export async function settleCrmNoteRetraction(
    query: CrmReceiptQuery, id: string, outcome: CrmRetractionOutcome, detail?: string | null,
): Promise<boolean> {
    if (!CRM_RETRACTION_OUTCOMES.includes(outcome)) throw new Error('crm_retraction_outcome_invalid');
    if (!await hasReceipts(query)) return false;
    const state: CrmNoteReceiptState =
        outcome === 'accepted' ? 'retracted' : outcome === 'rejected' ? 'rejected' : 'unknown';
    const rows = await query<any[]>(
        `UPDATE crm_note_receipts
            SET state = $2, attempts = attempts + 1, last_error = $3, updated_at = NOW()
          WHERE id = $1::uuid AND state = 'retract_pending'
      RETURNING id`, [id, state, detail ?? null]);
    return !!rows?.length;
}

/**
 * Puts an `unknown` back in the queue, once somebody decides to ask again.
 *
 * Separate from `requestCrmNoteRetraction` because it is a different decision:
 * the first is an erasure, this is an operator choosing to re-ask about an
 * answer nobody got. Keeping them apart is what stops a sweep silently
 * retrying a rejection.
 */
export async function retryCrmNoteRetraction(query: CrmReceiptQuery, id: string): Promise<boolean> {
    if (!await hasReceipts(query)) return false;
    const rows = await query<any[]>(
        `UPDATE crm_note_receipts SET state = 'retract_pending', updated_at = NOW()
          WHERE id = $1::uuid AND state = 'unknown' RETURNING id`, [id]);
    return !!rows?.length;
}

/** How many notes are in each state, for anything that reports on the gap. */
export async function crmNoteReceiptCounts(
    query: CrmReceiptQuery,
): Promise<Readonly<Record<CrmNoteReceiptState, number>>> {
    const empty = Object.fromEntries(CRM_NOTE_RECEIPT_STATES.map(state => [state, 0]));
    if (!await hasReceipts(query)) return Object.freeze(empty) as any;
    const rows = await query<any[]>('SELECT state, count(*)::int AS n FROM crm_note_receipts GROUP BY state');
    for (const row of rows) empty[String(row.state)] = Number(row.n ?? 0);
    return Object.freeze(empty) as any;
}
