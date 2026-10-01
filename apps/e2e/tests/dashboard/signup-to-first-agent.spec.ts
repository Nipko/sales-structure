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
  // AuthContext refreshes the current user when the onboarding screen opens.
  // Keep the tenantless identity that this public-wizard fixture seeded.
  "auth/me": ok(NEW_USER),
  // The catalogue the fourth step renders. Every field the card reads is here
  // on purpose: the plan columns are NOT NULL in the schema, so a fixture
  // missing one would be testing a shape the API cannot produce — and the card
  // would print `NaN` where a number belongs.
  "billing/public/market": ok({ country: "CO", provider: "wompi", source: "edge", supportedCountries: ["CO", "US"] }),
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

const preparedAgentRoutes = (): ApiRoutes => ({
  ...dashboardShell(TENANT),
  ...verticalCatalog(),
  [`verticals/${TENANT}`]: ok({
    industry: "salud", subType: "medica_general",
    effectiveCapabilities: ["appointment_booking", "faq_search", "crm_pipeline"],
  }),
  [`persona/${TENANT}/setup-status`]: ok({
    onboardingStage: "account_created", hasAnyChannel: false, connectedChannelTypes: [],
    setupWizardCompleted: false, hasPersona: true,
    defaultAgent: { id: AGENT, name: "Laura Sofía", templateId: "appointment_scheduler" },
    defaultAgentTemplateId: "appointment_scheduler", timezone: "America/Bogota",
  }),
  "persona/templates": ok([
    { id: "appointment_scheduler", name: "Agenda de citas", description: "Agenda y confirma." },
  ]),
  [`persona/${TENANT}/agents/${AGENT}/configuration`]: ok({
    agentId: AGENT,
    operational: {
      version: 1, hash: "e2e-hash",
      body: {
        name: "Laura Sofía",
        configJson: { persona: { name: "Laura Sofía", greeting: "Hola, soy Laura de Clínica Aurora." } },
      },
    },
    draft: null, evaluationRevisionId: null,
  }),
  [`persona/${TENANT}/agents`]: ok([
    { id: AGENT, name: "Laura Sofía", isActive: true, templateId: "appointment_scheduler", channelBindings: [] },
  ]),
});

/** Signed in but tenantless, which is what the onboarding wizard runs as. */
async function seedNewAccount(page: Page): Promise<void> {
  await page.addInitScript((user) => {
    // A full page navigation after completion must retain the tenant the server just created.
    if (window.localStorage.getItem("accessToken")) return;
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

const advance = (page: Page) => page.locator("#onboarding-next-button");
const coach = (page: Page) => page.locator("[data-onboarding-coach-mark]");

/** Read painted geometry: a visible help card must leave every form label and control usable. */
async function expectHelpDoesNotCoverFields(page: Page): Promise<void> {
  await expect(coach(page)).toBeVisible();
  await expect.poll(() => coach(page).evaluate((help) => {
    const card = help.getBoundingClientRect();
    return [...document.querySelectorAll("label, input, select, textarea, button")]
      .filter((element) => !help.contains(element))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          && Math.min(card.right, rect.right) - Math.max(card.left, rect.left) > 1
          && Math.min(card.bottom, rect.bottom) - Math.max(card.top, rect.top) > 1;
      })
      .map((element) => element.id || element.textContent?.trim().slice(0, 80));
  })).toEqual([]);
}

async function openNewOnboarding(page: Page): Promise<HermeticState> {
  const state = await hermeticDashboard(page, publicRoutes());
  await seedNewAccount(page);
  await page.goto("/onboarding");
  await expect(page.locator("#onboarding-company-name")).toBeVisible();
  return state;
}

/** The labels of the checkboxes on the current step, in order. */
async function choices(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll("input[type=checkbox]")]
    .map((box) => {
      const input = box as HTMLInputElement;
      return (input.labels?.[0]?.textContent ?? "").replace(/\s+/g, " ").trim();
    }));
}

test.describe("del alta al primer agente", () => {
  test("la ayuda sigue el campo y sus consejos dejan el formulario visible", async ({ page }, testInfo) => {
    const state = await openNewOnboarding(page);
    await expect(coach(page)).toHaveAttribute("data-onboarding-coach-mark", "name");
    await expectHelpDoesNotCoverFields(page);

    await page.locator("#onboarding-company-name").fill("Clínica Aurora");
    await coach(page).getByRole("button", { name: "Siguiente consejo", exact: true }).click();
    await expect(coach(page)).toHaveAttribute("data-onboarding-coach-mark", "industry");
    await expect(page.locator("#onboarding-industry")).toBeFocused();
    await expect(page.locator("#onboarding-industry")).toBeInViewport();
    await page.locator("#onboarding-industry").selectOption("salud");
    await expect(page.locator("#onboarding-subtype")).toBeVisible();
    await expectHelpDoesNotCoverFields(page);

    await coach(page).getByRole("button", { name: "Siguiente consejo", exact: true }).click();
    await expect(coach(page)).toHaveAttribute("data-onboarding-coach-mark", "subtype");
    await page.locator("#onboarding-subtype").selectOption("medica_general");
    await coach(page).getByRole("button", { name: "Siguiente consejo", exact: true }).click();

    const about = page.locator("#onboarding-company-about");
    await expect(coach(page)).toHaveAttribute("data-onboarding-coach-mark", "about");
    await expect(about).toBeFocused();
    await expect(about).toBeInViewport();
    await about.fill("Consultas generales y controles para familias.");
    await expect(about).toBeFocused();
    await expectHelpDoesNotCoverFields(page);
    await page.screenshot({ path: testInfo.outputPath("onboarding-help-about.png"), fullPage: true });

    const initialViewport = page.viewportSize();
    for (const viewport of [{ width: 320, height: 640 }, { width: 640, height: 512 }]) {
      await page.setViewportSize(viewport);
      await expectHelpDoesNotCoverFields(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth
        <= document.documentElement.clientWidth + 1)).toBe(true);
      await expect(about).toBeFocused();
    }
    await page.screenshot({ path: testInfo.outputPath("onboarding-help-short-viewport.png"), fullPage: true });
    if (initialViewport) await page.setViewportSize(initialViewport);

    // The real textarea is resizable: changing its painted height must move the help with it.
    await about.evaluate((element) => { element.style.height = "280px"; });
    await expectHelpDoesNotCoverFields(page);
    await page.locator("#onboarding-orgsize").focus();
    await expect(coach(page)).toHaveAttribute("data-onboarding-coach-mark", "orgSize");
    await expect(page.locator("#onboarding-orgsize")).toBeFocused();
    await coach(page).getByRole("button", { name: "Consejo anterior", exact: true }).click();
    await expect(coach(page)).toHaveAttribute("data-onboarding-coach-mark", "about");
    await expect(about).toBeFocused();
    await expectHelpDoesNotCoverFields(page);

    await coach(page).getByRole("button", { name: "Cerrar ayuda", exact: true }).click();
    await expect(coach(page)).toHaveCount(0);
    await page.reload();
    await expect(about).toHaveValue("Consultas generales y controles para familias.");
    await expect(coach(page)).toHaveCount(0);
    await expectHermetic(state);
  });

  test("los campos requeridos bloquean avanzar y volver conserva el borrador y el contexto", async ({ page }) => {
    const state = await openNewOnboarding(page);
    await expect(advance(page)).toBeDisabled();
    await page.locator("#onboarding-company-name").fill("Clínica Aurora");
    await page.locator("#onboarding-industry").selectOption("salud");
    await page.locator("#onboarding-orgsize").selectOption("1-10");
    await expect(advance(page)).toBeDisabled();
    await page.locator("#onboarding-company-about").fill("Consultas generales y controles.");
    await expect(advance(page)).toBeDisabled();
    await page.locator("#onboarding-subtype").selectOption("medica_general");
    await expect(advance(page)).toBeEnabled();

    await page.locator("#onboarding-company-about").focus();
    await expect(coach(page)).toHaveAttribute("data-onboarding-coach-mark", "about");
    await advance(page).click();
    const audienceHeading = page.getByRole("heading", { name: "Tus clientes", exact: true });
    await expect(audienceHeading).toBeFocused();
    await expect(audienceHeading).toBeInViewport();
    await expect(coach(page)).toHaveCount(0);
    await expect(advance(page)).toBeDisabled();
    await page.getByRole("checkbox").first().check();
    await advance(page).click();
    await expect(page.getByRole("heading", { name: /Qué quieres lograr/ })).toBeFocused();
    await expect(advance(page)).toBeDisabled();
    await page.getByRole("checkbox").first().check();

    await page.getByRole("button", { name: "Atrás", exact: true }).click();
    await expect(audienceHeading).toBeFocused();
    await expect(audienceHeading).toBeInViewport();
    await expect(page.getByRole("checkbox").first()).toBeChecked();
    await page.getByRole("button", { name: "Atrás", exact: true }).click();
    await expect(page.locator("#onboarding-step-heading")).toBeFocused();
    await expect(page.locator("#onboarding-step-heading")).toBeInViewport();
    await expect(page.locator("#onboarding-company-name")).toHaveValue("Clínica Aurora");
    await expect(page.locator("#onboarding-subtype")).toHaveValue("medica_general");
    await expect(page.locator("#onboarding-company-about")).toHaveValue("Consultas generales y controles.");
    await expect(coach(page)).not.toHaveAttribute("data-onboarding-coach-mark", "name");

    await advance(page).click();
    await page.reload();
    await expect(audienceHeading).toBeVisible();
    await expect(page.getByRole("checkbox").first()).toBeChecked();
    await advance(page).click();
    await expect(page.getByRole("checkbox").first()).toBeChecked();
    expect(state.writes.filter((path) => path.includes("complete-onboarding"))).toEqual([]);
    await expectHermetic(state);
  });

  test("un borrador avanzado sin subtipo vuelve a los datos que faltan", async ({ page }) => {
    await page.addInitScript(({ userId }) => {
      localStorage.setItem(`parallly:onboarding:draft:${userId}`, JSON.stringify({
        savedAt: Date.now(), step: 3,
        companyName: "Inmobiliaria Aurora", industry: "inmobiliaria", subType: "",
        orgSize: "1-10", about: "Alquiler y venta de viviendas.",
        timezone: "America/Bogota", audiences: ["families"], goals: ["sales"],
      }));
    }, { userId: NEW_USER.id });
    const state = await openNewOnboarding(page);
    await expect(page.getByRole("heading", { name: "Tu empresa", exact: true })).toBeVisible();
    await expect(page.locator("#onboarding-company-name")).toHaveValue("Inmobiliaria Aurora");
    await expect(page.locator("#onboarding-industry")).toHaveValue("inmobiliaria");
    await expect(page.locator("#onboarding-company-about")).toHaveValue("Alquiler y venta de viviendas.");
    await expect(page.locator("#onboarding-subtype")).toHaveValue("");
    await expect(advance(page)).toBeDisabled();
    await expect(page.getByRole("heading", { name: /Elige tu plan/ })).toHaveCount(0);
    expect(state.writes.filter((path) => path.includes("complete-onboarding"))).toEqual([]);
    await expectHermetic(state);
  });

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

  test("un correo ya registrado conserva lo escrito y permite corregirlo", async ({ page }) => {
    const state = await hermeticDashboard(page, {
      ...publicRoutes(),
      "auth/signup": {
        status: 409,
        body: { success: false, error: "email_taken" },
      },
    });
    await page.goto("/signup");
    await page.getByLabel(/Nombre/).fill("Ana");
    await page.getByLabel(/Apellido/).fill("Rivas");
    await page.getByLabel(/Email/).fill(NEW_USER.email);
    await page.getByLabel(/Contraseña/).fill("Contrasena-Fuerte-9");
    await page.getByRole("button", { name: /Crear cuenta/ }).click();
    await expect(page.getByText("Ese correo ya tiene una cuenta.")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel(/Nombre/)).toHaveValue("Ana");
    await expect(page.getByLabel(/Apellido/)).toHaveValue("Rivas");
    await expect(page.getByLabel(/Contraseña/)).toHaveValue("Contrasena-Fuerte-9");
    expect(await page.evaluate(() => localStorage.getItem("accessToken"))).toBeNull();

    const correctedRequests: unknown[] = [];
    await page.route("**/api/v1/auth/signup", (route) => {
      correctedRequests.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ok({
          accessToken: "e2e.access.token", refreshToken: "e2e.refresh.token",
          verificationEmailSent: true, user: NEW_USER,
        }).body),
      });
    });
    await page.getByLabel(/Email/).fill("ana.nueva@clinica.test");
    await page.getByRole("button", { name: /Crear cuenta/ }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.locator("#onboarding-company-name")).toBeVisible();
    expect(correctedRequests).toEqual([expect.objectContaining({ email: "ana.nueva@clinica.test" })]);
    await expectHermetic(state);
  });

  test("el código de correo cabe en el teléfono y retoma la cuenta existente", async ({ page }, testInfo) => {
    let verified = false;
    const verificationRequests: unknown[] = [];
    const pendingUser = { ...TENANTED_USER, onboardingStage: "channel_deferred" };
    const state = await hermeticDashboard(page, {
      ...dashboardShell(TENANT),
      ...verticalCatalog(),
      "auth/me": () => ok({
        ...pendingUser,
        emailVerified: verified,
        onboardingStage: verified ? "account_created" : "channel_deferred",
      }),
      [`persona/${TENANT}/setup-status`]: ok({
        onboardingStage: "account_created", hasAnyChannel: false,
        connectedChannelTypes: [], setupWizardCompleted: false, hasPersona: false,
      }),
    });
    await page.route("**/api/v1/auth/verify-email", (route) => {
      verificationRequests.push(route.request().postDataJSON());
      verified = true;
      return route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify(ok({ verified: true }).body),
      });
    });
    await page.addInitScript((user) => {
      localStorage.setItem("accessToken", "e2e.access.token");
      localStorage.setItem("refreshToken", "e2e.refresh.token");
      localStorage.setItem("user", JSON.stringify(user));
      localStorage.setItem("activeTenantId", user.tenantId);
    }, pendingUser);
    await page.goto("/verify-email");

    const inputs = page.getByRole("textbox", { name: /^Dígito \d del código de verificación$/ });
    await expect(inputs).toHaveCount(6);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 740 });
      const dimensions = await inputs.evaluateAll((elements) => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        inputs: elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        }),
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
      expect(dimensions.inputs.every((input) => input.left >= 0 && input.right <= width && input.width > 20)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath("verify-email-mobile.png"), fullPage: true });

    for (let index = 0; index < 6; index++) {
      await inputs.nth(index).fill(String(index + 1));
      if (index < 5) await expect(inputs.nth(index + 1)).toBeFocused();
    }
    await expect(page).toHaveURL(/\/admin\/setup-wizard$/);
    expect(verificationRequests).toEqual([{ code: "123456" }]);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("user") || "{}")))
      .toMatchObject({ tenantId: TENANT, emailVerified: true, onboardingStage: "account_created" });
    await expect(page.locator("#onboarding-company-name")).toHaveCount(0);
    await expect(page.getByText(/Tu correo .* todavía no está verificado/)).toHaveCount(0);
    await expectHermetic(state);
  });

  test("elegir el rubro cambia lo que el asistente pregunta después", async ({ page }) => {
    // La tesis entera de las verticales, en una pantalla: si la industria no
    // cambia las preguntas, el rubro es una etiqueta y no una configuración.
    const state = await openNewOnboarding(page);

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
    const state = await openNewOnboarding(page);

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
    // El cuerpo del alta, capturado tal como sale del navegador: es el único
    // punto donde se puede comprobar que el rubro, el subtipo y los objetivos
    // llegan juntos y sin traducción de por medio.
    const sent: unknown[] = [];
    const state = await hermeticDashboard(page, {
      ...preparedAgentRoutes(),
      ...publicRoutes(),
      "auth/me": () => ok(sent.length ? TENANTED_USER : NEW_USER),
    });
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
    await expect(page.locator("#onboarding-company-name")).toBeVisible();

    await describeBusiness(page, "salud", "medica_general");
    await advance(page).click();
    await expect(page.getByRole("heading", { name: "Tus clientes" })).toBeVisible();
    await page.getByRole("checkbox").first().check();
    await advance(page).click();

    await expect(page.getByRole("heading", { name: /Qué quieres lograr/ })).toBeVisible();
    const goals = await choices(page);
    expect(goals.length).toBeGreaterThan(1);
    await page.getByRole("checkbox").first().check();
    await advance(page).click();

    // El cuarto paso: el plan con el que arranca la prueba. Sale del catálogo
    // vigente, no de una lista escrita en la pantalla.
    await expect(page.getByRole("heading", { name: /Elige tu plan/ })).toBeVisible();
    await expect(page.getByText("Emprendedor")).toBeVisible();
    await expect(page.getByText(/Wompi|Stripe|DIAN/)).toHaveCount(0);
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
    await expect(page).toHaveURL(/\/admin\/setup-wizard$/);
    await expect(page.getByText("Laura Sofía").first()).toBeVisible();
    await expectHermetic(state);
  });

  test("el asistente recibe el agente preparado y conserva el canal pendiente al terminar", async ({ page }, testInfo) => {
    // El final del recorrido: la cuenta existe, el rubro está elegido, y lo que
    // el dueño encuentra no es un formulario en blanco sino un agente sembrado
    // con su plantilla, su misión y sus herramientas — al que sólo le falta el
    // canal por el que va a atender.
    const state = await hermeticDashboard(page, preparedAgentRoutes());
    const progressWrites: unknown[] = [];
    await page.route(`**/api/v1/persona/${TENANT}/setup-wizard`, async (route) => {
      progressWrites.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, data: { saved: true } }),
      });
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

    const stepHeading = page.locator("#setup-wizard-step-heading");
    await page.getByRole("button", { name: "Siguiente", exact: true }).click();
    await expect(stepHeading).toHaveText("¿Por dónde te escriben tus clientes?");
    await expect(stepHeading).toBeFocused();
    await expect(stepHeading).toBeInViewport();
    await page.getByRole("button", { name: "Anterior", exact: true }).click();
    await expect(stepHeading).toHaveText("Tu agente");
    await expect(stepHeading).toBeFocused();
    await expect(stepHeading).toBeInViewport();
    await expect(page.getByText("Laura Sofía").first()).toBeVisible();
    await page.getByRole("button", { name: "Siguiente", exact: true }).click();
    await page.getByRole("button", { name: "Conectar después", exact: true }).click();
    await expect(stepHeading).toHaveText("Configuración inicial guardada");
    await expect(stepHeading).toBeFocused();
    await expect(stepHeading).toBeInViewport();
    await expect(page.locator("[data-channel-outcome='no_channel']")).toHaveText(/conectar WhatsApp/);
    expect(progressWrites).toEqual([expect.objectContaining({
      stageOnly: true, stage: "channel_deferred", markCompleted: false,
      channelConnectSkippedAt: expect.any(String),
    })]);
    await page.screenshot({ path: testInfo.outputPath("setup-channel-pending.png"), fullPage: true });
    await expectHermetic(state);
  });
});
