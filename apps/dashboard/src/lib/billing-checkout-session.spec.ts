import {
    buildWompiReturnUrl,
    parseBillingCheckoutIntent,
    parsePendingWompiSource,
    readBillingCheckoutIntent,
    saveBillingCheckoutIntent,
} from "./billing-checkout-session";

describe("billing checkout session", () => {
    const now = Date.UTC(2026, 7, 15, 12, 0, 0);

    it("accepts a fresh upgrade intent and rejects expired or malformed state", () => {
        expect(parseBillingCheckoutIntent(JSON.stringify({
            kind: "upgrade",
            planSlug: "pro",
            billingCycle: "annual",
            createdAt: now - 1_000,
        }), now)).toMatchObject({ kind: "upgrade", planSlug: "pro", billingCycle: "annual" });

        expect(parseBillingCheckoutIntent(JSON.stringify({
            kind: "upgrade",
            billingCycle: "monthly",
            createdAt: now,
        }), now)).toBeNull();

        expect(parseBillingCheckoutIntent(JSON.stringify({
            kind: "add-method",
            billingCycle: "monthly",
            createdAt: now - 31 * 60 * 1_000,
        }), now)).toBeNull();
    });

    it("persists only a local source id for an asynchronous Wompi authorization", () => {
        expect(parsePendingWompiSource(JSON.stringify({
            sourceId: "source-local-1",
            kind: "bancolombia_transfer",
            authorizationUrl: "https://bancolombia.example/authorize",
            createdAt: now,
        }), now)).toMatchObject({
            sourceId: "source-local-1",
            kind: "bancolombia_transfer",
        });

        expect(parsePendingWompiSource(JSON.stringify({
            sourceId: "source-local-1",
            kind: "pse",
            createdAt: now,
        }), now)).toBeNull();
    });

    it("builds a credential-free Bancolombia return URL", () => {
        expect(buildWompiReturnUrl(
            "https://admin.parallly-chat.cloud/admin/settings/billing?resumePlan=pro&cycle=annual#plans",
        )).toBe("https://admin.parallly-chat.cloud/admin/settings/billing?wompiReturn=1");
    });

    it("fails safely when the browser blocks sessionStorage", () => {
        const blocked = {
            getItem: () => { throw new Error("blocked"); },
            setItem: () => { throw new Error("blocked"); },
            removeItem: () => { throw new Error("blocked"); },
        };
        expect(() => saveBillingCheckoutIntent(blocked, "tenant-1", {
            kind: "upgrade",
            planSlug: "pro",
            billingCycle: "monthly",
        }, now)).not.toThrow();
        expect(readBillingCheckoutIntent(blocked, "tenant-1", now)).toBeNull();
    });
});
