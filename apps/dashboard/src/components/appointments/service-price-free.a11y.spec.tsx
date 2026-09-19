import type { ComponentProps } from "react";
import { act, useEffect } from "react";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import { api } from "@/lib/api";
import ServicesTab from "./ServicesTab";
import ServiceModal from "./ServiceModal";
import type { Service } from "./shared";
import { useServiceCatalog } from "@/hooks/useServiceCatalog";

type EditorForm = ComponentProps<typeof ServiceModal>["form"];

/**
 * FX1: a service without an amount is "Sin precio", and free is a choice.
 *
 * D17 seeds services WITHOUT an amount outside the six countries with an
 * example price. The card read that NULL as 0, offered "Confirmar precio", and
 * the API confirmed it: the agent then told customers the service was free.
 * The editor sent an empty field as 0, so "Precio confirmado" on a quoted
 * service did the same. Now a card with no amount offers what the API accepts
 * — write the amount, "Es gratis", "Se cotiza" — and the editor sends "free"
 * only when the owner presses "Es gratis".
 */

jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: {
        getUsers: jest.fn(async () => ({ success: true, data: [] })),
        getServices: jest.fn(async () => ({ success: true, data: [] })),
        updateService: jest.fn(async () => ({ success: true, data: {} })),
        createService: jest.fn(async () => ({ success: true, data: {} })),
    },
}));

const TENANT = "11111111-1111-4111-8111-111111111111";

function service(over: Partial<Service> & { id: string; name: string }): Service {
    return { duration: 30, buffer: 0, price: 50000, color: "#6c5ce7", active: true, ...over };
}

const buttonsNamed = (root: ParentNode, text: string) =>
    Array.from(root.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text);

const EDITOR_FORM: EditorForm = {
    name: "Clase de prueba",
    duration: 60,
    durationMax: null,
    durationType: "fixed",
    buffer: 0,
    price: null,
    priceStatus: "example",
    color: "#6c5ce7",
    category: "",
    maxConcurrent: 1,
    rebookAfterDays: null,
    requiredFields: [],
    locationType: "in_person",
    locationAddress: "",
    meetingLink: "",
    paymentPolicy: "none",
    depositPercent: null,
    depositAmount: null,
};

describe("a service card without an amount", () => {
    function renderTab(services: Service[], handlers: Partial<ComponentProps<typeof ServicesTab>> = {}) {
        return renderScreen(
            <ServicesTab
                services={services}
                loading={false}
                activeTenantId={TENANT}
                onCreateService={() => {}}
                onEditService={() => {}}
                onDeleteService={() => {}}
                onToggleActive={() => {}}
                onPriceStatusChange={jest.fn(async () => {})}
                {...handlers}
            />,
        );
    }

    it('says "Sin precio" and never offers to confirm nothing', async () => {
        const onPriceStatusChange = jest.fn(async () => {});
        const onEditService = jest.fn();
        const noAmount = service({ id: "svc-null", name: "Consulta general", price: null, priceStatus: "example" });
        const screen = await renderTab([noAmount], { onPriceStatusChange, onEditService });
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Sin precio");
            expect(text).not.toContain("Precio de ejemplo");
            expect(buttonsNamed(screen.container, "Confirmar precio")).toHaveLength(0);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);

            await interact(() => buttonsNamed(screen.container, "Es gratis")[0].click());
            expect(onPriceStatusChange).toHaveBeenCalledWith(expect.objectContaining({ id: "svc-null" }), "free");
            await interact(() => buttonsNamed(screen.container, "Se cotiza")[0].click());
            expect(onPriceStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "svc-null" }), "quote");
            await interact(() => buttonsNamed(screen.container, "Escribir precio")[0].click());
            expect(onEditService).toHaveBeenCalledWith(expect.objectContaining({ id: "svc-null" }));
        } finally { screen.unmount(); }
    });

    it("treats the recipe's 0 the same: free is said, not confirmed by accident", async () => {
        // "Clase de prueba" is free, but the recipe also writes 0 for
        // "Mensualidad de clases grupales". One button cannot tell them apart.
        const screen = await renderTab([service({ id: "svc-zero", name: "Clase de prueba", price: 0, priceStatus: "example" })]);
        try {
            expect(screen.container.textContent).toContain("Sin precio");
            expect(buttonsNamed(screen.container, "Confirmar precio")).toHaveLength(0);
            expect(buttonsNamed(screen.container, "Es gratis")).toHaveLength(1);
        } finally { screen.unmount(); }
    });

    it("shows a declared free service as free, with nothing left to decide", async () => {
        const screen = await renderTab([service({ id: "svc-free", name: "Asesoría inicial", price: 0, priceStatus: "confirmed" })]);
        try {
            expect(screen.container.textContent).toContain("Gratis");
            expect(buttonsNamed(screen.container, "Es gratis")).toHaveLength(0);
            expect(buttonsNamed(screen.container, "Confirmar precio")).toHaveLength(0);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("keeps confirming an example that has an amount", async () => {
        const onPriceStatusChange = jest.fn(async () => {});
        const screen = await renderTab([service({ id: "svc-example", name: "Corte", price: 45000, priceStatus: "example" })], { onPriceStatusChange });
        try {
            expect(screen.container.textContent).toContain("Precio de ejemplo");
            await interact(() => buttonsNamed(screen.container, "Confirmar precio")[0].click());
            expect(onPriceStatusChange).toHaveBeenCalledWith(expect.objectContaining({ id: "svc-example" }), "confirmed");
        } finally { screen.unmount(); }
    });
});

describe("the service editor's price choice", () => {
    const group = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="group"][aria-labelledby="service-price-status-label"]')!;
    const priceInput = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input[aria-label="Precio"]')!;
    const save = (root: HTMLElement) => buttonsNamed(root, "Crear servicio")[0] as HTMLButtonElement | undefined;
    const modal = (form: EditorForm, onChange = jest.fn()) => (
        <ServiceModal form={form} onChange={onChange} editingService={null} saving={false} onSave={() => {}} onClose={() => {}} />
    );

    it('offers "Es gratis" as its own choice, and choosing it drops any payment', async () => {
        const onChange = jest.fn();
        const screen = await renderScreen(modal(EDITOR_FORM, onChange));
        try {
            expect(buttonsNamed(group(screen.container), "Es gratis")).toHaveLength(1);
            // No amount: the hint says so instead of calling it an example.
            expect(screen.container.textContent).toContain("Este servicio todavía no tiene precio");
            expect(screen.container.textContent).not.toContain("Este precio es de ejemplo de tu rubro");
            expect(await findAccessibilityViolations(group(screen.container))).toEqual([]);
            await interact(() => buttonsNamed(group(screen.container), "Es gratis")[0].click());
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
                priceStatus: "free", paymentPolicy: "none", depositPercent: null, depositAmount: null,
            }));
        } finally { screen.unmount(); }
    });

    it('"Precio confirmado" with no amount cannot be saved and says why', async () => {
        const screen = await renderScreen(modal({ ...EDITOR_FORM, priceStatus: "confirmed" }));
        try {
            expect(screen.container.textContent).toContain("Escribe el monto para confirmar el precio.");
            expect(priceInput(screen.container).getAttribute("aria-invalid")).toBe("true");
            expect(save(screen.container)?.disabled).toBe(true);
            expect(await findAccessibilityViolations(group(screen.container))).toEqual([]);
        } finally { screen.unmount(); }

        // A 0 typed into the box is not "free" either.
        const zero = await renderScreen(modal({ ...EDITOR_FORM, priceStatus: "confirmed", price: 0 }));
        try {
            expect(save(zero.container)?.disabled).toBe(true);
        } finally { zero.unmount(); }
    });

    it("a free service shows no number to edit and tells the owner what the agent will say", async () => {
        const screen = await renderScreen(modal({ ...EDITOR_FORM, priceStatus: "free" }));
        try {
            expect(priceInput(screen.container).disabled).toBe(true);
            expect(priceInput(screen.container).value).toBe("");
            expect(buttonsNamed(group(screen.container), "Es gratis")[0].getAttribute("aria-pressed")).toBe("true");
            expect(screen.container.textContent).toContain("El agente le dice al cliente que este servicio es gratis.");
            expect(save(screen.container)?.disabled).toBe(false);
        } finally { screen.unmount(); }
    });
});

describe("what the catalogue sends", () => {
    const update = api.updateService as jest.Mock;
    const create = api.createService as jest.Mock;
    const getServices = api.getServices as jest.Mock;
    const noop = () => {};
    const MESSAGES = { saveError: "e", deleteError: "e", updateError: "e", created: "c", updated: "u", deleted: "d", priceMissing: "m" };
    // The hook's latest value, handed out from an effect (never during render).
    const latest: { current?: ReturnType<typeof useServiceCatalog> } = {};
    function Harness() {
        const value = useServiceCatalog(TENANT, noop, MESSAGES);
        useEffect(() => { latest.current = value; });
        return null;
    }
    const catalog = () => latest.current!;

    beforeEach(() => {
        update.mockClear();
        create.mockClear();
        getServices.mockReset().mockResolvedValue({
            success: true,
            data: [{ id: "svc-null", name: "Consulta general", durationMinutes: 30, price: null, priceStatus: "example" }],
        });
    });

    it("keeps a missing amount missing when it loads the catalogue", async () => {
        const screen = await renderScreen(<Harness />);
        try {
            await act(async () => { await catalog().loadServices(); });
            expect(catalog().services[0].price).toBeNull();
        } finally { screen.unmount(); }
    });

    it('"Es gratis" on a card is sent as free, not as a confirmation of nothing', async () => {
        const screen = await renderScreen(<Harness />);
        try {
            await act(async () => { await catalog().handleSetServicePriceStatus(service({ id: "svc-null", name: "Consulta", price: null, priceStatus: "example" }), "free"); });
            expect(update).toHaveBeenCalledWith(TENANT, "svc-null", { priceStatus: "confirmed", price: 0, free: true });
        } finally { screen.unmount(); }
    });

    it("saving an untouched placeholder sends no price decision, and a new service never sends a bare 0", async () => {
        const screen = await renderScreen(<Harness />);
        try {
            const seeded = service({ id: "svc-null", name: "Consulta general", price: null, priceStatus: "example" });
            await act(async () => { catalog().openEditServiceModal(seeded); });
            await act(async () => { await catalog().handleSaveService(); });
            const payload = update.mock.calls[0][2];
            expect(payload).not.toHaveProperty("price");
            expect(payload).not.toHaveProperty("priceStatus");
            expect(payload).not.toHaveProperty("free");

            await act(async () => { catalog().openCreateServiceModal(); });
            await act(async () => { catalog().setServiceForm({ ...catalog().serviceForm, name: "Asesoría", priceStatus: "free" }); });
            await act(async () => { await catalog().handleSaveService(); });
            expect(create.mock.calls[0][1]).toMatchObject({ name: "Asesoría", price: 0, priceStatus: "confirmed", free: true });
        } finally { screen.unmount(); }
    });
});
