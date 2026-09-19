import type { ComponentProps } from "react";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import ServicesTab from "./ServicesTab";
import ServiceModal from "./ServiceModal";
import type { Service } from "./shared";

type EditorForm = ComponentProps<typeof ServiceModal>["form"];

/**
 * Precios de ejemplo (decisión D10).
 *
 * El bootstrap por rubro siembra servicios con un número que el dueño nunca
 * escribió. Hasta que lo confirme, el agente no lo dice, y en la agenda ese
 * número tiene que verse como lo que es: un ejemplo, con la salida a mano
 * (confirmarlo tal cual, o declarar que se cotiza) sin pasar por el editor.
 * Un servicio "se cotiza" no muestra número en ningún lado, y mientras no
 * haya número no se puede pedir anticipo: el servidor lo rechaza, así que el
 * editor no lo ofrece y avisa por qué.
 */

jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: { getUsers: jest.fn(async () => ({ success: true, data: [] })) },
}));

const TENANT = "11111111-1111-4111-8111-111111111111";

function service(over: Partial<Service> & { id: string; name: string }): Service {
    return { duration: 30, buffer: 0, price: 50000, color: "#6c5ce7", active: true, ...over };
}

const buttonsNamed = (root: HTMLElement, text: string) =>
    Array.from(root.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text);

const policyRadios = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLInputElement>('input[name="paymentPolicy"]'));

const EDITOR_FORM: EditorForm = {
    name: "Corte",
    duration: 30,
    durationMax: null,
    durationType: "fixed",
    buffer: 0,
    price: 45000,
    priceStatus: "confirmed",
    color: "#6c5ce7",
    category: "",
    maxConcurrent: 1,
    rebookAfterDays: null,
    requiredFields: [],
    locationType: "in_person",
    locationAddress: "",
    meetingLink: "",
    paymentPolicy: "deposit",
    depositPercent: 30,
    depositAmount: null,
};

describe("services whose price the owner never confirmed", () => {
    it("marks the example, hides the quoted number and confirms without the editor", async () => {
        const onPriceStatusChange = jest.fn(async () => {});
        const screen = await renderScreen(
            <ServicesTab
                services={[
                    service({ id: "svc-example", name: "Corte", price: 45000, priceStatus: "example" }),
                    service({ id: "svc-quote", name: "Evento", price: 777777, priceStatus: "quote" }),
                    service({ id: "svc-confirmed", name: "Color", price: 88000, priceStatus: "confirmed" }),
                ]}
                loading={false}
                activeTenantId={TENANT}
                onCreateService={() => {}}
                onEditService={() => {}}
                onDeleteService={() => {}}
                onToggleActive={() => {}}
                onPriceStatusChange={onPriceStatusChange}
            />,
        );
        const text = screen.container.textContent ?? "";
        // The example keeps its number on screen, but labelled as an example.
        expect(text).toMatch(/45[.,]000/);
        expect(text).toContain("Precio de ejemplo");
        // A quoted service never states a number, anywhere.
        expect(text).toContain("Se cotiza según el caso");
        expect(text).not.toContain("777");
        // Only the example gets the two hand-fixes; confirmed and quoted do not.
        expect(buttonsNamed(screen.container, "Confirmar precio")).toHaveLength(1);
        expect(buttonsNamed(screen.container, "Se cotiza")).toHaveLength(1);

        await interact(() => buttonsNamed(screen.container, "Confirmar precio")[0].click());
        expect(onPriceStatusChange).toHaveBeenCalledWith(expect.objectContaining({ id: "svc-example" }), "confirmed");

        await interact(() => buttonsNamed(screen.container, "Se cotiza")[0].click());
        expect(onPriceStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "svc-example" }), "quote");

        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });

    it("in the editor, an example says so and quoting locks the payment policy", async () => {
        const onChange = jest.fn();
        const editing = service({ id: "svc-example", name: "Corte", price: 45000, priceStatus: "example" });
        const modal = (form: EditorForm) => (
            <ServiceModal form={form} onChange={onChange} editingService={editing} saving={false} onSave={() => {}} onClose={() => {}} />
        );

        // "Usar así" never confirms a price: the form opens with the row's real
        // state, the hint says the agent does not state it, and a payment
        // policy cannot be built on it until the owner presses a choice.
        const screen = await renderScreen(modal({ ...EDITOR_FORM, priceStatus: "example" }));
        expect(screen.container.textContent).toContain("Este precio es de ejemplo de tu rubro");
        expect(policyRadios(screen.container).length).toBeGreaterThan(0);
        expect(policyRadios(screen.container).every((r) => r.disabled)).toBe(true);
        const groupBefore = screen.container.querySelector<HTMLElement>('[role="group"][aria-labelledby="service-price-status-label"]');
        expect(groupBefore?.getAttribute("aria-describedby")).toBe("service-price-status-hint");
        expect(buttonsNamed(groupBefore!, "Precio confirmado")[0].getAttribute("aria-pressed")).toBe("false");

        const group = screen.container.querySelector<HTMLElement>('[role="group"][aria-labelledby="service-price-status-label"]');
        expect(group).not.toBeNull();
        expect(await findAccessibilityViolations(group!)).toEqual([]);

        await interact(() => buttonsNamed(group!, "Se cotiza según el caso")[0].click());
        // Choosing "quote" also drops the deposit: the server refuses a policy without a number.
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
            priceStatus: "quote", paymentPolicy: "none", depositPercent: null, depositAmount: null,
        }));
        screen.unmount();

        // The parent owns the form; this is what it renders after that change.
        const quoted = await renderScreen(modal({ ...EDITOR_FORM, priceStatus: "quote", paymentPolicy: "none", depositPercent: null }));
        const quotedText = quoted.container.textContent ?? "";
        expect(quotedText).toContain("el agente agenda sin pedir pago");
        expect(quotedText).not.toContain("Este precio es de ejemplo");
        expect(policyRadios(quoted.container).every((r) => r.disabled)).toBe(true);
        quoted.unmount();
    });
});
