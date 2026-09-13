/**
 * Which buffer a burst of fragments belongs to.
 *
 * People do not write one message; they write "hola", "quería preguntar", "por
 * el corte de cabello", "¿tienen cupo mañana?" in ten seconds. Answering each
 * one is four half-answers to the customer and, from 1 October 2026, four
 * charged WhatsApp messages for one question. So fragments are buffered for a
 * moment and processed as one turn.
 *
 * The key that buffer lives under decides who shares it, and it was missing the
 * connection:
 *
 *     buf:conv:{tenantId}:{channelType}:{contactId}
 *
 * A tenant with two WhatsApp numbers — a sales line and a support line — has one
 * customer who writes to both. Their fragments landed in the SAME buffer. The
 * flusher drained everything, so the sales line answered a question asked of
 * support, using words the customer sent to a different number; and the support
 * line, holding an older sequence, returned `null` and answered nothing at all.
 * One conversation got somebody else's context and the other got silence.
 *
 * The connection is part of the identity of a conversation, so it is part of the
 * key. Multi-account is not exotic — it is a plan feature (`maxChannelAccounts`)
 * and the whole reason `channel_accounts.access_token` exists.
 *
 * ── ABOUT THE DEPLOY THAT CHANGES THIS KEY ──────────────────────────────────
 *
 * Buffers live 60 seconds and a burst resolves in about one. During a rolling
 * restart a fragment written by the old code and one written by the new code sit
 * under different keys, so each flushes on its own: that burst becomes two turns
 * instead of one. Nothing is lost and nobody gets somebody else's words — it is
 * one less merge, for one burst, once. Draining the old key into the new one
 * would recover that merge by reintroducing exactly the conflation this fixes,
 * which is a bad trade for a window measured in seconds.
 */

export interface BurstIdentity {
    readonly tenantId: string;
    readonly channelType: string;
    /** The exact connection. `null` only where a channel genuinely has none. */
    readonly channelAccountId?: string | null;
    /** The customer's address on that channel. */
    readonly contactId: string;
}

/**
 * `-` rather than the empty string for a missing connection.
 *
 * An empty segment would make `a:b::c` and `a:b:c:` collide in ways that depend
 * on where the gap is, and a channel with no account id must not end up sharing
 * a buffer with one whose account id happens to be blank.
 */
const NO_CONNECTION = '-';

export function burstBufferKeys(identity: BurstIdentity): {
    readonly base: string; readonly seqKey: string; readonly msgsKey: string;
} {
    const connection = String(identity.channelAccountId ?? '').trim() || NO_CONNECTION;
    const base = `buf:conv:${identity.tenantId}:${identity.channelType}:${connection}:${identity.contactId}`;
    return Object.freeze({ base, seqKey: `${base}:seq`, msgsKey: `${base}:msgs` });
}

/**
 * Do two inbound messages belong in the same buffered turn?
 *
 * Exported so the property this key exists to hold can be tested directly,
 * rather than inferred from two Redis calls agreeing with each other.
 */
export function sharesBurstBuffer(left: BurstIdentity, right: BurstIdentity): boolean {
    return burstBufferKeys(left).base === burstBufferKeys(right).base;
}
