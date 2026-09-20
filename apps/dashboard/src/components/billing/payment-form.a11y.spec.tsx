import { renderScreen, interact, findAccessibilityViolations } from "@/test/a11y";
import { type BillingPublicConfig } from "@/lib/api";
import PaymentForm from "./PaymentForm";

jest.mock("./WompiPaymentForm", () => ({ __esModule: true, default: () => <div data-testid="wompi-form">Wompi</div> }));

const config = (provider: "stripe" | "wompi"): BillingPublicConfig => ({
    provider, country: provider === "stripe" ? "US" : "CO", publicKey: null,
    environment: "sandbox", methods: ["card"], asyncSettlement: true, requiresAcceptanceTokens: provider === "wompi",
});

describe("subscription checkout dispatcher", () => {
    it("offers an accessible hosted Stripe action without collecting card data or invoking Wompi", async () => {
        const onHostedCheckout = jest.fn();
        const onSourceSaved = jest.fn();
        const screen = await renderScreen(<PaymentForm tenantId="tenant" config={config("stripe")} onSourceSaved={onSourceSaved} onHostedCheckout={onHostedCheckout} />);
        try {
            expect(screen.container.querySelector('[data-testid="wompi-form"]')).toBeNull();
            expect(screen.container.querySelector('input')).toBeNull();
            const button = screen.container.querySelector('button')!;
            expect(button.textContent).toBe('Continuar con Stripe');
            await interact(() => button.click());
            expect(onHostedCheckout).toHaveBeenCalledTimes(1);
            expect(onSourceSaved).not.toHaveBeenCalled();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("retains the Colombian Wompi form", async () => {
        const screen = await renderScreen(<PaymentForm tenantId="tenant" config={config("wompi")} onSourceSaved={jest.fn()} onHostedCheckout={jest.fn()} />);
        try {
            expect(screen.container.querySelector('[data-testid="wompi-form"]')).not.toBeNull();
            expect(screen.container.textContent).not.toContain('Stripe');
        } finally { screen.unmount(); }
    });
});
