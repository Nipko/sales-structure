export type WebhookErasureQuery = <T = any[]>(sql: string, params?: any[]) => Promise<T>;

/**
 * Redact contact-bearing public-hook payloads under the caller's privacy fence.
 * Terminal receipts remain as non-personal operational evidence. Work that has
 * not reached a terminal provider outcome is conclusively refused here, so the
 * recovery sweep cannot publish the erased payload after the transaction.
 */
export async function erasePublicWebhookDeliveries(
    query: WebhookErasureQuery,
    tenantId: string,
    contactIds: string[],
): Promise<number> {
    const [table] = await query<any[]>(
        "SELECT to_regclass('public.webhook_delivery_outbox')::text AS name",
    );
    if (!table?.name || contactIds.length === 0) return 0;
    const rows = await query<any[]>(
        `UPDATE public.webhook_delivery_outbox delivery
            SET payload = '{}'::jsonb,
                state = CASE WHEN state IN ('pending','in_flight') THEN 'rejected' ELSE state END,
                error = CASE WHEN state IN ('pending','in_flight') THEN 'contact_erased' ELSE error END,
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE delivery.tenant_id = $1::uuid
            AND (
                delivery.payload->>'contactId' = ANY($2::text[])
                OR delivery.payload->>'conversationId' IN (
                    SELECT conversation.id::text FROM conversations conversation
                     WHERE conversation.contact_id = ANY($2::uuid[])
                )
            )
          RETURNING delivery.id`,
        [tenantId, contactIds],
    );
    return rows.length;
}
