import type { ApiEnvelope, BillingRefundResult } from "@/lib/api";

type RefundStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type BillingRefundIntent = { requestId: string; amountCents?: number; reason?: string; expectedRefundedAmountCents?: number };
const PREFIX = "parallly:billing:refund:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RefundIntentStorageError extends Error {}

function key(actorId: string, paymentId: string): string {
    if (!actorId || !paymentId) throw new RefundIntentStorageError();
    return `${PREFIX}${actorId}:${paymentId}`;
}

/** Unconfirmed requests never expire: losing their identity could repeat a refund. */
export function readRefundIntent(storage: RefundStorage, actorId: string, paymentId: string): BillingRefundIntent | null {
    try {
        const raw = storage.getItem(key(actorId, paymentId));
        if (raw === null) return null;
        const value = JSON.parse(raw) as BillingRefundIntent;
        if (!value || !UUID.test(value.requestId)
            || (value.amountCents !== undefined && (!Number.isSafeInteger(value.amountCents) || value.amountCents <= 0))
            || (value.expectedRefundedAmountCents !== undefined && (!Number.isSafeInteger(value.expectedRefundedAmountCents) || value.expectedRefundedAmountCents < 0))
            || (value.reason !== undefined && typeof value.reason !== "string")) throw new Error();
        return value;
    } catch { throw new RefundIntentStorageError(); }
}

export function saveRefundIntent(
    storage: RefundStorage, actorId: string, paymentId: string,
    input: Omit<BillingRefundIntent, "requestId">,
): BillingRefundIntent {
    const pending = readRefundIntent(storage, actorId, paymentId);
    if (pending) return pending;
    try {
        const intent = { ...input, requestId: crypto.randomUUID() };
        const serialized = JSON.stringify(intent);
        const storageKey = key(actorId, paymentId);
        storage.setItem(storageKey, serialized);
        if (storage.getItem(storageKey) !== serialized) throw new Error();
        return intent;
    } catch { throw new RefundIntentStorageError(); }
}

// These responses reject the input before a provider command can be submitted.
const INPUT_REJECTIONS = new Set([
    "invalid_refund_amount", "refund_exceeds_payment", "payment_not_found", "already_refunded",
    "cannot_refund", "missing_provider_payment_id", "refund_not_supported", "partial_void_not_supported",
    "stripe_payment_not_refundable", "invalid_refund_request_id", "refund_balance_changed", "validation_failed",
]);

export function finishRefundIntent(
    storage: RefundStorage, actorId: string, paymentId: string,
    intent: BillingRefundIntent, response: ApiEnvelope<BillingRefundResult>,
): void {
    const terminal = response.success
        ? !!response.data?.providerPaymentId && (!response.data.status || response.data.status === "succeeded" || response.data.status === "failed")
        : INPUT_REJECTIONS.has(response.errorCode ?? "");
    if (terminal && readRefundIntent(storage, actorId, paymentId)?.requestId === intent.requestId) {
        try { storage.removeItem(key(actorId, paymentId)); }
        catch { /* Keeping the old key is safe: its next request replays the same result. */ }
    }
}

export function refundFeedback(response: ApiEnvelope<BillingRefundResult>): "refundSucceeded" | "refundPending" | "refundFailed" | "refundNeedsReview" {
    if (response.success && !response.data?.providerPaymentId) return "refundPending";
    if (!response.success) {
        if (INPUT_REJECTIONS.has(response.errorCode ?? "")) return "refundFailed";
        if (response.errorCode === "refund_request_conflict") return "refundNeedsReview";
        return "refundPending";
    }
    switch (response.data?.status) {
        case "pending": return "refundPending";
        case "needs_review": return "refundNeedsReview";
        case "failed": return "refundFailed";
        default: return "refundSucceeded";
    }
}
