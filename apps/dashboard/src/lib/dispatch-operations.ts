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

/** What `POST reconciliation/:tenantId/:dispatchId` answers with. */
export interface DispatchResolutionReceipt {
    id: string;
    state: DispatchState;
    attempts: number;
    receipt: string | null;
    errorCode: string | null;
}

/**
 * A queue row as the screen holds it.
 *
 * The API only ever lists rows in `reconciliation_required`, so it does not
 * repeat the state in each entry. The screen must carry it anyway: once a
 * decision commits, the row in front of the operator describes a reality that
 * no longer exists, and offering a second irreversible decision on it is the
 * exact mistake this queue exists to prevent. So a settled row keeps its place
 * in the list with the state the server returned, and stops being actionable.
 */
export interface DispatchQueueRow extends DispatchReconciliationEntry {
    state: DispatchState;
}

export const asQueueRow = (entry: DispatchReconciliationEntry): DispatchQueueRow =>
    ({ ...entry, state: "reconciliation_required" });

export const settleQueueRow = (row: DispatchQueueRow, receipt: DispatchResolutionReceipt): DispatchQueueRow =>
    ({ ...row, state: receipt.state, attempts: receipt.attempts, receipt: receipt.receipt, errorCode: receipt.errorCode });

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
    row: Pick<DispatchQueueRow, "state" | "redacted" | "attempts">,
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
export const isDispatchResolvable = (row: Pick<DispatchQueueRow, "state">): boolean =>
    row.state === "reconciliation_required";

/** The body the API accepts. Built only from a verdict that allowed it. */
export function prepareDispatchResolution(
    row: Pick<DispatchQueueRow, "state" | "redacted" | "attempts">,
    input: DispatchResolutionInput,
): { resolution: DispatchResolution; evidence: string; receipt?: string } {
    const block = dispatchResolutionBlock(row, input);
    if (block) throw new Error(`dispatch_resolution_blocked:${block}`);
    const evidence = input.evidence.trim();
    return input.resolution === "delivered"
        ? { resolution: input.resolution, evidence, receipt: String(input.receipt).trim() }
        : { resolution: input.resolution, evidence };
}

/**
 * Fixed categories only: a refusal is translated, never printed raw.
 *
 * The dispatch controller raises `BadRequestException(code)`, so the stable
 * code arrives as the message rather than in `errorCode` — reading only one of
 * the two would show "Bad Request" to an operator holding an irreversible
 * decision.
 */
export type DispatchErrorKind =
    | "notReconcilable"
    | "redacted"
    | "attemptsExhausted"
    | "receiptRequired"
    | "evidenceRequired"
    | "invalidRollout"
    | "unavailable";

export function dispatchErrorKind(envelope: Pick<ApiEnvelope<unknown>, "error" | "errorCode">): DispatchErrorKind {
    const code = [envelope.errorCode, envelope.error]
        .find(value => typeof value === "string" && value.startsWith("dispatch_")) ?? "";
    if (code.startsWith("dispatch_not_reconcilable")) return "notReconcilable";
    if (code === "dispatch_redacted") return "redacted";
    if (code === "dispatch_attempts_exhausted") return "attemptsExhausted";
    if (code === "dispatch_receipt_required") return "receiptRequired";
    if (code === "dispatch_resolution_evidence_required") return "evidenceRequired";
    if (code.startsWith("dispatch_rollout_")) return "invalidRollout";
    return "unavailable";
}

/** The state a refusal reports the row is really in, when it says so. */
export function dispatchStateFromRefusal(
    envelope: Pick<ApiEnvelope<unknown>, "error" | "errorCode">,
): DispatchState | null {
    const code = [envelope.errorCode, envelope.error]
        .find(value => typeof value === "string" && value.startsWith("dispatch_not_reconcilable:")) ?? "";
    const state = code.slice("dispatch_not_reconcilable:".length);
    return (DISPATCH_STATES as readonly string[]).includes(state) ? state as DispatchState : null;
}

export type DispatchSlaState = "within" | "nearing" | "breaching";

/** Half the deadline is where an operator should already be looking. */
export function dispatchSlaState(ageSeconds: number, slaSeconds: number): DispatchSlaState {
    if (!Number.isFinite(slaSeconds) || slaSeconds <= 0) return "within";
    if (ageSeconds >= slaSeconds) return "breaching";
    return ageSeconds >= slaSeconds / 2 ? "nearing" : "within";
}

/** Oldest first, exactly like the queue: the longest uncertainty is the worst. */
export const sortDispatchQueue = (rows: readonly DispatchQueueRow[]): DispatchQueueRow[] =>
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
