import { expect, test, type Page } from "@playwright/test";
import {
  AGENT_HANDOFF_RETURN_PARAM,
  buildAgentHandoff,
  routedAgentOperations,
  type AgentRoutedOperation,
} from "@parallext/shared";
import { dashboardShell, handoffDestinations } from "../../fixtures/dashboard-routes";
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
 * The eight things Parallly Assist will never do itself.
 *
 * They are declared as handoffs rather than operations because each one either
 * needs a secret, grants a privilege, or reaches the tenant's own customers.
 * Assist collects what is not a secret, then opens the screen that decides.
 *
 * The promise is the whole product here: an assistant that sends the owner to a
 * screen the panel then bounces them off is worse than one that says "I can't".
 * And that is exactly what happened — the handoff list went to the model
 * filtered by neither the caller's role nor the tenant's vertical, so an inbox
 * agent was told to open `/admin/users` and a restaurant to open
 * `/admin/appointments`. `roles.ts` denies by default and the layout hides a
 * vertical surface the capabilities do not include, so both trips ended back at
 * the setup wizard.
 *
 * The contract specs beside `roles.ts` and the vertical resolver now hold both
 * halves as data. What only a browser can add is the last claim in the chain:
 * that the screen actually opens, renders its own heading, and asks for nothing
 * nobody declared.
 */

const TENANT = "33333333-3333-4333-8333-333333333333";

/** Everything the eight destinations need, and nothing the shell already has. */
const routes = (capabilities: readonly string[]): ApiRoutes => ({
  ...dashboardShell(TENANT),
  ...handoffDestinations(TENANT),
  // The one answer that decides whether a vertical screen exists for this
  // business. Without `manifestVersion` the resolver applies no subtype route
  // filter, so what is enabled is exactly this list — which is what makes the
  // capability the single variable under test.
  [`verticals/${TENANT}`]: ok({
    industry: "salud",
    subType: "clinica_general",
    effectiveCapabilities: capabilities,
  }),
});

const EVERY_CAPABILITY = ["appointment_booking", "course_enrollment", "faq_search", "crm_pipeline"];

/**
 * The narrowest tenant role the operation declares.
 *
 * Narrowest rather than `tenant_admin`, because an admin passes every rule and
 * would hide precisely the mistake worth catching: an operation offered to a
 * supervisor or an agent whose screen only admins can open.
 */
const NARROW_FIRST: readonly DashboardRole[] = ["tenant_agent", "tenant_supervisor", "tenant_admin"];
const narrowestRole = (operation: AgentRoutedOperation): DashboardRole =>
  NARROW_FIRST.find((role) => operation.roles.includes(role as never))!;

/**
 * A role the SCREEN refuses, which is not the same as a role the operation
 * refuses.
 *
 * `agenda.availability.replace` is admin-and-supervisor because replacing a
 * whole availability set is destructive — but its screen, `/admin/appointments`,
 * is open to agents, who book on it all day. Routing cannot express "this
 * person may open the screen but not press that button", and asserting a bounce
 * there would be asserting a redirect the product should never do.
 *
 * So the refused role is computed per ROUTE: one no operation on that route
 * admits. That is exactly the set the panel turns away.
 */
function refusedRole(route: string): DashboardRole | null {
  const admitted = new Set(routedAgentOperations()
    .filter((operation) => operation.route === route)
    .flatMap((operation) => operation.roles as readonly string[]));
  return NARROW_FIRST.find((role) => !admitted.has(role)) ?? null;
}

/** The screen opened, it is this screen, and it says what it is. */
async function expectScreenOpened(page: Page, route: string, state: HermeticState) {
  await settled(page);
  expect(page.url()).toContain(route);
  const main = page.locator("main, [role='main']").first();
  await expect(main).toBeVisible();
  // A heading, not just a landmark: a redirect that happens to keep the URL
  // would still leave an empty frame, and an empty frame is what "the assistant
  // sent me nowhere" looks like from the owner's side.
  const heading = main.getByRole("heading").first();
  await expect(heading).toBeVisible();
  expect((await heading.innerText()).trim().length).toBeGreaterThan(0);
  await expectHermetic(state);
}

/** The panel refused, and said so by moving the person somewhere real. */
async function expectBouncedOff(page: Page, route: string) {
  await settled(page);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
    .not.toBe(route);
  // Somewhere real, not the login screen: being denied one screen is not a
  // reason to lose the session.
  expect(new URL(page.url()).pathname).not.toContain("/login");
}

test.describe("las ocho pantallas a las que Assist deriva", () => {
  for (const operation of routedAgentOperations()) {
    const role = narrowestRole(operation);

    test(`${operation.key} abre ${operation.route} para ${role}`, async ({ page }) => {
      const state = await hermeticDashboard(page, routes(EVERY_CAPABILITY));
      await signIn(page, role);
      await page.goto(operation.route);
      await expectScreenOpened(page, operation.route, state);
    });

    const denied = refusedRole(operation.route);
    if (denied) {
      test(`${operation.key} no le abre ${operation.route} a ${denied}`, async ({ page }) => {
        const state = await hermeticDashboard(page, routes(EVERY_CAPABILITY));
        await signIn(page, denied);
        await page.goto(operation.route);
        await expectBouncedOff(page, operation.route);
        expect(state.productionRequests).toEqual([]);
      });
    }

    if (operation.requiresCapability) {
      test(`${operation.key} no le abre ${operation.route} a un rubro sin ${operation.requiresCapability}`, async ({ page }) => {
        // Mismo rol, misma pantalla, y lo único distinto es el rubro del
        // negocio. Es el caso que hacía que el dueño de un restaurante
        // terminara en el asistente de puesta en marcha por seguir un consejo.
        const without = EVERY_CAPABILITY.filter((capability) => capability !== operation.requiresCapability);
        const state = await hermeticDashboard(page, routes(without));
        await signIn(page, role);
        await page.goto(operation.route);
        await expectBouncedOff(page, operation.route);
        expect(state.productionRequests).toEqual([]);
      });
    }
  }

  test("el enlace que arma Assist llega preconfigurado, y la vuelta abre el chat sin quedar pegada", async ({ page }) => {
    // El viaje completo, no la ruta suelta: Assist arma el enlace con lo que
    // preguntó —qué canal—, la pantalla lo lee y destaca esa tarjeta, y al
    // llegar se reabre el chat para verificar cómo quedó. La marca de vuelta se
    // consume al entrar: si sobreviviera, recargar o compartir el enlace
    // reabriría un chat por un viaje que ya ocurrió.
    const built = buildAgentHandoff("channels.account.connect", { channelType: "telegram" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const state = await hermeticDashboard(page, routes(EVERY_CAPABILITY));
    await signIn(page, "tenant_admin");
    await page.goto(built.plan.href);
    await settled(page);
    expect(page.url()).toContain("/admin/channels");

    // La tarjeta que Assist preguntó, destacada.
    await expect(page.locator("[data-channel-focus='true']")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("type")).toBe("telegram");
    // Y la marca, consumida.
    await expect.poll(() => new URL(page.url()).searchParams.get(AGENT_HANDOFF_RETURN_PARAM))
      .toBeNull();

    // El chat de vuelta, con la pregunta ya escrita: el dueño no tiene que
    // acordarse de qué fue a hacer para que Assist pueda verificarlo.
    const panel = page.locator("[role='dialog']").first();
    await expect(panel).toBeVisible();
    await expect(panel.locator("textarea, input[type='text']").first())
      .toHaveValue(/channels\.account\.connect/);

    // Mientras el panel está abierto, la pantalla de atrás sale del árbol de
    // accesibilidad y el foco no se escapa a ella. Es lo que hace que un lector
    // de pantalla lea el chat y no las 35 cosas que quedaron debajo.
    const escaped = await page.evaluate(() => {
      const hidden = [...document.querySelectorAll('[aria-hidden="true"]')];
      return hidden.some((node) => node.contains(document.activeElement));
    });
    expect(escaped).toBe(false);
    await expect(page.locator("main, [role='main']").first().getByRole("heading").first())
      .toHaveCount(0);

    await expectHermetic(state);
  });
});
