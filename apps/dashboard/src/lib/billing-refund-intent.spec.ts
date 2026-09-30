import { finishRefundIntent, readRefundIntent, refundFeedback, RefundIntentStorageError, saveRefundIntent } from "./billing-refund-intent";

function storage() {
    const items = new Map<string, string>();
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => { items.set(key, value); },
        removeItem: (key: string) => { items.delete(key); },
    };
}

describe("refund request identity", () => {
    it("resumes the same amount and identity after a lost response, across a page reload", () => {
        const browser = storage();
        const first = saveRefundIntent(browser, "admin", "payment", { amountCents: 1000, reason: "Refund" });
        finishRefundIntent(browser, "admin", "payment", first, { success: false });
        expect(readRefundIntent(browser, "admin", "payment")).toEqual(first);
        expect(saveRefundIntent(browser, "admin", "payment", { amountCents: 2000, reason: "Changed" })).toEqual(first);
    });

    it.each(["pending", "needs_review"] as const)("retains the original request while %s", (status) => {
        const browser = storage();
        const first = saveRefundIntent(browser, "admin", "payment", { amountCents: 1000 });
        finishRefundIntent(browser, "admin", "payment", first, { success: true, data: { providerPaymentId: "in_1", partialAmountCents: 1000, status } });
        expect(readRefundIntent(browser, "admin", "payment")).toEqual(first);
        expect(refundFeedback({ success: true, data: { providerPaymentId: "in_1", partialAmountCents: 1000, status } })).not.toBe("refundSucceeded");
    });

    it.each(["succeeded", "failed"] as const)("allows a new explicit request only after %s", (status) => {
        const browser = storage();
        const first = saveRefundIntent(browser, "admin", "payment", { amountCents: 1000 });
        finishRefundIntent(browser, "admin", "payment", first, { success: true, data: { providerPaymentId: "in_1", partialAmountCents: 1000, status } });
        expect(readRefundIntent(browser, "admin", "payment")).toBeNull();
        expect(saveRefundIntent(browser, "admin", "payment", { amountCents: 1000 }).requestId).not.toBe(first.requestId);
    });

    it("isolates admins and payments, and refuses to submit if storage is unavailable", () => {
        const browser = storage();
        saveRefundIntent(browser, "admin", "payment", {});
        expect(readRefundIntent(browser, "admin2", "payment")).toBeNull();
        expect(readRefundIntent(browser, "admin", "payment2")).toBeNull();
        expect(() => saveRefundIntent({ ...browser, setItem: () => { throw new Error("blocked"); } }, "admin", "payment2", {})).toThrow(RefundIntentStorageError);
    });

    it("keeps uncertain failures but allows correcting rejected amounts", () => {
        const browser = storage();
        const first = saveRefundIntent(browser, "admin", "payment", { amountCents: 1000 });
        finishRefundIntent(browser, "admin", "payment", first, { success: false, httpStatus: 503 });
        expect(readRefundIntent(browser, "admin", "payment")).toEqual(first);
        finishRefundIntent(browser, "admin", "payment", first, { success: false, errorCode: "refund_exceeds_payment" });
        expect(readRefundIntent(browser, "admin", "payment")).toBeNull();
    });
});
