import type { PaymentSourceKind } from "@/lib/api";

const KIND_BY_METHOD_FLAG: Readonly<Record<string, PaymentSourceKind>> = {
    card: "card",
    nequi: "nequi",
    bancolombiaTransfer: "bancolombia_transfer",
};

/**
 * Converts runtime Wompi kill-switch flags into dashboard source kinds.
 * An empty list means Billing Ops disabled every method, so the UI must not
 * invent a card fallback.
 */
export function resolveWompiPaymentKinds(methods: readonly string[]): PaymentSourceKind[] {
    return methods
        .map((method) => KIND_BY_METHOD_FLAG[method])
        .filter((kind): kind is PaymentSourceKind => kind !== undefined);
}
