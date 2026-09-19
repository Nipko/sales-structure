import { act } from "react";
import { renderScreen } from "@/test/a11y";
import { QUALITY_HEALTH_REFRESH_EVENT } from "@/lib/quality-health-events";
import { AuthProvider, useAuth } from "./AuthContext";

/**
 * The panel notices the agent's first reply without waiting for a token
 * refresh.
 *
 * The stage used to travel only on login and on the refresh every ~10 minutes.
 * An owner who wrote to her own number from her phone came back to a panel
 * still in day-0 silence, with no way to know her agent had answered. The
 * session now re-reads the day-0 facts from `/auth/me` when the panel opens
 * and when the person comes back to the tab — only while the account is still
 * waiting for its first reply, and never more than once every few seconds.
 */

const TODAY = () => new Date(Date.now() - 30 * 60 * 1000).toISOString();

interface FetchCall { url: string; init?: RequestInit }
let calls: FetchCall[] = [];
let meFacts: Record<string, unknown> = {};
let meFails = false;

function respond(body: unknown, ok = true) {
    return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

function meCalls(): FetchCall[] {
    return calls.filter((call) => call.url.endsWith("/auth/me"));
}

function Probe() {
    const { user } = useAuth();
    return (
        <p>
            <span data-testid="stage">{user?.onboardingStage ?? "none"}</span>
            <span data-testid="reply">{user?.firstReplyAt ?? "none"}</span>
        </p>
    );
}

function storeSession(user: Record<string, unknown>): void {
    localStorage.setItem("accessToken", "access-token");
    localStorage.setItem("refreshToken", "refresh-token");
    localStorage.setItem("user", JSON.stringify(user));
}

function owner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "user-1",
        email: "owner@example.com",
        firstName: "Ana",
        lastName: "Ruiz",
        role: "tenant_admin",
        tenantId: "tenant-1",
        onboardingStage: "completed",
        firstReplyAt: null,
        tenantCreatedAt: TODAY(),
        ...overrides,
    };
}

async function flush(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

async function returnToTab(): Promise<void> {
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
}

function text(container: HTMLElement, id: string): string {
    return container.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";
}

describe("day-0 facts in the session", () => {
    const realFetch = global.fetch;
    let clock: jest.SpyInstance<number, []>;
    let now: number;

    beforeEach(() => {
        localStorage.clear();
        calls = [];
        meFacts = {};
        meFails = false;
        now = Date.now();
        clock = jest.spyOn(Date, "now").mockImplementation(() => now);
        global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            calls.push({ url, init });
            if (url.endsWith("/auth/me")) {
                if (meFails) return respond({ success: false }, false);
                return respond({ success: true, data: { id: "user-1", tenantId: "tenant-1", ...meFacts } });
            }
            if (url.endsWith("/auth/activity-ping")) return respond({ success: true, data: { alive: true } });
            return respond({ success: false }, false);
        }) as typeof fetch;
    });

    afterEach(() => {
        clock.mockRestore();
        global.fetch = realFetch;
    });

    it("learns the first reply as soon as the panel opens, and then stops asking", async () => {
        storeSession(owner());
        meFacts = { onboardingStage: "completed", firstReplyAt: "2026-09-17T14:59:00.000Z", tenantCreatedAt: TODAY() };
        const screen = await renderScreen(<AuthProvider><Probe /></AuthProvider>);
        try {
            await flush();
            expect(meCalls()).toHaveLength(1);
            expect(meCalls()[0].init?.headers).toMatchObject({ Authorization: "Bearer access-token" });
            expect(text(screen.container, "reply")).toBe("2026-09-17T14:59:00.000Z");
            // The stored session carries it too, so a reload starts out live.
            expect(JSON.parse(localStorage.getItem("user")!).firstReplyAt).toBe("2026-09-17T14:59:00.000Z");

            // Live now: coming back to the tab costs nothing any more.
            now += 5 * 60 * 1000;
            await returnToTab();
            expect(meCalls()).toHaveLength(1);
        } finally { screen.unmount(); }
    });

    it("re-reads when the owner comes back to the tab, but not on every focus", async () => {
        storeSession(owner({ onboardingStage: "agent_reviewed" }));
        meFacts = { onboardingStage: "agent_reviewed", firstReplyAt: null, tenantCreatedAt: TODAY() };
        const refreshes = jest.fn();
        window.addEventListener(QUALITY_HEALTH_REFRESH_EVENT, refreshes);
        const screen = await renderScreen(<AuthProvider><Probe /></AuthProvider>);
        try {
            await flush();
            expect(meCalls()).toHaveLength(1);

            // A focus right after the first read is not a reason to ask again.
            now += 5 * 1000;
            await returnToTab();
            expect(meCalls()).toHaveLength(1);

            // She connected WhatsApp in another tab and came back.
            meFacts = { onboardingStage: "channel_connected", firstReplyAt: null, tenantCreatedAt: TODAY() };
            now += 60 * 1000;
            await returnToTab();
            expect(meCalls()).toHaveLength(2);
            expect(text(screen.container, "stage")).toBe("channel_connected");
            // The quality summary in memory describes the account before the
            // connection; the change asks for a fresh one.
            expect(refreshes).toHaveBeenCalledTimes(1);
        } finally {
            screen.unmount();
            window.removeEventListener(QUALITY_HEALTH_REFRESH_EVENT, refreshes);
        }
    });

    it("never asks for an account whose agent already answered", async () => {
        storeSession(owner({ firstReplyAt: "2026-09-10T10:00:00.000Z" }));
        const screen = await renderScreen(<AuthProvider><Probe /></AuthProvider>);
        try {
            await flush();
            now += 5 * 60 * 1000;
            await returnToTab();
            expect(meCalls()).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("leaves the session alone when the read fails, and tries again on the next return", async () => {
        storeSession(owner({ onboardingStage: "agent_reviewed" }));
        meFails = true;
        const screen = await renderScreen(<AuthProvider><Probe /></AuthProvider>);
        try {
            await flush();
            expect(meCalls()).toHaveLength(1);
            expect(text(screen.container, "stage")).toBe("agent_reviewed");
            expect(text(screen.container, "reply")).toBe("none");

            meFails = false;
            meFacts = { onboardingStage: "agent_reviewed", firstReplyAt: "2026-09-17T14:59:00.000Z", tenantCreatedAt: TODAY() };
            now += 60 * 1000;
            await returnToTab();
            expect(meCalls()).toHaveLength(2);
            expect(text(screen.container, "reply")).toBe("2026-09-17T14:59:00.000Z");
        } finally { screen.unmount(); }
    });
});
