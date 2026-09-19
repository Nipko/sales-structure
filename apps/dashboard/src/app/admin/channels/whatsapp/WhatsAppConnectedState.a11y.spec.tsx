import { act } from "react";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import WhatsAppConnectedState from "./WhatsAppConnectedState";
import type { ConnectedReadiness } from "./connected-readiness";

/**
 * The wizard's "connected" screen, as the owner reads it and as a screen
 * reader hands it over.
 *
 * The 14-sep-2026 recording ended here: "¡Conectado! … Tu agente ya responde
 * ahí" over a number with no billing time zone, so every reply was refused and
 * nothing on screen said why. What is pinned below is the whole rule, driven
 * through the real component with the real Spanish copy:
 *  - all good → the claim, one quiet line about the payment method;
 *  - time zone missing → no claim, the picker already on the business's zone,
 *    one tap to confirm, and only then the claim;
 *  - payment method missing or not established → a call to action in Meta,
 *    never a blocked "Continuar".
 */

const mockFetch = jest.fn();
const mockTenantZone = jest.fn();
const mockFunding = jest.fn();
const mockCheckFunding = jest.fn();
const mockSetZone = jest.fn();
jest.mock("@/lib/api", () => ({
    api: {
        fetch: (...args: unknown[]) => mockFetch(...args),
        getTenantTimezone: (...args: unknown[]) => mockTenantZone(...args),
        getWhatsappFundingReadiness: (...args: unknown[]) => mockFunding(...args),
        checkWhatsappFunding: (...args: unknown[]) => mockCheckFunding(...args),
        setWhatsappBillingTimeZone: (...args: unknown[]) => mockSetZone(...args),
    },
}));

const TODAY = Date.UTC(2026, 8, 17, 15);
const AFTER_DEADLINE = Date.UTC(2026, 9, 2, 15);
const CONNECTED = { displayPhoneNumber: "+57 300 000 0001", phoneNumberId: "111", warnings: [] };

function zoneReading(zone: string | null) {
    return {
        success: true,
        data: {
            numbers: [{
                channelAccountId: "111",
                zone,
                resolution: zone ? { kind: "known" } : { kind: "unmapped" },
                metadata: { displayPhoneNumber: "+57 300 000 0001" },
            }],
            contradictions: [],
        },
    };
}

function fundingReading(state: string) {
    return { success: true, data: { numbers: [{ channelAccountId: "111", state, checkedAt: "2026-09-17T10:00:00Z" }] } };
}

/** Lets the chained reads (readiness → Meta check → re-read) settle. */
async function settle() {
    for (let round = 0; round < 4; round += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

async function render(options: {
    now?: number;
    canCheckFunding?: boolean;
    onAcknowledged?: (r: ConnectedReadiness) => void;
    warnings?: string[];
} = {}) {
    const screen = await renderScreen(
        <WhatsAppConnectedState
            connected={options.warnings ? { ...CONNECTED, warnings: options.warnings } : CONNECTED}
            access="form"
            canCheckFunding={options.canCheckFunding ?? true}
            onAcknowledged={options.onAcknowledged ?? (() => {})}
            now={options.now ?? TODAY}
        />,
    );
    await settle();
    return screen;
}

function continueButton(container: HTMLElement): HTMLButtonElement {
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes("Continuar"));
    if (!button) throw new Error("no Continuar button");
    return button as HTMLButtonElement;
}

beforeEach(() => {
    mockFetch.mockReset();
    mockTenantZone.mockReset().mockResolvedValue({ success: true, data: { timezone: "America/Mexico_City" } });
    mockFunding.mockReset();
    mockCheckFunding.mockReset().mockResolvedValue({ success: true, data: {} });
    mockSetZone.mockReset();
});

describe("WhatsApp connected on day 0", () => {
    it("all good: says the agent answers, with one quiet line about the payment method", async () => {
        mockFetch.mockResolvedValue(zoneReading("America/Bogota"));
        mockFunding.mockResolvedValue(fundingReading("attached"));
        const onAcknowledged = jest.fn();
        const screen = await render({ onAcknowledged });
        const text = screen.container.textContent ?? "";

        expect(mockFetch).toHaveBeenCalledWith("/channels/whatsapp/connection/billing-readiness");
        expect(text).toContain("¡Conectado!");
        expect(text).toContain("Tu agente ya responde ahí");
        expect(text).toContain("Método de pago en Meta: listo");
        expect(text).toContain("Zona horaria de facturación: America/Bogota");
        // Nothing to fix: no form, no call to action, and Meta was not asked
        // again about a card it already reported.
        expect(screen.container.querySelector("form")).toBeNull();
        expect(screen.container.querySelector("a[href^='https://business.facebook.com']")).toBeNull();
        expect(mockCheckFunding).not.toHaveBeenCalled();
        expect(screen.container.querySelector("a[href='https://wa.me/573000000001']")).not.toBeNull();

        await interact(() => continueButton(screen.container).click());
        expect(onAcknowledged).toHaveBeenCalledWith({ headline: "ready", answering: true, pending: [] });
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });

    it("timezone missing: no claim, the business's zone preselected, and one tap turns it into the claim", async () => {
        mockFetch
            .mockResolvedValueOnce(zoneReading(null))
            .mockResolvedValue(zoneReading("America/Mexico_City"));
        mockFunding.mockResolvedValue(fundingReading("attached"));
        mockSetZone.mockResolvedValue({ success: true, data: { phoneNumberId: "111", timeZone: "America/Mexico_City", alsoApplied: [] } });
        const onAcknowledged = jest.fn();
        const screen = await render({ onAcknowledged });
        const before = screen.container.textContent ?? "";

        expect(before).not.toContain("ya responde");
        expect(before).not.toContain("¡Conectado!");
        expect(before).toContain("Tu número +57 300 000 0001 quedó conectado. Falta un paso");
        expect(before).toContain("Ya dejamos elegida la de tu negocio, America/Mexico_City");
        // The generic "most common" hint must not describe the business's zone.
        expect(before).not.toContain("porque es la más común");
        expect(screen.container.querySelector("select")!.value).toBe("America/Mexico_City");
        // A test message cannot succeed yet, so there is no button to send one.
        expect(screen.container.querySelector("a[href^='https://wa.me/']")).toBeNull();
        expect(before).toContain("Primero confirma la zona horaria de arriba");
        expect(mockSetZone).not.toHaveBeenCalled();
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);

        // Continuing is allowed — and tells the next screen what is left.
        await interact(() => continueButton(screen.container).click());
        expect(onAcknowledged).toHaveBeenLastCalledWith({ headline: "needs_zone", answering: false, pending: ["billing_zone"] });

        const confirm = screen.container.querySelector<HTMLButtonElement>("button[type=submit]")!;
        expect(confirm.textContent).toBe("Confirmar America/Mexico_City");
        await interact(() => confirm.click());
        await settle();

        expect(mockSetZone).toHaveBeenCalledWith("111", "America/Mexico_City");
        const after = screen.container.textContent ?? "";
        expect(after).toContain("Listo: la zona horaria de facturación de +57 300 000 0001 quedó en America/Mexico_City.");
        expect(after).toContain("¡Conectado!");
        expect(after).toContain("Tu agente ya responde ahí");
        expect(screen.container.querySelector("a[href='https://wa.me/573000000001']")).not.toBeNull();
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });

    it("payment method missing: no claim, a call to action in Meta with the date, and Continuar still works", async () => {
        mockFetch.mockResolvedValue(zoneReading("America/Bogota"));
        mockFunding.mockResolvedValue(fundingReading("absent"));
        const onAcknowledged = jest.fn();
        const screen = await render({ onAcknowledged });
        const text = screen.container.textContent ?? "";

        expect(text).not.toContain("ya responde");
        expect(text).toContain("Meta nos dice que tu cuenta de WhatsApp no tiene un método de pago.");
        expect(text).toContain("no pasa por Parallly");
        expect(text).toContain("antes del 30 de septiembre de 2026");
        const link = screen.container.querySelector<HTMLAnchorElement>("a[href='https://business.facebook.com/wa/manage/home/']")!;
        expect(link.target).toBe("_blank");
        expect(link.textContent).toContain("se abre en una pestaña nueva");

        const button = continueButton(screen.container);
        expect(button.disabled).toBe(false);
        await interact(() => button.click());
        expect(onAcknowledged).toHaveBeenCalledWith({ headline: "needs_payment", answering: false, pending: ["payment_method"] });

        // "Ya lo agregué": ask Meta again, and believe the answer.
        mockFunding.mockResolvedValue(fundingReading("attached"));
        const recheck = [...screen.container.querySelectorAll("button")].find((node) => node.textContent?.includes("Ya lo agregué"))!;
        await interact(() => (recheck as HTMLButtonElement).click());
        await settle();
        expect(mockCheckFunding).toHaveBeenCalledWith("111");
        expect(screen.container.textContent).toContain("Tu agente ya responde ahí");
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });

    it("payment refused by Meta: says replies are not going out now, without a deadline that already passed for her", async () => {
        mockFetch.mockResolvedValue(zoneReading("America/Bogota"));
        mockFunding.mockResolvedValue(fundingReading("restricted"));
        const onAcknowledged = jest.fn();
        const screen = await render({ onAcknowledged });
        const text = screen.container.textContent ?? "";

        expect(text).not.toContain("ya responde");
        expect(text).toContain("Meta no está entregando las respuestas de tu agente");
        expect(text).toContain("Meta no está aceptando cobros de tu cuenta de WhatsApp.");
        expect(text).not.toContain("antes del 30 de septiembre");
        await interact(() => continueButton(screen.container).click());
        expect(onAcknowledged).toHaveBeenCalledWith({ headline: "payment_restricted", answering: false, pending: ["payment_method"] });
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });

    it("payment method never checked: asks Meta once, and an unknown answer is a call to action, not a finding", async () => {
        mockFetch.mockResolvedValue(zoneReading("America/Bogota"));
        mockFunding
            .mockResolvedValueOnce(fundingReading("not_checked"))
            .mockResolvedValue(fundingReading("unknown"));
        const screen = await render();
        const text = screen.container.textContent ?? "";

        expect(mockCheckFunding).toHaveBeenCalledTimes(1);
        expect(mockCheckFunding).toHaveBeenCalledWith("111");
        // Before 1 October a reply goes out without a card, so the claim holds;
        // the card still says what to do and by when.
        expect(text).toContain("Tu agente ya responde ahí");
        expect(text).toContain("No pudimos confirmar con Meta");
        expect(text).not.toContain("no tiene un método de pago.");
        expect(screen.container.querySelector("a[href='https://business.facebook.com/wa/manage/home/']")).not.toBeNull();
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });

    it("payment method unknown after 1 October: the claim stops", async () => {
        mockFetch.mockResolvedValue(zoneReading("America/Bogota"));
        mockFunding.mockResolvedValue(fundingReading("unknown"));
        const screen = await render({ now: AFTER_DEADLINE });
        const text = screen.container.textContent ?? "";

        expect(text).not.toContain("ya responde");
        expect(text).toContain("Desde el 1 de octubre de 2026, Meta no entrega las respuestas de tu agente");
        expect(text).not.toContain("antes del 30 de septiembre");
        screen.unmount();
    });

    it("gives a person who may not ask Meta no check and no button that would refuse", async () => {
        mockFetch.mockResolvedValue(zoneReading("America/Bogota"));
        mockFunding.mockResolvedValue(fundingReading("not_checked"));
        const screen = await render({ canCheckFunding: false });

        expect(mockCheckFunding).not.toHaveBeenCalled();
        const labels = [...screen.container.querySelectorAll("button")].map((node) => node.textContent);
        expect(labels.some((label) => label?.includes("Ya lo agregué"))).toBe(false);
        expect(screen.container.querySelector("a[href='https://business.facebook.com/wa/manage/home/']")).not.toBeNull();
        screen.unmount();
    });

    it.each([
        ["webhook_subscription_failed", "webhook_subscription", "No pudimos confirmar la suscripción a los mensajes entrantes."],
        ["phone_registration_deferred", "phone_registration", "El registro del número quedó pendiente del lado de Meta."],
    ])("a signup Meta left open (%s): no claim, what is open and what to do, and 'Continuar' carries it", async (warning, pending, line) => {
        // Zone set, card attached: before, the only thing between this screen
        // and "Tu agente ya responde" on the last one was this warning.
        mockFetch.mockResolvedValue(zoneReading("America/Bogota"));
        mockFunding.mockResolvedValue(fundingReading("attached"));
        const onAcknowledged = jest.fn();
        const screen = await render({ onAcknowledged, warnings: [warning] });
        const text = screen.container.textContent ?? "";

        expect(text).not.toContain("ya responde");
        expect(text).toContain(line);
        expect(text).toContain("Mientras esto siga abierto, tu agente no puede responder por este número.");
        // Canales → WhatsApp has nothing to fix this with: not promised there.
        expect(text).not.toContain("terminar esto después en Canales → WhatsApp");
        await interact(() => continueButton(screen.container).click());
        expect(onAcknowledged).toHaveBeenCalledWith({ headline: "signup_pending", answering: false, pending: [pending] });
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });

    it("a warning that does not stop replies (business not verified) keeps the agent answering", async () => {
        mockFetch.mockResolvedValue(zoneReading("America/Bogota"));
        mockFunding.mockResolvedValue(fundingReading("attached"));
        const onAcknowledged = jest.fn();
        const screen = await render({ onAcknowledged, warnings: ["business_not_verified"] });

        expect(screen.container.textContent).toContain("Tu empresa todavía no está verificada en Meta.");
        expect(screen.container.textContent).not.toContain("Mientras esto siga abierto");
        await interact(() => continueButton(screen.container).click());
        expect(onAcknowledged).toHaveBeenCalledWith({ headline: "ready", answering: true, pending: [] });
        screen.unmount();
    });

    it("claims nothing when the time zone could not be read", async () => {
        mockFetch.mockRejectedValue(new Error("HTTP error! status: 500"));
        mockFunding.mockResolvedValue(fundingReading("attached"));
        const screen = await render();
        const text = screen.container.textContent ?? "";

        expect(text).not.toContain("ya responde");
        expect(text).toContain("No pudimos comprobar si tu agente ya puede responder ahí");
        expect(text).toContain("No pudimos comprobar la zona horaria de facturación de este número.");
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });
});
