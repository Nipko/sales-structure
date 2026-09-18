import { interact, renderScreen, type RenderedScreen } from "@/test/a11y";
import { AuthProvider, useAuth } from "./AuthContext";

/**
 * The confirmed email reaches an open panel without a reload.
 *
 * The wizard refuses Instagram, Messenger and Telegram while the session says
 * `emailVerified: false` (`emailBlocksConnect`). That flag was written at login
 * and by /verify-email only, so an owner who typed the code in another tab or
 * on her phone came back to a wizard that still refused her until she reloaded
 * the whole page. The panel now takes the confirmation from two places: the
 * `/auth/me` read it already does when the window regains focus — also after
 * day 0, while the email is still unconfirmed — and the stored session another
 * tab rewrites (`storage`).
 *
 * The real provider; the network and the router are faked.
 */

jest.mock("next/navigation", () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => "/admin/setup-wizard",
}));
jest.mock("@/hooks/useIdleTimer", () => ({ __esModule: true, useIdleTimer: () => ({ resetActivity: jest.fn() }) }));
jest.mock("@/components/SessionTimeoutModal", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/SessionConflictModal", () => ({ __esModule: true, default: () => null }));

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-09-18T15:00:00.000Z");

/** An owner whose agent already answered: out of day 0, email still unconfirmed. */
function liveOwner(overrides: Record<string, unknown> = {}) {
    return {
        id: "user-1", email: "owner@example.com", firstName: "Ana", lastName: "Ruiz", role: "tenant_admin",
        tenantId: "tenant-1", onboardingStage: "live", firstReplyAt: new Date(T0 - HOUR).toISOString(),
        tenantCreatedAt: new Date(T0 - 2 * HOUR).toISOString(), emailVerified: false, ...overrides,
    };
}

function EmailFlag() {
    const { user } = useAuth();
    return <output data-email-verified>{String(user?.emailVerified)}</output>;
}

/** What `fetch` resolves to, as far as the provider reads it (jsdom has no `Response`). */
const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const flag = (screen: RenderedScreen) => screen.container.querySelector("[data-email-verified]")?.textContent;

describe("the session learns the email was confirmed elsewhere", () => {
    let now = T0;
    let serverVerified = false;
    let meReads = 0;
    const originalFetch = global.fetch;

    beforeEach(() => {
        now = T0;
        serverVerified = false;
        meReads = 0;
        jest.spyOn(Date, "now").mockImplementation(() => now);
        localStorage.clear();
        localStorage.setItem("accessToken", "access-token");
        global.fetch = jest.fn(async (url: RequestInfo | URL) => {
            const endpoint = String(url);
            if (endpoint.endsWith("/auth/me")) {
                meReads += 1;
                // `/auth/me` is the whole validated user plus the day-0 facts.
                return reply({ success: true, data: { ...liveOwner(), emailVerified: serverVerified } });
            }
            return reply({ success: false });
        }) as unknown as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it("reads /auth/me again when she comes back to the window, after day 0 too, and takes the confirmation", async () => {
        localStorage.setItem("user", JSON.stringify(liveOwner()));
        const screen = await renderScreen(<AuthProvider><EmailFlag /></AuthProvider>);
        try {
            await interact(() => {});
            expect(flag(screen)).toBe("false");
            const readsBefore = meReads;

            // She confirms on her phone, and comes back to the panel.
            serverVerified = true;
            now = T0 + 30_000;
            await interact(() => { window.dispatchEvent(new Event("focus")); });
            await interact(() => {});

            expect(meReads).toBeGreaterThan(readsBefore);
            expect(flag(screen)).toBe("true");
            // The stored session says so too: the next load starts from it.
            expect(JSON.parse(localStorage.getItem("user")!).emailVerified).toBe(true);
        } finally { screen.unmount(); }
    });

    it("takes the confirmation another tab stored, without waiting for a read", async () => {
        localStorage.setItem("user", JSON.stringify(liveOwner()));
        const screen = await renderScreen(<AuthProvider><EmailFlag /></AuthProvider>);
        try {
            await interact(() => {});
            expect(flag(screen)).toBe("false");
            const readsBefore = meReads;

            // /verify-email in another tab rewrites the stored user.
            const confirmed = JSON.stringify(liveOwner({ emailVerified: true }));
            localStorage.setItem("user", confirmed);
            await interact(() => {
                window.dispatchEvent(new StorageEvent("storage", { key: "user", newValue: confirmed, storageArea: localStorage }));
            });

            expect(flag(screen)).toBe("true");
            expect(meReads).toBe(readsBefore);
        } finally { screen.unmount(); }
    });

    it("ignores a stored user that is somebody else", async () => {
        localStorage.setItem("user", JSON.stringify(liveOwner()));
        const screen = await renderScreen(<AuthProvider><EmailFlag /></AuthProvider>);
        try {
            await interact(() => {});
            const someoneElse = JSON.stringify(liveOwner({ id: "user-2", emailVerified: true }));
            await interact(() => {
                window.dispatchEvent(new StorageEvent("storage", { key: "user", newValue: someoneElse, storageArea: localStorage }));
            });
            expect(flag(screen)).toBe("false");
        } finally { screen.unmount(); }
    });

    it("does not keep reading /auth/me on focus once the email is confirmed and day 0 is over", async () => {
        localStorage.setItem("user", JSON.stringify(liveOwner({ emailVerified: true })));
        const screen = await renderScreen(<AuthProvider><EmailFlag /></AuthProvider>);
        try {
            await interact(() => {});
            const readsBefore = meReads;
            now = T0 + 60_000;
            await interact(() => { window.dispatchEvent(new Event("focus")); });
            await interact(() => {});
            expect(meReads).toBe(readsBefore);
        } finally { screen.unmount(); }
    });
});
