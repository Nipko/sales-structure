import { WHATSAPP_CONNECT_ROUTE_IDS, getWhatsAppConnectRoute } from "./whatsapp-connect-routes";
import {
    WHATSAPP_TRIAGE_ANSWERS,
    WHATSAPP_TRIAGE_ANSWER_IDS,
    fetchRecordedTriage,
    getWhatsAppTriageAnswer,
    isWhatsAppTriageAnswerId,
    persistTriage,
    readRecordedTriage,
    readRememberedTriage,
    rememberTriage,
    routeAfterTriage,
    triageRouteId,
    whatsAppTriageEndpoint,
    whatsAppTriageKey,
} from "./whatsapp-triage";

const mockFetch = jest.fn();
const mockGetSetupStatus = jest.fn();
jest.mock("@/lib/api", () => ({
    api: {
        fetch: (...args: unknown[]) => mockFetch(...args),
        getSetupStatus: (...args: unknown[]) => mockGetSetupStatus(...args),
    },
}));

beforeEach(() => {
    mockFetch.mockReset().mockResolvedValue({ success: true });
    mockGetSetupStatus.mockReset();
});

/** Lets every queued write settle. */
async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

// A write a test started lands inside that test, never in the next one's mock.
afterEach(() => flush());

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

    // "Lo dejamos anotado y lo retomas cuando lo tengas" has to hold on her
    // phone too: every answer goes to the account, the browser keeps a copy.
    it("writes every answer, and every take-back, to the account", async () => {
        rememberTriage("tenant-a", "not_at_hand");
        rememberTriage("tenant-a", null);
        await flush();
        expect(mockFetch.mock.calls).toEqual([
            ["/persona/tenant-a/whatsapp-triage", { method: "PUT", body: JSON.stringify({ answerId: "not_at_hand" }) }],
            ["/persona/tenant-a/whatsapp-triage", { method: "PUT", body: JSON.stringify({ answerId: null }) }],
        ]);
    });

    it("writes nothing without a tenant", async () => {
        rememberTriage(null, "business_app");
        await flush();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("keeps the local copy even when the account could not be reached", async () => {
        mockFetch.mockRejectedValue(new Error("offline"));
        rememberTriage("tenant-a", "other_provider");
        await flush();
        expect(readRememberedTriage("tenant-a")).toBe("other_provider");
        await expect(persistTriage("tenant-a", "other_provider")).resolves.toBe(false);
    });
});

describe("the account's answer is the one that counts", () => {
    it("addresses the tenant in the path, safely", () => {
        expect(whatsAppTriageEndpoint("tenant-a")).toBe("/persona/tenant-a/whatsapp-triage");
        expect(whatsAppTriageEndpoint("a/b")).toBe("/persona/a%2Fb/whatsapp-triage");
    });

    it("reads setup-status's whatsappTriage and nothing that only looks like it", () => {
        expect(readRecordedTriage({ answerId: "not_at_hand", recordedAt: "2026-09-18T15:00:00.000Z" }))
            .toEqual({ answerId: "not_at_hand", recordedAt: "2026-09-18T15:00:00.000Z" });
        for (const junk of [null, undefined, "not_at_hand", [], { answerId: "sandbox", recordedAt: "x" }, { answerId: "new_number" }]) {
            expect(readRecordedTriage(junk)).toBeNull();
        }
    });

    it("treats a recordedAt that is not a date as no answer, like the API's own reader", () => {
        // A valid id is not enough: the API only writes an ISO instant, so a
        // date nobody can read is a hand-edited or foreign row, not her answer.
        for (const recordedAt of ["x", "ayer", "2026-13-45T99:00:00Z", "   "]) {
            expect({ recordedAt, read: readRecordedTriage({ answerId: "not_at_hand", recordedAt }) })
                .toEqual({ recordedAt, read: null });
        }
        // Any date the platform can read still counts, not only the exact ISO shape.
        expect(readRecordedTriage({ answerId: "other_provider", recordedAt: "2026-09-18" }))
            .toEqual({ answerId: "other_provider", recordedAt: "2026-09-18" });
    });

    it("reads an unreadable date from setup-status as no answer, not as an unreadable account", async () => {
        mockGetSetupStatus.mockResolvedValueOnce({ success: true, data: { whatsappTriage: { answerId: "new_number", recordedAt: "not a date" } } });
        await expect(fetchRecordedTriage("tenant-a")).resolves.toBeNull();
    });

    it("tells an answer apart from no answer, and both from an unreadable one", async () => {
        mockGetSetupStatus.mockResolvedValueOnce({ success: true, data: { whatsappTriage: { answerId: "new_number", recordedAt: "2026-09-18T15:00:00.000Z" } } });
        await expect(fetchRecordedTriage("tenant-a")).resolves.toEqual({ answerId: "new_number", recordedAt: "2026-09-18T15:00:00.000Z" });

        mockGetSetupStatus.mockResolvedValueOnce({ success: true, data: { whatsappTriage: null } });
        await expect(fetchRecordedTriage("tenant-a")).resolves.toBeNull();

        // An API older than the field, a refusal, a network error: nobody
        // could look, which is not "she never answered".
        mockGetSetupStatus.mockResolvedValueOnce({ success: true, data: { hasAnyChannel: false } });
        await expect(fetchRecordedTriage("tenant-a")).resolves.toBeUndefined();
        mockGetSetupStatus.mockResolvedValueOnce({ success: false, error: "Error 500" });
        await expect(fetchRecordedTriage("tenant-a")).resolves.toBeUndefined();
        mockGetSetupStatus.mockRejectedValueOnce(new Error("offline"));
        await expect(fetchRecordedTriage("tenant-a")).resolves.toBeUndefined();
    });

    it("sends the writes of one tenant in the order she made them", async () => {
        const releases: Array<() => void> = [];
        mockFetch.mockImplementation(() => new Promise((resolve) => { releases.push(() => resolve({ success: true })); }));
        const first = persistTriage("tenant-z", "business_app");
        const second = persistTriage("tenant-z", null);
        await flush();
        // The take-back is not sent while the answer is still on its way.
        expect(mockFetch).toHaveBeenCalledTimes(1);
        releases[0]();
        await first;
        await flush();
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch.mock.calls[1][1]).toEqual({ method: "PUT", body: JSON.stringify({ answerId: null }) });
        releases[1]();
        await expect(second).resolves.toBe(true);
    });

    it("reads only after its own pending write has landed", async () => {
        // "Cambiar mi respuesta" remounts the question: a read that overtook
        // the clearing write would bring back the answer she just took back.
        let release: () => void = () => undefined;
        mockFetch.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ success: true }); }));
        mockGetSetupStatus.mockResolvedValue({ success: true, data: { whatsappTriage: null } });
        void persistTriage("tenant-y", null);
        const read = fetchRecordedTriage("tenant-y");
        await flush();
        expect(mockGetSetupStatus).not.toHaveBeenCalled();
        release();
        await expect(read).resolves.toBeNull();
        expect(mockGetSetupStatus).toHaveBeenCalledWith("tenant-y");
    });
});
