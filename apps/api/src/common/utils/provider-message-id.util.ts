import { NormalizedMessage } from '@parallext/shared';

/**
 * Stable, provider-assigned identity of an inbound message.
 *
 * Reads ONLY `metadata`: every adapter mints a fresh `uuid()` for
 * `NormalizedMessage.id` (whatsapp/instagram/messenger/telegram/email/sms
 * adapters all do), so `msg.id` changes on every redelivery and is useless for
 * deduplication. The provider ids below are the same values the webhook
 * controllers already use to build their `idem:*` Redis keys.
 *
 * Telegram is namespaced differently on purpose: `updateId` is per-bot (and
 * `tgMessageId` is only per-chat), so it is prefixed to avoid colliding with a
 * numerically identical id from another provider.
 *
 * Returns null when no provider id is available — callers must degrade
 * gracefully (no dedupe) rather than invent one.
 */
export function providerMessageId(msg: NormalizedMessage): string | null {
    const m = (msg?.metadata || {}) as Record<string, unknown>;
    const raw =
        m.waMessageId ??
        m.igMessageId ??
        m.fbMessageId ??
        m.twilioMessageSid ??
        m.emailMessageId ??
        (m.updateId != null ? `tgu${m.updateId}` : undefined);

    if (raw === undefined || raw === null || raw === '') return null;
    return String(raw);
}

/**
 * Deterministic identity for one outbound send derived from the turn that
 * produced it. Used as the BullMQ jobId so replaying a turn — a retry, or a
 * queue-backed re-run after a restart — re-derives the SAME ids and BullMQ
 * drops the duplicates instead of messaging the customer twice.
 *
 * `purpose` + `index` disambiguate the several sends a single turn can emit
 * (a chunked reply, media, a booking confirmation…), so they must be stable
 * across replays: derive them from position in the flow, never from content or
 * a timestamp.
 *
 * Returns undefined when the turn has no provider id, which leaves the send
 * un-deduped — exactly today's behaviour, never worse.
 */
export function outboundDedupeId(
    inbound: NormalizedMessage,
    purpose: string,
    index = 0,
): string | undefined {
    const pmid = providerMessageId(inbound);
    if (!pmid) return undefined;
    return `${inbound.tenantId}:${pmid}:${purpose}:${index}`;
}
