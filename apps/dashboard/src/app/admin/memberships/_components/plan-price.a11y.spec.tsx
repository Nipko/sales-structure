import { act } from "react";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import { api } from "@/lib/api";
import { PlanCard } from "./PlanCard";
import { PlanFormModal } from "./PlanFormModal";
import type { MembershipPlan } from "../plan-price";

/**
 * Plan prices the owner can confirm (D10, gyms).
 *
 * The agent never states a membership price the owner has not confirmed. The
 * memberships screen used to print `Number(plan.price)` for every plan — the
 * recipe's example and the seed's placeholder 0 included — with no way to
 * confirm it, so an owner corrected a price and the agent kept refusing to say
 * it with nothing on screen explaining why. These pin the card and the editor
 * to the same contract the services cards already follow.
 */

jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: {
        updateMembershipPlan: jest.fn(),
        createMembershipPlan: jest.fn(),
    },
}));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
let mockOperatingCurrency: string | null = "MXN";
jest.mock("@/hooks/useOperatingCurrency", () => ({ useOperatingCurrency: () => mockOperatingCurrency }));

function plan(over: Partial<MembershipPlan> = {}): MembershipPlan {
    return {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Mensual",
        duration_days: 30,
        price: "150000.00",
        price_status: "example",
        currency: "MXN",
        personal_training_credits: 0,
        guest_passes: 0,
        freeze_allowance_days: 7,
        perks: [],
        is_active: true,
        ...over,
    };
}

const buttonsNamed = (root: ParentNode, text: string) =>
    Array.from(root.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text);

/** React only sees a change made through the native setter. */
function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("a membership plan card", () => {
    beforeEach(() => { mockOperatingCurrency = "MXN"; });

    it("labels the recipe's example, explains why the agent keeps quiet and confirms it in place", async () => {
        const onPriceStatusChange = jest.fn(async () => ({ success: true }));
        const screen = await renderScreen(
            <PlanCard plan={plan()} onEdit={() => {}} onDelete={() => {}} onPriceStatusChange={onPriceStatusChange} />,
        );
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toMatch(/150[.,\s ]000/);
            expect(text).toContain("Precio de ejemplo");
            expect(text).toContain("El agente no dice este precio hasta que lo confirmes.");
            expect(buttonsNamed(screen.container, "Confirmar precio")).toHaveLength(1);
            expect(buttonsNamed(screen.container, "Se cotiza")).toHaveLength(1);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);

            await interact(() => buttonsNamed(screen.container, "Confirmar precio")[0].click());
            expect(onPriceStatusChange).toHaveBeenCalledWith(expect.objectContaining({ id: plan().id }), "confirmed");
            await interact(() => buttonsNamed(screen.container, "Se cotiza")[0].click());
            expect(onPriceStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: plan().id }), "quote");
        } finally { screen.unmount(); }
    });

    it('shows the seed\'s placeholder 0 as "Sin precio" and asks for the amount instead of confirming it', async () => {
        const onEdit = jest.fn();
        const onPriceStatusChange = jest.fn(async () => ({ success: true }));
        const placeholder = plan({ price: "0.00", price_status: "example" });
        const screen = await renderScreen(
            <PlanCard plan={placeholder} onEdit={onEdit} onDelete={() => {}} onPriceStatusChange={onPriceStatusChange} />,
        );
        try {
            const priceSlot = screen.container.querySelector("article > div > div.text-right")!.textContent ?? "";
            expect(priceSlot).toContain("Sin precio");
            expect(priceSlot).not.toMatch(/\$|MXN|\b0\b|gratis/i);
            expect(screen.container.textContent).toContain("Este plan todavía no tiene precio");
            // There is nothing to confirm: the ways out are an amount, "Es
            // gratis" (explicit, FX1) or "se cotiza".
            expect(buttonsNamed(screen.container, "Confirmar precio")).toHaveLength(0);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);

            await interact(() => buttonsNamed(screen.container, "Escribir precio")[0].click());
            expect(onEdit).toHaveBeenCalledWith(placeholder, { focusPrice: true });
            expect(onPriceStatusChange).not.toHaveBeenCalled();
            await interact(() => buttonsNamed(screen.container, "Es gratis")[0].click());
            expect(onPriceStatusChange).toHaveBeenCalledWith(placeholder, "free");
        } finally { screen.unmount(); }
    });

    it("never states a quoted plan's number, and leaves a confirmed one alone", async () => {
        const quoted = await renderScreen(
            <PlanCard plan={plan({ price: "777777.00", price_status: "quote" })} onEdit={() => {}} onDelete={() => {}} onPriceStatusChange={jest.fn()} />,
        );
        try {
            expect(quoted.container.textContent).toContain("Se cotiza según el caso");
            expect(quoted.container.textContent).not.toContain("777");
            expect(quoted.container.querySelectorAll("button")).toHaveLength(2); // edit + delete only
        } finally { quoted.unmount(); }

        const confirmed = await renderScreen(
            <PlanCard plan={plan({ price: "120000.00", price_status: "confirmed" })} onEdit={() => {}} onDelete={() => {}} onPriceStatusChange={jest.fn()} />,
        );
        try {
            expect(confirmed.container.textContent).toMatch(/120[.,\s ]000/);
            expect(confirmed.container.textContent).not.toContain("Precio de ejemplo");
            expect(buttonsNamed(confirmed.container, "Confirmar precio")).toHaveLength(0);
            expect(await findAccessibilityViolations(confirmed.container)).toEqual([]);
        } finally { confirmed.unmount(); }
    });

    it("shows a plan the owner declared free as free, not as a $0 price", async () => {
        const screen = await renderScreen(
            <PlanCard plan={plan({ price: "0.00", price_status: "confirmed" })} onEdit={() => {}} onDelete={() => {}} onPriceStatusChange={jest.fn()} />,
        );
        try {
            const priceSlot = screen.container.querySelector("article > div > div.text-right")!.textContent ?? "";
            expect(priceSlot).toContain("Gratis");
            expect(priceSlot).not.toMatch(/\$|MXN|\b0\b/);
            expect(buttonsNamed(screen.container, "Es gratis")).toHaveLength(0);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("prints a bare number when neither the plan nor the business has a currency", async () => {
        mockOperatingCurrency = null;
        const screen = await renderScreen(
            <PlanCard plan={plan({ currency: null, price_status: "confirmed" })} operatingCurrency={null} onEdit={() => {}} onDelete={() => {}} onPriceStatusChange={jest.fn()} />,
        );
        try {
            const amount = screen.container.querySelector("p.font-mono")!.textContent ?? "";
            expect(amount).toMatch(/^150[.,\s ]000$/);
        } finally { screen.unmount(); }
    });

    it("turns a price_missing refusal into a request for the amount", async () => {
        const onEdit = jest.fn();
        const onPriceStatusChange = jest.fn(async () => ({ success: false, errorCode: "price_missing", error: "server text" }));
        const screen = await renderScreen(
            <PlanCard plan={plan()} onEdit={onEdit} onDelete={() => {}} onPriceStatusChange={onPriceStatusChange} />,
        );
        try {
            await interact(() => buttonsNamed(screen.container, "Confirmar precio")[0].click());
            await settle();
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Este plan todavía no tiene precio. Escribe el monto para confirmarlo");
            expect(alert?.textContent).not.toContain("server text");
            expect(buttonsNamed(screen.container, "Confirmar precio")).toHaveLength(0);
            await interact(() => buttonsNamed(screen.container, "Escribir precio")[0].click());
            expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: plan().id }), { focusPrice: true });
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });
});

describe("the plan editor", () => {
    const update = api.updateMembershipPlan as jest.Mock;
    const create = api.createMembershipPlan as jest.Mock;
    const dialog = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="dialog"]')!;
    const group = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="group"][aria-labelledby="plan-price-status-label"]')!;
    const priceInput = (root: HTMLElement) => root.querySelector<HTMLInputElement>("#plan-price")!;
    const save = (root: HTMLElement) => buttonsNamed(root, "Guardar")[0] as HTMLButtonElement;

    beforeEach(() => {
        update.mockReset().mockResolvedValue({ success: true, data: {} });
        create.mockReset().mockResolvedValue({ success: true, data: {} });
    });

    it("keeps an untouched example as an example: saving the plan sends no price decision", async () => {
        const onSaved = jest.fn();
        const screen = await renderScreen(<PlanFormModal plan={plan()} onClose={() => {}} onSaved={onSaved} />);
        try {
            expect(screen.container.textContent).toContain("Este precio es de ejemplo de tu rubro");
            expect(buttonsNamed(group(screen.container), "Precio confirmado")[0].getAttribute("aria-pressed")).toBe("false");
            expect(group(screen.container).getAttribute("aria-describedby")).toBe("plan-price-hint");
            expect(await findAccessibilityViolations(dialog(screen.container))).toEqual([]);

            await interact(() => save(screen.container).click());
            await settle();
            const payload = update.mock.calls[0][2];
            expect(payload).not.toHaveProperty("price");
            expect(payload).not.toHaveProperty("priceStatus");
            expect(onSaved).toHaveBeenCalled();
        } finally { screen.unmount(); }
    });

    it('opens "Escribir precio" on the amount and will not confirm a placeholder without one', async () => {
        const screen = await renderScreen(
            <PlanFormModal plan={plan({ price: "0.00" })} focusPrice onClose={() => {}} onSaved={() => {}} />,
        );
        try {
            expect(document.activeElement).toBe(priceInput(screen.container));
            expect(priceInput(screen.container).value).toBe("");
            expect(screen.container.textContent).toContain("Este plan todavía no tiene precio. Escribe el monto para que el agente pueda decirlo");

            await interact(() => buttonsNamed(group(screen.container), "Precio confirmado")[0].click());
            expect(save(screen.container).disabled).toBe(true);
            expect(screen.container.textContent).toContain("Escribe el monto para confirmar el precio.");
            expect(priceInput(screen.container).getAttribute("aria-invalid")).toBe("true");
            expect(await findAccessibilityViolations(dialog(screen.container))).toEqual([]);

            await interact(() => typeInto(priceInput(screen.container), "90000"));
            expect(save(screen.container).disabled).toBe(false);
            await interact(() => save(screen.container).click());
            await settle();
            expect(update.mock.calls[0][2]).toMatchObject({ price: 90000, priceStatus: "confirmed" });
        } finally { screen.unmount(); }
    });

    it('"Es gratis" confirms a placeholder at 0, explicitly', async () => {
        const screen = await renderScreen(<PlanFormModal plan={plan({ price: "0.00" })} onClose={() => {}} onSaved={() => {}} />);
        try {
            await interact(() => buttonsNamed(group(screen.container), "Es gratis")[0].click());
            expect(priceInput(screen.container).disabled).toBe(true);
            expect(screen.container.textContent).toContain("El agente le dice al cliente que este plan es gratis.");
            expect(await findAccessibilityViolations(dialog(screen.container))).toEqual([]);
            await interact(() => save(screen.container).click());
            await settle();
            expect(update.mock.calls[0][2]).toMatchObject({ price: 0, priceStatus: "confirmed", free: true });
        } finally { screen.unmount(); }
    });

    it('a 0 typed under "Precio confirmado" cannot be saved: free is its own choice', async () => {
        const screen = await renderScreen(<PlanFormModal plan={plan({ price: "0.00" })} onClose={() => {}} onSaved={() => {}} />);
        try {
            await interact(() => buttonsNamed(group(screen.container), "Precio confirmado")[0].click());
            await interact(() => typeInto(priceInput(screen.container), "0"));
            expect(save(screen.container).disabled).toBe(true);
            expect(screen.container.textContent).toContain("Si no se cobra, elige «Es gratis».");
        } finally { screen.unmount(); }
    });

    it("typing a new amount over an example confirms it", async () => {
        const screen = await renderScreen(<PlanFormModal plan={plan()} onClose={() => {}} onSaved={() => {}} />);
        try {
            await interact(() => typeInto(priceInput(screen.container), "165000"));
            expect(buttonsNamed(group(screen.container), "Precio confirmado")[0].getAttribute("aria-pressed")).toBe("true");
            await interact(() => save(screen.container).click());
            await settle();
            expect(update.mock.calls[0][2]).toMatchObject({ price: 165000, priceStatus: "confirmed" });
        } finally { screen.unmount(); }
    });

    it('"Se cotiza según el caso" hides the number and sends no amount', async () => {
        const screen = await renderScreen(<PlanFormModal plan={null} onClose={() => {}} onSaved={() => {}} />);
        try {
            await interact(() => typeInto(screen.container.querySelector<HTMLInputElement>("#plan-name")!, "Corporativo"));
            await interact(() => buttonsNamed(group(screen.container), "Se cotiza según el caso")[0].click());
            expect(priceInput(screen.container).disabled).toBe(true);
            expect(priceInput(screen.container).value).toBe("");
            expect(screen.container.textContent).toContain("El agente no dice ningún monto de este plan");
            await interact(() => save(screen.container).click());
            await settle();
            const payload = create.mock.calls[0][1];
            expect(payload).toMatchObject({ name: "Corporativo", priceStatus: "quote" });
            expect(payload).not.toHaveProperty("price");
        } finally { screen.unmount(); }
    });

    it("keeps the editor open and explains a price_missing refusal instead of closing as if it saved", async () => {
        update.mockResolvedValue({ success: false, errorCode: "price_missing", error: "server text" });
        const onSaved = jest.fn();
        const screen = await renderScreen(<PlanFormModal plan={plan()} onClose={() => {}} onSaved={onSaved} />);
        try {
            await interact(() => buttonsNamed(group(screen.container), "Precio confirmado")[0].click());
            await interact(() => save(screen.container).click());
            await settle();
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Este plan todavía no tiene precio. Escribe el monto para confirmarlo");
            expect(onSaved).not.toHaveBeenCalled();
            expect(await findAccessibilityViolations(dialog(screen.container))).toEqual([]);
        } finally { screen.unmount(); }
    });
});
