import { renderScreen, interact } from "@/test/a11y";
import { api } from "@/lib/api";
import BillingPage from "./page";

jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant" }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: "tenant_admin" } }) }));
jest.mock("@/components/ui/help-panel", () => ({ HelpPanel: () => null }));
jest.mock("@/components/FiscalGateModal", () => ({ FiscalGateModal: () => null }));
jest.mock("@/lib/api", () => ({ api: {
    getBillingSubscription: jest.fn(), getBillingPlans: jest.fn(), getBillingUsage: jest.fn(), fetch: jest.fn(),
    getFiscalData: jest.fn(), getBillingPublicConfig: jest.fn(), listPaymentSources: jest.fn(),
    upgradeBillingPlan: jest.fn(), createStripeCheckout: jest.fn(), createStripePortal: jest.fn(),
} }));

const plan = (slug: string, price: number) => ({
    id: slug, slug, name: slug === "starter" ? "Starter" : "Pro", priceUsdCents: price,
    displayPriceCents: price, displayCurrency: "USD", maxAgents: 1, maxAiMessages: 1000,
    features: {}, trialDays: 0, requiresPaymentMethodAtSignup: true,
    signupAvailable: true, monthlyAvailable: true, annualAvailable: false, checkoutMode: "self_serve",
});

describe("international subscription management", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sessionStorage.clear();
        (api.getBillingSubscription as jest.Mock).mockResolvedValue({ success: true, billingCountry: "US", data: {
            id: "sub", planId: "starter", provider: "stripe", providerBacked: true, status: "active", billingCycle: "monthly",
            currentPeriodStart: "2026-09-01T00:00:00Z", currentPeriodEnd: "2026-10-01T00:00:00Z", payments: [],
        } });
        (api.getBillingPlans as jest.Mock).mockResolvedValue({ success: true, data: [plan("starter", 5000), plan("pro", 10000)] });
        (api.getBillingUsage as jest.Mock).mockResolvedValue({ success: true, data: null });
        (api.fetch as jest.Mock).mockResolvedValue({ success: false });
        (api.getBillingPublicConfig as jest.Mock).mockResolvedValue({ success: true, data: {
            provider: "stripe", country: "US", methods: ["card"], publicKey: null, environment: "sandbox",
        } });
        (api.listPaymentSources as jest.Mock).mockResolvedValue({ success: true, data: [] });
        (api.upgradeBillingPlan as jest.Mock).mockResolvedValue({ success: true, data: {} });
    });

    it("changes an existing Stripe plan without a Wompi form, new Checkout or Colombian tax-profile request", async () => {
        const screen = await renderScreen(<BillingPage />);
        try {
            expect(api.getFiscalData).not.toHaveBeenCalled();
            const upgrade = [...screen.container.querySelectorAll('button')].find((button) => button.textContent?.includes('Pro'));
            expect(upgrade).toBeDefined();
            await interact(() => upgrade!.click());
            expect(api.upgradeBillingPlan).toHaveBeenCalledWith('tenant', { planSlug: 'pro', cardTokenId: undefined, billingCycle: 'monthly' });
            expect(api.createStripeCheckout).not.toHaveBeenCalled();
            expect(api.createStripePortal).not.toHaveBeenCalled();
            expect(screen.container.querySelector('input[name="cardNumber"]')).toBeNull();
            expect([...screen.container.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Pausar')).toBe(false);
        } finally { screen.unmount(); }
    });

    it("blocks activation of a legacy foreign Wompi trial instead of silently starting Stripe", async () => {
        (api.getBillingSubscription as jest.Mock).mockResolvedValue({ success: true, billingCountry: "US", data: {
            id: "sub", planId: "starter", provider: "wompi", providerBacked: false, status: "trialing", billingCycle: "monthly",
            trialEndsAt: "2026-10-01T00:00:00Z", currentPeriodEnd: "2026-10-01T00:00:00Z", payments: [],
        } });
        const screen = await renderScreen(<BillingPage />);
        try {
            expect(api.getBillingPublicConfig).toHaveBeenCalledWith('CO');
            expect(screen.container.textContent).toContain('Contacta a soporte antes de activar el plan');
            const upgrade = [...screen.container.querySelectorAll('button')].find((button) => button.textContent?.includes('Pro'));
            expect(upgrade?.disabled).toBe(true);
            expect(api.createStripeCheckout).not.toHaveBeenCalled();
            expect(api.upgradeBillingPlan).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
    });
});
