import { expect, test, type Page } from "@playwright/test";
import {
  dashboardShell,
  handoffDestinations,
  pendingAssessment,
  readyBusiness,
} from "../../fixtures/dashboard-routes";
import { expectHermetic, hermeticDashboard, ok, settled, signIn } from "../../fixtures/dashboard-session";

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
  test("el modal de servicio permite recorrer, guardar y reabrir una visita online en una pantalla baja", async ({ page, isMobile }, testInfo) => {
    await page.setViewportSize({ width: isMobile ? 320 : 1280, height: 548 });
    const state = await hermeticDashboard(page, {
      ...routes(),
      [`tenants/${TENANT}/regional/profile`]: ok({
        operatingCurrency: { value: "COP", source: "declared" },
      }),
    });
    const serviceId = "88888888-8888-4888-8888-888888888888";
    const writes: Array<{ method: string; body: Record<string, unknown> }> = [];
    let saved: Record<string, unknown> | null = null;
    await page.route(new RegExp(`/api/v1/appointments/${TENANT}/services(?:/[^/?]+)?(?:\\?.*)?$`), async (route) => {
      const method = route.request().method();
      if (method === "POST" || method === "PUT") {
        const body = route.request().postDataJSON();
        writes.push({ method, body });
        // Echo the API's service shape on the subsequent list read, so the
        // reopened editor proves that the real catalogue mapper kept its terms.
        saved = { ...saved, ...body, id: serviceId, isActive: true, durationMinutes: body.duration };
      }
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, data: method === "GET" ? (saved ? [saved] : []) : saved }),
      });
    });
    await signIn(page, "tenant_admin");
    await page.goto("/admin/appointments?tab=services");
    await settled(page);
    await page.getByRole("button", { name: "Nuevo servicio", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Nuevo servicio", exact: true });
    const save = dialog.getByRole("button", { name: "Crear servicio", exact: true });
    const body = dialog.locator(".overflow-y-auto");
    await expect(dialog).toBeVisible();

    const assertFits = async () => {
      const geometry = await dialog.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const content = element.querySelector<HTMLElement>(".overflow-y-auto")!;
        const contentBox = content.getBoundingClientRect();
        const footer = element.lastElementChild!.getBoundingClientRect();
        return {
          top: box.top, bottom: box.bottom, left: box.left, right: box.right,
          width: window.innerWidth, height: window.innerHeight,
          contentBottom: contentBox.bottom, footerTop: footer.top,
          scrollHeight: content.scrollHeight, clientHeight: content.clientHeight,
          scrollWidth: content.scrollWidth, clientWidth: content.clientWidth,
        };
      });
      expect(geometry.top).toBeGreaterThanOrEqual(15);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.height - 15);
      expect(geometry.left).toBeGreaterThanOrEqual(15);
      expect(geometry.right).toBeLessThanOrEqual(geometry.width - 15);
      expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.footerTop + 1);
      expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
      await expect(save).toBeInViewport({ ratio: 1 });
      await expect(dialog.getByRole("button", { name: "Cerrar", exact: true })).toBeInViewport({ ratio: 1 });
      return geometry;
    };
    const initialGeometry = await assertFits();
    await page.screenshot({ path: testInfo.outputPath("service-modal-top.png") });
    await dialog.getByPlaceholder("Ej: Consulta general").fill("Visita virtual");
    await dialog.getByPlaceholder("Duración personalizada").fill("20");
    await dialog.getByRole("button", { name: "Es gratis", exact: true }).click();
    await dialog.getByRole("button", { name: "Online", exact: true }).click();
    await dialog.getByPlaceholder("https://meet.google.com/... o https://teams.microsoft.com/...").fill("https://meet.example.test/visita");
    await dialog.getByRole("checkbox", { name: "email", exact: true }).check();
    expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const scrolledGeometry = await assertFits();
    await testInfo.attach("service-modal-geometry", {
      body: JSON.stringify({ initial: initialGeometry, scrolled: scrolledGeometry }, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath("service-modal-scrollable.png") });
    await save.click();
    await expect(dialog).not.toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "POST", body: {
      name: "Visita virtual", duration: 20, locationType: "online",
      meetingLink: "https://meet.example.test/visita", requiredFields: ["email"],
      paymentPolicy: "none", depositPercent: null, depositAmount: null,
      price: 0, priceStatus: "confirmed", free: true,
    } });
    await expect(page.getByText("Visita virtual", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    const editDialog = page.getByRole("dialog", { name: "Editar servicio", exact: true });
    await expect(editDialog.getByPlaceholder("Duración personalizada")).toHaveValue("20");
    await expect(editDialog.getByRole("button", { name: "Online", exact: true })).toHaveClass(/bg-primary/);
    await expect(editDialog.getByPlaceholder("https://meet.google.com/... o https://teams.microsoft.com/...")).toHaveValue("https://meet.example.test/visita");
    await expect(editDialog.getByRole("radio", { name: /^Sin pago/ })).toBeChecked();
    await expect(editDialog.getByRole("checkbox", { name: "email", exact: true })).toBeChecked();
    await editDialog.getByRole("button", { name: "Actualizar servicio", exact: true }).click();
    await expect(editDialog).not.toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({ method: "PUT", body: writes[0].body });
    await expectHermetic(state);
  });

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
