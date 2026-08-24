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
  "/support",
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
    ).toHaveAttribute("href", "https://parallly-chat.cloud/signup");
    await expect(page.locator('header a[href="/precios"]')).toHaveText("Precios");
    await expect(
      page.locator('header a[href="https://admin.parallly-chat.cloud/login"]'),
    ).toHaveText("Ingresar");
  });

  test(
    "signup bridge preserves allowlisted attribution before the dashboard hop",
    async ({ page }) => {
      let forwardedUrl: string | undefined;
      await page.route(
        /^https:\/\/admin\.parallly-chat\.cloud\/signup(?:\?.*)?$/,
        async (route) => {
          forwardedUrl = route.request().url();
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<!doctype html><title>Dashboard signup</title>",
          });
        },
      );

      await page.goto(
        "/signup?plan=Pro&country=co&cycle=annual&unexpected=drop-me",
        {
          referer:
            "http://127.0.0.1:3003/precios?utm_source=e2e&utm_campaign=vertical-audit",
        },
      );

      await expect.poll(() => forwardedUrl).toBeTruthy();
      const forwarded = new URL(forwardedUrl!);
      expect(forwarded.origin + forwarded.pathname).toBe(
        "https://admin.parallly-chat.cloud/signup",
      );
      expect(forwarded.searchParams.get("plan")).toBe("Pro");
      expect(forwarded.searchParams.get("country")).toBe("co");
      expect(forwarded.searchParams.get("cycle")).toBe("annual");
      expect(forwarded.searchParams.get("source")).toBe("marketing_site");
      expect(forwarded.searchParams.get("source_path")).toBe("/precios");
      expect(forwarded.searchParams.get("utm_source")).toBe("e2e");
      expect(forwarded.searchParams.get("utm_campaign")).toBe("vertical-audit");
      expect(forwarded.searchParams.has("unexpected")).toBe(false);
    },
  );

  test("support is a dedicated localized page with the canonical contact address", async ({ page }) => {
    await page.goto("/support");

    await expect(page).toHaveURL(/\/support\/?$/);
    await expect(page.getByTestId("support-page-title")).toHaveText(
      "Centro de soporte de Parallly",
    );
    await expect(page.locator("#hero-title")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Escribir a soporte" })).toHaveAttribute(
      "href",
      "mailto:it.executive@parallext.com?subject=Soporte%20Parallly",
    );
    await expect(page.locator('footer a[href="/support"]')).toHaveText("Soporte");

    const language = page.locator("header select");
    const localizedTitles = {
      en: "Parallly Support Center",
      pt: "Central de suporte da Parallly",
      fr: "Centre de support Parallly",
    } as const;

    for (const [locale, title] of Object.entries(localizedTitles)) {
      await language.selectOption(locale);
      await expect(page.getByTestId("support-page-title")).toHaveText(title);
    }
  });
});
