/**
 * ═══ ONE DEFINITION OF "THIS PERSON ASKED US TO STOP" ═══
 *
 * `ComplianceService.isBlocked` answers it for a single phone or lead id and is
 * what drip, nurturing, the temporal evaluator and SMS ask. The producers that
 * pick their audience in SQL (recall, broadcast) or revalidate inside the
 * outbox admission transaction (all three) cannot call a service that goes
 * through Redis and its own connection, so the same semantics live here as SQL.
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
 * It is a fragment of SQL, not a function that executes, so the SAME text is
 * used in a `WHERE` of a selection, in a `SELECT … FROM unnest(…)` over a batch
 * and inside an admission transaction.
 */

export const OPT_OUT_ACTIVE_STATUSES_SQL = `('pending', 'confirmed')`;

const DIGITS = (expr: string) => `NULLIF(regexp_replace(${expr}, '\\D', '', 'g'), '')`;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Only well-formed UUIDs may reach a `::uuid[]` cast; anything else would abort the transaction. */
export function uuidsOnly(values: ReadonlyArray<unknown>): string[] {
    return [...new Set(values.map(value => String(value ?? '').trim()).filter(value => UUID.test(value)))];
}

/**
 * `TRUE` when the person is on the opt-out register for the channel.
 *
 * @param input.phone    SQL expression for the phone (text), e.g. `$1` or `contacts.phone`.
 * @param input.ids      SQL expression for a `uuid[]` of contact and/or lead ids.
 * @param input.channel  SQL expression for the channel being used (text).
 */
export function optedOutSql(input: { phone: string; ids: string; channel: string }): string {
    const { phone, ids, channel } = input;
    return `(
        EXISTS (
            SELECT 1 FROM opt_out_records oo
             WHERE oo.status IN ${OPT_OUT_ACTIVE_STATUSES_SQL}
               AND (oo.channel = ${channel} OR oo.channel = 'all')
               AND (
                    (${DIGITS('oo.phone')} IS NOT NULL AND (
                        ${DIGITS('oo.phone')} = ${DIGITS(phone)}
                        OR ${DIGITS('oo.phone')} IN (
                            SELECT ${DIGITS('cc.phone')} FROM contacts cc WHERE cc.id = ANY(${ids}))))
                    OR oo.lead_id = ANY(${ids})
                    OR oo.lead_id IN (
                        SELECT ll.id FROM leads ll
                         WHERE ll.contact_id = ANY(${ids})
                            OR (${DIGITS('ll.phone')} IS NOT NULL AND ${DIGITS('ll.phone')} = ${DIGITS(phone)}))
               )
        )
        OR EXISTS (
            SELECT 1 FROM leads ll
             WHERE ll.opted_out = true
               AND (
                    ll.id = ANY(${ids})
                    OR ll.contact_id = ANY(${ids})
                    OR (${DIGITS('ll.phone')} IS NOT NULL AND (
                        ${DIGITS('ll.phone')} = ${DIGITS(phone)}
                        OR ${DIGITS('ll.phone')} IN (
                            SELECT ${DIGITS('cc.phone')} FROM contacts cc WHERE cc.id = ANY(${ids}))))
               )
        )
    )`;
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
    const rows = await query<any[]>(
        `SELECT ${optedOutSql({ phone: '$1::text', ids: '$2::uuid[]', channel: '$3::text' })} AS blocked`,
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
              WHERE ${optedOutSql({ phone: 'r.phone', ids: "ARRAY[NULLIF(r.id, '')::uuid]", channel: '$4::text' })}`,
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
