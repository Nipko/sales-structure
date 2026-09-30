import { randomUUID } from "crypto";
import { interact, renderScreen } from "@/test/a11y";
import { api } from "@/lib/api";
import BillingPage from "./page";

jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant" }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator-1", role: "super_admin" } }) }));
jest.mock("@/components/ui/help-panel", () => ({ HelpPanel: () => null }));
jest.mock("@/components/FiscalGateModal", () => ({ FiscalGateModal: () => null }));
jest.mock("@/lib/api", () => ({ api: {
    getBillingSubscription: jest.fn(), getBillingPlans: jest.fn(), getBillingUsage: jest.fn(), fetch: jest.fn(),
    getFiscalData: jest.fn(), getBillingPublicConfig: jest.fn(), listPaymentSources: jest.fn(), refundBillingPayment: jest.fn(),
} }));

const payment = {
    id: "payment-1", provider: "stripe", providerPaymentId: "in_paid", status: "succeeded",
    amountCents: 6900, currency: "USD", paidAt: "2026-09-01T00:00:00Z", createdAt: "2026-09-01T00:00:00Z",
};
const storageKey = "parallly:billing:refund:operator-1:payment-1";
const pendingMessage = "El resultado del reembolso sigue pendiente.";
const successMessage = "Reembolso confirmado.";

function refundButton(container: HTMLElement): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === "Reembolsar");
    if (!found) throw new Error("Refund button not found");
    return found;
}

describe("subscription payment refund recovery", () => {
    // jsdom omits this secure-context browser API; use Node's actual generator.
    beforeAll(() => Object.defineProperty(crypto, "randomUUID", { configurable: true, value: randomUUID }));
    beforeEach(() => {
        jest.resetAllMocks();
        sessionStorage.clear();
        localStorage.clear();
        jest.spyOn(window, "prompt").mockReturnValueOnce("1200").mockReturnValueOnce("Solicitud del cliente");
        jest.spyOn(window, "confirm").mockReturnValue(true);
        (api.getBillingSubscription as jest.Mock).mockResolvedValue({ success: true, billingCountry: "US", data: {
            id: "sub", planId: "starter", provider: "stripe", providerBacked: true, status: "active", billingCycle: "monthly",
            currentPeriodStart: "2026-09-01T00:00:00Z", currentPeriodEnd: "2026-10-01T00:00:00Z", payments: [payment],
        } });
        (api.getBillingPlans as jest.Mock).mockResolvedValue({ success: true, data: [{
            id: "starter", slug: "starter", name: "Starter", priceUsdCents: 6900,
            displayPriceCents: 6900, displayCurrency: "USD", features: {}, trialDays: 0,
            maxAgents: 1, maxAiMessages: 1000,
            signupAvailable: true, monthlyAvailable: true, annualAvailable: false, checkoutMode: "self_serve",
        }] });
        (api.getBillingUsage as jest.Mock).mockResolvedValue({ success: true, data: null });
        (api.fetch as jest.Mock).mockResolvedValue({ success: false });
        (api.getBillingPublicConfig as jest.Mock).mockResolvedValue({ success: true, data: {
            provider: "stripe", country: "US", methods: ["card"], publicKey: null, environment: "sandbox",
        } });
        (api.listPaymentSources as jest.Mock).mockResolvedValue({ success: true, data: [] });
    });

    afterEach(() => jest.restoreAllMocks());

    it("reuses the original request, partial amount and reason after timeout and remount without new prompts", async () => {
        (api.refundBillingPayment as jest.Mock).mockRejectedValueOnce(new Error("timeout"))
            .mockResolvedValueOnce({ success: true, data: { providerPaymentId: "in_paid", status: "pending" } });
        let screen = await renderScreen(<BillingPage />);
        try {
            await interact(() => refundButton(screen.container).click());
            const original = (api.refundBillingPayment as jest.Mock).mock.calls[0][1];
            expect(original).toEqual({ requestId: expect.any(String), amountCents: 1200, reason: "Solicitud del cliente", expectedRefundedAmountCents: 0 });
            expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(original);
            expect(screen.container.textContent).toContain(pendingMessage);
            expect(window.prompt).toHaveBeenCalledTimes(2);
            screen.unmount();
            sessionStorage.clear(); // Closing a tab must not discard its unresolved refund identity.
            screen = await renderScreen(<BillingPage />);
            await interact(() => refundButton(screen.container).click());
            expect(window.confirm).toHaveBeenCalledTimes(1);
            expect(window.prompt).toHaveBeenCalledTimes(2);
            expect(api.refundBillingPayment).toHaveBeenNthCalledWith(2, payment.id, original);
            expect(screen.container.textContent).toContain(pendingMessage);
            expect(screen.container.textContent).not.toContain(successMessage);
        } finally { screen.unmount(); }
    });

    it.each([
        ["pending", pendingMessage],
        ["needs_review", "Este reembolso requiere revisión en Stripe."],
    ])("preserves the %s result after refreshing the payment history", async (status, message) => {
        (api.refundBillingPayment as jest.Mock).mockResolvedValue({ success: true, data: { providerPaymentId: "in_paid", status } });
        const screen = await renderScreen(<BillingPage />);
        try {
            await interact(() => refundButton(screen.container).click());
            expect(api.getBillingSubscription).toHaveBeenCalledTimes(2);
            expect(localStorage.getItem(storageKey)).not.toBeNull();
            expect(screen.container.textContent).toContain(message);
            expect(screen.container.textContent).not.toContain(successMessage);
        } finally { screen.unmount(); }
    });

    it("clears a confirmed failed request and prompts for a deliberate new one", async () => {
        (api.refundBillingPayment as jest.Mock).mockResolvedValueOnce({ success: true, data: { providerPaymentId: "in_paid", status: "failed" } })
            .mockResolvedValueOnce({ success: true, data: { providerPaymentId: "in_paid", status: "pending" } });
        const screen = await renderScreen(<BillingPage />);
        try {
            await interact(() => refundButton(screen.container).click());
            const original = (api.refundBillingPayment as jest.Mock).mock.calls[0][1];
            expect(localStorage.getItem(storageKey)).toBeNull();
            expect(screen.container.textContent).toContain("El reembolso no se completó.");
            (window.prompt as jest.Mock).mockReturnValueOnce("500").mockReturnValueOnce("Nueva solicitud revisada");
            await interact(() => refundButton(screen.container).click());
            expect(window.prompt).toHaveBeenCalledTimes(4);
            expect(window.confirm).not.toHaveBeenCalled();
            const next = (api.refundBillingPayment as jest.Mock).mock.calls[1][1];
            expect(next.requestId).not.toBe(original.requestId);
            expect(next).toMatchObject({ amountCents: 500, reason: "Nueva solicitud revisada" });
        } finally { screen.unmount(); }
    });

    it("submits once and disables refunds during two synchronous clicks", async () => {
        let finish!: (value: unknown) => void;
        (api.refundBillingPayment as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const screen = await renderScreen(<BillingPage />);
        try {
            const button = refundButton(screen.container);
            await interact(() => { button.click(); button.click(); });
            expect(api.refundBillingPayment).toHaveBeenCalledTimes(1);
            expect(window.prompt).toHaveBeenCalledTimes(2);
            expect(button.disabled).toBe(true);
            await interact(() => finish({ success: true, data: { providerPaymentId: "in_paid", status: "pending" } }));
            expect(api.refundBillingPayment).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });

    it("rejects amounts above the remaining balance and binds an accepted request to that balance", async () => {
        const subscription = await (api.getBillingSubscription as jest.Mock)();
        (api.getBillingSubscription as jest.Mock).mockClear().mockResolvedValue({ ...subscription, data: {
            ...subscription.data, payments: [{ ...payment, metadata: { refundedAmountCents: 6000 } }],
        } });
        (window.prompt as jest.Mock).mockReset().mockReturnValueOnce("1200");
        (api.refundBillingPayment as jest.Mock).mockResolvedValue({ success: true, data: { providerPaymentId: "in_paid", status: "pending" } });
        const screen = await renderScreen(<BillingPage />);
        try {
            await interact(() => refundButton(screen.container).click());
            expect(api.refundBillingPayment).not.toHaveBeenCalled();
            expect(window.prompt).toHaveBeenCalledTimes(1);
            expect(localStorage.getItem(storageKey)).toBeNull();
            (window.prompt as jest.Mock).mockReturnValueOnce("500").mockReturnValueOnce("Parcial revisado");
            await interact(() => refundButton(screen.container).click());
            expect(api.refundBillingPayment).toHaveBeenCalledWith(payment.id, {
                requestId: expect.any(String), amountCents: 500, reason: "Parcial revisado", expectedRefundedAmountCents: 6000,
            });
        } finally { screen.unmount(); }
    });
});
