/**
 * Contact-addressable key for the short-lived copy of a completed turn reply.
 *
 * The contact UUID is part of the key so a privacy erasure can name every copy
 * without scanning Redis or inspecting the reply text. Provider message ids
 * remain the retry identity inside that contact boundary.
 */
export function turnReplyKey(tenantId: string, contactId: string, providerMsgId: string): string {
    return `turn:reply:${tenantId}:${contactId}:${providerMsgId}`;
}

/** Keys written before replies became addressable by contact. */
export function legacyTurnReplyKey(tenantId: string, providerMsgId: string): string {
    return `turn:reply:${tenantId}:${providerMsgId}`;
}

type TenantQuery = <T = unknown>(sql: string, params?: unknown[]) => Promise<T>;
type CacheDelete = { del(key: string): Promise<void> };

/**
 * Delete every retry-reply copy for these contacts while their ledger address
 * is still available. Callers hold the tenant privacy transaction lock.
 */
export async function eraseTurnReplyCaches(
    query: TenantQuery,
    redis: CacheDelete | undefined,
    schema: string,
    tenantId: string,
    contactIds: string[],
): Promise<number> {
    if (!redis) return 0;
    const [turnLedger] = await query<Array<{ name: string | null }>>(
        'SELECT to_regclass($1)::text AS name', [`${schema}.agent_turn_ledger`]);
    if (!turnLedger?.name) return 0;
    const cachedReplies = await query<Array<{ contact_id: string; provider_message_id: string }>>(
        `SELECT contact_id,provider_message_id FROM agent_turn_ledger
          WHERE contact_id=ANY($1::uuid[]) AND provider_message_id IS NOT NULL`, [contactIds]);
    const keys = new Set<string>();
    for (const row of cachedReplies) {
        const providerId = String(row.provider_message_id || '');
        const ownerId = String(row.contact_id || '');
        if (!providerId || !ownerId) continue;
        keys.add(turnReplyKey(tenantId, ownerId, providerId));
        keys.add(legacyTurnReplyKey(tenantId, providerId));
    }
    for (const key of keys) await redis.del(key);
    return keys.size;
}
