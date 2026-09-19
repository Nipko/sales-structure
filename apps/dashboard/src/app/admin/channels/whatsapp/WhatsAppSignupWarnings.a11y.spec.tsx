import { act } from "react";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import WhatsAppConnectedState from "./WhatsAppConnectedState";
import WhatsAppSignupWarningsNotice from "./WhatsAppSignupWarningsNotice";
import { BILLING_READINESS_ENDPOINT } from "./billing-time-zone";

/**
 * A signup's warnings, read back from the server, as the owner reads them.
 *
 * The connected state and Canales → WhatsApp knew a signup's warnings only
 * from the answer to a signup run in that same page. A number connected
 * earlier — or the same number after a reload — whose registration Meta
 * refused sat under "Conectado" with nothing saying its agent cannot answer.
 * Driven here through the real components and the real Spanish copy.
 */

const mockFetch = jest.fn();
const mockTenantZone = jest.fn();
const mockFunding = jest.fn();
jest.mock("@/lib/api", () => ({
    api: {
        fetch: (...args: unknown[]) => mockFetch(...args),
        getTenantTimezone: (...args: unknown[]) => mockTenantZone(...args),
        getWhatsappFundingReadiness: (...args: unknown[]) => mockFunding(...args),
        checkWhatsappFunding: jest.fn(async () => ({ success: true, data: {} })),
        setWhatsappBillingTimeZone: jest.fn(),
    },
}));

const TODAY = Date.UTC(2026, 8, 17, 15);
const REGISTRATION_LINE = "El registro del número quedó pendiente del lado de Meta";
const BLOCKS_LINE = "Mientras esto siga abierto, tu agente no puede responder por este número.";

const ZONE_SET = {
    success: true,
    data: {
        numbers: [{ channelAccountId: "111", zone: "America/Bogota", resolution: { kind: "known" }, metadata: { displayPhoneNumber: "+57 300 000 0001" } }],
        contradictions: [],
    },
};
const statusWith = (signupWarnings: unknown) => ({
    success: true,
    data: {
        connected: true,
        accounts: [{ accountId: "111", displayName: "Tienda", metadata: { displayPhoneNumber: "+57 300 000 0001" }, signupWarnings, signupWarningsAt: "2026-09-10T15:00:00.000Z" }],
    },
});

async function settle() {
    for (let round = 0; round < 4; round += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

function continueButton(container: HTMLElement): HTMLButtonElement {
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes("Continuar"));
    if (!button) throw new Error("no Continuar button");
    return button as HTMLButtonElement;
}

beforeEach(() => {
    mockFetch.mockReset();
    mockTenantZone.mockReset().mockResolvedValue({ success: true, data: { timezone: "America/Bogota" } });
    mockFunding.mockReset().mockResolvedValue({
        success: true, data: { numbers: [{ channelAccountId: "111", state: "attached", checkedAt: "2026-09-17T10:00:00Z" }] },
    });
});

describe("the connected state of a number connected before this page", () => {
    it("reads what its signup left open from the server, and does not say the agent answers", async () => {
        mockFetch.mockImplementation(async (endpoint: string) => (
            endpoint === "/channels/whatsapp/status" ? statusWith(["phone_registration_deferred"]) : ZONE_SET
        ));
        const onAcknowledged = jest.fn();
        const screen = await renderScreen(
            <WhatsAppConnectedState
                connected={{ displayPhoneNumber: "+57 300 000 0001", phoneNumberId: "111" }}
                access="form"
                canCheckFunding
                onAcknowledged={onAcknowledged}
                now={TODAY}
            />,
        );
        await settle();
        const text = screen.container.textContent ?? "";

        expect(mockFetch).toHaveBeenCalledWith("/channels/whatsapp/status");
        expect(text).toContain(REGISTRATION_LINE);
        expect(text).toContain(BLOCKS_LINE);
        expect(text).not.toContain("ya responde");
        await interact(() => continueButton(screen.container).click());
        expect(onAcknowledged).toHaveBeenCalledWith({ headline: "signup_pending", answering: false, pending: ["phone_registration"] });
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });

    it("says the agent answers when the server kept nothing open", async () => {
        mockFetch.mockImplementation(async (endpoint: string) => (
            endpoint === "/channels/whatsapp/status" ? statusWith([]) : ZONE_SET
        ));
        const screen = await renderScreen(
            <WhatsAppConnectedState connected={{ phoneNumberId: "111", displayPhoneNumber: "+57 300 000 0001" }} access="form" canCheckFunding now={TODAY} />,
        );
        await settle();

        expect(screen.container.textContent).toContain("Tu agente ya responde ahí");
        screen.unmount();
    });

    it("does not ask the server again when the signup it just ran already answered", async () => {
        mockFetch.mockResolvedValue(ZONE_SET);
        const screen = await renderScreen(
            <WhatsAppConnectedState connected={{ phoneNumberId: "111", displayPhoneNumber: "+57 300 000 0001", warnings: [] }} access="form" canCheckFunding now={TODAY} />,
        );
        await settle();

        expect(mockFetch).not.toHaveBeenCalledWith("/channels/whatsapp/status");
        expect(mockFetch).toHaveBeenCalledWith(BILLING_READINESS_ENDPOINT);
        screen.unmount();
    });
});

describe("Canales → WhatsApp: what each number's signup left open", () => {
    it("names each number, says which ones cannot answer, and dates what came from an earlier signup", async () => {
        const screen = await renderScreen(
            <WhatsAppSignupWarningsNotice
                showNumbers
                numberLabel={(id) => (id === "111" ? "+57 300 000 0001" : "+57 300 000 0002")}
                groups={[
                    { phoneNumberId: "111", warnings: ["phone_registration_deferred"], recordedAt: "2026-09-10T15:00:00.000Z" },
                    { phoneNumberId: "222", warnings: ["business_not_verified"], recordedAt: null },
                ]}
            />,
        );
        const text = screen.container.textContent ?? "";

        expect(text).toContain("Conectado, con algunas cosas pendientes");
        expect(text).toContain("+57 300 000 0001");
        expect(text).toContain("+57 300 000 0002");
        expect(text).toContain(REGISTRATION_LINE);
        expect(text).toContain("Tu empresa todavía no está verificada en Meta.");
        // Only the registration stops replies, so the line appears once.
        expect(text.split(BLOCKS_LINE).length - 1).toBe(1);
        expect(text).toContain("Meta lo informó al conectar este número, el 10 de septiembre de 2026.");
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });

    it("renders nothing when nothing is open", async () => {
        const screen = await renderScreen(<WhatsAppSignupWarningsNotice groups={[]} showNumbers={false} numberLabel={(id) => id} />);
        expect(screen.container.textContent).toBe("");
        screen.unmount();
    });
});
