import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import SlackSettingsPage from "./slack/page";
import EcommerceIntegrationPage from "./ecommerce/page";
import ApiKeysPage from "../api-keys/page";

/**
 * Three integration screens, each asked a question nobody answered.
 *
 * They shared one bug in four spellings: the load swallowed its rejection and
 * the initial state stayed on screen, which in every case is the shape of "not
 * configured". An owner reads that as a fact about their account — and on the
 * two screens whose Save posts the whole form, acts on it destructively:
 *
 * - Slack `save` PUTs the entire `cfg`, so one Save writes `enabled: false,
 *   webhookUrl: ""` over a working destination and switches their alerts off.
 * - E-commerce `handleSave` PUTs the whole form, wiping the stored access
 *   token; its `catch(() => null)` made a rejection indistinguishable from a
 *   store that was never connected.
 * - API keys reported "No hay claves de API", which is a claim that nothing
 *   out there is currently authorised against this tenant's BI API.
 *
 * Payments has its own spec (`payments/tenant-payments.a11y.spec.tsx`) because
 * its Save can switch the live gateway.
 */

const reject = () => Promise.reject(new Error("network"));

jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: {
        getSlackConfig: jest.fn(() => reject()),
        updateSlackConfig: jest.fn(async () => ({ success: true })),
        testSlack: jest.fn(async () => ({ success: true })),
        listPublicApiKeys: jest.fn(() => reject()),
        createPublicApiKey: jest.fn(async () => ({ success: true })),
        revokePublicApiKey: jest.fn(async () => ({ success: true })),
        rotatePublicApiKey: jest.fn(async () => ({ success: true })),
        // The e-commerce page swallows rejections itself with `.catch(() => null)`,
        // which is exactly the ambiguity under test.
        fetch: jest.fn(() => reject()),
    },
}));

jest.mock("@/contexts/TenantContext", () => ({
    __esModule: true,
    useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }),
}));

jest.mock("@/contexts/AuthContext", () => ({
    __esModule: true,
    useAuth: () => ({ user: { id: "u1", role: "tenant_admin", tenantId: "11111111-1111-4111-8111-111111111111" } }),
}));

jest.mock("@/hooks/usePlanLimits", () => ({
    __esModule: true,
    usePlanLimits: () => ({ features: { publicApi: true }, loading: false, canCreate: () => true, getLimit: () => 10 }),
}));

const { api } = jest.requireMock("@/lib/api") as { api: Record<string, jest.Mock> };

const clickEverything = async (container: HTMLElement) => {
    for (const button of Array.from(container.querySelectorAll("button"))) {
        await interact(() => button.click());
    }
};

beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockClear();
});

describe("integration screens do not report a failed read as 'not configured'", () => {
    it.each([
        ["Slack", () => <SlackSettingsPage />],
        ["E-commerce", () => <EcommerceIntegrationPage />],
        ["API keys", () => <ApiKeysPage />],
    ])("%s says the read failed, out loud", async (_name, render) => {
        const screen = await renderScreen(render());
        const alert = screen.container.querySelector('[role="alert"]');
        expect(alert).not.toBeNull();
        expect(alert!.textContent).toContain("No pudimos leer esta información");
        screen.unmount();
    });

    it("Slack will not write an empty webhook over a working one", async () => {
        const screen = await renderScreen(<SlackSettingsPage />);
        // The form is withheld, so there is no checkbox to flip and no field to
        // blank — and the handler refuses even if something reaches it.
        expect(screen.container.querySelectorAll("input")).toHaveLength(0);
        await clickEverything(screen.container);
        expect(api.updateSlackConfig).not.toHaveBeenCalled();
        screen.unmount();
    });

    it("E-commerce will not write an empty store config over the saved one", async () => {
        const screen = await renderScreen(<EcommerceIntegrationPage />);
        expect(screen.container.querySelectorAll("input")).toHaveLength(0);
        await clickEverything(screen.container);
        // Only the initial reads happened; no PUT and no sync.
        const writes = api.fetch.mock.calls.filter(([, init]) => init?.method && init.method !== "GET");
        expect(writes).toEqual([]);
        screen.unmount();
    });

    it("API keys does not claim nothing is authorised when it could not check", async () => {
        const screen = await renderScreen(<ApiKeysPage />);
        expect(screen.container.textContent).not.toContain("No hay claves de API");
        screen.unmount();
    });

    it("each retry re-runs the read that failed", async () => {
        const screen = await renderScreen(<SlackSettingsPage />);
        expect(api.getSlackConfig).toHaveBeenCalledTimes(1);
        const retry = Array.from(screen.container.querySelectorAll("button"))
            .find((button) => (button.textContent ?? "").includes("Reintentar"));
        expect(retry).toBeDefined();
        await interact(() => retry!.click());
        expect(api.getSlackConfig).toHaveBeenCalledTimes(2);
        screen.unmount();
    });

    it.each([
        ["Slack", () => <SlackSettingsPage />],
        ["E-commerce", () => <EcommerceIntegrationPage />],
        ["API keys", () => <ApiKeysPage />],
    ])("%s has no machine-detectable accessibility violations in the unknown state", async (_name, render) => {
        const screen = await renderScreen(render());
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });
});
