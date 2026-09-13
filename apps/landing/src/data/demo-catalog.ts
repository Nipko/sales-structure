/**
 * ═══ WHAT A DEMO ON THIS SITE IS ALLOWED TO CLAIM ═══════════════════════════
 *
 * Every animated panel on this site had the same defect: it showed an outcome —
 * a confirmed appointment, a paid order, a conversation handed to a person —
 * with nothing on screen saying whether that was a drawing, a recorded test or
 * a customer. A reader is entitled to assume the strongest of the three, and
 * "the text said 'reserved'" is not evidence that anything was reserved.
 *
 * So a demo now declares two separate things, and confusing them is the whole
 * risk:
 *
 *   `kind` — what the ANIMATION is. `illustrative` is a drawing of a flow;
 *   `localTest` is an artifact of a run that actually happened against a local
 *   stack; `realCase` is a customer's own traffic, with their consent. All four
 *   demos below are `illustrative`, because that is what they are: scripted
 *   panels with timers, not recordings. Labelling them anything else would be
 *   the exact lie this registry was written to stop.
 *
 *   `capabilityState` — what the PRODUCT is, independently of the drawing. The
 *   audited closure report (`docs/audits/2026-09-09/closure-report.json`)
 *   certifies zero of seventy-six profiles and zero of five channels, so the
 *   ceiling for every capability here is `implementedNotCertified`: the code
 *   exists and is reachable, and no end-to-end certification backs it.
 *
 * The `evidence` paths are checked to exist by `scripts/validate-marketing-
 * claims.cjs`. They are not proof the flow works — they are the thing a reader
 * or a reviewer can go and read, which is the most a marketing page can offer.
 */

/** What the animation on screen actually is. Never inferred from the copy. */
export type DemoEvidenceKind = "illustrative" | "localTest" | "realCase";

/**
 * How far the underlying capability has been taken. `certified` is deliberately
 * absent from this union: nothing on the platform holds it today, and a value
 * that cannot be true is a value somebody will eventually set.
 */
export type DemoCapabilityState = "implementedNotCertified";

export type DemoId = "appointment" | "orderPayment" | "handoff" | "configuration";

export interface DemoContract {
  id: DemoId;
  /** i18n key prefix inside the `labelledDemos` namespace. */
  i18nKey: DemoId;
  kind: DemoEvidenceKind;
  capabilityState: DemoCapabilityState;
  /** Repository paths a reader can open. Existence is checked by the build. */
  evidence: readonly string[];
}

export const LABELLED_DEMOS: readonly DemoContract[] = Object.freeze([
  Object.freeze({
    id: "appointment",
    i18nKey: "appointment",
    kind: "illustrative",
    capabilityState: "implementedNotCertified",
    evidence: Object.freeze([
      "apps/api/src/modules/appointments",
      "docs/appointments-manual.md",
    ]),
  }),
  Object.freeze({
    id: "orderPayment",
    i18nKey: "orderPayment",
    kind: "illustrative",
    capabilityState: "implementedNotCertified",
    // Two separate things, and the demo keeps them apart: an order exists in
    // our own module, and the money moves through the TENANT's gateway with the
    // tenant's own credentials. A payment link that has been issued is not a
    // payment that has settled, and the panel says so rather than showing a tick.
    evidence: Object.freeze([
      "apps/api/src/modules/orders",
      "apps/api/src/modules/tenant-payments",
    ]),
  }),
  Object.freeze({
    id: "handoff",
    i18nKey: "handoff",
    kind: "illustrative",
    capabilityState: "implementedNotCertified",
    evidence: Object.freeze([
      "apps/api/src/modules/handoff",
      "apps/api/src/modules/agent-console",
    ]),
  }),
  Object.freeze({
    id: "configuration",
    i18nKey: "configuration",
    kind: "illustrative",
    capabilityState: "implementedNotCertified",
    evidence: Object.freeze([
      "apps/api/src/modules/persona",
      "apps/api/src/modules/business-info",
    ]),
  }),
]);

/**
 * One contract by id, for the pages that render a single demo in place.
 *
 * Throws rather than returning a default: a page that asks for a demo which is
 * not in the registry would otherwise render an unlabelled panel, which is the
 * state this whole module exists to make impossible.
 */
export function demoContract(id: DemoId): DemoContract {
  const found = LABELLED_DEMOS.find((contract) => contract.id === id);
  if (!found) throw new Error(`Unregistered demo: ${id}`);
  return found;
}

export const DEMO_KINDS: readonly DemoEvidenceKind[] = Object.freeze([
  "illustrative",
  "localTest",
  "realCase",
]);
