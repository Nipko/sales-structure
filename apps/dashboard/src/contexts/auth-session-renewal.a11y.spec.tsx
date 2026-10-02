import { act, useState } from "react";
import { renderScreen } from "@/test/a11y";
import { authFetch, refreshAccessToken } from "@/lib/api";
import { AuthProvider, useAuth } from "./AuthContext";

let mockPathname = "/admin/appointments";
const mockPush = jest.fn();
const mockRouter = { push: mockPush, replace: jest.fn() };
jest.mock("next/navigation", () => ({
    useRouter: () => mockRouter,
    usePathname: () => mockPathname,
}));
jest.mock("@/components/SessionTimeoutModal", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/SessionConflictModal", () => ({ __esModule: true, default: () => null }));

const MINUTE = 60_000;
const storedUser = {
    id: "owner", tenantId: "tenant", role: "tenant_admin", emailVerified: true,
    onboardingStage: "live", firstReplyAt: "2026-09-10T12:00:00Z",
};
const response = (status: number, data: unknown = {}) => ({
    status, ok: status >= 200 && status < 300,
    json: async () => ({ success: status === 200, data }),
} as Response);
const renewed = () => response(200, { accessToken: "new-access", refreshToken: "new-refresh" });
const callsTo = (path: string) => (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith(path));

function Probe() {
    return <output>{useAuth().user?.id ?? "logged-out"}</output>;
}

describe("session renewal shared by API calls and activity pings", () => {
    const realFetch = global.fetch;
    const realLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.clear();
        localStorage.setItem("accessToken", "old-access");
        localStorage.setItem("refreshToken", "old-refresh");
        localStorage.setItem("user", JSON.stringify(storedUser));
        mockPush.mockClear();
        mockPathname = "/admin/appointments";
        Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    });
    afterEach(() => {
        jest.useRealTimers();
        global.fetch = realFetch;
        if (realLocks) Object.defineProperty(navigator, "locks", realLocks);
        else Reflect.deleteProperty(navigator, "locks");
    });

    it("renews an expired heartbeat once while another request also receives 401", async () => {
        let release!: (value: Response) => void;
        const pendingRefresh = new Promise<Response>((resolve) => { release = resolve; });
        global.fetch = jest.fn(async (url, init) => {
            if (String(url).endsWith("/auth/refresh")) return pendingRefresh;
            if (String(url).endsWith("/auth/activity-ping") || String(url).endsWith("/appointments/test")) {
                return response((init?.headers as Record<string, string>)?.Authorization === "Bearer new-access" ? 200 : 401);
            }
            return response(200);
        }) as typeof fetch;
        const screen = await renderScreen(<AuthProvider><Probe /></AuthProvider>);
        try {
            const request = authFetch("/appointments/test", { method: "POST", body: "{}" }, false);
            const proactive = refreshAccessToken();
            await act(async () => { await Promise.resolve(); });
            expect(callsTo("/auth/refresh")).toHaveLength(1);
            await act(async () => {
                release(renewed());
                expect((await request).status).toBe(200);
                await proactive;
            });
            expect(callsTo("/auth/refresh")).toHaveLength(1);
            expect(localStorage.getItem("accessToken")).toBe("new-access");
            expect(localStorage.getItem("refreshToken")).toBe("new-refresh");
            expect(screen.container.textContent).toBe("owner");
            expect(mockPush).not.toHaveBeenCalled();
            expect(callsTo("/auth/logout")).toHaveLength(0);
        } finally { screen.unmount(); }
    });

    it.each(["network", "503", "403"])("keeps credentials through an unconfirmed %s failure and retries the next ping", async (failure) => {
        let recovered = false;
        global.fetch = jest.fn(async (url, init) => {
            if (String(url).endsWith("/auth/refresh")) {
                if (recovered) return renewed();
                if (failure === "network") throw new TypeError("Failed to fetch");
                return response(Number(failure));
            }
            if (String(url).endsWith("/auth/activity-ping")) {
                return response((init?.headers as Record<string, string>)?.Authorization === "Bearer new-access" ? 200 : 401);
            }
            return response(200);
        }) as typeof fetch;
        const screen = await renderScreen(<AuthProvider><Probe /></AuthProvider>);
        try {
            expect(localStorage.getItem("refreshToken")).toBe("old-refresh");
            expect(mockPush).not.toHaveBeenCalled();
            recovered = true;
            await act(async () => { await jest.advanceTimersByTimeAsync(2 * MINUTE); });
            expect(localStorage.getItem("accessToken")).toBe("new-access");
            expect(screen.container.textContent).toBe("owner");
            expect(mockPush).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
    });

    it.each(["refresh rejected", "retry rejected"])("expires the session when authentication is definitively rejected (%s)", async (failure) => {
        global.fetch = jest.fn(async (url) => {
            if (String(url).endsWith("/auth/refresh")) return failure === "refresh rejected" ? response(401) : renewed();
            if (String(url).endsWith("/auth/activity-ping")) return response(401);
            return response(200);
        }) as typeof fetch;
        const screen = await renderScreen(<AuthProvider><Probe /></AuthProvider>);
        try {
            await act(async () => { await Promise.resolve(); });
            expect(screen.container.textContent).toBe("logged-out");
            expect(localStorage.getItem("accessToken")).toBeNull();
            expect(localStorage.getItem("refreshToken")).toBeNull();
            expect(mockPush).toHaveBeenCalledTimes(1);
            expect(mockPush).toHaveBeenCalledWith("/login?expired=1");
        } finally { screen.unmount(); }
    });

    it("navigation does not postpone proactive renewal, and return-to-tab keeps the session alive", async () => {
        global.fetch = jest.fn(async (url) => String(url).endsWith("/auth/refresh") ? renewed() : response(200)) as typeof fetch;
        function NavigatingApp() {
            const [, setRender] = useState(0);
            return <>
                <button type="button" onClick={() => setRender(value => value + 1)}>Navigate</button>
                <AuthProvider><Probe /></AuthProvider>
            </>;
        }
        const screen = await renderScreen(<NavigatingApp />);
        try {
            for (const path of ["/admin/inbox", "/admin/appointments", "/admin/knowledge"]) {
                await act(async () => { await jest.advanceTimersByTimeAsync(3 * MINUTE); });
                mockPathname = path;
                await act(async () => { screen.container.querySelector("button")?.click(); });
            }
            expect(callsTo("/auth/refresh")).toHaveLength(0);
            await act(async () => { await jest.advanceTimersByTimeAsync(MINUTE); });
            expect(callsTo("/auth/refresh")).toHaveLength(1);
            const pingCount = callsTo("/auth/activity-ping").length;
            await act(async () => {
                await jest.advanceTimersByTimeAsync(45_000);
                window.dispatchEvent(new Event("focus"));
            });
            expect(callsTo("/auth/activity-ping")).toHaveLength(pingCount + 1);
            expect(mockPush).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
    });

    it("reuses credentials renewed by another tab while waiting for the shared lock", async () => {
        global.fetch = jest.fn();
        const request = jest.fn(async (_name, callback) => {
            localStorage.setItem("accessToken", "other-tab-access");
            localStorage.setItem("refreshToken", "other-tab-refresh");
            return callback();
        });
        Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
        expect(await refreshAccessToken("old-access")).toBe("other-tab-access");
        expect(request).toHaveBeenCalledWith("parallly-auth-refresh", expect.any(Function));
        expect(global.fetch).not.toHaveBeenCalled();
        expect(localStorage.getItem("refreshToken")).toBe("other-tab-refresh");
    });

    it("does not restore an old session if logout wins an in-flight refresh", async () => {
        let release!: (value: Response) => void;
        global.fetch = jest.fn(() => new Promise<Response>(resolve => { release = resolve; })) as typeof fetch;
        const result = refreshAccessToken();
        localStorage.clear();
        release(renewed());
        await expect(result).rejects.toThrow("Session changed");
        expect(localStorage.getItem("accessToken")).toBeNull();
        expect(localStorage.getItem("refreshToken")).toBeNull();
    });

    it.each(["another user", "same user with a new session"])("never replays an old action after the lock changes to %s", async (kind) => {
        const jwt = (sid: string) => `header.${btoa(JSON.stringify({ sub: "owner", sid }))}.signature`;
        if (kind === "same user with a new session") localStorage.setItem("accessToken", jwt("session-a"));
        const nextAccess = kind === "another user" ? "other-login-access" : jwt("session-b");
        global.fetch = jest.fn(async () => response(401)) as typeof fetch;
        Object.defineProperty(navigator, "locks", { configurable: true, value: {
            request: async (_name: string, callback: () => Promise<unknown>) => {
                localStorage.setItem("user", JSON.stringify({ ...storedUser, id: kind === "another user" ? "another-owner" : "owner" }));
                localStorage.setItem("accessToken", nextAccess);
                localStorage.setItem("refreshToken", "other-login-refresh");
                return callback();
            },
        } });
        await expect(authFetch("/appointments/test", { method: "POST", body: "{}" })).rejects.toThrow("Session changed");
        expect(callsTo("/appointments/test")).toHaveLength(1);
        expect(callsTo("/auth/refresh")).toHaveLength(0);
        expect(localStorage.getItem("accessToken")).toBe(nextAccess);
    });

    it("keeps a newer session when a previous session's retry returns a late 401", async () => {
        let release!: (value: Response) => void;
        let retryStarted = false;
        global.fetch = jest.fn(async (url, init) => {
            if (String(url).endsWith("/auth/refresh")) return renewed();
            if ((init?.headers as Record<string, string>)?.Authorization === "Bearer new-access") {
                retryStarted = true;
                return new Promise<Response>(resolve => { release = resolve; });
            }
            return response(401);
        }) as typeof fetch;
        const request = authFetch("/appointments/test", { method: "POST", body: "{}" });
        for (let i = 0; i < 10 && !retryStarted; i++) await Promise.resolve();
        expect(retryStarted).toBe(true);
        localStorage.setItem("user", JSON.stringify({ ...storedUser, id: "another-owner" }));
        localStorage.setItem("accessToken", "other-login-access");
        localStorage.setItem("refreshToken", "other-login-refresh");
        release(response(401));
        await expect(request).rejects.toThrow("Session changed");
        expect(localStorage.getItem("accessToken")).toBe("other-login-access");
        expect(localStorage.getItem("refreshToken")).toBe("other-login-refresh");
    });
});
