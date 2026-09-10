/**
 * Where a queued reply's words and recipient actually live.
 *
 * The legacy path put them in Redis. A BullMQ job for a staggered bubble, a
 * payment link or a piece of media carried the text and the phone number, sat
 * there for its delay, and kept them for up to 24 hours after a failure. Nothing
 * could reach it: a retraction matches on a release id and the job had none, an
 * erasure matches on a contact and the job was not in any database. It was the
 * widest hole in the output sweep, and the durable outbox that solves it is
 * behind a switch that is off by default — so "just turn it on" was never an
 * answer anybody could give for a live tenant.
 *
 * This is the other answer, and the one that needs no flag flipped in
 * production: the job becomes a REFERENCE. Redis carries two ids. The words and
 * the recipient live in a tenant table where both keys can find them, and the
 * processor reads them at the last moment before sending — which is what makes
 * "retracted while it was queued" mean something.
 *
 * Three properties this table exists to give:
 *
 *   · **A delayed reply survives a crash.** The row is committed before the job
 *     is published, so a worker that dies mid-flight loses nothing but time;
 *   · **A retraction or an erasure reaches it BEFORE it is sent.** Redaction
 *     nulls the payload and the row survives as the fact that stops a resend, in
 *     exactly the shape the dispatch outbox already uses;
 *   · **It is not sent twice.** The payload is cleared on delivery, so a
 *     replayed job finds nothing to send rather than a second copy of it.
 */

export type OutboundPayloadQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

export const OUTBOUND_PAYLOAD_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS outbound_payloads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        channel_type TEXT NOT NULL,
        /** Reachable by an erasure. Null for a message with no contact behind it. */
        contact_id UUID,
        conversation_id UUID,
        /** Reachable by a retraction. The release ids the words were produced under. */
        release_ids TEXT[] NOT NULL DEFAULT '{}',
        /** The caller's dedupe id, so a replay resolves to this row. */
        dedupe_id TEXT,
        /** Words and recipient. NULL once redacted or delivered. */
        payload JSONB,
        redacted_at TIMESTAMPTZ,
        redacted_reason TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT outbound_payloads_reason
            CHECK (redacted_reason IS NULL OR redacted_reason IN ('retraction','erasure','delivered'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_outbound_payload_dedupe
        ON outbound_payloads (tenant_id, dedupe_id) WHERE dedupe_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_outbound_payload_contact
        ON outbound_payloads (contact_id) WHERE payload IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_outbound_payload_release
        ON outbound_payloads USING GIN (release_ids) WHERE payload IS NOT NULL`,
]);

export async function ensureOutboundPayloads(query: OutboundPayloadQuery): Promise<void> {
    for (const statement of OUTBOUND_PAYLOAD_DDL) await query(statement);
}

export interface StoredOutboundPayload {
    readonly id: string;
    readonly payload: Record<string, unknown> | null;
    readonly redactedAt: string | null;
    readonly redactedReason: string | null;
    readonly sentAt: string | null;
}

/**
 * Commits the payload and returns the id the job will carry.
 *
 * Idempotent by `dedupe_id`: the same reply prepared twice resolves to one row,
 * which is what makes a replayed turn produce one message instead of two.
 */
export async function storeOutboundPayload(
    query: OutboundPayloadQuery,
    input: {
        tenantId: string; channelType: string; contactId?: string | null;
        conversationId?: string | null; releaseIds?: readonly string[]; dedupeId?: string | null;
        payload: Record<string, unknown>;
    },
): Promise<string> {
    const rows = await query<any[]>(
        `INSERT INTO outbound_payloads
            (tenant_id, channel_type, contact_id, conversation_id, release_ids, dedupe_id, payload)
         VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::text[],$6,$7::jsonb)
         ON CONFLICT (tenant_id, dedupe_id) WHERE dedupe_id IS NOT NULL DO UPDATE
             SET payload = COALESCE(outbound_payloads.payload, EXCLUDED.payload)
         RETURNING id`,
        [input.tenantId, input.channelType, input.contactId ?? null, input.conversationId ?? null,
            [...(input.releaseIds ?? [])], input.dedupeId ?? null, JSON.stringify(input.payload)]);
    return String(rows[0].id);
}

/** Reads the payload back, with everything the caller needs to refuse to send. */
export async function loadOutboundPayload(
    query: OutboundPayloadQuery, id: string,
): Promise<StoredOutboundPayload | null> {
    const [row] = await query<any[]>(
        `SELECT id, payload, redacted_at, redacted_reason, sent_at FROM outbound_payloads WHERE id = $1::uuid`, [id]);
    if (!row) return null;
    return {
        id: String(row.id),
        payload: (row.payload as Record<string, unknown> | null) ?? null,
        redactedAt: row.redacted_at ? new Date(row.redacted_at).toISOString() : null,
        redactedReason: row.redacted_reason ?? null,
        sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    };
}

/**
 * Marks a payload delivered and drops the words.
 *
 * The row survives on purpose. It is the fact that stops a replayed job sending
 * a second copy — the same reason the dispatch outbox keeps a redacted row
 * rather than deleting it.
 */
export async function markOutboundPayloadSent(query: OutboundPayloadQuery, id: string): Promise<void> {
    await query(
        `UPDATE outbound_payloads
            SET payload = NULL, sent_at = NOW(), redacted_reason = 'delivered'
          WHERE id = $1::uuid AND sent_at IS NULL`, [id]);
}

/**
 * Takes back what has not been sent, by release.
 *
 * A retraction withdraws a RELEASE, so it reaches what is still queued and
 * deliberately does not rewrite a conversation that already happened — which is
 * why `sent_at IS NULL` is part of the predicate rather than an afterthought.
 */
export async function redactOutboundPayloadsForRelease(
    query: OutboundPayloadQuery, releaseIds: readonly string[],
): Promise<number> {
    if (!releaseIds.length) return 0;
    const rows = await query<any[]>(
        `UPDATE outbound_payloads
            SET payload = NULL, redacted_at = NOW(), redacted_reason = 'retraction'
          WHERE payload IS NOT NULL AND sent_at IS NULL AND release_ids && $1::text[]
      RETURNING id`, [[...releaseIds]]);
    return rows?.length ?? 0;
}

/**
 * Takes back everything of one person's, sent or not.
 *
 * The key is the contact, not the release, and there is no `sent_at` clause:
 * an erasure reaches a queued reply whatever produced it.
 */
export async function redactOutboundPayloadsForContact(
    query: OutboundPayloadQuery, contactIds: readonly string[],
): Promise<number> {
    if (!contactIds.length) return 0;
    const rows = await query<any[]>(
        `UPDATE outbound_payloads
            SET payload = NULL, redacted_at = NOW(), redacted_reason = 'erasure'
          WHERE payload IS NOT NULL AND contact_id = ANY($1::uuid[])
      RETURNING id`, [[...contactIds]]);
    return rows?.length ?? 0;
}
