import { createElement } from "react";
import { renderScreen, findAccessibilityViolations, interact } from "@/test/a11y";
import type { SetupStatusDemoLink } from "@/lib/onboarding-guide";
import DemoLinkCard from "./DemoLinkCard";

/**
 * "El enlace de {Nombre}", read the way a screen reader hands it over.
 *
 * Five actions on one card. Three of them go somewhere (the page, WhatsApp,
 * the web-chat settings) and must be real links — the two external ones say
 * they open a new tab; two copy something and must be real buttons. The copy
 * that leads elsewhere leaves a hint that is announced, because "Copiado"
 * alone does not say where to paste.
 *
 * The load-bearing assertion is the negative one: this card holds the DEMO
 * widget id, so its embed snippet must never reach a clipboard. A real site
 * running on the platform-paid demo widget dies with its allowance.
 *
 * What the link is FOR depends on the plan (audit #61): with the web chat in
 * the plan it is a real channel and the five actions apply; on a trial it is
 * for trying the agent and showing it to someone, and the card must not sell
 * it for the Instagram bio nor send people to a web-chat page their plan does
 * not open.
 *
 * And whether it answers TODAY: a trial link the platform switched off, or
 * one whose free replies are used, is said as paused, with nothing to open,
 * copy or share.
 */

const DEMO_LINK: SetupStatusDemoLink = {
    widgetId: "wgt_abc123", path: "/w/wgt_abc123", agentName: "Ana", usageMode: "operational", answers: true, unavailableReason: null,
};
const WEB_CHAT_SETTINGS = "/admin/settings/integrations/web-chat";

/** The plan as `usePlanLimits` reports it; each test sets what it needs. */
let mockPlan: { features: { widget: boolean }; loading: boolean } = { features: { widget: true }, loading: false };
jest.mock("@/hooks/usePlanLimits", () => ({ usePlanLimits: () => mockPlan }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/lib/api", () => ({ api: { setDemoLinkUsageMode: jest.fn() } }));

let writeText: jest.Mock;

beforeEach(() => {
    mockPlan = { features: { widget: true }, loading: false };
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

function buttons(container: HTMLElement): HTMLButtonElement[] {
    return [...container.querySelectorAll("button")] as HTMLButtonElement[];
}

function byText<T extends HTMLElement>(nodes: T[], text: string): T {
    const node = nodes.find((candidate) => candidate.textContent?.trim() === text);
    if (!node) throw new Error(`no control reads "${text}"`);
    return node;
}

describe("the agent's link card, as a screen reader receives it", () => {
    it("is a named section with three links out and two copy buttons on a plan with the web chat", async () => {
        const screen = await renderScreen(createElement(DemoLinkCard, { demoLink: DEMO_LINK }));
        try {
            const section = screen.container.querySelector("section");
            const title = document.getElementById(section?.getAttribute("aria-labelledby") as string);
            expect(title?.textContent).toBe("El enlace de Ana");

            const links = [...screen.container.querySelectorAll("a")] as HTMLAnchorElement[];
            expect(links).toHaveLength(3);
            // The two that leave the product say so; the in-app one must not.
            for (const link of links.slice(0, 2)) {
                expect(link.getAttribute("target")).toBe("_blank");
                expect(link.getAttribute("rel")).toBe("noopener noreferrer");
                expect(link.getAttribute("aria-label")).toMatch(/\(abre en una pestaña nueva\)$/);
            }
            expect(links[0].getAttribute("href")).toBe("http://localhost/w/wgt_abc123");
            // The WhatsApp share carries the message with the link inside it.
            const share = new URL(links[1].getAttribute("href") as string);
            expect(share.origin + share.pathname).toBe("https://wa.me/");
            expect(share.searchParams.get("text")).toBe("Mira cómo responde Ana: http://localhost/w/wgt_abc123");

            expect(buttons(screen.container).map((button) => button.textContent?.trim()))
                .toEqual(["Copiar enlace", "Ponerlo en mi bio", "Dejar solo como prueba"]);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("sends the website to the page where the tenant's OWN chat is created", async () => {
        const screen = await renderScreen(createElement(DemoLinkCard, { demoLink: DEMO_LINK }));
        try {
            const links = [...screen.container.querySelectorAll("a")] as HTMLAnchorElement[];
            const website = links.find((link) => link.textContent?.trim() === "Ponerlo en mi página web");
            expect(website?.getAttribute("href")).toBe(WEB_CHAT_SETTINGS);
            expect(website?.getAttribute("target")).toBeNull();
            // Said before the click, not only after it.
            expect(screen.container.textContent)
                .toContain("Ahí se crea el chat de tu página y se copian las dos líneas.");
        } finally {
            screen.unmount();
        }
    });

    it("never copies an embed snippet carrying the demo widget id", async () => {
        const screen = await renderScreen(createElement(DemoLinkCard, { demoLink: DEMO_LINK }));
        try {
            // Everything a person can press, pressed.
            for (const button of buttons(screen.container).filter((button) => !button.textContent?.includes("Dejar solo como prueba"))) {
                await interact(() => button.click());
            }
            const copies = writeText.mock.calls.map(([text]) => String(text));
            expect(copies.length).toBeGreaterThan(0);
            for (const text of copies) {
                expect(text).not.toContain("__paralllyWidget");
                expect(text).not.toContain("loader.js");
            }
            // The demo id may travel as the public LINK, never as a snippet.
            expect(copies.filter((text) => text.includes("wgt_abc123")))
                .toEqual(["http://localhost/w/wgt_abc123", "http://localhost/w/wgt_abc123"]);
            expect(screen.container.innerHTML).not.toContain("__paralllyWidget");
        } finally {
            screen.unmount();
        }
    });

    it("prefers the name the wizard is showing over the one setup-status sent", async () => {
        const screen = await renderScreen(createElement(DemoLinkCard, { demoLink: DEMO_LINK, agentName: "Lucía" }));
        try {
            expect(screen.container.querySelector("h3")?.textContent).toBe("El enlace de Lucía");
        } finally {
            screen.unmount();
        }
    });

    it("copies the link for the bio and says where to paste it", async () => {
        const screen = await renderScreen(createElement(DemoLinkCard, { demoLink: DEMO_LINK }));
        try {
            await interact(() => byText(buttons(screen.container), "Ponerlo en mi bio").click());
            expect(writeText).toHaveBeenCalledWith("http://localhost/w/wgt_abc123");
            const status = screen.container.querySelector("[role=status]");
            expect(status?.textContent).toBe("Pégalo en Instagram → Editar perfil → Enlaces.");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("on a trial, says what the link is for and what a plan with the web chat changes — and sells no bio", async () => {
        mockPlan = { features: { widget: false }, loading: false };
        const screen = await renderScreen(createElement(DemoLinkCard, { demoLink: { ...DEMO_LINK, usageMode: "trial" } }));
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Es para probar a Ana y mostrárselo a alguien");
            expect(text).toContain("Con un plan que incluya el chat web, este mismo enlace atiende a tus clientes");
            expect(text).not.toContain("sirve para probar hoy y para tu bio de Instagram");

            // Open, copy and show it to a partner stay: that is what a trial is for.
            expect(buttons(screen.container).map((button) => button.textContent?.trim())).toEqual(["Copiar enlace"]);
            const links = [...screen.container.querySelectorAll("a")] as HTMLAnchorElement[];
            expect(links.map((link) => link.textContent?.trim())).toEqual(["Abrir", "Mostrárselo a mi socio", "Ver planes"]);
            // No page the plan does not open, and the way to the plan that does.
            expect(links.some((link) => link.getAttribute("href") === WEB_CHAT_SETTINGS)).toBe(false);
            expect(links[2].getAttribute("href")).toBe("/admin/settings/billing");
            expect(links[2].getAttribute("target")).toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("keeps explaining the persisted purpose while the plan is read", async () => {
        mockPlan = { features: { widget: false }, loading: true };
        const screen = await renderScreen(createElement(DemoLinkCard, { demoLink: DEMO_LINK }));
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("sirve para probar hoy y para tu bio de Instagram");
            expect(text).not.toContain("Es para probar a Ana");
            expect(buttons(screen.container).map((button) => button.textContent?.trim())).toEqual(["Copiar enlace", "Ponerlo en mi bio"]);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it.each([
        ["switched_off", "El enlace de prueba de Ana está en pausa, así que por ahora no responde."],
        ["allowance_used", "Ana ya usó las respuestas gratis de su enlace de prueba, así que ahí no responde más."],
    ] as const)("paused (%s): says why, and offers nothing to open, copy or share", async (unavailableReason, sentence) => {
        // Both plans: a paused link is paused whatever the plan says it is for.
        for (const widget of [true, false]) {
            mockPlan = { features: { widget }, loading: false };
            const screen = await renderScreen(createElement(DemoLinkCard, {
                demoLink: { ...DEMO_LINK, usageMode: "trial", answers: false, unavailableReason },
            }));
            try {
                const section = screen.container.querySelector("section");
                const title = document.getElementById(section?.getAttribute("aria-labelledby") as string);
                expect(title?.textContent).toBe("El enlace de Ana");
                const text = screen.container.textContent ?? "";
                expect(text).toContain(sentence);
                expect(text).toContain("conecta un canal o elige un plan con el chat web");
                // Nothing that treats it as working.
                expect(buttons(screen.container)).toEqual([]);
                const links = [...screen.container.querySelectorAll("a")] as HTMLAnchorElement[];
                expect(links.map((link) => [link.textContent?.trim(), link.getAttribute("href")]))
                    .toEqual([["Ver planes", "/admin/settings/billing"]]);
                expect(text).not.toContain("http://localhost/w/wgt_abc123");
                expect(text).not.toMatch(/Abrir|Copiar enlace|Mostrárselo|bio/);
                expect(await findAccessibilityViolations(screen.container)).toEqual([]);
            } finally {
                screen.unmount();
            }
        }
    });

    it("says so when the clipboard is not available, instead of a silent Copiado", async () => {
        writeText.mockRejectedValue(new Error("denied"));
        const screen = await renderScreen(createElement(DemoLinkCard, { demoLink: DEMO_LINK }));
        try {
            await interact(() => byText(buttons(screen.container), "Copiar enlace").click());
            expect(screen.container.querySelector("[role=status]")?.textContent)
                .toBe("No se pudo copiar. Selecciona el enlace y cópialo a mano.");
            expect(screen.container.textContent).not.toContain("Copiado");
        } finally {
            screen.unmount();
        }
    });
});
