import { act, createElement } from "react";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import WhatsAppTriage from "./WhatsAppTriage";

/**
 * "¿Dónde vive hoy tu número de WhatsApp?", with the answer kept for the
 * account.
 *
 * The screen says "lo dejamos anotado y lo retomas cuando lo tengas". With
 * the answer only in this browser, the owner who answered on her laptop met
 * the question again on her phone. Now the question shows this browser's copy
 * at once, then the account's answer replaces it; what she presses wins over
 * any read still on its way, and a read nobody could make changes nothing.
 */

const mockFetch = jest.fn();
const mockGetSetupStatus = jest.fn();
jest.mock("@/lib/api", () => ({
    api: {
        fetch: (...args: unknown[]) => mockFetch(...args),
        getSetupStatus: (...args: unknown[]) => mockGetSetupStatus(...args),
    },
}));

const TENANT = "tenant-1";
const STORAGE_KEY = `parallly_wa_triage_${TENANT}`;

function recorded(answerId: string | null) {
    return {
        success: true,
        data: { whatsappTriage: answerId ? { answerId, recordedAt: "2026-09-18T15:00:00.000Z" } : null },
    };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

async function render(initialAnswerId: string | null = null) {
    const screen = await renderScreen(createElement(WhatsAppTriage, {
        tenantId: TENANT,
        initialAnswerId: initialAnswerId as any,
        onRoute: jest.fn(),
        onLater: jest.fn(),
    }));
    await settle();
    return screen;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(text));
    if (!found) throw new Error(`no button reads "${text}"`);
    return found as HTMLButtonElement;
}

const QUESTION = "¿Dónde vive hoy tu número de WhatsApp?";
const NOT_AT_HAND = "No lo tengo a mano ahora";

beforeEach(() => {
    window.localStorage.clear();
    mockFetch.mockReset().mockResolvedValue({ success: true });
    mockGetSetupStatus.mockReset();
});

describe("the WhatsApp question remembers the account's answer", () => {
    it("shows the answer she gave on another device, and keeps a copy here", async () => {
        mockGetSetupStatus.mockResolvedValue(recorded("not_at_hand"));
        const screen = await render(null);
        try {
            expect(mockGetSetupStatus).toHaveBeenCalledWith(TENANT);
            expect(screen.container.textContent).toContain(NOT_AT_HAND);
            expect(screen.container.textContent).toContain("lo dejamos anotado");
            expect(screen.container.textContent).not.toContain(QUESTION);
            expect(window.localStorage.getItem(STORAGE_KEY)).toBe("not_at_hand");
            // Adopting the account's answer is a read, not a new answer.
            expect(mockFetch).not.toHaveBeenCalled();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("asks again when the account holds no answer, whatever this browser remembered", async () => {
        window.localStorage.setItem(STORAGE_KEY, "business_app");
        mockGetSetupStatus.mockResolvedValue(recorded(null));
        const screen = await render("business_app");
        try {
            expect(screen.container.textContent).toContain(QUESTION);
            expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("keeps this browser's copy when nobody could read the account's answer", async () => {
        mockGetSetupStatus.mockRejectedValue(new Error("offline"));
        const screen = await render("not_at_hand");
        try {
            expect(screen.container.textContent).toContain(NOT_AT_HAND);
            expect(screen.container.textContent).not.toContain(QUESTION);
        } finally {
            screen.unmount();
        }
    });

    it("lets what she presses win over a read still on its way, and writes it to the account", async () => {
        let answerRead: (value: unknown) => void = () => undefined;
        mockGetSetupStatus.mockImplementation(() => new Promise((resolve) => { answerRead = resolve; }));
        const screen = await render(null);
        try {
            await interact(() => button(screen.container, NOT_AT_HAND).click());
            await settle();
            expect(mockFetch).toHaveBeenCalledWith("/persona/tenant-1/whatsapp-triage",
                { method: "PUT", body: JSON.stringify({ answerId: "not_at_hand" }) });

            // The account's older answer arrives afterwards and changes nothing.
            answerRead(recorded("business_app"));
            await settle();
            expect(screen.container.textContent).toContain(NOT_AT_HAND);
            expect(window.localStorage.getItem(STORAGE_KEY)).toBe("not_at_hand");
        } finally {
            screen.unmount();
        }
    });

    it("takes the answer back from the account too, on \"Cambiar mi respuesta\"", async () => {
        mockGetSetupStatus.mockResolvedValue(recorded("not_at_hand"));
        const screen = await render("not_at_hand");
        try {
            await interact(() => button(screen.container, "Cambiar mi respuesta").click());
            await settle();
            expect(mockFetch).toHaveBeenLastCalledWith("/persona/tenant-1/whatsapp-triage",
                { method: "PUT", body: JSON.stringify({ answerId: null }) });
            expect(screen.container.textContent).toContain(QUESTION);
            expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });
});
