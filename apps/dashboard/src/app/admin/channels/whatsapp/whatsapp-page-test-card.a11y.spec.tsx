import { act } from "react";
import { findAccessibilityViolations, renderScreen } from "@/test/a11y";
import { guidedTourSelector } from "@/lib/guided-tours";
import WhatsAppSetupPage from "./page";

/**
 * "Prueba tu agente" on Canales → WhatsApp, over a number that cannot answer.
 *
 * The page listed what the signup left open in the amber notice and, right
 * under it, offered "Prueba tu agente" with a wa.me link — for a number Meta
 * had not registered, whose test message could never be answered. While a
 * signup warning that stops every reply is open (the connected state's rule:
 * `signupBlockers`), the card now says what is pending instead of the link.
 * It keeps its tour anchor: the WhatsApp tour reads it as "connected".
 */

const mockFetch = jest.fn();
jest.mock("@/lib/api", () => ({
    api: {
        fetch: (...args: unknown[]) => mockFetch(...args),
        getWhatsappConfig: jest.fn(async () => ({ success: true, data: null })),
        disconnectChannelAccount: jest.fn(),
    },
}));
jest.mock("next/navigation", () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    usePathname: () => "/admin/channels/whatsapp",
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: "tenant_admin" } }) }));
jest.mock("@/hooks/usePlanLimits", () => ({ usePlanLimits: () => ({ canAddChannelAccount: () => false }) }));
// Panels with their own reads and their own specs; nothing here is about them.
jest.mock("@/components/channels/WhatsappFundingPanel", () => ({ WhatsappFundingPanel: () => null }));
jest.mock("@/components/channels/WhatsappSpendPanel", () => ({ WhatsappSpendPanel: () => null }));
jest.mock("@/components/ui/help-panel", () => ({ HelpPanel: () => null }));
jest.mock("./WhatsAppBillingTimeZone", () => ({ __esModule: true, default: () => null }));

const NUMBER = "+57 300 000 0001";
const BLOCKED_LINE = `Mientras siga abierto lo pendiente de arriba, tu agente no puede responder por ${NUMBER}.`;

function statusWith(signupWarnings: string[]) {
    return {
        success: true,
        data: {
            connected: true,
            accounts: [{
                accountId: "111", displayName: "Tienda", metadata: { displayPhoneNumber: NUMBER },
                signupWarnings, signupWarningsAt: "2026-09-10T15:00:00.000Z",
            }],
        },
    };
}

function arrange(signupWarnings: string[]) {
    mockFetch.mockReset().mockImplementation(async (endpoint: string) => {
        if (endpoint === "/channels/whatsapp/status") return statusWith(signupWarnings);
        if (endpoint === "/channels/whatsapp/templates") return [];
        return null;
    });
}

async function render() {
    const screen = await renderScreen(<WhatsAppSetupPage />);
    for (let round = 0; round < 4; round += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
    return screen;
}

function testCard(container: HTMLElement): HTMLElement {
    const card = container.querySelector<HTMLElement>(guidedTourSelector("whatsapp-test"));
    if (!card) throw new Error("no test card");
    return card;
}

describe("Canales → WhatsApp: the \"Prueba tu agente\" card", () => {
    it("says what is pending instead of offering the test while Meta has not registered the number", async () => {
        arrange(["phone_registration_deferred"]);
        const screen = await render();
        try {
            const card = testCard(screen.container);
            expect(card.textContent).toContain("Prueba tu agente");
            expect(card.textContent).toContain(BLOCKED_LINE);
            expect(card.querySelector("a[href^='https://wa.me/']")).toBeNull();
            expect(screen.container.querySelector("a[href^='https://wa.me/']")).toBeNull();
            // The notice above still says what to do about it.
            expect(screen.container.textContent).toContain("escríbenos a soporte");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("does the same while Meta has not confirmed the webhook subscription", async () => {
        arrange(["webhook_subscription_failed"]);
        const screen = await render();
        try {
            expect(testCard(screen.container).textContent).toContain(BLOCKED_LINE);
            expect(screen.container.querySelector("a[href^='https://wa.me/']")).toBeNull();
        } finally { screen.unmount(); }
    });

    it("keeps the test when what is open still lets a reply out", async () => {
        arrange(["business_not_verified", "template_sync_failed"]);
        const screen = await render();
        try {
            const card = testCard(screen.container);
            expect(card.textContent).not.toContain(BLOCKED_LINE);
            expect(card.querySelector("a")?.getAttribute("href")).toBe("https://wa.me/573000000001");
        } finally { screen.unmount(); }
    });

    it("keeps the test when nothing is open", async () => {
        arrange([]);
        const screen = await render();
        try {
            expect(testCard(screen.container).querySelector("a")?.getAttribute("href")).toBe("https://wa.me/573000000001");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });
});
