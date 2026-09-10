import * as fs from "fs";
import * as path from "path";
import { GUIDED_TOUR_IDS, summarizeGuidedTourOutcome } from "@parallext/shared";
import {
  GUIDED_TOUR_ANCHOR_NAMES,
  buildGuidedTourSteps,
  clearGuidedTourResume,
  evaluateGuidedTourStep,
  getGuidedTourStepDefinitions,
  parseGuidedTourResume,
  readGuidedTourResume,
  saveGuidedTourResume,
  type GuidedTourConditionProbe,
  type GuidedTourStorageLike,
} from "./guided-tours";

/**
 * Un recorrido que dice "listo" sin haber mirado es peor que uno que no dice nada.
 *
 * Estas dos mitades comparten una regla: cuando no se pudo comprobar, la
 * respuesta es `unknown` y el cierre no lo cuenta como hecho. Lo mismo vale para
 * retomar tras una recarga — un registro que no se puede validar entero se tira,
 * porque abrir una guía encima de otra tarea es peor que no retomarla.
 */

const AGENT_ID = "00000000-0000-4000-8000-000000000000";

function probe(
  { fields = {}, present = [] }: { fields?: Record<string, string[]>; present?: string[] },
): GuidedTourConditionProbe {
  return {
    fieldValues: (selector) => (selector in fields ? fields[selector] : null),
    exists: (selector) => present.includes(selector),
  };
}

describe("guided tour step conditions", () => {
  it("says nothing at all for a step that declares no condition", () => {
    expect(evaluateGuidedTourStep({ selector: "#a" }, probe({ fields: { "#a": ["x"] } }))).toBeNull();
  });

  it("answers unknown — never done — when the anchor is not on screen", () => {
    expect(evaluateGuidedTourStep(
      { selector: "#a", completedWhen: { kind: "filled" } },
      probe({}),
    )).toBe("unknown");
    expect(evaluateGuidedTourStep(
      { selector: "#a", completedWhen: { kind: "present", selector: "#proof" } },
      // The proof element exists, but the screen holding the anchor does not:
      // judging that would mark every other page as configured.
      probe({ present: ["#proof"] }),
    )).toBe("unknown");
  });

  it("reads an anchor with no field at all as pending, not as vacuously done", () => {
    expect(evaluateGuidedTourStep(
      { selector: "#a", completedWhen: { kind: "filled" } },
      probe({ fields: { "#a": [] } }),
    )).toBe("pending");
    expect(evaluateGuidedTourStep(
      { selector: "#a", completedWhen: { kind: "filled", all: true } },
      probe({ fields: { "#a": [] } }),
    )).toBe("pending");
  });

  it("distinguishes 'some field' from 'every field'", () => {
    const partial = probe({ fields: { "#a": ["Peluquería Ana", "   "] } });
    expect(evaluateGuidedTourStep({ selector: "#a", completedWhen: { kind: "filled" } }, partial)).toBe("done");
    expect(evaluateGuidedTourStep({ selector: "#a", completedWhen: { kind: "filled", all: true } }, partial)).toBe("pending");
    expect(evaluateGuidedTourStep(
      { selector: "#a", completedWhen: { kind: "filled", min: 2 } },
      probe({ fields: { "#a": ["uno", "dos"] } }),
    )).toBe("done");
  });

  it("treats whitespace as empty", () => {
    expect(evaluateGuidedTourStep(
      { selector: "#a", completedWhen: { kind: "filled" } },
      probe({ fields: { "#a": ["  \n "] } }),
    )).toBe("pending");
  });

  it("uses a proof element the screen only renders once the goal is met", () => {
    const step = { selector: "#anchor", completedWhen: { kind: "present" as const, selector: "#proof" } };
    expect(evaluateGuidedTourStep(step, probe({ present: ["#anchor", "#proof"] }))).toBe("done");
    expect(evaluateGuidedTourStep(step, probe({ present: ["#anchor"] }))).toBe("pending");
  });

  it("declares every condition against an anchor the contract test already covers", () => {
    const targets = GUIDED_TOUR_IDS.flatMap((id) =>
      getGuidedTourStepDefinitions(id, { agentId: AGENT_ID })
        .flatMap((step) => (step.completedWhen?.kind === "present" ? [step.completedWhen.selector] : [])));
    expect(targets.length).toBeGreaterThan(0);
    // A condition may name an anchor plus the attribute that proves its goal;
    // every anchor id inside it has to be one the contract test renders, and a
    // condition that names none at all points at nothing the tour anchors in.
    const named = targets.map((selector) => selector.match(/#tour-target-[A-Za-z0-9_-]+/g) ?? []);
    expect(named.filter((matches) => matches.length === 0)).toEqual([]);
    expect(named.flat().filter((anchor) => !GUIDED_TOUR_ANCHOR_NAMES.includes(anchor.replace("#tour-target-", "")))).toEqual([]);
  });

  it("carries the condition into the step the runner actually renders", () => {
    const steps = buildGuidedTourSteps("business_identity", {}, (key) => key) as Array<{ completedWhen?: unknown }>;
    expect(steps.filter((step) => step.completedWhen).length).toBe(3);
    // The save button asserts nothing: pressing it is not evidence of content.
    expect(steps[steps.length - 1].completedWhen).toBeUndefined();
  });
});

describe("guided tour outcome", () => {
  it("cannot report success for a run that observed nothing", () => {
    expect(summarizeGuidedTourOutcome([])).toMatchObject({ outcome: "unverified", checked: 0 });
    expect(summarizeGuidedTourOutcome(["unknown", "unknown"]).outcome).toBe("unverified");
  });

  it("needs every observation to be done before it says confirmed", () => {
    expect(summarizeGuidedTourOutcome(["done", "done"])).toMatchObject({ outcome: "confirmed", done: 2, checked: 2 });
    expect(summarizeGuidedTourOutcome(["done", "unknown"]).outcome).toBe("unverified");
  });

  it("lets one thing we watched stay empty outrank everything we could not read", () => {
    expect(summarizeGuidedTourOutcome(["done", "unknown", "pending"])).toMatchObject({
      outcome: "incomplete", done: 1, pending: 1, unknown: 1, checked: 3,
    });
  });
});

describe("guided tour resume", () => {
  const NOW = 1_700_000_000_000;
  const BASE = {
    tourId: "business_identity" as const,
    stepIndex: 2,
    route: "/admin/settings/business-info",
    scope: "user-1:tenant-1",
    context: { agentId: null, channelType: null, verticalCatalogRoute: null },
  };
  const OPTIONS = { scope: BASE.scope, route: BASE.route, role: "tenant_admin", now: NOW };
  const stored = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ ...BASE, savedAt: NOW - 1_000, ...overrides });

  function memoryStorage(seed?: string): GuidedTourStorageLike & { value: string | null } {
    return {
      value: seed ?? null,
      getItem(this: { value: string | null }) { return this.value; },
      setItem(this: { value: string | null }, _key: string, next: string) { this.value = next; },
      removeItem(this: { value: string | null }) { this.value = null; },
    };
  }

  it("restores a fresh record for the same user, route and role", () => {
    expect(parseGuidedTourResume(stored(), OPTIONS)).toMatchObject({ tourId: "business_identity", stepIndex: 2 });
  });

  it.each([
    ["a tour id that is no longer registered", { tourId: "retired_tour" }],
    ["another route", { route: "/admin/inbox" }],
    ["another user or tenant", { scope: "user-2:tenant-1" }],
    ["a record older than the window", { savedAt: NOW - 21 * 60 * 1000 }],
    ["a timestamp from the future", { savedAt: NOW + 10 * 60 * 1000 }],
    ["a step index that is not a whole position", { stepIndex: -1 }],
    ["a context carrying anything the tour does not declare", { context: { agentId: "a", surprise: "x" } }],
  ])("discards %s", (_case, overrides) => {
    expect(parseGuidedTourResume(stored(overrides), OPTIONS)).toBeNull();
  });

  it("discards a tour the current role may no longer run", () => {
    const supervisorTour = stored({ tourId: "agent_quality_center" });
    expect(parseGuidedTourResume(supervisorTour, { ...OPTIONS, role: "tenant_supervisor" })).not.toBeNull();
    expect(parseGuidedTourResume(supervisorTour, { ...OPTIONS, role: "tenant_agent" })).toBeNull();
    expect(parseGuidedTourResume(supervisorTour, { ...OPTIONS, role: null })).toBeNull();
  });

  it("survives garbage without throwing", () => {
    expect(parseGuidedTourResume("{not json", OPTIONS)).toBeNull();
    expect(parseGuidedTourResume(null, OPTIONS)).toBeNull();
  });

  it("consumes the record on read, so a failed restore is not retried forever", () => {
    const storage = memoryStorage(stored());
    expect(readGuidedTourResume(storage, OPTIONS)).not.toBeNull();
    expect(storage.value).toBeNull();
    expect(readGuidedTourResume(storage, OPTIONS)).toBeNull();
  });

  it("round-trips through a storage that behaves", () => {
    const storage = memoryStorage();
    saveGuidedTourResume(storage, BASE, NOW);
    expect(readGuidedTourResume(storage, OPTIONS)).toMatchObject({ stepIndex: 2, route: BASE.route });
  });

  it("keeps the tour running when the browser refuses storage", () => {
    const hostile: GuidedTourStorageLike = {
      getItem() { throw new Error("private window"); },
      setItem() { throw new Error("private window"); },
      removeItem() { throw new Error("private window"); },
    };
    expect(() => saveGuidedTourResume(hostile, BASE, NOW)).not.toThrow();
    expect(() => clearGuidedTourResume(hostile)).not.toThrow();
    expect(readGuidedTourResume(hostile, OPTIONS)).toBeNull();
  });
});

describe("guided tour verification copy", () => {
  const KEYS = [
    "productTour.stepStatus.done",
    "productTour.stepStatus.pending",
    "productTour.outcome.confirmed",
    "productTour.outcome.incomplete",
    "productTour.outcome.unverified",
    "productTour.outcome.walkthrough",
    "productTour.resumed",
  ];

  it.each(["es", "en", "pt", "fr"])("has every status and outcome string in %s", (locale) => {
    const messages = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8"),
    );
    const lookup = (key: string) => key.split(".").reduce<unknown>(
      (node, segment) => (node && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined),
      messages,
    );
    expect(KEYS.filter((key) => typeof lookup(key) !== "string")).toEqual([]);
    // The counts are what keep the end state honest; a translation that drops
    // them would turn "2 of 5" into an unqualified claim of success.
    expect(String(lookup("productTour.outcome.incomplete"))).toContain("{done}");
    expect(String(lookup("productTour.outcome.confirmed"))).toContain("{total}");
  });
});
