import { createElement } from "react";
import { resolveVerticalCapabilityManifest } from "@parallext/shared";
import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import ToolsTour from "./ToolsTour";

/**
 * The discovery tour, read the way a screen reader hands it over.
 *
 * The four cards completed here carry more than a title: each one answers what
 * the screen needs, what it confirms, what it costs and how to try it. That
 * copy is only worth writing if it reaches somebody who cannot see the card, so
 * what is asserted below is the accessibility tree — the link's name, the
 * description wired to it, and the fact that every card is a real link and not
 * a div somebody made clickable.
 *
 * What this cannot prove is in `@/test/a11y`: contrast needs painted pixels and
 * jsdom has none. Focus *order* is the DOM order here, which the assertions do
 * check; whether the focus ring is visible against the card needs a browser.
 */

const verticalConfig: Record<string, unknown> = {};

jest.mock("@/lib/api", () => ({ api: {} }));
jest.mock("@/contexts/AuthContext", () => ({
    useAuth: () => ({ verticalConfig }),
}));

/**
 * A tenant of the vertical under test, published exactly as the platform
 * publishes it.
 *
 * Hand-written capability lists were the first draft and they lied: without
 * `manifestVersion` the resolver never consults the subtype's routes, so pet
 * boarding silently lost the one card this suite exists to check. The manifest
 * is the only thing allowed to say what a vertical has.
 */
function asTenant(industry: string, subType: string): void {
    const manifest = resolveVerticalCapabilityManifest(industry, subType);
    for (const key of Object.keys(verticalConfig)) delete verticalConfig[key];
    Object.assign(verticalConfig, {
        industry,
        subType,
        manifestVersion: manifest.manifestVersion,
        effectiveCapabilities: [...manifest.capabilities],
    });
}

function links(container: HTMLElement): HTMLAnchorElement[] {
    return [...container.querySelectorAll("a")] as HTMLAnchorElement[];
}

function findCard(container: HTMLElement, href: string): HTMLAnchorElement {
    const card = links(container).find((link) => link.getAttribute("href") === href);
    if (!card) throw new Error(`no card points at ${href}`);
    return card;
}

describe("the discovery tour, as a screen reader receives it", () => {
    it.each([
        // Hotel: the register is `stays`, the catalogue that fills it `properties`.
        ["turismo", "hotel", "/admin/stays"],
        // Travel agency: `tourBookings` over `tours`.
        ["turismo", "agencia_viajes", "/admin/tour-bookings"],
        // A practice, whose primary object is the case file.
        ["servicios_profesionales", "abogados", "/admin/cases"],
        // Pet boarding: had `serviceCatalog` in discovery and was shown nothing.
        ["pet_services", "guarderia", "/admin/service-catalog"],
    ] as const)("gives %s/%s a card for its own register", async (industry, subType, href) => {
        asTenant(industry, subType);
        const screen = await renderScreen(createElement(ToolsTour));
        try {
            const card = findCard(screen.container, href);
            // A link, reachable by Tab without anything added: the tour must not
            // invent its own keyboard model.
            expect(card.tagName).toBe("A");
            expect(card.hasAttribute("tabindex")).toBe(false);
            // The accessible name is the tool, plus the warning that the wizard
            // stays behind in this tab.
            expect(card.getAttribute("aria-label")).toMatch(/\(abre en una pestaña nueva\)$/);
            expect(card.getAttribute("target")).toBe("_blank");
            expect(card.getAttribute("rel")).toBe("noopener noreferrer");
        } finally {
            screen.unmount();
        }
    });

    it("reads the four-facet briefing out as the card's description", async () => {
        asTenant("pet_services", "guarderia");
        const screen = await renderScreen(createElement(ToolsTour));
        try {
            const card = findCard(screen.container, "/admin/service-catalog");
            const describedBy = card.getAttribute("aria-describedby");
            expect(describedBy).toBeTruthy();

            // By id, not by selector: `useId` mints ids that are legal HTML and
            // illegal CSS, and `aria-describedby` is resolved by id anyway.
            const brief = document.getElementById(describedBy as string);
            expect(brief?.tagName).toBe("DL");
            const terms = [...(brief?.querySelectorAll("dt") || [])].map((node) => node.textContent);
            const details = [...(brief?.querySelectorAll("dd") || [])].map((node) => node.textContent);
            expect(terms).toEqual(["Necesita:", "Confirma:", "Cuesta:", "Pruébalo:"]);
            // Real sentences, not key paths: a missing message renders its own
            // key, which is exactly what four separate locales make likely.
            expect(details).toHaveLength(4);
            for (const detail of details) {
                expect(detail).toEqual(expect.any(String));
                expect(detail).not.toMatch(/setupWizard\.discover/);
                expect((detail as string).length).toBeGreaterThan(20);
            }
        } finally {
            screen.unmount();
        }
    });

    it("orders the cards the way the resolver ordered the work", async () => {
        asTenant("turismo", "hotel");
        const screen = await renderScreen(createElement(ToolsTour));
        try {
            // Focus order is DOM order, and DOM order has to be the discovery
            // order: load the catalogue, then work the register it fills.
            const hrefs = links(screen.container).map((link) => link.getAttribute("href"));
            expect(hrefs.indexOf("/admin/properties")).toBeLessThan(hrefs.indexOf("/admin/stays"));
            // The transversal block still leads: it is what the agent answers with.
            expect(hrefs.indexOf("/admin/knowledge")).toBeLessThan(hrefs.indexOf("/admin/properties"));
        } finally {
            screen.unmount();
        }
    });

    it("leads a practice with its case files, not with the calendar", async () => {
        // `servicios_profesionales` declares `professional_case` as its primary
        // object and publishes `/admin/cases` ahead of `/admin/appointments`.
        // With cases absent the tour opened on the agenda, which is the part of
        // the job a practice thinks about least.
        asTenant("servicios_profesionales", "abogados");
        const screen = await renderScreen(createElement(ToolsTour));
        try {
            const hrefs = links(screen.container).map((link) => link.getAttribute("href"));
            expect(hrefs.indexOf("/admin/cases")).toBeLessThan(hrefs.indexOf("/admin/appointments"));
        } finally {
            screen.unmount();
        }
    });

    it("offers no way to save anything from the tour", async () => {
        asTenant("servicios_profesionales", "abogados");
        const screen = await renderScreen(createElement(ToolsTour));
        try {
            // Every card is a link out. The only button on the screen queues the
            // copilot for later, which the person still has to accept there.
            const buttons = [...screen.container.querySelectorAll("button")];
            expect(buttons).toHaveLength(1);
            expect(screen.container.querySelectorAll("form")).toHaveLength(0);
            expect(screen.container.querySelectorAll("input, select, textarea")).toHaveLength(0);
        } finally {
            screen.unmount();
        }
    });

    it.each([
        ["turismo", "hotel"],
        ["servicios_profesionales", "abogados"],
        ["pet_services", "guarderia"],
    ] as const)("hands %s/%s a tree axe has nothing to say about", async (industry, subType) => {
        asTenant(industry, subType);
        const screen = await renderScreen(createElement(ToolsTour));
        try {
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });
});
