import { createElement } from "react";
import { renderScreen, findAccessibilityViolations, interact } from "@/test/a11y";
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
 */

const DEMO_LINK = { widgetId: "wgt_abc123", path: "/w/wgt_abc123", agentName: "Ana" };
const WEB_CHAT_SETTINGS = "/admin/settings/integrations/web-chat";

let writeText: jest.Mock;

beforeEach(() => {
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
    it("is a named section with three links out and two copy buttons", async () => {
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
                .toEqual(["Copiar enlace", "Ponerlo en mi bio"]);
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
            for (const button of buttons(screen.container)) {
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
