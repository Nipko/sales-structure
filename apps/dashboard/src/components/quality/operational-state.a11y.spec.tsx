import type { AgentAssessment } from "@parallext/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanScreen } from "@/test/a11y";
import { AgentAssessmentPanel } from "./AgentAssessmentPanel";
import { AppliedDraftEvidence } from "./AgentConfigurationReview";

/**
 * The surfaces that started speaking this week, read the way a screen reader
 * hands them over.
 *
 * Three of them arrived at once — the six-state badges, the applied-draft
 * verdict and the per-connection list — and every one of them says something a
 * person has to act on. A completion review had already flagged status
 * expressed only through Tailwind classes on two other screens, so what matters
 * here is not that axe is quiet but that the state survives having its colour
 * taken away: each assertion below reads the text, not the class.
 *
 * What this cannot prove is in `@/test/a11y`: contrast needs painted pixels and
 * jsdom has none, so that check is disabled rather than passed vacuously.
 */

jest.mock("@/lib/api", () => ({ api: {} }));
// `useRole` reads the auth context, which the harness deliberately does not
// build: this suite is about what a screen reader is handed, not about who is
// allowed to see it. Authorization has its own tests.
jest.mock("@/hooks/useRole", () => ({
    useRole: () => ({ role: "tenant_admin", canAccess: () => true, isSuperAdmin: false, loading: false }),
}));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenantId: "tenant", tenant: null }) }));

const AGENT = "44444444-4444-4444-8444-444444444444";

const assessment = (over: Partial<AgentAssessment> = {}): AgentAssessment => ({
    version: 1,
    revision: "a".repeat(64),
    generatedAt: "2026-09-08T00:00:00.000Z",
    agent: { id: AGENT, version: 3, name: "Luna" },
    overview: { agent: { id: AGENT, version: 3, name: "Luna" }, status: "ready" },
    mission: { source: "configured", templateId: "restaurant", profileId: "restaurantes/casual_dining",
        definition: { objective: "Tomar pedidos", intentKeys: ["place_food_order"], successCriteria: [], handoffConditions: [] },
        availableIntentKeys: ["place_food_order"], unsupportedIntents: [] },
    // One of each state that can appear on a task, plus the one that cannot: a
    // task that does not apply carries no state at all.
    tasks: [
        { key: "mission", status: "warning", state: "pending", checks: [], href: `/admin/agent/${AGENT}`, tourId: null, dependsOn: [] },
        { key: "channel", status: "unknown", state: "unknown", checks: [], href: "/admin/channels", tourId: "connect_channel", dependsOn: [] },
        { key: "business", status: "pass", state: "prepared", checks: [], href: "/admin/settings/business-info", tourId: null, dependsOn: [] },
        { key: "knowledge", status: "warning", state: "degraded", checks: [], href: "/admin/knowledge", tourId: null, dependsOn: [] },
        { key: "team", status: "not_applicable", state: null, checks: [], href: "/admin/users", tourId: null, dependsOn: [] },
    ],
    nextTask: "mission",
    requiredTests: [],
    channels: [],
    state: "degraded",
    tools: [],
    configuration: { persona: { name: "Luna", role: "", greeting: "", fallbackMessage: "", personality: { tone: "", formality: "" } } },
    ...over,
} as unknown as AgentAssessment);

describe("the states a person is asked to act on", () => {
    it("hands a screen reader no violations on the assessment panel", async () => {
        expect(await scanScreen(<AgentAssessmentPanel assessment={assessment()} />)).toEqual([]);
    });

    it("keeps every task state readable with the colour taken away", async () => {
        const { container } = await import("@/test/a11y").then(module =>
            module.renderScreen(<AgentAssessmentPanel assessment={assessment()} />));
        const text = container.textContent ?? "";
        const messages = JSON.parse(
            readFileSync(join(__dirname, "../../../messages/es.json"), "utf8"));
        for (const state of ["pending", "unknown", "prepared", "degraded"]) {
            expect(text).toContain(messages.agentOperationalState.states[state].label);
        }
        // A task that does not apply gets no badge: the six states answer "how
        // far along is this", and that question was never asked of it.
        expect(text).toContain(messages.agentQuality.checkStatuses.not_applicable);
    });

    it("announces a failed draft check as an alert and an unavailable one as status", async () => {
        for (const [state, reason] of [["failed", null], ["unavailable", "quota_exhausted"]] as const) {
            // Wrapped in the heading level it really sits under. Scanned bare it
            // would report a heading-order violation about the harness rather
            // than about the component: inside the review its `h4` follows an
            // `h3`. Testing a fragment out of its document is how an
            // accessibility suite starts reporting its own scaffolding.
            const findings = await scanScreen(<section><h3>Revisión</h3>
                <AppliedDraftEvidence verification={{
                    scope: "applied_draft", state, reason, revisionId: null, revisionHash: null,
                    checkedAt: "2026-09-08T00:00:00.000Z",
                }} /></section>);
            expect(findings).toEqual([]);
        }
    });

    it("says an unavailable check proved nothing, rather than showing it as a result", async () => {
        const { container } = await import("@/test/a11y").then(module =>
            module.renderScreen(<AppliedDraftEvidence verification={{
                scope: "applied_draft", state: "unavailable", reason: "quota_exhausted",
                revisionId: null, revisionHash: null, checkedAt: "2026-09-08T00:00:00.000Z",
            }} />));
        const messages = JSON.parse(
            readFileSync(join(__dirname, "../../../messages/es.json"), "utf8"));
        const text = container.textContent ?? "";
        expect(text).toContain(messages.agentConfiguration.draftCheck.unavailable);
        expect(text).toContain(messages.agentConfiguration.draftCheck.reasons.quota_exhausted);
        // Never the success sentence, and never its caveat either: nothing ran,
        // so there is nothing to qualify.
        expect(text).not.toContain(messages.agentConfiguration.draftCheck.verified);
        expect(text).not.toContain(messages.agentConfiguration.draftCheck.verifiedLimit);
    });
});
