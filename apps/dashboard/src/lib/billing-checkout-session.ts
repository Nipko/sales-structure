import type { PaymentSourceKind } from "@/lib/api";

const CHECKOUT_PREFIX = "parallly:billing:checkout:";
const WOMPI_SOURCE_PREFIX = "parallly:billing:wompi-source:";
const SESSION_TTL_MS = 30 * 60 * 1000;

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type BillingCheckoutIntent = {
    kind: "upgrade" | "change-card" | "add-method";
    planSlug?: string;
    billingCycle: "monthly" | "annual";
    createdAt: number;
};

export type PendingWompiSource = {
    sourceId: string;
    kind: PaymentSourceKind;
    authorizationUrl?: string;
    createdAt: number;
};

function isFreshTimestamp(value: unknown, now: number): value is number {
    return typeof value === "number"
        && Number.isFinite(value)
        && value <= now + 60_000
        && now - value <= SESSION_TTL_MS;
}

export function parseBillingCheckoutIntent(
    raw: string | null,
    now = Date.now(),
): BillingCheckoutIntent | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<BillingCheckoutIntent>;
        if (!isFreshTimestamp(value.createdAt, now)) return null;
        if (
            value.kind !== "upgrade"
            && value.kind !== "change-card"
            && value.kind !== "add-method"
        ) return null;
        if (value.billingCycle !== "monthly" && value.billingCycle !== "annual") return null;
        if (value.kind === "upgrade" && (!value.planSlug || typeof value.planSlug !== "string")) return null;
        return value as BillingCheckoutIntent;
    } catch {
        return null;
    }
}

export function parsePendingWompiSource(
    raw: string | null,
    now = Date.now(),
): PendingWompiSource | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<PendingWompiSource>;
        if (!isFreshTimestamp(value.createdAt, now)) return null;
        if (!value.sourceId || typeof value.sourceId !== "string") return null;
        if (
            value.kind !== "card"
            && value.kind !== "nequi"
            && value.kind !== "bancolombia_transfer"
            && value.kind !== "daviplata"
        ) return null;
        if (value.authorizationUrl !== undefined && typeof value.authorizationUrl !== "string") return null;
        return value as PendingWompiSource;
    } catch {
        return null;
    }
}

function checkoutKey(tenantId: string): string {
    return `${CHECKOUT_PREFIX}${tenantId}`;
}

function wompiSourceKey(tenantId: string): string {
    return `${WOMPI_SOURCE_PREFIX}${tenantId}`;
}

export function saveBillingCheckoutIntent(
    storage: SessionStorageLike,
    tenantId: string,
    intent: Omit<BillingCheckoutIntent, "createdAt">,
    now = Date.now(),
): void {
    try {
        storage.setItem(checkoutKey(tenantId), JSON.stringify({ ...intent, createdAt: now }));
    } catch {
        // The explicit resumePlan query still lets onboarding continue when a
        // browser blocks storage; it just cannot survive a bank redirect.
    }
}

export function readBillingCheckoutIntent(
    storage: SessionStorageLike,
    tenantId: string,
    now = Date.now(),
): BillingCheckoutIntent | null {
    try {
        const key = checkoutKey(tenantId);
        const value = parseBillingCheckoutIntent(storage.getItem(key), now);
        if (!value) storage.removeItem(key);
        return value;
    } catch {
        return null;
    }
}

export function clearBillingCheckoutIntent(storage: SessionStorageLike, tenantId: string): void {
    try { storage.removeItem(checkoutKey(tenantId)); } catch { /* storage unavailable */ }
}

export function savePendingWompiSource(
    storage: SessionStorageLike,
    tenantId: string,
    source: Omit<PendingWompiSource, "createdAt">,
    now = Date.now(),
): void {
    try {
        storage.setItem(wompiSourceKey(tenantId), JSON.stringify({ ...source, createdAt: now }));
    } catch {
        // The source remains server-side; the user can resume from Billing.
    }
}

export function readPendingWompiSource(
    storage: SessionStorageLike,
    tenantId: string,
    now = Date.now(),
): PendingWompiSource | null {
    try {
        const key = wompiSourceKey(tenantId);
        const value = parsePendingWompiSource(storage.getItem(key), now);
        if (!value) storage.removeItem(key);
        return value;
    } catch {
        return null;
    }
}

export function clearPendingWompiSource(storage: SessionStorageLike, tenantId: string): void {
    try { storage.removeItem(wompiSourceKey(tenantId)); } catch { /* storage unavailable */ }
}

/**
 * Wompi only needs a place to return after Bancolombia account authorization.
 * The provider token stays in Wompi/backend state; the callback URL contains no
 * payment credential or plan details.
 */
export function buildWompiReturnUrl(currentUrl: string): string {
    const url = new URL(currentUrl);
    url.search = "";
    url.hash = "";
    url.searchParams.set("wompiReturn", "1");
    return url.toString();
}
