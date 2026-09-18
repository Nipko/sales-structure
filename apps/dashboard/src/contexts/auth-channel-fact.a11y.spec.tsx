import { act } from "react";
import { renderScreen } from "@/test/a11y";
import { QUALITY_HEALTH_REFRESH_EVENT } from "@/lib/quality-health-events";
import { AuthProvider, useAuth } from "./AuthContext";

/**
 * The session carries the server's channel fact, `hasAnyChannel`.
 *
 * The day-0 red bar lets a delivery failure through only over a channel that
 * provably exists, and the stage stopped proving it the moment the wizard's
 * last button wrote `completed`. The fact now travels with the session and is
 * refreshed from `/auth/me` like the other day-0 facts. When it changes, the
 * quality summary in memory describes the account before the change — an
 * account with no channel, whose "connect a channel" critical would read as
 * "the channel you connected cannot deliver" — so a fresh one is requested,
 * even though the stage did not move.
 */

const CREATED = () => new Date(Date.now() - 30 * 60 * 1000).toISOString();

let meFacts: Record<string, unknown> = {};
let meCalls = 0;

function respond(body: unknown, ok = true) {
    return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

function Probe() {
    const { user } = useAuth();
    return <p data-testid="channel">{String(user?.hasAnyChannel)}</p>;
}

async function flush(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

describe("the channel fact in the session", () => {
    const realFetch = global.fetch;
    let clock: jest.SpyInstance<number, []>;
    let now: number;

    beforeEach(() => {
        localStorage.clear();
        meFacts = {};
        meCalls = 0;
        now = Date.now();
        clock = jest.spyOn(Date, "now").mockImplementation(() => now);
        global.fetch = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith("/auth/me")) {
                meCalls += 1;
                return respond({ success: true, data: { id: "user-1", tenantId: "tenant-1", ...meFacts } });
            }
            if (url.endsWith("/auth/activity-ping")) return respond({ success: true, data: { alive: true } });
            return respond({ success: false }, false);
        }) as typeof fetch;
        localStorage.setItem("accessToken", "access-token");
        localStorage.setItem("refreshToken", "refresh-token");
    });

    afterEach(() => {
        clock.mockRestore();
        global.fetch = realFetch;
    });

    it("learns the channel from /auth/me, keeps it through a failed read, and asks for fresh health when it appears", async () => {
        // A session from before the wizard's last button: no channel fact yet.
        localStorage.setItem("user", JSON.stringify({
            id: "user-1",
            email: "owner@example.com",
            role: "tenant_admin",
            tenantId: "tenant-1",
            onboardingStage: "completed",
            firstReplyAt: null,
            tenantCreatedAt: CREATED(),
        }));
        meFacts = { onboardingStage: "completed", firstReplyAt: null, tenantCreatedAt: CREATED(), hasAnyChannel: true };
        const refreshes = jest.fn();
        window.addEventListener(QUALITY_HEALTH_REFRESH_EVENT, refreshes);
        const screen = await renderScreen(<AuthProvider><Probe /></AuthProvider>);
        try {
            await flush();
            expect(meCalls).toBe(1);
            expect(screen.container.textContent).toBe("true");
            expect(JSON.parse(localStorage.getItem("user")!).hasAnyChannel).toBe(true);
            // Same stage, new channel: the summary in memory is stale.
            expect(refreshes).toHaveBeenCalledTimes(1);

            // The next read could not establish the channel: nothing changes.
            meFacts = { onboardingStage: "completed", firstReplyAt: null, tenantCreatedAt: CREATED() };
            now += 60 * 1000;
            await act(async () => { window.dispatchEvent(new Event("focus")); });
            await flush();
            expect(meCalls).toBe(2);
            expect(screen.container.textContent).toBe("true");
            expect(refreshes).toHaveBeenCalledTimes(1);
        } finally {
            screen.unmount();
            window.removeEventListener(QUALITY_HEALTH_REFRESH_EVENT, refreshes);
        }
    });
});
