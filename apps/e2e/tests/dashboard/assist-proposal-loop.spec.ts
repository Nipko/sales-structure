import { expect, test, type Page } from "@playwright/test";
import {
  dashboardShell,
  handoffDestinations,
  pendingAssessment,
  readyBusiness,
} from "../../fixtures/dashboard-routes";
import {
  expectHermetic,
  hermeticDashboard,
  ok,
  settled,
  signIn,
  type ApiRoutes,
  type DashboardRole,
  type HermeticState,
} from "../../fixtures/dashboard-session";

/**
 * The loop that makes Assist worth having: ask, review, save, and be told what
 * actually happened.
 *
 * Every claim in that sentence is a promise this product makes in writing, and
 * every one of them is the kind that reads fine in a unit test and fails in a
 * browser. Assist prepares a proposal, it never applies one. The review card
 * shows both sides, so nobody saves a change they have not seen. Saving writes
 * a DRAFT, not the configuration serving customers. And what comes back is a
 * receipt about the edited revision — separate from the assessment, which
 * describes the version the edit did not touch, and which must never be shown
 * as evidence for the draft.
 *
 * Nothing here calls a model. `copilot/chat` is declared with the reply and the
 * proposal a model would have produced; what is under test is the panel's half
 * of the contract, which is the half a browser can settle.
 */

const TENANT = "33333333-3333-4333-8333-333333333333";
const AGENT = "77777777-7777-4777-8777-777777777777";
const PROPOSAL = "88888888-8888-4888-8888-888888888888";
const REVISION = "99999999-9999-4999-8999-999999999999";
const DIGEST = "a".repeat(64);

/** The change Assist offers: a greeting that names the business. */
const proposal = (overrides: Record<string, unknown> = {}) => ({
  id: PROPOSAL,
  agentId: AGENT,
  agentName: "Laura Sofía",
  expectedVersion: 3,
  targetScope: "agent_draft",
  expectedDraftRevision: null,
  digest: DIGEST,
  status: "proposed",
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  changes: [{
    path: "persona.greeting",
    value: "Hola, soy Laura de Clínica Aurora. ¿En qué te ayudo?",
    before: "Hola, ¿en qué puedo ayudarte?",
  }],
  ...overrides,
});

const applied = (verification: Record<string, unknown>) => ({
  proposal: proposal({ status: "applied", appliedVersion: 3, appliedDraftRevision: REVISION }),
  assessment: null,
  verification: "verified",
  assessmentScope: "operational",
  draftVerification: {
    scope: "applied_draft",
    revisionId: REVISION,
    revisionHash: "hash-e2e",
    checkedAt: "2026-09-09T12:05:00.000Z",
    ...verification,
  },
  draft: {
    idempotentReplay: false,
    savedRevision: { id: REVISION, version: 4 },
    workspace: {
      agentId: AGENT,
      operational: { version: 3, hash: "op-hash", body: { name: "Laura Sofía", configJson: { persona: {} } } },
      draft: { id: REVISION, version: 4 },
      evaluationRevisionId: REVISION,
    },
  },
});

const routes = (extra: ApiRoutes = {}): ApiRoutes => ({
  ...dashboardShell(TENANT),
  ...handoffDestinations(TENANT),
  ...readyBusiness(TENANT),
  ...pendingAssessment(TENANT),
  [`verticals/${TENANT}`]: ok({
    industry: "salud", subType: "clinica_general",
    effectiveCapabilities: ["appointment_booking", "faq_search", "crm_pipeline"],
  }),
  "copilot/chat": ok({
    reply: "Preparé un saludo que nombra al negocio. Revisalo antes de guardarlo.",
    proposal: proposal(),
  }),
  ...extra,
});

/** Opens the assistant the way the launcher does. */
async function openAssist(page: Page, role: DashboardRole = "tenant_admin"): Promise<HermeticState> {
  const state = await hermeticDashboard(page, routes(assistRoutesRef.current));
  await signIn(page, role);
  await page.goto("/admin");
  await settled(page);
  await page.getByRole("button", { name: /Asistente de [Aa]yuda/ }).click();
  return state;
}

/** Per-test overrides for the apply endpoint, set before `openAssist`. */
const assistRoutesRef: { current: ApiRoutes } = { current: {} };

const panel = (page: Page) => page.locator("[role='dialog']").first();
const review = (page: Page) => page.locator("section[aria-label]").filter({ hasText: "Laura Sofía" }).first();

async function ask(page: Page, message: string): Promise<void> {
  const box = panel(page).locator("textarea, input[type='text']").first();
  await box.fill(message);
  await box.press("Enter");
}

test.describe("el circuito de Assist: proponer, revisar, guardar, verificar", () => {
  test.beforeEach(() => { assistRoutesRef.current = {}; });

  test("propone un cambio y muestra los dos lados antes de tocar nada", async ({ page }) => {
    const state = await openAssist(page);
    await ask(page, "El saludo suena genérico");

    const card = review(page);
    await expect(card).toBeVisible();
    // Los dos lados. Guardar algo que no se vio es exactamente lo que esta
    // tarjeta existe para impedir.
    await expect(card).toContainText("Hola, ¿en qué puedo ayudarte?");
    await expect(card).toContainText("Clínica Aurora");
    // Y nada se aplicó por proponerlo.
    expect(state.writes.filter((entry) => entry.includes("/apply"))).toEqual([]);
    await expectHermetic(state);
  });

  test("guardar escribe un borrador, con el digest que se revisó", async ({ page }) => {
    // El digest es el contrato entre lo que se mostró y lo que se guarda: si el
    // botón mandara otro, la persona habría aprobado una pantalla y guardado
    // otra cosa.
    const sent: Array<Record<string, unknown>> = [];
    assistRoutesRef.current = {};
    const state = await hermeticDashboard(page, routes());
    await page.route(`**/api/v1/copilot/configuration/${TENANT}/proposals/*/apply`, async (route) => {
      sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, data: applied({ state: "verified", reason: null }) }),
      });
    });
    await signIn(page, "tenant_admin");
    await page.goto("/admin");
    await settled(page);
    await page.getByRole("button", { name: /Asistente de [Aa]yuda/ }).click();
    await ask(page, "El saludo suena genérico");

    const card = review(page);
    await expect(card).toBeVisible();
    await card.getByRole("button").last().click();

    await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
    expect(sent[0].url).toContain(`/proposals/${PROPOSAL}/apply`);
    expect(sent[0].body).toEqual({ digest: DIGEST });
    // Y el recibo dice "guardado", no "publicado": lo que sirve a los clientes
    // sigue siendo la versión operativa.
    await expect(card.getByRole("status").first()).toBeVisible();
    expect(state.productionRequests).toEqual([]);
  });

  test("lo que vuelve es evidencia del borrador, y ofrece probarlo", async ({ page }) => {
    assistRoutesRef.current = {
      [`copilot/configuration/${TENANT}/proposals`]: ok(applied({ state: "verified", reason: null })),
    };
    const state = await openAssist(page);
    await ask(page, "El saludo suena genérico");
    const card = review(page);
    await expect(card).toBeVisible();
    await card.getByRole("button").last().click();

    // El enlace a la prueba lleva la revisión aplicada: probar "el agente" sin
    // decir cuál mediría la versión operativa y llamaría a eso una prueba del
    // cambio.
    const testLink = card.getByRole("link").first();
    await expect(testLink).toBeVisible();
    const href = await testLink.getAttribute("href");
    expect(href).toContain(`/admin/agent/${AGENT}/test`);
    expect(href).toContain(`configurationRevisionId=${REVISION}`);
    await expectHermetic(state);
  });

  test("una verificación que no pudo correr no se muestra como verificada", async ({ page }) => {
    // La regla que hace que el recibo signifique algo: nada probado no puede
    // leerse nunca como probado, y el motivo se dice.
    assistRoutesRef.current = {
      [`copilot/configuration/${TENANT}/proposals`]: ok({
        ...applied({ state: "unavailable", reason: "runner_unavailable" }),
        verification: "unavailable",
      }),
    };
    const state = await openAssist(page);
    await ask(page, "El saludo suena genérico");
    const card = review(page);
    await expect(card).toBeVisible();
    await card.getByRole("button").last().click();

    await expect(card.getByRole("status").first()).toBeVisible();
    await expect(card).not.toContainText("verificado con éxito");
    // Y el botón sigue disponible para reintentar la verificación, porque el
    // motivo no es una cuota agotada.
    await expect(card.getByRole("button").last()).toBeEnabled();
    await expectHermetic(state);
  });

  test("un supervisor ve el cambio propuesto y no puede guardarlo", async ({ page }) => {
    // Ver no es poder. La configuración del agente es del administrador de la
    // cuenta, y la tarjeta lo respeta sin esconder lo que se propuso.
    const state = await openAssist(page, "tenant_supervisor");
    await ask(page, "El saludo suena genérico");
    const card = review(page);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Clínica Aurora");
    expect(await card.getByRole("button").count()).toBe(0);
    expect(state.writes.filter((entry) => entry.includes("/apply"))).toEqual([]);
  });

  test("una propuesta vencida se dice vencida, en vez de dejar guardar a ciegas", async ({ page }) => {
    // Media hora después la configuración pudo cambiar. Guardar sobre una
    // revisión que ya no existe es escribir encima de otro cambio.
    const state = await hermeticDashboard(page, routes({
      "copilot/chat": ok({
        reply: "Preparé un saludo.",
        proposal: proposal({ expiresAt: new Date(Date.now() - 60_000).toISOString() }),
      }),
    }));
    await signIn(page, "tenant_admin");
    await page.goto("/admin");
    await settled(page);
    await page.getByRole("button", { name: /Asistente de [Aa]yuda/ }).click();
    await ask(page, "El saludo suena genérico");

    const card = review(page);
    await expect(card).toBeVisible();
    await expect(card.getByRole("status").first()).toBeVisible();
    expect(await card.getByRole("button").count()).toBe(0);
    expect(state.writes.filter((entry) => entry.includes("/apply"))).toEqual([]);
  });
});
