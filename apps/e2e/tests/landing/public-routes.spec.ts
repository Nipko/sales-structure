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
  "/producto",
  "/producto/agente-ia",
  "/producto/parallly-assist",
  "/producto/app-android",
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
      "Tu atención con IA. Fácil de configurar. A tu manera.",
    );
    await expect(
      page.locator('section[aria-labelledby="hero-title"]').getByRole("link", {
        name: "Empezar con Parallly",
        exact: true,
      }),
    ).toHaveAttribute("href", "https://parallly-chat.cloud/signup");
    await expect(page.locator('header a[href="/es/precios"]')).toHaveText("Precios");
    await expect(
      page.locator('header a[href="https://admin.parallly-chat.cloud/login"]'),
    ).toHaveText("Ingresar");
  });

  test("primary menus open by click and Escape returns focus to their trigger", async ({ page }) => {
    await page.goto("/");

    const menus = [
      {
        name: "Para tu empresa",
        id: "mega-navSolutions",
        overview: "Encuentra una configuración para tu negocio",
        href: "/es/soluciones",
      },
      {
        name: "Plataforma",
        id: "mega-navProduct",
        overview: "Conoce toda la plataforma",
        href: "/es/producto",
      },
    ];

    for (const menu of menus) {
      const trigger = page.locator("header").getByRole("button", { name: menu.name, exact: true });
      const region = page.getByRole("region", { name: menu.name, exact: true });
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toHaveAttribute("aria-controls", menu.id);
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(region).toBeVisible();

      const overview = region.getByRole("link", { name: menu.overview, exact: true });
      await expect(overview).toHaveAttribute("href", menu.href);
      if (menu.id === "mega-navProduct") {
        await expect(region.locator('a[href="/es/producto/parallly-assist"]')).toContainText("Parallly Assist");
        await expect(region.locator('a[href="/es/producto/agente-ia"]')).toContainText("Agente IA");
      }

      await overview.focus();
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(region).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  });

  test("Android showcase switches screenshots and exposes the same Google Play destination as its product page", async ({ page }) => {
    await page.goto("/");

    const showcase = page.locator("#app-movil");
    const choices = showcase.getByRole("group", { name: "Explorar pantallas de la app" });
    await expect(choices.getByRole("button", { name: "Atención", exact: true })).toHaveAttribute("aria-pressed", "true");

    for (const screen of [
      { name: "CRM", file: "crm", title: "El contexto de cada cliente, a mano." },
      { name: "Agenda", file: "agenda", title: "Ten presente lo que sigue." },
      { name: "Atención", file: "inbox", title: "La conversación continúa contigo." },
    ]) {
      const button = choices.getByRole("button", { name: screen.name, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(choices.locator('button[aria-pressed="true"]')).toHaveCount(1);
      await expect(showcase.locator("#mobile-app-benefit h3")).toHaveText(screen.title);
      const screenshot = showcase.locator("#mobile-app-preview img");
      await expect(screenshot).toHaveAttribute("src", `/mobile/${screen.file}.png`);
      await expect(screenshot).toHaveAttribute("alt", /\S+/);
      await expect.poll(() => screenshot.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    }

    const playStoreUrl = "https://play.google.com/store/apps/details?id=cloud.parallly.mobile";
    const homeDownload = showcase.getByRole("link", {
      name: "Descargar Parallly en Google Play (abre otra pestaña)",
      exact: true,
    });
    await expect(homeDownload).toHaveAttribute("href", playStoreUrl);
    await expect(homeDownload).toHaveAttribute("target", "_blank");
    await expect(homeDownload).toHaveAttribute("rel", /\bnoopener\b/);
    await expect(homeDownload).toHaveAttribute("rel", /\bnoreferrer\b/);

    const details = showcase.getByRole("link", { name: "Explorar la app", exact: true });
    await expect(details).toHaveAttribute("href", "/es/producto/app-android");
    await details.click();
    await expect(page).toHaveURL(/\/es\/producto\/app-android\/?$/);
    const productDownload = page.getByRole("link", { name: "Descargar en Google Play", exact: true });
    await expect(productDownload).toHaveAttribute("href", playStoreUrl);
    await expect(productDownload).toHaveAttribute("target", "_blank");
    await expect(productDownload).toHaveAttribute("rel", /\bnoopener\b/);
    await expect(productDownload).toHaveAttribute("rel", /\bnoreferrer\b/);
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
      expect(forwarded.searchParams.get("plan")).toBe("pro");
      expect(forwarded.searchParams.get("country")).toBe("CO");
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
      "Encuentra el siguiente paso para tu negocio",
    );
    await expect(page.locator("#hero-title")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Escribir a soporte" })).toHaveAttribute(
      "href",
      "mailto:it.executive@parallext.com?subject=Soporte%20Parallly",
    );
    await expect(page.locator('footer a[href="/es/support"]')).toHaveText("Soporte");

    const language = page.locator("header select");
    const localizedTitles = {
      en: "Find the next step for your business",
      pt: "Encontre o próximo passo para seu negócio",
      fr: "Trouvez la prochaine étape pour votre activité",
    } as const;

    for (const [locale, title] of Object.entries(localizedTitles)) {
      await language.selectOption(locale);
      await expect(page).toHaveURL(new RegExp(`/${locale}/support/?$`));
      await expect(page.getByTestId("support-page-title")).toHaveText(title);
    }
  });
});
