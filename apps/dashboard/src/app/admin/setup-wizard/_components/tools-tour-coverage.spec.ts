import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    DISCOVERY_ORDER,
    VERTICAL_DASHBOARD_ITEMS,
    resolveVerticalDashboard,
    type VerticalDashboardItem,
} from "@/lib/vertical-dashboard-resolver";
import { listVerticalCapabilityConfigurations, resolveVerticalCapabilityManifest } from "@parallext/shared";

/**
 * The tour has to survive the item that is reachable and unexplained.
 *
 * `ToolsTour` maps discovery items to cards and then drops the misses with a
 * `.filter(Boolean)`. That filter is why `serviceCatalog` could sit inside
 * `DISCOVERY_ORDER` for a whole release while the tenants it belongs to — pet
 * boarding, photography — opened the tour and were shown nothing about the one
 * screen where their packages live. Nothing failed, because a silent drop is
 * indistinguishable from an item nobody published.
 *
 * So the contract is two-sided and stated here rather than in the component:
 * every item a tenant can actually reach must have a card, every card must be
 * named and explained in all four languages, and a card that promises the
 * four-facet briefing must deliver all four in all four. A locale that lags
 * turns into a raw key path printed at a person — worse than an absent card.
 *
 * Read as source text on purpose: this file must be able to disagree with the
 * component. Importing the table and asserting the table against itself would
 * agree with any mistake it contains.
 */

const LOCALES = ["es", "en", "pt", "fr"] as const;
const TOOLS_TOUR = join(__dirname, "ToolsTour.tsx");

const messages = Object.fromEntries(LOCALES.map((locale) => [
    locale,
    JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "..", "messages", `${locale}.json`), "utf8")),
])) as Record<typeof LOCALES[number], any>;

interface TourCard { key: string; href: string; brief: boolean }

/** The vertical table, read out of the component's own source. */
function parseItemCards(): Map<VerticalDashboardItem, TourCard> {
    const source = readFileSync(TOOLS_TOUR, "utf8");
    const table = source.match(/A_BY_ITEM[^=]*=\s*\{([\s\S]*?)\n\};/);
    if (!table) throw new Error("A_BY_ITEM is no longer a literal this contract can read");
    const cards = new Map<VerticalDashboardItem, TourCard>();
    for (const line of table[1].split("\n")) {
        const entry = line.match(/^\s*(\w+):\s*\{\s*key:\s*"([^"]+)",([^}]*)href:\s*"([^"]+)"([^}]*)\}/);
        if (entry) {
            cards.set(entry[1] as VerticalDashboardItem, {
                key: entry[2],
                href: entry[4],
                brief: /\bbrief:\s*true/.test(`${entry[3]}${entry[5]}`),
            });
        }
    }
    return cards;
}

/** Every item any published vertical can actually put in front of a tenant. */
function reachableDiscoveryItems(): VerticalDashboardItem[] {
    const reachable = new Set<VerticalDashboardItem>();
    for (const configuration of listVerticalCapabilityConfigurations()) {
        const manifest = resolveVerticalCapabilityManifest(configuration.industry, configuration.subtype);
        const resolution = resolveVerticalDashboard({
            industry: configuration.industry,
            subType: configuration.subtype,
            manifestVersion: manifest.manifestVersion,
            effectiveCapabilities: manifest.capabilities,
        });
        for (const item of resolution.discoveryItems) reachable.add(item);
    }
    return [...reachable];
}

/** What every card owes a reader. */
const CARD_COPY = ["name", "desc"] as const;
/** What a briefed card owes on top: the questions somebody has before clicking. */
const BRIEFING = ["needs", "confirms", "cost", "test"] as const;

/**
 * The screens completed here, pinned by name.
 *
 * Three operational registers never reached `DISCOVERY_ORDER` at all and the
 * fourth reached it and was dropped by the tour. Listing them means dropping
 * one again is a failure rather than a silently shorter tour.
 */
const MUST_BE_BRIEFED: readonly VerticalDashboardItem[] = ["stays", "tourBookings", "cases", "serviceCatalog"];

describe("the discovery tour covers what the dashboard can reach", () => {
    const cards = parseItemCards();

    it("gives every operational item a place in the discovery order", () => {
        // An item missing from `DISCOVERY_ORDER` is not "ordered last": the
        // filter at the end of the resolver drops it, so the tour never sees it
        // and `primaryTourItem` can never be it.
        expect([...VERTICAL_DASHBOARD_ITEMS].sort()).toEqual([...DISCOVERY_ORDER].sort());
    });

    it("gives every item reachable in the discovery order a card", () => {
        const uncovered = DISCOVERY_ORDER.filter((item) => !cards.has(item));
        expect(uncovered).toEqual([]);
    });

    it("covers every item a published vertical resolves to", () => {
        const uncovered = reachableDiscoveryItems().filter((item) => !cards.has(item));
        expect(uncovered).toEqual([]);
    });

    it("points every card at a page that exists", () => {
        const missing = [...cards.values()]
            .map(({ href }) => href)
            .filter((href) => {
                const page = join(__dirname, "..", "..", "..", "..", "app", href.replace(/^\/+/, ""), "page.tsx");
                try {
                    readFileSync(page);
                    return false;
                } catch {
                    return true;
                }
            });
        expect(missing).toEqual([]);
    });

    it("keeps every card openable without losing the wizard", () => {
        // The wizard is a stateful flow. A card that navigated the current tab
        // would take a half-configured agent with it, so the return path is the
        // new tab and it is part of the contract, not a styling detail.
        const source = readFileSync(TOOLS_TOUR, "utf8");
        expect(source).toContain('target="_blank"');
        expect(source).toContain('rel="noopener noreferrer"');
        // A card is a link. Nothing on this screen may write on the way out.
        expect(source).not.toMatch(/\bapi\.(update|save|create|delete|post|put|patch)/i);
    });

    it("names and explains every vertical card in all four languages", () => {
        const gaps: string[] = [];
        for (const item of DISCOVERY_ORDER) {
            const card = cards.get(item);
            if (!card) continue;
            for (const locale of LOCALES) {
                const copy = messages[locale]?.setupWizard?.discover?.tools?.[card.key];
                for (const facet of CARD_COPY) {
                    const value = copy?.[facet];
                    if (typeof value !== "string" || !value.trim()) {
                        gaps.push(`${locale}: setupWizard.discover.tools.${card.key}.${facet}`);
                    }
                }
            }
        }
        expect(gaps).toEqual([]);
    });

    it("keeps the registers this contract completed briefed", () => {
        expect([...cards].filter(([, card]) => card.brief).map(([item]) => item).sort())
            .toEqual([...MUST_BE_BRIEFED].sort());
    });

    it("briefs every briefed card on all four facets in all four languages", () => {
        const gaps: string[] = [];
        for (const [, card] of [...cards].filter(([, candidate]) => candidate.brief)) {
            for (const locale of LOCALES) {
                const copy = messages[locale]?.setupWizard?.discover?.tools?.[card.key];
                for (const facet of BRIEFING) {
                    const value = copy?.[facet];
                    if (typeof value !== "string" || !value.trim()) {
                        gaps.push(`${locale}: setupWizard.discover.tools.${card.key}.${facet}`);
                    }
                }
            }
        }
        expect(gaps).toEqual([]);
    });

    it("labels the briefing facets in all four languages", () => {
        const gaps: string[] = [];
        for (const locale of LOCALES) {
            const labels = messages[locale]?.setupWizard?.discover?.briefLabels;
            for (const facet of ["needs", "confirms", "cost", "test"]) {
                const value = labels?.[facet];
                if (typeof value !== "string" || !value.trim()) {
                    gaps.push(`${locale}: setupWizard.discover.briefLabels.${facet}`);
                }
            }
        }
        expect(gaps).toEqual([]);
    });

    it("keeps the translations from drifting apart", () => {
        // Parity is measured against Spanish, which is the language the copy is
        // written in; the other three are translations of it.
        const spanish = Object.keys(messages.es.setupWizard.discover.tools).sort();
        for (const locale of LOCALES) {
            expect({ locale, keys: Object.keys(messages[locale].setupWizard.discover.tools).sort() })
                .toEqual({ locale, keys: spanish });
        }
    });

    it("never shows the same card twice", () => {
        // `foodOrders` and `orders` deliberately share one card key. The tour
        // dedupes by key, so a duplicate must stay intentional rather than
        // become a second card that says the same thing.
        const byKey = new Map<string, VerticalDashboardItem[]>();
        for (const [item, card] of cards) byKey.set(card.key, [...(byKey.get(card.key) || []), item]);
        expect([...byKey].filter(([, items]) => items.length > 1))
            .toEqual([["orders", ["foodOrders", "orders"]]]);
    });
});
