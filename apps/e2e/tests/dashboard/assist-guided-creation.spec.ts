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
} from "../../fixtures/dashboard-session";

/**
 * The other review card: an object that does not exist yet.
 *
 * The configuration card shows a diff — a value and the value it replaces. A
 * creation has no `before`, and an empty left column would read as a field
 * being cleared rather than an object being made, so this card says so in words
 * and then lists exactly what will be written. Nothing is created until a person
 * presses the button, the digest travels back unchanged so the approval belongs
 * to the content that was shown, and pressing twice returns the first object
 * rather than making a second.
 *
 * Three of the four executable operations are walked here — a FAQ, a legal text
 * and an agenda service — because they differ in who may ask for them and in
 * what "created" then means. The legal text is the sharpest: it is written
 * INACTIVE, and publishing it stays a person's decision on its own screen.
 */

const TENANT = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DIGEST = "b".repeat(64);

type Creation = {
  operation: string;
  domain: string;
  route: string;
  after: Array<{ field: string; value: string | number | boolean }>;
};

const FAQ: Creation = {
  operation: "knowledge.faq.create",
  domain: "knowledge",
  route: "/admin/knowledge/faqs",
  after: [
    { field: "title", value: "¿Atienden sin cita?" },
    { field: "content", value: "Sí, con disponibilidad del día. Conviene llamar antes." },
  ],
};

const LEGAL: Creation = {
  operation: "policies.legal_text.create",
  domain: "policies",
  route: "/admin/compliance",
  after: [
    { field: "name", value: "Política de privacidad" },
    { field: "type", value: "privacy" },
    { field: "text", value: "Tratamos tus datos para agendar y confirmar tu cita." },
  ],
};

const SERVICE: Creation = {
  operation: "agenda.service.create",
  domain: "agenda",
  route: "/admin/appointments",
  after: [
    { field: "name", value: "Control anual" },
    { field: "durationMinutes", value: 45 },
  ],
};

const contentProposal = (creation: Creation, overrides: Record<string, unknown> = {}) => ({
  id: PROPOSAL,
  operation: creation.operation,
  domain: creation.domain,
  target: { module: creation.domain, service: "X", method: "create", table: "t" },
  route: creation.route,
  digest: DIGEST,
  status: "proposed",
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  preview: { before: null, beforeState: "does_not_exist", after: creation.after },
  ...overrides,
});

const appliedObject = (creation: Creation, overrides: Record<string, unknown> = {}) => ({
  proposal: contentProposal(creation, { status: "applied", createdObjectId: "obj-1" }),
  outcome: "created",
  object: { id: "obj-1", label: String(creation.after[0].value), route: creation.route },
  verification: "verified",
  verificationReason: null,
  ...overrides,
});

const routes = (creation: Creation, extra: ApiRoutes = {}): ApiRoutes => ({
  ...dashboardShell(TENANT),
  ...handoffDestinations(TENANT),
  ...readyBusiness(TENANT),
  ...pendingAssessment(TENANT),
  [`verticals/${TENANT}`]: ok({
    industry: "salud", subType: "clinica_general",
    effectiveCapabilities: ["appointment_booking", "faq_search", "crm_pipeline"],
  }),
  "copilot/chat": ok({
    reply: "Preparé el objeto. Revisá el contenido antes de crearlo.",
    contentProposal: contentProposal(creation),
  }),
  ...extra,
});

const card = (page: Page) => page.locator("section").filter({ hasText: "Todavía no existe" }).first();

async function askFor(page: Page, creation: Creation, extra: ApiRoutes = {}) {
  const state = await hermeticDashboard(page, routes(creation, extra));
  await signIn(page, "tenant_admin");
  await page.goto("/admin");
  await settled(page);
  await page.getByRole("button", { name: /Asistente de [Aa]yuda/ }).click();
  const box = page.locator("[role='dialog']").first().locator("textarea, input[type='text']").first();
  await box.fill("Escribime esto para el negocio");
  await box.press("Enter");
  return state;
}

test.describe("creación asistida: lo que se va a escribir, antes de escribirlo", () => {
  test("una FAQ se muestra campo por campo y no existe hasta que alguien la crea", async ({ page }) => {
    const state = await askFor(page, FAQ);

    const review = card(page);
    await expect(review).toBeVisible();
    await expect(review).toContainText("¿Atienden sin cita?");
    await expect(review).toContainText("con disponibilidad del día");
    // Ningún intento de escritura por haberlo propuesto.
    expect(state.writes.filter((entry) => entry.includes("operations/"))).toEqual([]);
    await expectHermetic(state);
  });

  test("crearla manda el digest que se revisó y devuelve dónde leerla", async ({ page }) => {
    const sent: Array<Record<string, unknown>> = [];
    const state = await hermeticDashboard(page, routes(FAQ));
    await page.route(`**/api/v1/copilot/operations/${TENANT}/proposals/*/apply`, async (route) => {
      sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, data: appliedObject(FAQ) }),
      });
    });
    await signIn(page, "tenant_admin");
    await page.goto("/admin");
    await settled(page);
    await page.getByRole("button", { name: /Asistente de [Aa]yuda/ }).click();
    const box = page.locator("[role='dialog']").first().locator("textarea, input[type='text']").first();
    await box.fill("Escribime una pregunta frecuente");
    await box.press("Enter");

    const review = card(page);
    await expect(review).toBeVisible();
    await review.getByRole("button").last().click();

    await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
    expect(sent[0].url).toContain(`/proposals/${PROPOSAL}/apply`);
    expect(sent[0].body).toEqual({ digest: DIGEST });

    // Creado, y con la pantalla donde una persona lo lee: escrito no es
    // revisado, y el card no pretende que lo sea.
    await expect(review.getByRole("status").first()).toBeVisible();
    await expect(review.getByRole("link")).toHaveAttribute("href", FAQ.route);
    // Y el botón desaparece: crear dos veces lo mismo no es una opción que la
    // pantalla deba ofrecer.
    expect(await review.getByRole("button").count()).toBe(0);
    expect(state.productionRequests).toEqual([]);
  });

  test("un texto legal se ofrece igual, y su pantalla es la que lo publica", async ({ page }) => {
    // Assist puede escribir el texto. Activarlo es una decisión que sale hacia
    // los clientes, así que vive en `/admin/compliance` y no en este chat.
    const state = await askFor(page, LEGAL, {
      [`copilot/operations/${TENANT}/proposals`]: ok(appliedObject(LEGAL)),
    });

    const review = card(page);
    await expect(review).toBeVisible();
    await expect(review).toContainText("Política de privacidad");
    await review.getByRole("button").last().click();
    await expect(review.getByRole("link")).toHaveAttribute("href", "/admin/compliance");
    await expectHermetic(state);
  });

  test("un servicio de agenda muestra la duración que se va a guardar", async ({ page }) => {
    const state = await askFor(page, SERVICE);
    const review = card(page);
    await expect(review).toBeVisible();
    await expect(review).toContainText("Control anual");
    await expect(review).toContainText("45");
    await expectHermetic(state);
  });

  test("el segundo intento devuelve el primer objeto, no crea otro", async ({ page }) => {
    // `replayed` no es silencio: la pantalla lo dice, y dice que el objeto es
    // el mismo. Un reintento que creara un segundo dejaría dos FAQ iguales que
    // nadie pidió.
    const state = await askFor(page, FAQ, {
      [`copilot/operations/${TENANT}/proposals`]: ok(appliedObject(FAQ, { outcome: "replayed" })),
    });
    const review = card(page);
    await expect(review).toBeVisible();
    await review.getByRole("button").last().click();
    await expect(review.getByRole("status").first()).toBeVisible();
    await expect(review.getByRole("link")).toHaveAttribute("href", FAQ.route);
    await expectHermetic(state);
  });

  test("escrito no es verificado: si no se pudo releer, lo dice", async ({ page }) => {
    const state = await askFor(page, FAQ, {
      [`copilot/operations/${TENANT}/proposals`]: ok(appliedObject(FAQ, {
        verification: "unavailable", verificationReason: "reread_failed",
      })),
    });
    const review = card(page);
    await expect(review).toBeVisible();
    await review.getByRole("button").last().click();
    // Dos avisos: se creó, y no se pudo confirmar. Decir sólo el primero sería
    // afirmar una lectura que nunca ocurrió.
    await expect.poll(() => review.getByRole("status").count()).toBeGreaterThan(1);
    await expectHermetic(state);
  });

  test("una propuesta vencida no se puede crear a ciegas", async ({ page }) => {
    const state = await hermeticDashboard(page, routes(FAQ, {
      "copilot/chat": ok({
        reply: "Preparé el objeto.",
        contentProposal: contentProposal(FAQ, { expiresAt: new Date(Date.now() - 60_000).toISOString() }),
      }),
    }));
    await signIn(page, "tenant_admin");
    await page.goto("/admin");
    await settled(page);
    await page.getByRole("button", { name: /Asistente de [Aa]yuda/ }).click();
    const box = page.locator("[role='dialog']").first().locator("textarea, input[type='text']").first();
    await box.fill("Escribime una pregunta frecuente");
    await box.press("Enter");

    const review = card(page);
    await expect(review).toBeVisible();
    await expect(review.getByRole("status").first()).toBeVisible();
    expect(await review.getByRole("button").count()).toBe(0);
    expect(state.writes.filter((entry) => entry.includes("operations/"))).toEqual([]);
  });
});
