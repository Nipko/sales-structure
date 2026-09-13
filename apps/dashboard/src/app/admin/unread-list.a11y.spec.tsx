import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import AutomationPage from "./automation/page";
import UsersPage from "./users/page";

/**
 * Two list screens, asked for a list nobody answered with.
 *
 * `[]` is the shape of "this tenant has nothing", so a swallowed rejection
 * became a sentence about the account: "todavía no tienes reglas" invites the
 * owner to rebuild automation that may already be running, and an empty roster
 * plus its four counters ("0 usuarios · 0 administradores") is a claim about
 * who can reach this tenant's inbox.
 *
 * `/admin/users` also carried the data-source badge, which said "DEMO" in
 * exactly this state — see `hooks/data-source-badge.a11y.spec.tsx`.
 */

const reject = () => Promise.reject(new Error("network"));

jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: {
        getAutomationRules: jest.fn(() => reject()),
        toggleRule: jest.fn(async () => ({ success: true })),
        deleteRule: jest.fn(async () => ({ success: true })),
        getUsers: jest.fn(() => reject()),
        listInvitations: jest.fn(async () => ({ success: true, data: [] })),
        getTenants: jest.fn(async () => ({ success: true, data: [] })),
    },
}));

jest.mock("@/contexts/TenantContext", () => ({
    __esModule: true,
    useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }),
}));

jest.mock("@/contexts/AuthContext", () => ({
    __esModule: true,
    useAuth: () => ({
        user: { id: "u1", role: "tenant_admin", tenantId: "11111111-1111-4111-8111-111111111111" },
        verticalConfig: null,
    }),
}));

jest.mock("@/hooks/usePlanLimits", () => ({
    __esModule: true,
    usePlanLimits: () => ({
        features: {}, loading: false, canCreate: () => true, getLimit: () => 10,
    }),
    UpgradeModal: () => null,
}));

const { api } = jest.requireMock("@/lib/api") as { api: Record<string, jest.Mock> };

const textOf = (container: HTMLElement) => container.textContent ?? "";

beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockClear();
});

describe("a list we could not read is not an empty list", () => {
    it("automation says the read failed instead of 'you have no rules yet'", async () => {
        const screen = await renderScreen(<AutomationPage />);

        const alert = screen.container.querySelector('[role="alert"]');
        expect(alert).not.toBeNull();
        expect(alert!.textContent).toContain("No pudimos leer esta información");
        expect(textOf(screen.container)).not.toContain("No hay reglas de automatización");

        screen.unmount();
    });

    it("automation re-requests the rules when the retry is pressed", async () => {
        const screen = await renderScreen(<AutomationPage />);
        expect(api.getAutomationRules).toHaveBeenCalledTimes(1);

        const retry = Array.from(screen.container.querySelectorAll("button"))
            .find((button) => (button.textContent ?? "").includes("Reintentar"));
        expect(retry).toBeDefined();
        await interact(() => retry!.click());
        expect(api.getAutomationRules).toHaveBeenCalledTimes(2);

        screen.unmount();
    });

    it("users does not count an unread roster", async () => {
        const screen = await renderScreen(<UsersPage />);

        expect(screen.container.querySelector('[role="alert"]')).not.toBeNull();
        // The four counters are `users.length` in four flavours. With no roster
        // they are not zero; they are unknown, so they are not shown at all.
        for (const counter of ["Administradores", "Agentes", "Activos"]) {
            expect(textOf(screen.container)).not.toContain(counter);
        }

        screen.unmount();
    });

    it("users does not label an unread roster as live data", async () => {
        const screen = await renderScreen(<UsersPage />);
        const badge = screen.container.querySelector("span[aria-label]");
        expect(badge?.textContent).not.toContain("EN VIVO");
        expect(badge?.getAttribute("aria-label")).toContain("No pudimos leer");
        screen.unmount();
    });

    it.each([
        ["automation", () => <AutomationPage />],
        ["users", () => <UsersPage />],
    ])("%s has no machine-detectable accessibility violations in the unknown state", async (_name, render) => {
        const screen = await renderScreen(render());
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });
});
