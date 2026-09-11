import type { FundingSignal } from './meta-funding-signals';

/**
 * ═══ PAUSING ONE NUMBER, AND PROVING IT CAN COME BACK ═══
 *
 * When Meta says a business account cannot be billed, the right response is
 * narrow and specific:
 *
 *   · STOP CHARGEABLE SENDS from that one number. Not the tenant, not the
 *     other numbers on other WABAs, and not the inbound side — a customer who
 *     writes in must still be received, recorded and shown to a human, because
 *     the business has a missing card and not a missing customer.
 *   · DO NOT RETRY. Every attempt is identical and none can succeed until a
 *     person does something in a different company's interface. A retry loop
 *     here is a queue filling with errors that all say the same thing.
 *   · SAY WHY, WHERE SOMEBODY WILL SEE IT, with the exact next action.
 *   · MAKE COMING BACK VERIFIABLE. A pause that can only be cleared by
 *     guessing is a pause nobody trusts, and one that clears itself on a timer
 *     is a pause that resumes into the same wall.
 *
 * ── WHY THE STATE LIVES IN `channel_accounts.metadata` ──────────────────────
 *
 * Because it belongs to one connection and nothing else reads it. A column
 * would need a migration on the busiest table in the platform for a field that
 * is null for every healthy account; a separate table would need a join on the
 * send path. The shape is validated here rather than by a CHECK, which is the
 * trade being made deliberately and is why every reader goes through `readPause`
 * instead of touching the JSON.
 */
export interface SendPause {
    /** Why sending stopped. Today only funding; the shape allows others. */
    readonly reason: 'funding_not_ready';
    /** Meta's code, when it gave one. */
    readonly code: number | null;
    /** What Meta actually said. Never a token, never a phone number. */
    readonly detail: string;
    /** When it was first seen. */
    readonly since: string;
    /** Where it was seen most recently, and how many times. */
    readonly source: FundingSignal['source'];
    readonly observations: number;
    readonly lastSeen: string;
    /**
     * How the pause was cleared, when it was.
     *
     * Present means the account is NOT paused. Kept rather than deleted so the
     * history reads as "this happened and was fixed" instead of "nothing ever
     * happened", which is what an operator needs when it happens twice.
     */
    readonly clearedAt?: string;
    readonly clearedBy?: 'provider_accepted' | 'operator';
    readonly clearedNote?: string;
}

const isIsoDate = (value: unknown): value is string =>
    typeof value === 'string' && !Number.isNaN(Date.parse(value));

/**
 * Read a pause out of an account's metadata, refusing anything malformed.
 *
 * Anything that does not parse is treated as NO pause. The failure mode matters:
 * a garbled field read as "paused" would silence a working account on the
 * strength of a JSON typo, and this whole mechanism exists to avoid exactly
 * that class of self-inflicted outage. A garbled field read as "not paused"
 * costs money and is visible in the ledger the same day.
 */
export function readPause(metadata: unknown): SendPause | null {
    const raw = (metadata as any)?.sendPause;
    if (!raw || typeof raw !== 'object') return null;
    if (raw.reason !== 'funding_not_ready') return null;
    if (!isIsoDate(raw.since) || !isIsoDate(raw.lastSeen)) return null;
    if (raw.clearedAt !== undefined && !isIsoDate(raw.clearedAt)) return null;
    return Object.freeze({
        reason: 'funding_not_ready',
        code: typeof raw.code === 'number' ? raw.code : null,
        detail: String(raw.detail ?? '').slice(0, 400),
        since: raw.since,
        source: raw.source === 'status_webhook' ? 'status_webhook' : 'http_response',
        observations: Number.isFinite(raw.observations) ? Math.max(1, Number(raw.observations)) : 1,
        lastSeen: raw.lastSeen,
        ...(raw.clearedAt ? { clearedAt: raw.clearedAt } : {}),
        ...(raw.clearedBy === 'operator' || raw.clearedBy === 'provider_accepted'
            ? { clearedBy: raw.clearedBy } : {}),
        ...(raw.clearedNote ? { clearedNote: String(raw.clearedNote).slice(0, 300) } : {}),
    });
}

/** Is this account currently stopped from sending anything chargeable? */
export function isPaused(pause: SendPause | null): boolean {
    return Boolean(pause) && !pause!.clearedAt;
}

/**
 * Fold a new funding signal into whatever pause already exists.
 *
 * The first sighting starts the pause. A later one does NOT restart it: `since`
 * is when the problem began, and moving it forward on every failed message
 * would make a three-day outage look like it started thirty seconds ago. What
 * moves is `lastSeen` and the count, which is what says "still happening".
 *
 * A signal arriving after a clear reopens the pause, with a new `since`: the
 * problem was fixed and has come back, and pretending it is the same episode
 * would hide that it happened twice.
 */
export function applyFundingSignal(existing: SendPause | null, signal: FundingSignal): SendPause {
    const live = isPaused(existing) ? existing! : null;
    return Object.freeze({
        reason: 'funding_not_ready' as const,
        code: signal.code,
        detail: signal.detail,
        since: live?.since ?? signal.at,
        source: signal.source,
        observations: (live?.observations ?? 0) + 1,
        lastSeen: signal.at,
    });
}

/**
 * Clear a pause, only ever on evidence.
 *
 * `provider_accepted` is the strong one: Meta took a message from this account,
 * which is the only proof that billing works again, and it is produced by the
 * platform rather than claimed by anybody.
 *
 * `operator` exists because a person may fix the card and want to try, and
 * refusing to let them would mean a paused account can only recover by being
 * sent from — which it cannot, because it is paused. It carries a note so the
 * record says who decided and why.
 */
export function clearPause(existing: SendPause | null, input: {
    readonly by: 'provider_accepted' | 'operator';
    readonly at?: Date;
    readonly note?: string;
}): SendPause | null {
    if (!isPaused(existing)) return existing;
    return Object.freeze({
        ...existing!,
        clearedAt: (input.at ?? new Date()).toISOString(),
        clearedBy: input.by,
        ...(input.note ? { clearedNote: String(input.note).slice(0, 300) } : {}),
    });
}

/** One line an operator can act on, in their own terms. */
export function describePause(pause: SendPause): string {
    return `Sending from this WhatsApp number is paused since ${pause.since}: Meta reported that the `
        + `business account cannot be billed (${pause.code ?? 'no code'}, seen ${pause.observations} `
        + `time(s), last ${pause.lastSeen}). Meta charges the business directly, and the Parallly `
        + `subscription is a separate payment — add or fix the payment method on this WhatsApp `
        + `Business Account in Meta, then send one message to confirm. Incoming messages are still `
        + `being received. Detail: ${pause.detail}`;
}
