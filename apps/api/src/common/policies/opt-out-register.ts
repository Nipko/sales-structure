/**
 * ═══ ONE DEFINITION OF "THIS PERSON ASKED US TO STOP" ═══
 *
 * `ComplianceService.isBlocked` answers it for a single phone or lead id and is
 * what drip, nurturing, the temporal evaluator and SMS ask. The producers that
 * pick their audience in SQL (recall, broadcast) or revalidate inside the
 * outbox admission transaction cannot call a service that goes through Redis
 * and its own connection, so the same semantics live here as SQL.
 *
 * A person is suppressed when ANY of these holds:
 *
 *   · an `opt_out_records` row is `pending` or `confirmed` (a pending request
 *     stays suppressed until a reviewer rejects it as a false positive — exactly
 *     what `isBlocked` does) and it names this person by phone or by lead, for
 *     the channel being used (or for `all`);
 *   · a lead of this person has `leads.opted_out = true` (the public-form
 *     unsubscribe sets it with no channel, so it blocks every channel).
 *
 * "This person" is matched by id (contact id, or a lead id for segment
 * audiences) AND by phone digits: the register stores the phone as the sender
 * wrote it, the contact as E.164, and a formatting difference must not be the
 * way an opt-out is missed.
 *
 * ── SHAPE OF THE SQL, AND WHY ───────────────────────────────────────────────
 *
 * It runs once per candidate (a recall page, a campaign of thousands, an
 * admission). Every subquery below is UNCORRELATED: it does not mention the
 * candidate, so the planner evaluates it once and hashes it, and each candidate
 * costs a hash probe. The first version correlated a `leads` lookup to each
 * candidate, which is a scan of `leads` per recipient.
 *
 * It is a fragment of SQL, not a function that executes, so the SAME text is
 * used in a `WHERE` of a selection, in a `SELECT … FROM unnest(…)` over a batch
 * and inside an admission transaction.
 */

export const OPT_OUT_ACTIVE_STATUSES_SQL = `('pending', 'confirmed')`;

/**
 * What a policy revision answers, and the outbox records as the reason, when the
 * recipient opted out after the effect was queued. Distinct from "the entity is
 * gone" so an operator (and the campaign's statistics) can tell a person who
 * said stop from a campaign that was deleted.
 */
export const RECIPIENT_OPTED_OUT_CODE = 'recipient_opted_out';

const DIGITS = (expr: string) => `NULLIF(regexp_replace(${expr}, '\\D', '', 'g'), '')`;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Only well-formed UUIDs may reach a `::uuid[]` cast; anything else would abort the transaction. */
export function uuidsOnly(values: ReadonlyArray<unknown>): string[] {
    return [...new Set(values.map(value => String(value ?? '').trim()).filter(value => UUID.test(value)))];
}

/**
 * `TRUE` when the person is on the opt-out register for the channel, never NULL
 * (`x IN (… NULL …)` is NULL, and `NOT NULL` in a WHERE would drop the row).
 *
 * @param input.phone    SQL expression for the phone (text, may be NULL), e.g. `contacts.phone`.
 * @param input.id       SQL expression for the contact or lead id (uuid, may be NULL).
 * @param input.channel  SQL expression for the channel being used (text); must not depend on the candidate.
 */
export function optedOutSql(input: { phone: string; id: string; channel: string }): string {
    const { phone, id, channel } = input;
    const active = `oo.status IN ${OPT_OUT_ACTIVE_STATUSES_SQL} AND (oo.channel = ${channel} OR oo.channel = 'all')`;
    const leadsOptedOutByRequest = `SELECT oo.lead_id FROM opt_out_records oo WHERE ${active} AND oo.lead_id IS NOT NULL`;
    return `COALESCE((
        ${DIGITS(phone)} IN (
            SELECT ${DIGITS('oo.phone')} FROM opt_out_records oo WHERE ${active} AND oo.phone IS NOT NULL)
        OR ${DIGITS(phone)} IN (
            SELECT ${DIGITS('ll.phone')} FROM leads ll
             WHERE ll.opted_out = true OR ll.id IN (${leadsOptedOutByRequest}))
        OR ${id} IN (${leadsOptedOutByRequest})
        OR ${id} IN (SELECT ll.id FROM leads ll WHERE ll.opted_out = true)
        OR ${id} IN (
            SELECT ll.contact_id FROM leads ll
             WHERE ll.opted_out = true OR ll.id IN (${leadsOptedOutByRequest}))
    ), false)`;
}

type Query = <T = any[]>(sql: string, params?: any[]) => Promise<T>;

/** Is this one person on the register, for this channel? Safe to run inside a transaction. */
export async function isRecipientOptedOut(
    query: Query,
    input: { channel: string; phone?: string | null; ids?: ReadonlyArray<unknown> },
): Promise<boolean> {
    const ids = uuidsOnly(input.ids ?? []);
    const phone = String(input.phone ?? '').trim() || null;
    if (!ids.length && !phone) return false;
    // One row per way the person can be named: the phone given, each id, and
    // the phone of each contact id (a rule or a campaign row knows the contact,
    // not always the number).
    const rows = await query<any[]>(
        `WITH p(phone, id) AS (
            SELECT $1::text, NULL::uuid
            UNION ALL SELECT NULL::text, x FROM unnest($2::uuid[]) AS x
            UNION ALL SELECT cc.phone, cc.id FROM contacts cc WHERE cc.id = ANY($2::uuid[])
         )
         SELECT EXISTS (
            SELECT 1 FROM p WHERE ${optedOutSql({ phone: 'p.phone', id: 'p.id', channel: '$3::text' })}
         ) AS blocked`,
        [phone, ids, input.channel]);
    return rows?.[0]?.blocked === true;
}

/**
 * Of a batch of recipients, which are on the register for this channel?
 * Returns the `key`s to drop. One round trip per chunk, not per person.
 *
 * `key` is whatever the caller needs back (a recipient row id, a contact id);
 * `id` is the person's contact or lead id when it has one.
 */
export async function optedOutRecipientKeys(
    query: Query,
    channel: string,
    recipients: ReadonlyArray<{ key: string; id?: string | null; phone?: string | null }>,
    chunkSize = 5000,
): Promise<Set<string>> {
    const blocked = new Set<string>();
    for (let offset = 0; offset < recipients.length; offset += chunkSize) {
        const chunk = recipients.slice(offset, offset + chunkSize);
        const rows = await query<any[]>(
            `SELECT r.key
               FROM unnest($1::text[], $2::text[], $3::text[]) AS r(key, id, phone)
              WHERE ${optedOutSql({ phone: 'r.phone', id: "NULLIF(r.id, '')::uuid", channel: '$4::text' })}`,
            [
                chunk.map(recipient => String(recipient.key)),
                chunk.map(recipient => uuidsOnly([recipient.id])[0] ?? ''),
                chunk.map(recipient => String(recipient.phone ?? '')),
                channel,
            ]);
        for (const row of rows || []) blocked.add(String(row.key));
    }
    return blocked;
}
