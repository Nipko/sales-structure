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
    id: slug, slug, name: slug === "starter" ? "Starter" : slug === "emprendedor" ? "Emprendedor" : "Pro", priceUsdCents: price,
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
        // Stop at the hosted-checkout boundary; these tests never navigate to a payment page.
        (api.createStripeCheckout as jest.Mock).mockResolvedValue({ success: false, error: 'checkout-fixture' });
    });

    function noCardTrial() {
        const sub = {
            id: 'sub', planId: 'emprendedor', provider: 'stripe', providerBacked: false, status: 'trialing', billingCycle: 'monthly',
            trialEndsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), payments: [], plan: plan('emprendedor', 2100),
        };
        const starter = {
            ...plan('starter', 5000), trialDays: 7, requiresCardForTrial: false, requiresPaymentMethodAtSignup: false,
            trialAvailable: true, annualAvailable: true, displayPriceAnnualCents: 50000,
            features: { channels: ['whatsapp', 'telegram', 'webchat'] },
        };
        (api.getBillingSubscription as jest.Mock).mockResolvedValue({ success: true, billingCountry: 'US', data: sub });
        (api.getBillingPlans as jest.Mock).mockResolvedValue({ success: true, data: [plan('emprendedor', 2100), starter] });
        return { sub, starter };
    }

    it('upgrades a live no-card monthly trial without Checkout or a claim of automatic future charging', async () => {
        const { sub } = noCardTrial();
        (api.getBillingSubscription as jest.Mock)
            .mockResolvedValueOnce({ success: true, billingCountry: 'US', data: sub })
            .mockResolvedValue({ success: true, billingCountry: 'US', data: { ...sub, planId: 'starter' } });
        const screen = await renderScreen(<BillingPage />);
        try {
            const upgrade = [...screen.container.querySelectorAll('button')].find((button) => button.textContent?.includes('Mejorar a Starter'));
            expect(upgrade?.disabled).toBe(false);
            await interact(() => upgrade!.click());
            expect(api.upgradeBillingPlan).toHaveBeenCalledWith('tenant', { planSlug: 'starter', cardTokenId: undefined, billingCycle: 'monthly' });
            expect(api.createStripeCheckout).not.toHaveBeenCalled();
            expect(api.createStripePortal).not.toHaveBeenCalled();
            expect(api.getFiscalData).not.toHaveBeenCalled();
            expect(screen.container.textContent).toContain('Tu prueba ahora incluye Starter');
            expect(screen.container.textContent).toContain('No se realizó ningún cobro.');
            expect(screen.container.textContent).not.toContain('ese día se cobrarán');
            expect(screen.container.querySelector('input[name="cardNumber"]')).toBeNull();
        } finally { screen.unmount(); }
    });

    it('uses the subscribed plan when it is no longer in the active catalog for a no-charge trial upgrade', async () => {
        const { starter } = noCardTrial();
        (api.getBillingPlans as jest.Mock).mockResolvedValue({ success: true, data: [starter] });
        const screen = await renderScreen(<BillingPage />);
        try {
            const upgrade = [...screen.container.querySelectorAll('button')].find((button) => button.textContent?.includes('Mejorar a Starter'));
            expect(upgrade?.disabled).toBe(false);
            await interact(() => upgrade!.click());
            expect(api.upgradeBillingPlan).toHaveBeenCalledWith('tenant', { planSlug: 'starter', cardTokenId: undefined, billingCycle: 'monthly' });
            expect(api.createStripeCheckout).not.toHaveBeenCalled();
            expect(screen.container.textContent).toContain('No se realizó ningún cobro.');
        } finally { screen.unmount(); }
    });

    it.each(['annual', 'expired', 'card-required', 'no-trial'])('retains hosted Checkout for a %s local trial upgrade', async (kind) => {
        const { sub, starter } = noCardTrial();
        if (kind === 'expired') sub.trialEndsAt = new Date(Date.now() - 1).toISOString();
        if (kind === 'card-required') {
            starter.requiresCardForTrial = true;
            starter.requiresPaymentMethodAtSignup = true;
        }
        if (kind === 'no-trial') { starter.trialDays = 0; starter.requiresPaymentMethodAtSignup = true; }
        const screen = await renderScreen(<BillingPage />);
        try {
            if (kind === 'annual') {
                const annual = [...screen.container.querySelectorAll('button')].find((button) => button.textContent?.startsWith('Anual'));
                expect(annual).toBeDefined();
                await interact(() => annual!.click());
            }
            const upgrade = [...screen.container.querySelectorAll('button')].find((button) => button.textContent?.includes('Mejorar a Starter'));
            expect(upgrade?.disabled).toBe(false);
            await interact(() => upgrade!.click());
            expect(api.createStripeCheckout).toHaveBeenCalledWith('tenant', { planSlug: 'starter', billingCycle: kind === 'annual' ? 'annual' : 'monthly' });
            expect(api.upgradeBillingPlan).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
    });

    it.each([
        ['stripe_checkout_required', 'Este cambio requiere activar un medio de pago.'],
        ['stripe_subscription_changed_retry', 'El estado de tu plan cambió.'],
    ])('explains %s without exposing a provider code or automatically opening payment', async (errorCode, message) => {
        noCardTrial();
        (api.upgradeBillingPlan as jest.Mock).mockResolvedValue({ success: false, errorCode, error: 'Bad Request' });
        const screen = await renderScreen(<BillingPage />);
        try {
            const upgrade = [...screen.container.querySelectorAll('button')].find((button) => button.textContent?.includes('Mejorar a Starter'));
            await interact(() => upgrade!.click());
            expect(screen.container.textContent).toContain(message);
            expect(screen.container.textContent).not.toContain(errorCode);
            expect(screen.container.textContent).not.toContain('Bad Request');
            expect(api.createStripeCheckout).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
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
