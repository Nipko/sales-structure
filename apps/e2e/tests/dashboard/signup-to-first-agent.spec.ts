import { expect, test, type Page } from "@playwright/test";
import { dashboardShell, verticalCatalog } from "../../fixtures/dashboard-routes";
import {
  expectHermetic,
  hermeticDashboard,
  ok,
  settled,
  type ApiRoutes,
  type HermeticState,
} from "../../fixtures/dashboard-session";

/**
 * From "create account" to a business the product knows something about.
 *
 * This is the stretch where the product is won or lost, and until now nothing
 * walked it in a browser: the specs covered the login screen and everything
 * behind it, and jumped over the twenty minutes in between. What is asserted
 * here is the claim the whole vertical strategy rests on — that saying "I run a
 * medical practice" changes what the wizard asks next, and that what the owner
 * answered is what reaches the server, once.
 *
 * The API is declared, not real. A signup that needed PostgreSQL, Redis and a
 * model key would be a test nobody runs; what is under test is the wizard, and
 * the wizard is entirely in the browser.
 */

const TENANT = "33333333-3333-4333-8333-333333333333";
const AGENT = "77777777-7777-4777-8777-777777777777";

const NEW_USER = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "duena@clinica.test",
  name: "Dueña de la clínica",
  role: "tenant_admin",
  tenantId: null,
  emailVerified: false,
  onboardingCompleted: false,
};

/** The same person after the tenant exists. */
const TENANTED_USER = { ...NEW_USER, tenantId: TENANT, onboardingCompleted: true, onboardingStage: "account_created" };

/** Everything the two public screens ask for, and nothing behind the session. */
const publicRoutes = (): ApiRoutes => ({
  ...verticalCatalog(),
  "auth/signup": ok({
    accessToken: "e2e.access.token",
    refreshToken: "e2e.refresh.token",
    verificationEmailSent: true,
    user: NEW_USER,
  }),
  "auth/complete-onboarding": ok({
    accessToken: "e2e.access.token",
    refreshToken: "e2e.refresh.token",
    user: TENANTED_USER,
    verticalConfig: {
      industry: "salud",
      subType: "medica_general",
      effectiveCapabilities: ["appointment_booking", "faq_search", "crm_pipeline"],
    },
  }),
  "auth/activity-ping": ok({ ok: true }),
  // The catalogue the fourth step renders. Every field the card reads is here
  // on purpose: the plan columns are NOT NULL in the schema, so a fixture
  // missing one would be testing a shape the API cannot produce — and the card
  // would print `NaN` where a number belongs.
  "billing/public/plans": ok([{
    id: "plan-emprendedor",
    slug: "emprendedor",
    name: "Emprendedor",
    priceUsdCents: 1900,
    displayPriceCents: 79000,
    displayPriceAnnualCents: 790000,
    displayCurrency: "COP",
    trialDays: 14,
    requiresCardForTrial: false,
    requiresPaymentMethodAtSignup: false,
    providerConfigured: true,
    maxAgents: 1,
    maxAiMessages: 1000,
    features: { channels: ["whatsapp"] },
    signupAvailable: true,
    trialAvailable: true,
    monthlyAvailable: true,
    annualAvailable: false,
    checkoutMode: "self_serve",
  }]),
});

/** Signed in but tenantless, which is what the onboarding wizard runs as. */
async function seedNewAccount(page: Page): Promise<void> {
  await page.addInitScript((user) => {
    window.localStorage.setItem("accessToken", "e2e.access.token");
    window.localStorage.setItem("refreshToken", "e2e.refresh.token");
    window.localStorage.setItem("user", JSON.stringify(user));
  }, NEW_USER);
}

/** Fills the first screen for a given industry and moves on. */
async function describeBusiness(page: Page, industry: string, subType?: string): Promise<void> {
  await page.locator("#onboarding-company-name").fill("Clínica Aurora");
  await page.locator("#onboarding-industry").selectOption(industry);
  if (subType) {
    await expect(page.locator("#onboarding-subtype")).toBeVisible();
    await page.locator("#onboarding-subtype").selectOption(subType);
  }
  await page.locator("#onboarding-company-about").fill("Consultas generales y controles.");
  await page.locator("#onboarding-orgsize").selectOption("1-10");
}

const advance = (page: Page) => page.getByRole("button", { name: "Siguiente" }).first();

/** The labels of the checkboxes on the current step, in order. */
async function choices(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll("input[type=checkbox]")]
    .map((box) => {
      const input = box as HTMLInputElement;
      return (input.labels?.[0]?.textContent ?? "").replace(/\s+/g, " ").trim();
    }));
}

test.describe("del alta al primer agente", () => {
  test("crear la cuenta deja la sesión lista y lleva al asistente, no al panel", async ({ page }) => {
    const state = await hermeticDashboard(page, publicRoutes());
    await page.goto("/signup");
    await settled(page).catch(() => undefined);

    // Por el nombre accesible, no por el placeholder: hasta hace poco los
    // cuatro campos no tenían etiqueta asociada y un lector de pantalla leía
    // "edit text" cuatro veces en la primera pantalla del producto.
    await page.getByLabel(/Nombre/).fill("Ana");
    await page.getByLabel(/Apellido/).fill("Rivas");
    await page.getByLabel(/Email/).fill(NEW_USER.email);
    await page.getByLabel(/Contraseña/).fill("Contrasena-Fuerte-9");

    await page.getByRole("button", { name: /Crear cuenta/ }).click();

    await expect(page).toHaveURL(/\/onboarding/);
    // La sesión quedó puesta: sin esto el asistente arranca sin token y la
    // primera llamada vuelve 401 sobre una cuenta recién creada.
    expect(await page.evaluate(() => window.localStorage.getItem("accessToken"))).toBeTruthy();
    expect(state.observed.filter((path) => path === "auth/signup")).toHaveLength(1);
  });

  test("elegir el rubro cambia lo que el asistente pregunta después", async ({ page }) => {
    // La tesis entera de las verticales, en una pantalla: si la industria no
    // cambia las preguntas, el rubro es una etiqueta y no una configuración.
    const state = await hermeticDashboard(page, publicRoutes());
    await seedNewAccount(page);
    await page.goto("/onboarding");
    await settled(page).catch(() => undefined);

    await describeBusiness(page, "salud", "medica_general");
    await expect(advance(page)).toBeEnabled();
    await advance(page).click();

    await expect(page.getByRole("heading", { name: "Tus clientes" })).toBeVisible();
    const medical = await choices(page);
    expect(medical.length).toBeGreaterThan(1);
    expect(medical.join(" | ")).toMatch(/[Pp]aciente/);
    await expectHermetic(state);
  });

  test("otro rubro pregunta otra cosa, con la misma pantalla", async ({ page }) => {
    const state = await hermeticDashboard(page, publicRoutes());
    await seedNewAccount(page);
    await page.goto("/onboarding");
    await settled(page).catch(() => undefined);

    await describeBusiness(page, "restaurantes", "casual_dining");
    await advance(page).click();
    await expect(page.getByRole("heading", { name: "Tus clientes" })).toBeVisible();

    const restaurant = await choices(page);
    expect(restaurant.length).toBeGreaterThan(1);
    // Nada de pacientes acá. Es la comprobación negativa que hace que la
    // positiva de arriba signifique algo.
    expect(restaurant.join(" | ")).not.toMatch(/[Pp]aciente/);
    await expectHermetic(state);
  });

  test("lo que la dueña contestó es exactamente lo que se manda, una sola vez", async ({ page }) => {
    const state = await hermeticDashboard(page, publicRoutes());
    // El cuerpo del alta, capturado tal como sale del navegador: es el único
    // punto donde se puede comprobar que el rubro, el subtipo y los objetivos
    // llegan juntos y sin traducción de por medio.
    const sent: unknown[] = [];
    await page.route("**/api/v1/auth/complete-onboarding", async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            accessToken: "e2e.access.token",
            refreshToken: "e2e.refresh.token",
            user: TENANTED_USER,
            verticalConfig: {
              industry: "salud", subType: "medica_general",
              effectiveCapabilities: ["appointment_booking", "faq_search"],
            },
          },
        }),
      });
    });
    await seedNewAccount(page);
    await page.goto("/onboarding");
    await settled(page).catch(() => undefined);

    await describeBusiness(page, "salud", "medica_general");
    await advance(page).click();
    await expect(page.getByRole("heading", { name: "Tus clientes" })).toBeVisible();
    await page.locator("input[type=checkbox]").first().click({ force: true });
    await advance(page).click();

    await expect(page.getByRole("heading", { name: /Qué quieres lograr/ })).toBeVisible();
    const goals = await choices(page);
    expect(goals.length).toBeGreaterThan(1);
    await page.locator("input[type=checkbox]").first().click({ force: true });
    await advance(page).click();

    // El cuarto paso: el plan con el que arranca la prueba. Sale del catálogo
    // vigente, no de una lista escrita en la pantalla.
    await expect(page.getByRole("heading", { name: /Elige tu plan/ })).toBeVisible();
    await expect(page.getByText("Emprendedor")).toBeVisible();
    await page.getByRole("button", { name: /Crear mi cuenta/ }).click();

    await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
    expect(sent[0]).toMatchObject({
      company: expect.objectContaining({
        name: "Clínica Aurora", industry: "salud", subType: "medica_general", orgSize: "1-10",
      }),
      audiences: expect.arrayContaining([expect.any(String)]),
      goals: expect.arrayContaining([expect.any(String)]),
      locale: "es",
    });
    // Y el tenant recién creado queda en el navegador con su vertical, que es
    // lo que decide qué pantallas existen en la primera carga del panel.
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("verticalConfig")))
      .toContain("medica_general");
    expect(state.productionRequests).toEqual([]);
  });

  test("el asistente de puesta en marcha recibe un agente ya preparado", async ({ page }) => {
    // El final del recorrido: la cuenta existe, el rubro está elegido, y lo que
    // el dueño encuentra no es un formulario en blanco sino un agente sembrado
    // con su plantilla, su misión y sus herramientas — al que sólo le falta el
    // canal por el que va a atender.
    const state = await hermeticDashboard(page, {
      ...dashboardShell(TENANT),
      ...verticalCatalog(),
      "auth/activity-ping": ok({ ok: true }),
      [`verticals/${TENANT}`]: ok({
        industry: "salud", subType: "medica_general",
        effectiveCapabilities: ["appointment_booking", "faq_search", "crm_pipeline"],
      }),
      [`persona/${TENANT}/setup-status`]: ok({
        onboardingStage: "account_created",
        hasAnyChannel: false,
        connectedChannelTypes: [],
        setupWizardCompleted: false,
        hasPersona: true,
        defaultAgent: { id: AGENT, name: "Laura Sofía", templateId: "appointment_scheduler" },
        defaultAgentTemplateId: "appointment_scheduler",
        timezone: "America/Bogota",
      }),
      "persona/templates": ok([
        { id: "appointment_scheduler", name: "Agenda de citas", description: "Agenda y confirma." },
      ]),
      // The prepared agent as the editor reads it: an operational version with
      // a body, and no draft on top of it yet.
      [`persona/${TENANT}/agents/${AGENT}/configuration`]: ok({
        agentId: AGENT,
        operational: {
          version: 1,
          hash: "e2e-hash",
          body: {
            name: "Laura Sofía",
            configJson: {
              persona: { name: "Laura Sofía", greeting: "Hola, soy Laura de Clínica Aurora." },
            },
          },
        },
        draft: null,
        evaluationRevisionId: null,
      }),
      [`persona/${TENANT}/agents`]: ok([
        { id: AGENT, name: "Laura Sofía", isActive: true, templateId: "appointment_scheduler", channelBindings: [] },
      ]),
    });
    await page.addInitScript((user) => {
      window.localStorage.setItem("accessToken", "e2e.access.token");
      window.localStorage.setItem("refreshToken", "e2e.refresh.token");
      window.localStorage.setItem("user", JSON.stringify(user));
      window.localStorage.setItem("activeTenantId", (user as { tenantId: string }).tenantId);
    }, TENANTED_USER);

    await page.goto("/admin/setup-wizard");
    await settled(page);

    // La pantalla es suya y se queda: una cuenta sin canal NO puede ser
    // rebotada al panel, que es donde el asistente y el panel se pisaban.
    await expect(page).toHaveURL(/\/admin\/setup-wizard/);
    const main = page.locator("main, [role='main']").first();
    await expect(main).toBeVisible();
    await expect(main.getByRole("heading").first()).toBeVisible();
    // Y el agente sembrado aparece por su nombre, no como "sin configurar".
    await expect(page.getByText("Laura Sofía").first()).toBeVisible();
    await expectHermetic(state);
  });
});
