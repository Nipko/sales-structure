import { randomUUID } from "crypto";
import { interact, renderScreen, type RenderedScreen } from "@/test/a11y";
import { api } from "@/lib/api";
import BillingOpsPage from "./page";

const mockUser = { id: "operator-1", role: "super_admin" };
const mockRouter = { push: jest.fn() };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api", () => ({ api: {
    listAdminSubscriptions: jest.fn(), listAdminPayments: jest.fn(), listAdminBillingEvents: jest.fn(),
    refundBillingPayment: jest.fn(),
} }));

const payment = {
    id: "payment-1", provider: "stripe", providerPaymentId: "in_paid", status: "succeeded",
    amountCents: 6900, currency: "USD", paidAt: "2026-09-01T00:00:00Z", metadata: {},
    subscription: { tenant: { name: "Cliente de prueba" } },
};
const storageKey = "parallly:billing:refund:operator-1:payment-1";
const pendingMessage = "El resultado del reembolso sigue pendiente.";
const failedMessage = "El reembolso no se completó.";
const successMessage = "Reembolso confirmado.";

function button(container: HTMLElement, label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
    if (!found) throw new Error(`Button not found: ${label}`);
    return found;
}

function reasonField(screen: RenderedScreen): HTMLTextAreaElement {
    return screen.container.querySelector('textarea[aria-label="Motivo (opcional)"]')!;
}

async function openRefund(screen: RenderedScreen, reason = "Solicitud del cliente") {
    await interact(() => button(screen.container, "Reembolsar").click());
    const field = reasonField(screen);
    if (!field.disabled) {
        await interact(() => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, reason);
            field.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }
}

function confirmButton(screen: RenderedScreen): HTMLButtonElement {
    const field = reasonField(screen);
    const modal = field.parentElement!;
    return [...modal.querySelectorAll("button")].find(item => item.textContent?.trim() !== "Cancelar")!;
}

async function mountPayments(): Promise<RenderedScreen> {
    const screen = await renderScreen(<BillingOpsPage />);
    await interact(() => screen.container.querySelector<HTMLButtonElement>('[data-tab-id="payments"]')!.click());
    return screen;
}

describe("billing operations refund recovery", () => {
    // jsdom omits this secure-context browser API; use Node's actual generator.
    beforeAll(() => Object.defineProperty(crypto, "randomUUID", { configurable: true, value: randomUUID }));
    beforeEach(() => {
        jest.resetAllMocks();
        sessionStorage.clear();
        localStorage.clear();
        (api.listAdminSubscriptions as jest.Mock).mockResolvedValue({ success: true, data: { items: [], total: 0 } });
        (api.listAdminPayments as jest.Mock).mockResolvedValue({ success: true, data: { items: [payment], total: 1 } });
        (api.listAdminBillingEvents as jest.Mock).mockResolvedValue({ success: true, data: { items: [], total: 0 } });
    });

    it("keeps the same full-refund request and reason after a timeout and remount", async () => {
        (api.refundBillingPayment as jest.Mock).mockRejectedValueOnce(new Error("timeout"))
            .mockResolvedValueOnce({ success: true, data: { providerPaymentId: "in_paid", status: "pending" } });
        let screen = await mountPayments();
        try {
            await openRefund(screen);
            await interact(() => confirmButton(screen).click());
            const original = (api.refundBillingPayment as jest.Mock).mock.calls[0][1];
            expect(original).toEqual({ requestId: expect.any(String), reason: "Solicitud del cliente", expectedRefundedAmountCents: 0 });
            expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(original);
            expect(screen.container.textContent).toContain(pendingMessage);
            screen.unmount();
            sessionStorage.clear(); // Closing a tab must not discard its unresolved refund identity.
            screen = await mountPayments();
            await openRefund(screen, "No debe sustituir el motivo original");
            expect(reasonField(screen).disabled).toBe(true);
            expect(reasonField(screen).value).toBe("Solicitud del cliente");
            expect(confirmButton(screen).textContent).toContain("Consultar solicitud");
            await interact(() => confirmButton(screen).click());
            expect(api.refundBillingPayment).toHaveBeenNthCalledWith(2, payment.id, original);
            expect(screen.container.textContent).toContain(pendingMessage);
            expect(screen.container.textContent).not.toContain(successMessage);
        } finally { screen.unmount(); }
    });

    it.each([
        ["pending", pendingMessage],
        ["needs_review", "Este reembolso requiere revisión en Stripe."],
    ])("keeps a %s request recoverable and never reports success", async (status, message) => {
        (api.refundBillingPayment as jest.Mock).mockResolvedValue({ success: true, data: { providerPaymentId: "in_paid", status } });
        const screen = await mountPayments();
        try {
            await openRefund(screen);
            await interact(() => confirmButton(screen).click());
            expect(api.listAdminPayments).toHaveBeenCalledTimes(2);
            expect(localStorage.getItem(storageKey)).not.toBeNull();
            expect(screen.container.textContent).toContain(message);
            expect(screen.container.textContent).not.toContain(successMessage);
        } finally { screen.unmount(); }
    });

    it("clears a confirmed failed intent and lets a deliberate new request get a new identity", async () => {
        (api.refundBillingPayment as jest.Mock).mockResolvedValueOnce({ success: true, data: { providerPaymentId: "in_paid", status: "failed" } })
            .mockResolvedValueOnce({ success: true, data: { providerPaymentId: "in_paid", status: "pending" } });
        const screen = await mountPayments();
        try {
            await openRefund(screen);
            await interact(() => confirmButton(screen).click());
            const original = (api.refundBillingPayment as jest.Mock).mock.calls[0][1];
            expect(localStorage.getItem(storageKey)).toBeNull();
            expect(screen.container.textContent).toContain(failedMessage);
            await openRefund(screen, "Nueva solicitud revisada");
            expect(reasonField(screen).disabled).toBe(false);
            await interact(() => confirmButton(screen).click());
            const next = (api.refundBillingPayment as jest.Mock).mock.calls[1][1];
            expect(next.requestId).not.toBe(original.requestId);
            expect(next.reason).toBe("Nueva solicitud revisada");
        } finally { screen.unmount(); }
    });

    it("blocks two synchronous confirmations while the first request is in flight", async () => {
        let finish!: (value: unknown) => void;
        (api.refundBillingPayment as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const screen = await mountPayments();
        try {
            await openRefund(screen);
            const confirm = confirmButton(screen);
            await interact(() => { confirm.click(); confirm.click(); });
            expect(api.refundBillingPayment).toHaveBeenCalledTimes(1);
            expect(confirm.disabled).toBe(true);
            await interact(() => finish({ success: true, data: { providerPaymentId: "in_paid", status: "pending" } }));
            expect(api.refundBillingPayment).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });

    it("shows the remaining balance and submits the observed refunded total for a partial payment", async () => {
        (api.listAdminPayments as jest.Mock).mockResolvedValue({ success: true, data: {
            items: [{ ...payment, metadata: { refundedAmountCents: 6000 } }], total: 1,
        } });
        (api.refundBillingPayment as jest.Mock).mockResolvedValue({ success: true, data: { providerPaymentId: "in_paid", status: "pending" } });
        const screen = await mountPayments();
        try {
            await openRefund(screen);
            expect(reasonField(screen).parentElement?.textContent).toContain("Vas a reembolsar 9 USD.");
            await interact(() => confirmButton(screen).click());
            expect(api.refundBillingPayment).toHaveBeenCalledWith(payment.id, {
                requestId: expect.any(String), reason: "Solicitud del cliente", expectedRefundedAmountCents: 6000,
            });
        } finally { screen.unmount(); }
    });
});
