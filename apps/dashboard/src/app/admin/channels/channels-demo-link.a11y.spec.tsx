import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import { api } from "@/lib/api";
import ChannelsOverviewPage from "./page";

/**
 * "El enlace de {Nombre}" on the channels page, told the way the plan makes it.
 *
 * The page drew its own card, the same for everybody: "Cualquiera puede
 * escribirle a tu agente desde este enlace." On a plan without the web chat
 * that link is a trial the platform pays — capped per day and in total, and no
 * person ever takes over — and the wizard's card already said so. This page
 * went on promising the other thing. What is pinned here is the same story as
 * `DemoLinkCard`, decided by the same flag (`features.widget`): a channel says
 * what a channel says; a trial says what it is for and what a plan with the
 * web chat changes; a plan still being read says neither. And a link that
 * does not answer today (`demoLink.answers === false`) says it is paused and
 * why, with nothing to open or copy.
 */

let mockPlan: { features: { widget: boolean }; loading: boolean } = { features: { widget: false }, loading: false };

jest.mock("@/lib/api", () => ({
    api: {
        fetch: jest.fn(),
        getSetupStatus: jest.fn(),
    },
}));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/hooks/usePlanLimits", () => ({
    usePlanLimits: () => ({ ...mockPlan, getChannelAccountLimit: () => 1 }),
}));
jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
// Its own specs cover it; here it would only add a second heading to count.
jest.mock("@/components/ui/help-panel", () => ({ HelpPanel: () => null }));

function setupStatus(link: Record<string, unknown> = {}) {
    return {
        success: true,
        data: { demoLink: { widgetId: "wgt_abc", path: "/w/wgt_abc", agentName: "Sofía", ...link } },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockPlan = { features: { widget: false }, loading: false };
    jest.mocked(api.fetch).mockResolvedValue({ success: true, data: [] } as never);
    jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus() as never);
});

async function renderLinkCard() {
    const screen = await renderScreen(<ChannelsOverviewPage />);
    const card = screen.container.querySelector('[aria-labelledby="channel-demo-link-title"]');
    expect(card).not.toBeNull();
    return { screen, card: card as HTMLElement };
}

describe("the public link on the channels page", () => {
    it("on a trial, says what it is for and what a plan with the web chat changes", async () => {
        const { screen, card } = await renderLinkCard();
        try {
            const text = card.textContent ?? "";
            expect(text).toContain("El enlace de Sofía");
            expect(text).toContain("Es para probar a Sofía y mostrárselo a alguien");
            expect(text).toContain("no pasa la conversación a una persona");
            expect(text).not.toContain("Cualquiera puede escribirle a tu agente");
            const plans = Array.from(card.querySelectorAll("a")).find((a) => a.textContent === "Ver planes");
            expect(plans?.getAttribute("href")).toBe("/admin/settings/billing");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("with the web chat in the plan, is a channel and says nothing about a cap", async () => {
        mockPlan = { features: { widget: true }, loading: false };
        const { screen, card } = await renderLinkCard();
        try {
            const text = card.textContent ?? "";
            expect(text).toContain("Cualquiera puede escribirle a tu agente desde este enlace.");
            expect(text).not.toMatch(/tope|probar|Ver planes/);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("tells neither story while the plan is being read", async () => {
        mockPlan = { features: { widget: false }, loading: true };
        const { screen, card } = await renderLinkCard();
        try {
            const text = card.textContent ?? "";
            expect(text).not.toContain("Cualquiera puede escribirle");
            expect(text).not.toContain("Es para probar");
            expect(text).not.toContain("Ver planes");
            // The link itself is still there to open and copy.
            expect(text).toContain("/w/wgt_abc");
        } finally { screen.unmount(); }
    });

    it.each([
        ["switched_off", "El enlace de prueba de Sofía está en pausa, así que por ahora no responde."],
        ["allowance_used", "Sofía ya usó las respuestas gratis de su enlace de prueba, así que ahí no responde más."],
    ] as const)("paused (%s): says why and offers nothing to open or copy, whatever the plan", async (unavailableReason, sentence) => {
        // F11: the card kept "Abrir" and "Copiar enlace" — and, with the web
        // chat, "Cualquiera puede escribirle a tu agente" — over a link that
        // no longer answered.
        for (const widget of [false, true]) {
            mockPlan = { features: { widget }, loading: false };
            jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({ answers: false, unavailableReason }) as never);
            const { screen, card } = await renderLinkCard();
            try {
                const text = card.textContent ?? "";
                expect(text).toContain("El enlace de Sofía");
                expect(text).toContain(sentence);
                expect(text).toContain("En pausa");
                expect(text).not.toMatch(/Cualquiera puede escribirle|Es para probar|Nada que conectar|\/w\/wgt_abc/);
                expect(card.querySelector('[data-channel-status="paused"]')).not.toBeNull();
                expect(card.querySelectorAll("button")).toHaveLength(0);
                expect(Array.from(card.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]))
                    .toEqual([["Ver planes", "/admin/settings/billing"]]);
                expect(await findAccessibilityViolations(screen.container)).toEqual([]);
            } finally { screen.unmount(); }
        }
    });

    it("an API that does not say whether the link answers keeps the card as it was", async () => {
        const { screen, card } = await renderLinkCard();
        try {
            expect(card.querySelector('[data-channel-status="always"]')).not.toBeNull();
            expect(Array.from(card.querySelectorAll("a")).some((a) => a.textContent?.includes("Abrir"))).toBe(true);
        } finally { screen.unmount(); }
    });
});
