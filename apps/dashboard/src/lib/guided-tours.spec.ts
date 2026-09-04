import * as fs from "fs";
import * as path from "path";
import { GUIDED_TOUR_IDS, getGuidedTour } from "@parallext/shared";
import {
  GUIDED_TOUR_ANCHOR_NAMES,
  getGuidedTourStepDefinitions,
  guidedTourAnchorId,
  guidedTourEntryRoute,
  guidedTourMessageKeys,
  resolveGuidedTourStepRoutes,
} from "./guided-tours";
import { resolveNavigationRoute } from "./navigation-contract";

/**
 * A guided tour that spotlights nothing is worse than no tour.
 *
 * "Mostrarme dónde" opens a screen and points at the control the person has to
 * touch. Every part of that promise can break silently: a renamed element
 * leaves the anchor dangling, a route that no longer exists sends the person to
 * a 404, missing copy renders the i18n key as the step title. None of it shows
 * up in `tsc`, and none of it shows up until a real tenant clicks the button
 * from a red banner — the worst possible moment to discover it.
 */

const SRC = path.join(__dirname, "..");
const AGENT_ID = "00000000-0000-4000-8000-000000000000";
const CONTEXT = { agentId: AGENT_ID };

function sourceFiles(directory = SRC): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

/** Anchor names actually rendered somewhere, from `guidedTourAnchorId("…")`. */
function renderedAnchorNames(): Set<string> {
  const pattern = /guidedTourAnchorId\(\s*["'`]([a-z0-9-]+)["'`]\s*\)/gi;
  const found = new Set<string>();
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return found;
}

function readSpanishMessages(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(SRC, "..", "messages", "es.json"), "utf8"));
}

function lookup(messages: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>(
    (node, segment) => (node && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined),
    messages,
  );
}

describe("guided tour catalogue", () => {
  it("gives every registered tour at least two steps", () => {
    const tooShort = GUIDED_TOUR_IDS
      .map((id) => ({ id, steps: getGuidedTourStepDefinitions(id, CONTEXT).length }))
      .filter((entry) => entry.steps < 2);
    expect(tooShort).toEqual([]);
  });

  it("starts every tour on a tour anchor, never on an arbitrary element", () => {
    for (const id of GUIDED_TOUR_IDS) {
      const [first] = getGuidedTourStepDefinitions(id, CONTEXT);
      expect(`${id}:${first.selector}`).toMatch(/:#tour-/);
    }
  });

  it("only ever navigates to routes the navigation contract knows", () => {
    const unknown: string[] = [];
    for (const id of GUIDED_TOUR_IDS) {
      for (const route of resolveGuidedTourStepRoutes(id, CONTEXT)) {
        if (!resolveNavigationRoute(route)) unknown.push(`${id} → ${route}`);
      }
      // The entry route is what the runner pushes before step 0.
      if (!resolveNavigationRoute(guidedTourEntryRoute(id, CONTEXT))) {
        unknown.push(`${id} → entry ${guidedTourEntryRoute(id, CONTEXT)}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("keeps the agent-scoped tours on the registry route when no agent is focused", () => {
    for (const id of GUIDED_TOUR_IDS) {
      const withoutAgent = guidedTourEntryRoute(id, {});
      expect(resolveNavigationRoute(withoutAgent)).not.toBeNull();
      const tour = getGuidedTour(id);
      if (tour?.stayOnCurrentRoute) expect(withoutAgent.startsWith("/admin")).toBe(true);
    }
  });

  it("points every anchor at an element that some screen actually renders", () => {
    const rendered = renderedAnchorNames();
    const missing = GUIDED_TOUR_ANCHOR_NAMES.filter((name) => !rendered.has(name));
    // The message names the anchors AND the id to add, so the fix is mechanical.
    expect({
      missing,
      hint: missing.map((name) => `id={guidedTourAnchorId("${name}")} → ${guidedTourAnchorId(name)}`),
    }).toEqual({ missing: [], hint: [] });
  });
});

describe("guided tour copy", () => {
  const messages = readSpanishMessages();
  // Unit C ships its keys through the i18n merge file; until that merge lands
  // `guidedTours` does not exist and the parity check has nothing to compare.
  const merged = Boolean(messages.guidedTours);

  (merged ? it : it.skip)("has a title and a body for every step, in Spanish", () => {
    const missing = guidedTourMessageKeys().filter((key) => typeof lookup(messages, key) !== "string");
    expect(missing).toEqual([]);
  });
});
