import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import type { TenantPaymentsConfig } from "@/lib/api";
import TenantPaymentsPage from "./page";

/**
 * The tenant's own payment rail, when its configuration could not be read.
 *
 * `EMPTY_CONFIG` is the shape of "this tenant has never connected a provider",
 * and it was also where a rejection landed. The owner then saw two blank
 * provider cards and a credentials form — an invitation to set up a rail that
 * may already be charging their customers.
 *
 * The Save is what makes this worse than a cosmetic lie. The MercadoPago branch
 * sends `activate: isActive || !activeProvider`, and an unread config has no
 * `activeProvider`, so `activate` computes to `true`: saving credentials from a
 * screen that never loaded switches which gateway takes the tenant's money.
 */

const connected: TenantPaymentsConfig = {
    connected: true,
    activeProvider: "wompi",
    providers: {
        wompi: {
            provider: "wompi",
            connected: true,
            ready: true,
            verified: true,
            webhookConfigured: true,
            environment: "production",
            publicKey: "pub_prod_abc123",
        },
    },
};

const answerRef: { current: unknown } = { current: null };

jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: {
        getTenantPaymentsConfig: jest.fn(async () => {
            const next = answerRef.current;
            if (next instanceof Error) throw next;
            return next;
        }),
        setTenantPaymentsProviderConfig: jest.fn(async () => ({ success: true })),
        activateTenantPaymentsProvider: jest.fn(async () => ({ success: true })),
        disconnectTenantPaymentsProvider: jest.fn(async () => ({ success: true })),
    },
}));

jest.mock("@/contexts/TenantContext", () => ({
    __esModule: true,
    useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }),
}));

jest.mock("@/hooks/usePlanLimits", () => ({
    __esModule: true,
    usePlanLimits: () => ({ features: { customerPayments: true }, loading: false }),
}));

const { api } = jest.requireMock("@/lib/api") as {
    api: {
        getTenantPaymentsConfig: jest.Mock;
        setTenantPaymentsProviderConfig: jest.Mock;
        activateTenantPaymentsProvider: jest.Mock;
        disconnectTenantPaymentsProvider: jest.Mock;
    };
};

const textOf = (container: HTMLElement) => container.textContent ?? "";

beforeEach(() => {
    api.getTenantPaymentsConfig.mockClear();
    api.setTenantPaymentsProviderConfig.mockClear();
    api.activateTenantPaymentsProvider.mockClear();
    api.disconnectTenantPaymentsProvider.mockClear();
});

describe("the tenant payments screen when the config could not be read", () => {
    it.each([
        ["the request rejects", new Error("network")],
        ["the API answers success: false", { success: false, error: "decrypt_unavailable" }],
    ])("says so instead of drawing an unconfigured account (%s)", async (_case, reply) => {
        answerRef.current = reply;
        const screen = await renderScreen(<TenantPaymentsPage />);

        expect(screen.container.querySelector('[role="alert"]')).not.toBeNull();
        expect(textOf(screen.container)).toContain("No pudimos leer tu configuración de cobros");
        // The credential fields are the invitation to reconfigure a live rail.
        expect(screen.container.querySelectorAll("input")).toHaveLength(0);

        screen.unmount();
    });

    it("cannot switch the active gateway from a config it never read", async () => {
        answerRef.current = new Error("network");
        const screen = await renderScreen(<TenantPaymentsPage />);

        for (const button of Array.from(screen.container.querySelectorAll("button"))) {
            await interact(() => button.click());
        }
        expect(api.setTenantPaymentsProviderConfig).not.toHaveBeenCalled();
        expect(api.activateTenantPaymentsProvider).not.toHaveBeenCalled();
        expect(api.disconnectTenantPaymentsProvider).not.toHaveBeenCalled();

        screen.unmount();
    });

    it("re-requests the config when the retry is pressed", async () => {
        answerRef.current = new Error("network");
        const screen = await renderScreen(<TenantPaymentsPage />);
        expect(api.getTenantPaymentsConfig).toHaveBeenCalledTimes(1);

        answerRef.current = { success: true, data: connected };
        const retry = Array.from(screen.container.querySelectorAll("button"))
            .find((button) => (button.textContent ?? "").includes("Reintentar"));
        expect(retry).toBeDefined();
        await interact(() => retry!.click());

        expect(api.getTenantPaymentsConfig).toHaveBeenCalledTimes(2);
        expect(screen.container.querySelector('[role="alert"]')).toBeNull();

        screen.unmount();
    });

    it("still distinguishes a genuinely unconfigured tenant from an unread one", async () => {
        // A real "nothing connected yet" answer must keep working: the fix is
        // about telling the two apart, not about hiding the setup form.
        answerRef.current = { success: true, data: { connected: false, providers: {} } };
        const screen = await renderScreen(<TenantPaymentsPage />);

        expect(screen.container.querySelector('[role="alert"]')).toBeNull();
        expect(screen.container.querySelectorAll("input").length).toBeGreaterThan(0);

        screen.unmount();
    });

    it("has no machine-detectable accessibility violations in the unknown state", async () => {
        answerRef.current = new Error("network");
        const screen = await renderScreen(<TenantPaymentsPage />);
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });
});
