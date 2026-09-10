import { VERTICAL_CAPABILITY_MANIFEST } from "@parallext/shared";
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

export const dashboardShell = (tenantId = TENANT): ApiRoutes => ({
  // The session heartbeat every authenticated page sends.
  "auth/activity-ping": ok({ ok: true }),
  // Undeclared, this 404s, the client treats it as a dead session and sends the
  // page to /login — which reads in a report as "the dashboard redirected" and
  // is really "the fixture forgot the refresh".
  "auth/refresh": ok({ accessToken: "e2e.access.token", refreshToken: "e2e.refresh.token" }),
  "auth/tenant/timezone": ok({ timezone: "America/Bogota" }),
  "platform-status": ok({ incidents: [], status: "operational" }),
  "system-updates": ok([]),
  [`persona/${tenantId}/plan-features`]: ok({
    features: { maxAgents: 3, maxChannelAccounts: 1 },
    plan: { slug: "pro", name: "Pro" },
  }),
  [`persona/${tenantId}/setup-status`]: ok({ complete: true, steps: [] }),
  [`persona/${tenantId}/agents`]: ok([]),
  [`verticals/${tenantId}`]: ok({ industry: "servicios", subType: "generico", config: {} }),
  "verticals/definitions/all": ok([]),
  [`business-info/${tenantId}`]: ok({ name: "Negocio de prueba", timezone: "America/Bogota" }),
  [`billing/${tenantId}/subscription`]: ok({ status: "active", plan: { slug: "pro" } }),
  [`billing/${tenantId}/restriction-status`]: ok({ restricted: false, level: "none" }),
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
  [`copilot/assessment/${tenantId}`]: ok({ blockers: [], recommendations: [], ready: false }),
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
      { key: "business", status: "fail", state: "pending", checks: [],
        href: "/admin/settings/business-info", tourId: "business_identity", dependsOn: [] },
      { key: "knowledge", status: "fail", state: "pending", checks: [],
        href: "/admin/knowledge", tourId: "knowledge_base", dependsOn: ["business"] },
      { key: "hours", status: "pass", state: "operating", checks: [],
        href: "/admin/settings/business-hours", tourId: "business_hours", dependsOn: [] },
    ],
    state: "pending",
    nextTask: "business",
    requiredTests: [],
    blockers: [],
    recommendations: [],
  }),
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
