import { AGENT_CONFIG_TOOL_FAMILIES, VERTICAL_CAPABILITY_MANIFEST, type AgentToolConfigurationSummary } from "@parallext/shared";
import { ok, type ApiRoutes } from "./dashboard-session";

/**
 * What an authenticated dashboard page asks for before it shows anything.
 *
 * Read off the pages rather than guessed: a probe recorded every call `/admin`,
 * `/admin/agent`, `/admin/quality` and `/onboarding` make on load, and this is
 * that list with the smallest answer each one accepts. Keeping it here rather
 * than in each spec means a page that grows a new dependency fails ONE table
 * instead of five specs, and the failure names the path.
 *
 * The answers are deliberately minimal and boring. A rich fixture would start
 * testing itself: an assertion that passes because the fixture said the right
 * thing is not evidence about the product.
 */

const TENANT = "33333333-3333-4333-8333-333333333333";

/** Published agents with every AI tool disabled; manual modules stay usable. */
export const disabledAgentTools = (totalAgents = 0): AgentToolConfigurationSummary => ({
  source: "operational", totalAgents,
  families: Object.fromEntries(AGENT_CONFIG_TOOL_FAMILIES.map(family => [family, {
    activeEnabledAgents: 0, pausedEnabledAgents: 0, unknownAgents: 0,
  }])) as AgentToolConfigurationSummary['families'],
});

/**
 * `GET /readiness/:tenantId` (R2) in the shape the setup card and `/admin/readiness`
 * read: the engine's result for one tenant. `no_listo` carries one blocking gap
 * (the regular hours) so the card has a blocker to list and link; `listo` has none.
 * Since R3 the answer also says which requirements open the panel's form drawer
 * (`formRequirementIds`) and where catalog data lives (`screenTargets`); the
 * hours have a form, so the card links that blocker to the panel with its
 * drawer open (`/admin/readiness?open=CORE.HOURS.REGULAR`).
 */
export const readinessCurrent = (verdict: "listo" | "no_listo") => {
  const failing = verdict === "no_listo";
  return {
    evaluationId: null, evaluatedAt: "2026-09-09T12:00:00.000Z", trigger: "on_demand", cached: true,
    result: {
      specVersion: "1.0.0-rc.1", asOf: "2026-09-09T12:00:00.000Z", resultHash: `e2e-${verdict}`, verdict,
      counts: { applicable: 1, blocking: 1, blockingFailing: failing ? 1 : 0, necessary: 0, necessaryFailing: 0, recommended: 0, recommendedFailing: 0 },
      requirements: [{ id: "CORE.HOURS.REGULAR", title: "Horario", layer: "core", level: "bloqueante", applies: true,
        result: failing ? "no_cumple" : "cumple", valueState: failing ? "ausente" : "confirmado", platform: false, derived: false,
        ...(failing ? { gap: { cause: "ausente", message: "Falta el horario de atención", intents: [], uiTarget: "/admin/settings/business-hours",
          uiToday: "/admin/settings/business-hours", rootOf: [] } } : {}) }],
      blockingGaps: failing ? ["CORE.HOURS.REGULAR"] : [], necessaryGaps: [], recommendedGaps: [],
      platformGaps: [], qualityWarnings: [], coverage: { byArea: {}, r5Pct: 100 }, limitedIntents: [],
    },
    formRequirementIds: ["CORE.HOURS.REGULAR"],
    screenTargets: {},
  };
};

/**
 * What `/admin/readiness` and `/admin/readiness/defaults` ask for beyond the
 * verdict (R3): the history, the drawer of the hours gap (descriptor, current
 * value, stored row and versions) and the defaults list. Without these, the
 * drawer's calls would fall into the `readiness/<tenant>` prefix and get the
 * verdict as their body — the accident the longest-prefix rule warns about.
 */
export const readinessPanelRoutes = (tenantId = TENANT): ApiRoutes => ({
  [`readiness/${tenantId}/history`]: ok([]),
  [`readiness/${tenantId}/requirements/CORE.HOURS.REGULAR`]: ok({
    specVersion: "1.0.0-rc.1",
    definition: {
      id: "CORE.HOURS.REGULAR", title: "Horario", layer: "core", kind: "fact", level: "bloqueante", rule: "R1",
      predicate: "7 días declarados", whenMissing: { code: "PREG", behavior: "Pregunta al negocio.", never: [] },
      uiToday: "/admin/settings/business-hours", uiTarget: "/admin/settings/business-hours", platform: false, answers: [],
    },
    evaluation: { id: "CORE.HOURS.REGULAR", result: "no_cumple", valueState: "ausente" },
    evaluatedAt: "2026-09-09T12:00:00.000Z",
    form: {
      schema: "business-spec/form@1", requirementId: "CORE.HOURS.REGULAR", title: "Horario", type: "weekly_hours",
      mode: "form", screens: [], root: "object", emptyAllowed: false, validation: [], example: null,
      help: "Falta el horario de atención", defaults: null,
      fields: [
        { key: "always_open", label: "Abierto 24/7", kind: "bool", required: false },
        { key: "days", label: "Días y tramos", kind: "day_spans", required: true, when: { field: "always_open", notIn: ["true"] } },
      ],
    },
    current: { state: "ausente", record: null, conflicts: [] },
    fact: null,
  }),
  [`readiness/${tenantId}/business-facts/CORE.HOURS.REGULAR/versions`]: ok([]),
  [`readiness/${tenantId}/business-facts/defaults`]: ok({ specVersion: "1.0.0-rc.1", items: [] }),
  // R5: the pending-knowledge link counter on the panel and the inbox (`/admin/readiness/pending`), empty.
  [`readiness/${tenantId}/pending`]: ok({ items: [], counts: { gap: 0, open: 0, answered: 0, stored: 0, closed: 0, dismissed: 0, overdue: 0 } }),
  // R4: the go-live card under the verdict (not published, gate in shadow mode, nothing recorded yet).
  [`readiness/${tenantId}/go-live`]: ok({
    state: "off", at: null, by: null, specVersion: null, ack: null, mode: "shadow",
    decision: { serve: false, reason: "no_listo" }, lastDecision: null,
    summary: { days: 7, total: 0, wouldBlock: 0, byReason: {}, since: null },
  }),
});

export const dashboardShell = (tenantId = TENANT): ApiRoutes => ({
  // The session heartbeat every authenticated page sends.
  "auth/activity-ping": ok({ ok: true }),
  // Undeclared, this 404s, the client treats it as a dead session and sends the
  // page to /login — which reads in a report as "the dashboard redirected" and
  // is really "the fixture forgot the refresh".
  "auth/refresh": ok({ accessToken: "e2e.access.token", refreshToken: "e2e.refresh.token" }),
  // Ola 6: mientras la cuenta espera la primera respuesta de su agente, el
  // panel relee el día 0 al abrir y al volver a la pestaña. Una respuesta sin
  // datos nuevos deja la sesión exactamente como la sembró cada prueba: el
  // merge nunca borra un dato conocido con uno ausente.
  "auth/me": ok({}),
  "auth/tenant/timezone": ok({ timezone: "America/Bogota" }),
  "platform-status": ok({ incidents: [], status: "operational" }),
  "system-updates": ok([]),
  // The authenticated top bar reads the user's notification policy before it
  // decides whether an incoming event may make a sound. This is shell state,
  // not state owned by the screen underneath it.
  "push/preferences": ok({
    version: 1,
    soundEnabled: true,
    categories: {
      chat: true,
      handoff: true,
      compliance: true,
      appointments: true,
      automation: false,
      orders: false,
      system: true,
    },
  }),
  [`persona/${tenantId}/plan-features`]: ok({
    features: { maxAgents: 3, maxChannelAccounts: 1 },
    plan: { slug: "pro", name: "Pro" },
  }),
  [`persona/${tenantId}/setup-status`]: ok({ complete: true, steps: [] }),
  [`persona/${tenantId}/agents`]: ok([]),
  [`persona/${tenantId}/tool-configuration-summary`]: ok(disabledAgentTools()),
  // Assist's review card (shell-level: the assistant lives in the layout) reads
  // how this account applies agent changes before it says what its button does.
  // Immediate is the product default, and so the honest minimal answer.
  [`persona/${tenantId}/agent-review-mode`]: ok({ mode: "immediate" }),
  // The onboarding guide records durable progress from the authenticated shell.
  // It is a declared write, not a request that should escape the hermetic suite.
  [`persona/${tenantId}/onboarding-events`]: ok({ recorded: true }),
  [`verticals/${tenantId}`]: ok({ industry: "servicios", subType: "generico", config: {} }),
  "verticals/definitions/all": ok([]),
  [`business-info/${tenantId}`]: ok({ name: "Negocio de prueba", timezone: "America/Bogota" }),
  [`billing/${tenantId}/subscription`]: ok({ status: "active", plan: { slug: "pro" } }),
  [`billing/${tenantId}/restriction-status`]: ok({ restricted: false, level: "none" }),
  "billing/public/market": ok({ country: "CO", provider: "wompi", source: "edge", supportedCountries: ["CO", "US"] }),
  "billing/public/plans": ok([]),
  [`fiscal/${tenantId}/data`]: ok({ required: false, complete: true }),
  [`quality/${tenantId}/attention-summary`]: ok({ total: 0, items: [] }),
  // Tenants predate durable quality snapshots, so the shell bootstraps one the
  // first time the summary proves an agent has never been evaluated. It is a
  // POST, and it is the shell's, not any screen's.
  [`quality/${tenantId}/reconcile`]: ok({ total: 0, items: [] }),
  [`analytics/overview/${tenantId}`]: ok({ conversations: 0, messages: 0 }),
  [`analytics/commercial-overview/${tenantId}`]: ok({ revenue: 0, opportunities: 0 }),
  "channels/overview": ok({ channels: [] }),
  // The setup wizard, which `/admin` routes on to while onboarding is open.
  "persona/templates": ok([]),
  // The business recipe orders the wizard's channels. Without this entry the
  // call still resolves — `verticals/<tenant>` is a prefix of it — but with the
  // vertical's config as its body, which only works by accident. No recipe is
  // the honest minimal answer: WhatsApp first, nothing recommended.
  [`verticals/${tenantId}/recipe`]: ok({ industry: null, subType: null, source: "none", recipe: null }),
  [`copilot/assessment/${tenantId}`]: ok({ blockers: [], recommendations: [], ready: false }),
  // Since R2 the setup card also reads the business verdict (`GET /readiness/:tenantId`)
  // next to the assessment, for every role that sees the card. A business with
  // nothing blocking is the honest minimal answer; `pendingAssessment` has the
  // pending one.
  [`readiness/${tenantId}`]: ok(readinessCurrent("listo")),
  // An agent lands in the console rather than on the dashboard, so their shell
  // is a different set of calls — all of them tenant-scoped, which is the point
  // the role tests check.
  [`agent-console/inbox/${tenantId}`]: ok({ conversations: [], total: 0 }),
  [`agent-console/macros/${tenantId}`]: ok([]),
  [`agent-console/canned/${tenantId}`]: ok([]),
  [`crm/custom-attributes/${tenantId}`]: ok([]),
  // Platform mode: what a super_admin's shell loads when it has no tenant.
  "tenants/stats": ok({ total: 0, active: 0, trialing: 0 }),
  tenants: ok([]),
  "health/incidents/summary": ok({ open: 0, acknowledged: 0, incidents: [] }),
  "financials/activation": ok({ activated: 0, pending: 0 }),
});

/**
 * What the eight screens Assist hands people to ask for, on top of the shell.
 *
 * Separate from `dashboardShell` because these are destinations, not the frame:
 * a spec that never opens `/admin/appointments` should not have to declare the
 * appointment calls, or the strictness stops meaning anything. Read off the
 * pages by probe, same as the shell.
 */
export const handoffDestinations = (tenantId = TENANT): ApiRoutes => ({
  // `/admin/users`
  "auth/users": ok([]),
  // `/admin/settings/integrations/payments`
  [`tenant-payments/${tenantId}/config`]: ok({ provider: null, connected: false }),
  // `/admin/appointments`
  [`appointments/${tenantId}/calendar/integrations`]: ok([]),
  [`appointments/${tenantId}/services`]: ok([]),
  [`appointments/${tenantId}`]: ok([]),
  // `/admin/catalog/offers`
  [`offers/${tenantId}`]: ok([]),
  // `/admin/catalog/campaigns`
  [`catalog/campaigns/${tenantId}`]: ok([]),
  [`catalog/courses/${tenantId}`]: ok([]),
  // The navigation cost counter, which every operational surface posts to.
  [`analytics/navigation-telemetry/${tenantId}`]: ok({ recorded: true }),
});

/**
 * A business that is already running, on top of the shell.
 *
 * The shell's `setup-status` is deliberately the shape of a brand-new account,
 * which is why `/admin` routes on to the setup wizard for a tenant admin: the
 * stage derives to `account_created` and the guide sends them there. That is the
 * right default for a first-login test and the wrong one for everything else —
 * a tour of the panel cannot start on the one route tours refuse to leave.
 *
 * `hasAnyChannel` is the fact that moves the stage. Nothing here claims the
 * setup is FINISHED: the card still has open items, which is the ordinary state
 * of a business a few days in and the state in which tours are offered.
 */
export const readyBusiness = (tenantId = TENANT): ApiRoutes => ({
  [`persona/${tenantId}/setup-status`]: ok({
    onboardingStage: "channel_connected",
    hasAnyChannel: true,
    connectedChannelTypes: ["whatsapp"],
    setupWizardCompleted: true,
    hasPersona: true,
    timezone: "America/Bogota",
  }),
  "channels/overview": ok({
    channels: [{ type: "whatsapp", accounts: 1, health: "ok", connected: true }],
  }),
});

const AGENT = "77777777-7777-4777-8777-777777777777";

/**
 * The assessment, in the shape the setup card and the quality banner read.
 *
 * "What is still missing before this account works" has exactly one answer in
 * this product — `AgentAssessment.tasks`, computed server-side against the same
 * preparation checks Agent health is graded on. The card renders that answer and
 * nothing else, so a fixture that is merely assessment-SHAPED renders "no
 * pudimos verificar estos pasos" and proves nothing. The task list below is the
 * real projection: the same hrefs and tours the API pairs each key with.
 */
export const pendingAssessment = (tenantId = TENANT): ApiRoutes => ({
  [`copilot/assessment/${tenantId}`]: ok({
    version: 1,
    revision: "e2e-1",
    generatedAt: "2026-09-09T12:00:00.000Z",
    agent: { id: AGENT, name: "Laura Sofía", version: 3, isActive: true },
    overview: null,
    mission: {
      source: "template_derived", templateId: "support", profileId: null,
      definition: null, availableIntentKeys: [], unsupportedIntents: [],
    },
    channels: [],
    tasks: [
      // The API emits channel before agent (`AGENT_SETUP_TASK_CHECKS` order), so
      // the card's first «Mostrarme dónde» is this one. A WhatsApp number is
      // connected (`readyBusiness`) but the channel step is still open, which
      // is the default pairing: `/admin/channels` and its `connect_channel` tour.
      { key: "channel", status: "fail", state: "pending", checks: [],
        href: "/admin/channels", tourId: "connect_channel", dependsOn: ["agent"] },
      { key: "agent", status: "fail", state: "pending", checks: [],
        href: `/admin/agent/${AGENT}?tab=instructions&focus=rules`, tourId: "agent_handoff_rules", dependsOn: ["mission"] },
      // Since R2 the business step is the readiness verdict (C0 §4.2): no tour,
      // it opens the readiness panel.
      { key: "business", status: "fail", state: "pending", checks: [],
        href: "/admin/readiness", tourId: null, dependsOn: [] },
    ],
    state: "pending",
    nextTask: "channel",
    requiredTests: [],
    blockers: [],
    recommendations: [],
  }),
  // The verdict the setup card's business step reads (`GET /readiness/:tenantId`).
  [`readiness/${tenantId}`]: ok(readinessCurrent("no_listo")),
});

/**
 * The vertical catalogue the signup wizard fills its industry selector from.
 *
 * Derived from the shared manifest rather than typed out, because the dashboard
 * refuses a catalogue that does not have exactly the canonical number of
 * industries — a hand-copied list would silently become a fixture that renders
 * an empty selector and a test that proves nothing about the real one.
 */
export const verticalCatalog = (): ApiRoutes => ({
  "verticals/definitions/all": ok(Object.fromEntries(
    Object.entries(VERTICAL_CAPABILITY_MANIFEST).map(([industry, entry]) => [
      industry,
      entry.subtypes.map((key) => ({ key, label: { es: key, en: key, pt: key, fr: key } })),
    ]),
  )),
});
