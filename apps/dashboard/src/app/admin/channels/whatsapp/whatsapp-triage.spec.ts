import { WHATSAPP_CONNECT_ROUTE_IDS, getWhatsAppConnectRoute } from "./whatsapp-connect-routes";
import {
    WHATSAPP_TRIAGE_ANSWERS,
    WHATSAPP_TRIAGE_ANSWER_IDS,
    getWhatsAppTriageAnswer,
    isWhatsAppTriageAnswerId,
    readRememberedTriage,
    rememberTriage,
    routeAfterTriage,
    triageRouteId,
    whatsAppTriageKey,
} from "./whatsapp-triage";

/**
 * D12 (sep-2026): one question decides the route. In the 14-sep recording the
 * owner spent 3.5 minutes on three route cards, chose the wrong one and Meta
 * refused twice; the screen could not tell her which case was hers.
 */
describe("every answer leads somewhere, and nowhere twice", () => {
    it("covers the five situations a number can be in, without duplicates", () => {
        expect(WHATSAPP_TRIAGE_ANSWERS.map(a => a.id)).toEqual([...WHATSAPP_TRIAGE_ANSWER_IDS]);
        expect(new Set(WHATSAPP_TRIAGE_ANSWER_IDS).size).toBe(5);
        expect(new Set(WHATSAPP_TRIAGE_ANSWERS.map(a => a.messageKey)).size).toBe(5);
    });

    it("sends the app, the new number and the other provider to the right route", () => {
        expect(triageRouteId(getWhatsAppTriageAnswer("business_app")!)).toBe("coexistence");
        expect(triageRouteId(getWhatsAppTriageAnswer("new_number")!)).toBe("new");
        // A number already on the API with another provider is the migration
        // case — the one she never picked because nothing named it. Sending that
        // answer to a postpone left that route unreachable from the only
        // question that identifies it.
        const otherProvider = getWhatsAppTriageAnswer("other_provider")!;
        expect(triageRouteId(otherProvider)).toBe("migration");
        // And because the old provider has to act first, the same card also
        // lets her leave it noted instead of forcing a choice today.
        expect(otherProvider.alsoPostpone).toBe(true);
        expect(otherProvider.minutes).toBeNull();
    });

    it("turns the ordinary-WhatsApp answer into the coexistence door after the detour", () => {
        const personal = getWhatsAppTriageAnswer("personal_app")!;
        expect(personal.outcome).toEqual({ kind: "install_business_app" });
        expect(triageRouteId(personal)).toBeNull();
        expect(routeAfterTriage(personal)).toBe("coexistence");
    });

    it("never opens Meta's window for an answer that cannot connect today", () => {
        expect(routeAfterTriage(getWhatsAppTriageAnswer("not_at_hand")!)).toBeNull();
        expect(getWhatsAppTriageAnswer("not_at_hand")!.outcome).toEqual({ kind: "later", reason: "not_at_hand" });
    });

    it("points only at routes that exist in the shared catalogue", () => {
        for (const answer of WHATSAPP_TRIAGE_ANSWERS) {
            const routeId = routeAfterTriage(answer);
            if (!routeId) continue;
            expect(WHATSAPP_CONNECT_ROUTE_IDS).toContain(routeId);
            expect(getWhatsAppConnectRoute(routeId)).not.toBeNull();
        }
    });

    it("promises minutes only when the wait is ours", () => {
        // Releasing a number from another provider, or finding it, depends on
        // somebody else: a number there would be a promise we cannot keep.
        expect(getWhatsAppTriageAnswer("other_provider")!.minutes).toBeNull();
        expect(getWhatsAppTriageAnswer("not_at_hand")!.minutes).toBeNull();
        for (const id of ["business_app", "personal_app", "new_number"] as const) {
            expect(getWhatsAppTriageAnswer(id)!.minutes).toBeGreaterThan(0);
        }
    });

    it("keeps every answer to three lines of what is needed", () => {
        for (const answer of WHATSAPP_TRIAGE_ANSWERS) {
            expect(answer.needCount).toBeGreaterThanOrEqual(1);
            expect(answer.needCount).toBeLessThanOrEqual(3);
        }
    });

    it("builds i18n keys under the existing namespace, never a parallel one", () => {
        const answer = getWhatsAppTriageAnswer("business_app")!;
        expect(whatsAppTriageKey(answer, "Title")).toBe("answerBusinessAppTitle");
        expect(whatsAppTriageKey(answer, "Need1")).toBe("answerBusinessAppNeed1");
    });

    it("refuses an unknown answer instead of guessing one", () => {
        expect(getWhatsAppTriageAnswer("whatever")).toBeNull();
        expect(getWhatsAppTriageAnswer(undefined)).toBeNull();
        expect(isWhatsAppTriageAnswerId("business_app")).toBe(true);
        expect(isWhatsAppTriageAnswerId("nope")).toBe(false);
    });
});

describe("the question is asked once per browser", () => {
    const store = new Map<string, string>();
    beforeAll(() => {
        Object.defineProperty(globalThis, "window", {
            value: {
                localStorage: {
                    getItem: (k: string) => store.get(k) ?? null,
                    setItem: (k: string, v: string) => { store.set(k, v); },
                    removeItem: (k: string) => { store.delete(k); },
                },
            },
            configurable: true,
        });
    });
    afterAll(() => { delete (globalThis as any).window; });
    beforeEach(() => store.clear());

    it("remembers the answer per tenant and forgets it on demand", () => {
        rememberTriage("tenant-a", "business_app");
        rememberTriage("tenant-b", "new_number");
        expect(readRememberedTriage("tenant-a")).toBe("business_app");
        expect(readRememberedTriage("tenant-b")).toBe("new_number");
        rememberTriage("tenant-a", null);
        expect(readRememberedTriage("tenant-a")).toBeNull();
        expect(readRememberedTriage("tenant-b")).toBe("new_number");
    });

    it("ignores a stored value that is not an answer, and a missing tenant", () => {
        store.set("parallly_wa_triage_tenant-a", "sandbox");
        expect(readRememberedTriage("tenant-a")).toBeNull();
        expect(readRememberedTriage(null)).toBeNull();
        expect(() => rememberTriage(undefined, "new_number")).not.toThrow();
    });

    it("survives a browser that refuses storage", () => {
        const win = (globalThis as any).window;
        const previous = win.localStorage;
        win.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
        expect(readRememberedTriage("tenant-a")).toBeNull();
        expect(() => rememberTriage("tenant-a", "business_app")).not.toThrow();
        win.localStorage = previous;
    });
});
