import { expect, test } from "@playwright/test";
import {
  expectNoProductionApiRequests,
  isolateLandingFromProduction,
  type LandingNetworkState,
} from "./network";

const PUBLIC_ROUTES = [
  "/",
  "/soluciones",
  "/soluciones/salud",
  "/producto/agente-ia",
  "/precios",
  "/privacy",
  "/terms",
  "/data-policy",
  "/data-deletion",
] as const;

test.describe("landing public routes", () => {
  let network: LandingNetworkState;

  test.beforeEach(async ({ page }) => {
    network = await isolateLandingFromProduction(page);
  });

  test.afterEach(async () => {
    await expectNoProductionApiRequests(network);
  });

  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders its primary content`, async ({ page }) => {
      const response = await page.goto(route);

      expect(response, `No navigation response was returned for ${route}`).not.toBeNull();
      expect(response?.ok(), `${route} returned ${response?.status()}`).toBe(true);
      await expect(page.locator("h1").first()).toBeVisible();
    });
  }

  test("home exposes the expected primary navigation without leaving the site", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator('header img[alt="Parallly"]')).toBeVisible();
    await expect(page.locator("#hero-title")).toContainText(
      "Convierte cada conversación en una venta, una cita o una tarea resuelta",
    );
    await expect(
      page.getByRole("link", { name: "Empezar prueba gratis", exact: true }).first(),
    ).toHaveAttribute("href", "https://admin.parallly-chat.cloud/signup");
    await expect(page.locator('header a[href="/precios"]')).toHaveText("Precios");
    await expect(
      page.locator('header a[href="https://admin.parallly-chat.cloud/login"]'),
    ).toHaveText("Ingresar");
  });
});
