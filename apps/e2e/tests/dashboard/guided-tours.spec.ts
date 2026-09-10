import { expect, test, type Locator, type Page } from "@playwright/test";
import { GUIDED_TOUR_START_EVENT, type GuidedTourId } from "@parallext/shared";
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
  type HermeticState,
} from "../../fixtures/dashboard-session";

/**
 * The guided tours: start, finish, leave, come back, do it again.
 *
 * A tour is the product's answer to "show me where", and its value rests on one
 * promise it makes twice over: it opens the screen and points at the thing, and
 * it changes nothing while doing it. Both halves are asserted here, because
 * both are the kind of claim only a browser can settle — the unit specs beside
 * `guided-tours.ts` prove every anchor NAME exists somewhere in the source; they
 * cannot prove the element is on screen when the tour points at it.
 *
 * The tenant is a business a few days in: a channel connected, some setup still
 * open. That is when tours are offered, and it is also the only state in which
 * they can run at all — `/admin` sends a brand-new admin to the setup wizard,
 * which is the one route a tour refuses to leave.
 */

const TENANT = "33333333-3333-4333-8333-333333333333";

const routes = () => ({
  ...dashboardShell(TENANT),
  ...handoffDestinations(TENANT),
  ...readyBusiness(TENANT),
  ...pendingAssessment(TENANT),
  [`verticals/${TENANT}`]: ok({
    industry: "salud",
    subType: "clinica_general",
    effectiveCapabilities: ["appointment_booking", "faq_search", "crm_pipeline"],
  }),
  // The screens the tours walk onto.
  [`knowledge/${TENANT}`]: ok({ documents: [], total: 0 }),
  [`business-info/${TENANT}/hours`]: ok({ hours: [] }),
});

/**
 * Anything that would change the business, as opposed to the calls every
 * authenticated page makes regardless: the session heartbeat, the navigation
 * cost counter and the quality snapshot bootstrap.
 */
const CONFIGURATION = /^(persona|business-info|knowledge|appointments|channels|verticals|compliance|catalog|offers|auth\/users|tenant-payments)\b/;

/** The tour card. `aria-modal="false"` on purpose: it explains the page behind it. */
const tourCard = (page: Page): Locator => page.locator("[role='dialog'][aria-modal='false']").first();

/** Starts a tour the way the five surfaces that offer one do. */
async function startTour(page: Page, tourId: GuidedTourId): Promise<void> {
  await page.evaluate(
    ([event, id]) => window.dispatchEvent(new CustomEvent(event as string, { detail: { tourId: id } })),
    [GUIDED_TOUR_START_EVENT, tourId],
  );
}

/** The counter is the only place the run states where it is. */
async function stepCounter(page: Page): Promise<{ step: number; total: number }> {
  const text = await tourCard(page).innerText();
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  expect(match, `no step counter in: ${text.slice(0, 140)}`).not.toBeNull();
  return { step: Number(match![1]), total: Number(match![2]) };
}

/** Clicks through to the end and returns how many steps it took. */
async function finishTour(page: Page, limit = 12): Promise<number> {
  let steps = 0;
  for (let i = 0; i < limit; i += 1) {
    const advance = tourCard(page).getByRole("button", { name: /Siguiente|Listo/ });
    if (!(await advance.count())) break;
    steps += 1;
    await advance.first().click();
    await page.waitForTimeout(500);
    if (!(await tourCard(page).count())) break;
  }
  return steps;
}

async function openReadyDashboard(page: Page): Promise<HermeticState> {
  const state = await hermeticDashboard(page, routes());
  await signIn(page, "tenant_admin");
  await page.goto("/admin");
  await settled(page);
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  return state;
}

test.describe("recorridos guiados", () => {
  test("arranca desde la tarjeta de puesta en marcha, con un clic de una persona", async ({ page }) => {
    // Arrancarlo con el evento sería probar el runner sin probar que alguien
    // pueda llegar a él. La tarjeta es la puerta que el dueño ve el primer día.
    const state = await openReadyDashboard(page);
    const card = page.locator("#tour-target-setup-card");
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: /Mostrarme dónde/ }).first().click();

    await expect(tourCard(page)).toBeVisible();
    expect((await stepCounter(page)).step).toBe(1);
    // Y llegó a la pantalla del paso, en vez de quedarse explicando el inicio.
    await expect(page).toHaveURL(/\/admin\/settings\/business-info/);
    await expectHermetic(state);
  });

  test("se completa hasta el último paso y se cierra sola", async ({ page }) => {
    const state = await openReadyDashboard(page);
    await startTour(page, "help_system");
    await expect(tourCard(page)).toBeVisible();

    const { total } = await stepCounter(page);
    expect(total).toBeGreaterThan(1);
    // El último paso dice "Listo", no "Siguiente": terminar es una decisión con
    // su propia palabra, no un paso más que se pasa de largo.
    expect(await finishTour(page)).toBe(total);
    await expect(tourCard(page)).toHaveCount(0);
    await expectHermetic(state);
  });

  test("no cambia nada de la cuenta mientras explica", async ({ page }) => {
    // La otra mitad de la promesa. Un recorrido que guardara algo estaría
    // cambiando la configuración de un negocio mientras dice que la explica, y
    // el dueño no tendría cómo enterarse.
    const state = await openReadyDashboard(page);
    const before = state.writes.length;
    await startTour(page, "help_system");
    await expect(tourCard(page)).toBeVisible();
    await finishTour(page);
    await expect(tourCard(page)).toHaveCount(0);

    const during = state.writes.slice(before)
      .filter((entry) => CONFIGURATION.test(entry.replace(/^\w+\s+/, "")));
    expect({ during }).toEqual({ during: [] });
  });

  test("se puede cerrar a la mitad, y no reaparece sola", async ({ page }) => {
    const state = await openReadyDashboard(page);
    await startTour(page, "help_system");
    await expect(tourCard(page)).toBeVisible();
    await tourCard(page).getByRole("button", { name: "Siguiente" }).first().click();
    await expect.poll(async () => (await stepCounter(page)).step).toBe(2);

    await tourCard(page).getByRole("button", { name: "Cerrar" }).click();
    await expect(tourCard(page)).toHaveCount(0);

    // Irse y volver no lo reabre: un recorrido cerrado es una respuesta, no una
    // pausa, y reaparecer encima de otra tarea es cómo una ayuda se convierte
    // en una molestia.
    await page.goto("/admin/channels");
    await settled(page);
    await page.waitForTimeout(1500);
    await expect(tourCard(page)).toHaveCount(0);
    await expectHermetic(state);
  });

  test("cruza a la pantalla del paso y sigue ahí, en vez de empezar de nuevo", async ({ page }) => {
    // `connect_channel` empieza en el menú y su siguiente paso vive en
    // `/admin/channels`. Cruzar recarga la aplicación entera, así que "seguir"
    // depende de un registro que sobreviva a eso — y que se consuma, o retomar
    // sería un bucle que se abre solo encima de la siguiente tarea.
    const state = await openReadyDashboard(page);
    await startTour(page, "connect_channel");

    await expect(page).toHaveURL(/\/admin\/channels/, { timeout: 20_000 });
    await expect(tourCard(page)).toBeVisible();
    expect((await stepCounter(page)).step).toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("parallly:tour:resume")))
      .toBeNull();
    await expectHermetic(state);
  });

  test("se puede volver a hacer, desde el primer paso", async ({ page }) => {
    const state = await openReadyDashboard(page);
    await startTour(page, "help_system");
    await expect(tourCard(page)).toBeVisible();
    await finishTour(page);
    await expect(tourCard(page)).toHaveCount(0);

    // Terminarlo no lo gasta. Alguien que lo hizo hace un mes y volvió a la
    // pantalla tiene que poder pedirlo otra vez y verlo entero.
    await startTour(page, "help_system");
    await expect(tourCard(page)).toBeVisible();
    expect((await stepCounter(page)).step).toBe(1);
    await expectHermetic(state);
  });
});
