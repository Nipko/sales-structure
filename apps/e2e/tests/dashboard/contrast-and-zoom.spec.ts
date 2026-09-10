import { expect, test, type Page } from "@playwright/test";
import {
  dashboardShell,
  handoffDestinations,
  pendingAssessment,
  readyBusiness,
} from "../../fixtures/dashboard-routes";
import { hermeticDashboard, ok, settled, signIn } from "../../fixtures/dashboard-session";

/**
 * Two things a person needs before anything else: to be able to read the text,
 * and to be able to use the page when it is magnified.
 *
 * Neither is a preference. Contrast below 4.5:1 is unreadable to a large share
 * of people over forty in ordinary daylight, and a layout that scrolls sideways
 * at 320px is a layout that cannot be zoomed — the two most common accessibility
 * failures on the web, and the two nobody notices while building on a big bright
 * screen.
 *
 * axe is loaded from the repo's own `axe-core`, injected into the page. No new
 * dependency and no network: the same engine the dashboard's jsdom specs use,
 * run against a real browser where the computed colours are the real ones.
 * Only the contrast rule is enabled here; the broader sweep belongs to the
 * component specs, and mixing them would make one failure hide the other.
 */

const AXE = require.resolve("axe-core/axe.min.js");
const TENANT = "33333333-3333-4333-8333-333333333333";

const routes = () => ({
  ...dashboardShell(TENANT),
  ...handoffDestinations(TENANT),
  ...readyBusiness(TENANT),
  ...pendingAssessment(TENANT),
  [`verticals/${TENANT}`]: ok({
    industry: "salud", subType: "clinica_general",
    effectiveCapabilities: ["appointment_booking", "faq_search", "crm_pipeline"],
  }),
});

interface ContrastViolation {
  target: string;
  ratio: string;
  colors: string;
  html: string;
}

/** Every text node axe judges unreadable, named so a failure is actionable. */
async function contrastViolations(page: Page): Promise<ContrastViolation[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<any> } }).axe;
    const results = await axe.run(document, {
      runOnly: { type: "rule", values: ["color-contrast"] },
      // The assistant bubble animates its own opacity, and axe reads a
      // mid-transition colour as a contrast failure that no one ever sees.
      rules: { "color-contrast": { enabled: true } },
    });
    return results.violations.flatMap((violation: any) => violation.nodes.map((node: any) => ({
      target: String(node.target?.[0] ?? "?").slice(0, 120),
      ratio: String(node.any?.[0]?.data?.contrastRatio ?? "?"),
      colors: `${node.any?.[0]?.data?.fgColor ?? "?"} on ${node.any?.[0]?.data?.bgColor ?? "?"}`,
      html: String(node.html ?? "").replace(/\s+/g, " ").slice(0, 160),
    })));
  });
}

/** True when the page itself scrolls sideways — the reflow failure (WCAG 1.4.10). */
async function scrollsSideways(page: Page): Promise<{ scroll: number; client: number }> {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
}

async function openDashboard(page: Page) {
  const state = await hermeticDashboard(page, routes());
  await signIn(page, "tenant_admin");
  await page.goto("/admin");
  await settled(page);
  // The assistant bubble slides in on load; measuring mid-animation reports a
  // colour that exists for 200ms and never again, which is how a contrast run
  // becomes flaky rather than informative.
  await page.waitForTimeout(2500);
  return state;
}

test.describe("se puede leer, y se puede agrandar", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`el panel no tiene texto ilegible en modo ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openDashboard(page);
      expect(await contrastViolations(page)).toEqual([]);
    });
  }

  test("la pantalla de acceso tampoco, que es la primera que se ve", async ({ page }) => {
    await hermeticDashboard(page, routes());
    await page.goto("/login");
    await settled(page);
    await page.waitForTimeout(600);
    expect(await contrastViolations(page)).toEqual([]);
  });

  test("a 320px de ancho la página no se va de lado", async ({ page }) => {
    // 320 CSS px es el ancho de referencia de WCAG 1.4.10: es lo que queda de
    // una pantalla de 1280 al 400% de zoom, y es también un teléfono chico.
    // Una página que se va de lado ahí obliga a leer en dos direcciones.
    await page.setViewportSize({ width: 320, height: 640 });
    await openDashboard(page);
    const { scroll, client } = await scrollsSideways(page);
    // Un píxel de margen por el redondeo del subpíxel, no por tolerancia.
    expect({ scroll, overflowing: scroll > client + 1 }).toEqual({ scroll, overflowing: false });
  });

  test("al doble de tamaño sigue siendo usable, sin scroll horizontal", async ({ page }) => {
    // 200% de zoom (WCAG 1.4.4) emulado como la mitad del viewport: el
    // navegador ve los mismos CSS px que a 1280 con el zoom al 200%.
    await page.setViewportSize({ width: 640, height: 512 });
    await openDashboard(page);

    const { scroll, client } = await scrollsSideways(page);
    expect({ scroll, overflowing: scroll > client + 1 }).toEqual({ scroll, overflowing: false });
    // Y lo principal sigue estando: una página que "entra" porque escondió su
    // propia navegación no pasa esta prueba, la esquiva.
    await expect(page.getByRole("button", { name: /Asistente de [Aa]yuda/ })).toBeVisible();
    await expect(page.locator("main, [role='main']").first()).toBeVisible();
  });

  test("el asistente abierto tampoco empuja la página de lado", async ({ page }) => {
    // El panel es un sobre de 380px que se fija a la derecha. En un teléfono
    // ocupa el ancho entero, y ahí es donde un `fixed` mal medido saca la
    // página de cuadro sin que nadie lo vea en el escritorio.
    await page.setViewportSize({ width: 320, height: 640 });
    await openDashboard(page);
    await page.getByRole("button", { name: /Asistente de [Aa]yuda/ }).click();
    await expect(page.locator("[role='dialog']").first()).toBeVisible();
    await page.waitForTimeout(800);

    const { scroll, client } = await scrollsSideways(page);
    expect({ scroll, overflowing: scroll > client + 1 }).toEqual({ scroll, overflowing: false });
  });
});
