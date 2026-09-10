import { expect, test, type Page } from "@playwright/test";
import { dashboardShell, handoffDestinations, readyBusiness } from "../../fixtures/dashboard-routes";
import { hermeticDashboard, ok, signIn, type HermeticState } from "../../fixtures/dashboard-session";

/**
 * Coming back from Instagram's authorization screen — the four ways it ends.
 *
 * This window is the only part of an OAuth connection the tenant sees, and it is
 * the part with no second chance: it opens as a popup, it has one job, and
 * whatever it says is what the owner believes about whether their Instagram is
 * connected. Meta is never contacted here; what is under test is the window's
 * own handling of the four shapes of return, and the redirect URI the config
 * publishes already points at this local route, so nothing has to leave.
 *
 * The fourth shape — the exchange that never answers — is the one that had no
 * handling at all. The popup span on a spinner forever: no message, no retry,
 * no hint that it could be closed, and the screen that opened it waiting for a
 * result never posted. It now has a deadline, and says the honest thing: not
 * "it failed", which would be a claim about a connection that may well have
 * gone through, but "we could not confirm it — go and look".
 */

const TENANT = "33333333-3333-4333-8333-333333333333";
const CALLBACK = "/admin/channels/instagram/callback";
const STATE = "e2e-oauth-state-9f2c";
const EXCHANGE = "**/api/v1/channels/instagram/oauth-connect";

const routes = () => ({
  ...dashboardShell(TENANT),
  ...handoffDestinations(TENANT),
  ...readyBusiness(TENANT),
  "channels/instagram/oauth-connect": ok({ connected: true, accountId: "ig-1" }),
  [`verticals/${TENANT}`]: ok({ industry: "salud", subType: "clinica_general", effectiveCapabilities: ["faq_search"] }),
});

/**
 * The popup's side of the conversation with the screen that opened it.
 *
 * `window.opener` is lost as soon as Meta redirects, so the result travels over
 * a BroadcastChannel. Collected from before the page loads, because the window
 * posts and closes in under a second.
 */
async function collectBroadcasts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __oauth: unknown[] }).__oauth = [];
    try {
      const channel = new BroadcastChannel("ig_oauth");
      channel.onmessage = (event) => {
        (window as unknown as { __oauth: unknown[] }).__oauth.push(event.data);
      };
    } catch { /* a browser without BroadcastChannel falls back to a reload */ }
  });
}

const broadcasts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __oauth: unknown[] }).__oauth ?? []);

/** The saved half of the CSRF pair, as the connect button leaves it. */
async function seedOAuthState(page: Page, value: string | null): Promise<void> {
  await page.addInitScript((saved) => {
    if (saved === null) window.localStorage.removeItem("ig_oauth_state");
    else window.localStorage.setItem("ig_oauth_state", saved as string);
  }, value);
}

async function openCallback(page: Page, query: string): Promise<HermeticState> {
  const state = await hermeticDashboard(page, routes());
  await signIn(page, "tenant_admin");
  await page.goto(`${CALLBACK}${query}`);
  return state;
}

test.describe("la vuelta de la autorización de Instagram", () => {
  test("vuelve con el código y cuenta que quedó conectado", async ({ page }) => {
    await collectBroadcasts(page);
    await seedOAuthState(page, STATE);
    const state = await openCallback(page, `?code=auth-code-123&state=${STATE}`);

    await expect(page.getByText("Canal de Instagram conectado correctamente.")).toBeVisible();
    // El código se canjeó exactamente una vez, y la pantalla que abrió la
    // ventana se entera por el canal, no por adivinar que se cerró.
    expect(state.observed.filter((path) => path === "channels/instagram/oauth-connect")).toHaveLength(1);
    await expect.poll(() => broadcasts(page)).toEqual([{ type: "ig_oauth_success" }]);
    // Y el `state` guardado se consume: un segundo intento con el mismo par no
    // puede reutilizar la mitad que quedó en el navegador.
    expect(await page.evaluate(() => window.localStorage.getItem("ig_oauth_state"))).toBeNull();
  });

  test("un error de Meta se muestra tal cual, sin canjear nada", async ({ page }) => {
    await collectBroadcasts(page);
    await seedOAuthState(page, STATE);
    const state = await openCallback(
      page,
      "?error=server_error&error_description=La%20aplicaci%C3%B3n%20no%20est%C3%A1%20disponible",
    );

    await expect(page.getByText("Error al conectar Instagram. Intenta de nuevo.")).toBeVisible();
    await expect(page.getByText("La aplicación no está disponible")).toBeVisible();
    // Sin código no hay nada que canjear, y llamar igual sería un intento con
    // las manos vacías que el API tendría que rechazar.
    expect(state.observed.filter((path) => path.includes("oauth-connect"))).toEqual([]);
    await expect.poll(() => broadcasts(page)).toEqual([
      { type: "ig_oauth_error", message: "La aplicación no está disponible" },
    ]);
  });

  test("si la persona cancela, lo dice como cancelación y no como falla nuestra", async ({ page }) => {
    await collectBroadcasts(page);
    await seedOAuthState(page, STATE);
    const state = await openCallback(
      page,
      "?error=access_denied&error_reason=user_denied&error_description=Permisos%20no%20otorgados",
    );

    await expect(page.getByText("Permisos no otorgados")).toBeVisible();
    expect(state.observed.filter((path) => path.includes("oauth-connect"))).toEqual([]);
    // La ventana se cierra igual: quedarse abierta después de una cancelación
    // deliberada es pedirle a la persona que cierre dos veces lo mismo.
    await expect.poll(() => broadcasts(page)).toHaveLength(1);
  });

  test("un state que no coincide se rechaza antes de canjear el código", async ({ page }) => {
    // La mitad de seguridad del par. Sin esto, un enlace preparado por otro
    // canjearía un código en la cuenta de quien lo abra.
    await collectBroadcasts(page);
    await seedOAuthState(page, "otro-state");
    const state = await openCallback(page, `?code=auth-code-123&state=${STATE}`);

    await expect(page.getByText(/CSRF/)).toBeVisible();
    expect(state.observed.filter((path) => path.includes("oauth-connect"))).toEqual([]);
  });

  test("un canje que nunca contesta deja de girar y dice qué hacer", async ({ page }) => {
    await collectBroadcasts(page);
    await seedOAuthState(page, STATE);
    const state = await hermeticDashboard(page, routes());
    // Registrada DESPUÉS del guard, así que gana: el canje sale y no vuelve.
    let asked = 0;
    await page.route(EXCHANGE, () => { asked += 1; /* nunca se responde */ });
    await signIn(page, "tenant_admin");
    // El reloj se adelanta en vez de esperar veinte segundos reales: la espera
    // es del producto, no de la suite.
    await page.clock.install();
    await page.goto(`${CALLBACK}?code=auth-code-123&state=${STATE}`);

    await expect(page.getByText("Conectando Instagram...")).toBeVisible();
    await expect.poll(() => asked).toBe(1);
    await page.clock.runFor(21_000);

    await expect(page.getByText(/No pudimos confirmar la conexión a tiempo/)).toBeVisible();
    // Y lo que se le dice a la pantalla de atrás es lo mismo que se le muestra
    // a la persona: un error con el motivo, no un silencio.
    await expect.poll(() => broadcasts(page)).toEqual([
      { type: "ig_oauth_error", message: expect.stringContaining("No pudimos confirmar") },
    ]);
    expect(state.productionRequests).toEqual([]);
  });

  test("recargar no vuelve a canjear el código, y lo dice en vez de girar", async ({ page }) => {
    // Un código de OAuth se gasta una vez. Recargar la ventana no puede volver
    // a pedirlo — y tampoco puede quedarse girando: antes el guardia devolvía
    // en silencio y la ventana no decía nunca más nada.
    await collectBroadcasts(page);
    await seedOAuthState(page, STATE);
    const state = await openCallback(page, `?code=auth-code-123&state=${STATE}`);
    await expect(page.getByText("Canal de Instagram conectado correctamente.")).toBeVisible();

    await page.reload();
    await expect(page.getByText(/Esta autorización ya se usó/)).toBeVisible();
    expect(state.observed.filter((path) => path === "channels/instagram/oauth-connect")).toHaveLength(1);
  });
});
