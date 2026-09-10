import type { ApiEnvelope } from "./api";

/**
 * The operator-side contract for the durable dispatch outbox.
 *
 * The API for rollout, backlog and reconciliation shipped without a consumer,
 * so the only way to read the kill switch or settle an uncertain effect was
 * curl and SQL. This module holds the decisions that must not live inside a
 * component: which row may be resolved, what a refusal means, and what a
 * rollout request is allowed to say. They are here so they can be tested
 * without a browser, and so the screen cannot quietly disagree with them.
 */

export const DISPATCH_RESOLUTIONS = ["delivered", "not_delivered", "retry"] as const;
export type DispatchResolution = (typeof DISPATCH_RESOLUTIONS)[number];

/** Mirrors `DISPATCH_STATES` in the API. Only one of them may be resolved. */
export const DISPATCH_STATES = [
    "prepared", "queued", "admitted", "sent", "stored", "suppressed", "failed", "reconciliation_required",
] as const;
export type DispatchState = (typeof DISPATCH_STATES)[number];

export const DISPATCH_ITEM_KINDS = ["text", "media", "payment_link", "flow"] as const;
export type DispatchItemKind = (typeof DISPATCH_ITEM_KINDS)[number];

/** `DISPATCH_MAX_ATTEMPTS` in the API. A retry past it is refused server-side. */
export const DISPATCH_MAX_ATTEMPTS = 5;

/** Channels the rollout may ever name, before the adapter check. */
export const DISPATCH_ROLLOUT_CHANNELS = ["whatsapp", "messenger", "instagram", "telegram"] as const;
export type DispatchRolloutChannel = (typeof DISPATCH_ROLLOUT_CHANNELS)[number];

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export interface DispatchRolloutState {
    enabled: boolean;
    tenantIds: string[];
    channels: string[];
    /** Channels whose adapter really implements the strict transport. */
    migratedChannels: string[];
    /** Requested AND migrated: what the switch actually does. */
    effectiveChannels: string[];
    /** Requested but unserviceable, so the operator sees why nothing happens. */
    ignoredChannels: string[];
}

export interface DispatchRolloutRequest {
    enabled: boolean;
    tenantIds: string[];
    channels: string[];
}

/**
 * One uncertain effect. No payload and no unmasked recipient: reconciliation
 * asks whether something happened, never what it said, and a queue view is not
 * a reason to hand out phone numbers.
 */
export interface DispatchReconciliationEntry {
    id: string;
    /**
     * What the server says this row is, not what the client deduces it must be.
     *
     * The listing only returns `reconciliation_required`, so the surface used
     * to assume it and carry the state itself. The entry states it now, and an
     * assumption that happens to be right is still the wrong thing to decide an
     * irreversible action on.
     */
    state: DispatchState;
    conversationId: string | null;
    inboundMessageId: string;
    channelType: string;
    channelAccountId: string;
    recipientHint: string | null;
    itemKind: DispatchItemKind;
    itemIndex: number;
    attempts: number;
    errorCode: string | null;
    receipt: string | null;
    settledLeaseToken: string | null;
    redacted: boolean;
    createdAt: string;
    updatedAt: string;
    ageSeconds: number;
}

export interface DispatchReconciliationBacklog {
    total: number;
    oldestAgeSeconds: number;
    /** Rows past the operational deadline; what an alert counts. */
    breachingSla: number;
}

export interface DispatchReconciliationQueue {
    entries: DispatchReconciliationEntry[];
    backlog: DispatchReconciliationBacklog;
    slaSeconds: number;
}

/**
 * The decision itself, as the server recorded it.
 *
 * It is a row in the tenant schema written in the same transaction as the
 * state change it authorises — not a log line written afterwards that could
 * fail silently. So the screen can state that the decision is durable, who
 * signed it and what it turned the effect into, instead of only that the
 * request came back without an error.
 */
export interface DispatchResolutionRecord {
    id: string;
    dispatchId: string;
    resolution: DispatchResolution;
    evidence: string;
    actorId: string;
    actorRole: string | null;
    /** Free-form on the wire; `asDispatchState` decides if it can be labelled. */
    previousState: string;
    /** The provider failure the decision replaced — kept, not overwritten. */
    previousErrorCode: string | null;
    newState: string;
    receipt: string | null;
    createdAt: string;
}

/**
 * What `POST reconciliation/:tenantId/:dispatchId` answers with.
 *
 * The endpoint answers the whole dispatch row plus the decision, and that row
 * carries the payload and the unmasked recipient. This type names only the
 * fields the queue is allowed to use, so nothing that must not be shown can be
 * reached from the screen by accident.
 */
export interface DispatchResolutionReceipt {
    id: string;
    state: DispatchState;
    attempts: number;
    receipt: string | null;
    /** Still the provider failure that opened the row; never the decision. */
    errorCode: string | null;
    resolution: DispatchResolutionRecord;
}

/** What the audit-copy drain answers with. */
export interface DispatchResolutionExport {
    attempted: number;
    remaining: number;
}

/**
 * Adopt what the server said about a row a decision was just made on.
 *
 * The listing states each row's state, so nothing is inferred here; this is
 * only the update afterwards. It matters because the row in front of the
 * operator now describes a reality that is gone, and offering a second
 * irreversible decision on it is the exact mistake this queue exists to
 * prevent.
 */
export const settleQueueRow = (
    row: DispatchReconciliationEntry, receipt: DispatchResolutionReceipt,
): DispatchReconciliationEntry =>
    ({ ...row, state: receipt.state, attempts: receipt.attempts, receipt: receipt.receipt, errorCode: receipt.errorCode });

/** A state the screen has a label for, or null so it never prints a raw value. */
export const asDispatchState = (value: unknown): DispatchState | null =>
    typeof value === "string" && (DISPATCH_STATES as readonly string[]).includes(value)
        ? value as DispatchState : null;

/** Why a resolution is not on offer. `null` means it is. */
export type DispatchResolutionBlock =
    | "settled"
    | "redacted"
    | "attemptsExhausted"
    | "evidenceRequired"
    | "receiptRequired";

export interface DispatchResolutionInput {
    resolution: DispatchResolution;
    evidence: string;
    receipt?: string | null;
}

/**
 * Whether this exact decision may be offered on this exact row.
 *
 * Fails closed on everything the server would refuse, so an operator never
 * types an explanation into a form that was never going to be accepted, and —
 * more importantly — never sees a "resolve" control on a row that has already
 * been decided.
 */
export function dispatchResolutionBlock(
    row: Pick<DispatchReconciliationEntry, "state" | "redacted" | "attempts">,
    input: DispatchResolutionInput,
): DispatchResolutionBlock | null {
    if (row.state !== "reconciliation_required") return "settled";
    if (!input.evidence.trim() || input.evidence.trim().length > 500) return "evidenceRequired";
    if (input.resolution === "delivered") {
        return typeof input.receipt === "string" && input.receipt.trim() ? null : "receiptRequired";
    }
    if (input.resolution === "retry") {
        // Redacted words cannot be resent under any evidence, and the server
        // will not admit a row that has spent its attempts.
        if (row.redacted) return "redacted";
        if (row.attempts >= DISPATCH_MAX_ATTEMPTS) return "attemptsExhausted";
    }
    return null;
}

/** Any resolution at all, for deciding whether the row shows actions. */
export const isDispatchResolvable = (row: Pick<DispatchReconciliationEntry, "state">): boolean =>
    row.state === "reconciliation_required";

/** The body the API accepts. Built only from a verdict that allowed it. */
export function prepareDispatchResolution(
    row: Pick<DispatchReconciliationEntry, "state" | "redacted" | "attempts">,
    input: DispatchResolutionInput,
): { resolution: DispatchResolution; evidence: string; receipt?: string } {
    const block = dispatchResolutionBlock(row, input);
    if (block) throw new Error(`dispatch_resolution_blocked:${block}`);
    const evidence = input.evidence.trim();
    return input.resolution === "delivered"
        ? { resolution: input.resolution, evidence, receipt: String(input.receipt).trim() }
        : { resolution: input.resolution, evidence };
}

/** Fixed categories only: a refusal is translated, never printed raw. */
export type DispatchErrorKind =
    | "notReconcilable"
    | "redacted"
    | "attemptsExhausted"
    | "receiptRequired"
    | "evidenceRequired"
    | "invalidRollout"
    | "unavailable";

export interface DispatchRefusal {
    kind: DispatchErrorKind;
    /**
     * Somebody else settled this row between the read and the decision. It is
     * a race, not a malformed request, and the only useful answer is to reload
     * — so it cannot be shown as one more validation complaint about a form
     * the operator filled in correctly.
     */
    conflict: boolean;
    /** The state the refusal reports the row is really in, when it names one. */
    state: DispatchState | null;
}

function refusalKind(code: string): DispatchErrorKind {
    if (code === "dispatch_redacted") return "redacted";
    if (code === "dispatch_attempts_exhausted") return "attemptsExhausted";
    if (code === "dispatch_receipt_required") return "receiptRequired";
    if (code === "dispatch_resolution_evidence_required") return "evidenceRequired";
    if (code.startsWith("dispatch_rollout_")) return "invalidRollout";
    return "unavailable";
}

/**
 * What a refused request actually said, in the three terms the screen needs.
 *
 * Two endpoints on this page report a refusal in two shapes, and both are
 * read. Reconciliation answers `{ error: code }`, so the stable code arrives
 * in `errorCode`; the rollout `PUT` still raises the code as an exception
 * message, so it arrives in `error` and `errorCode` says "Bad Request".
 * Reading one field only would show an operator holding an irreversible
 * decision the words "Bad Request".
 *
 * A 409 is a conflict whatever the body says: the status alone is the fact
 * that somebody else got there first.
 */
export function readDispatchRefusal(
    envelope: Pick<ApiEnvelope<unknown>, "error" | "errorCode" | "httpStatus">,
): DispatchRefusal {
    const code = [envelope.errorCode, envelope.error]
        .find(value => typeof value === "string" && value.startsWith("dispatch_")) ?? "";
    const conflict = envelope.httpStatus === 409 || code.startsWith("dispatch_not_reconcilable");
    return {
        kind: conflict ? "notReconcilable" : refusalKind(code),
        conflict,
        state: code.startsWith("dispatch_not_reconcilable:")
            ? asDispatchState(code.slice("dispatch_not_reconcilable:".length)) : null,
    };
}

export type DispatchSlaState = "within" | "nearing" | "breaching";

/** Half the deadline is where an operator should already be looking. */
export function dispatchSlaState(ageSeconds: number, slaSeconds: number): DispatchSlaState {
    if (!Number.isFinite(slaSeconds) || slaSeconds <= 0) return "within";
    if (ageSeconds >= slaSeconds) return "breaching";
    return ageSeconds >= slaSeconds / 2 ? "nearing" : "within";
}

/** Oldest first, exactly like the queue: the longest uncertainty is the worst. */
export const sortDispatchQueue = (
    rows: readonly DispatchReconciliationEntry[],
): DispatchReconciliationEntry[] =>
    [...rows].sort((a, b) => b.ageSeconds - a.ageSeconds || a.id.localeCompare(b.id));

/**
 * Validate the rollout locally against the same rules the server enforces.
 *
 * A configuration that names an unsupported channel is refused there with a
 * 400; catching it here means the operator sees which value is wrong instead
 * of a rejected form.
 */
export function prepareDispatchRollout(draft: {
    enabled: boolean; tenantIds: readonly string[]; channels: readonly string[];
}): { body: DispatchRolloutRequest; invalidTenantIds: string[]; invalidChannels: string[] } {
    const tenantIds = [...new Set(draft.tenantIds.map(value => value.trim()).filter(Boolean))].sort();
    const channels = [...new Set(draft.channels.map(value => value.trim()).filter(Boolean))].sort();
    return {
        body: { enabled: draft.enabled === true, tenantIds, channels },
        invalidTenantIds: tenantIds.filter(id => !UUID.test(id)),
        invalidChannels: channels.filter(
            channel => !(DISPATCH_ROLLOUT_CHANNELS as readonly string[]).includes(channel)),
    };
}

/**
 * A rollout that is on but delivers nothing: enabled with no effective channel.
 * Silence looks identical to a working pilot, so the screen has to say it.
 */
export const isDispatchRolloutInert = (state: DispatchRolloutState): boolean =>
    state.enabled && state.effectiveChannels.length === 0;

/** Coarse buckets, so an age reads as an age without importing a date library. */
export function dispatchAgeParts(ageSeconds: number): { hours: number; minutes: number } {
    const total = Math.max(0, Math.floor(Number(ageSeconds) || 0));
    return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60) };
}
