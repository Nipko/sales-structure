import { expect, test } from "@playwright/test";
import {
  expectNoProductionApiRequests,
  isolateLandingFromProduction,
  type LandingNetworkState,
} from "./network";

test.describe("landing locale", () => {
  let network: LandingNetworkState;

  test.beforeEach(async ({ page }) => {
    network = await isolateLandingFromProduction(page);
  });

  test.afterEach(async () => {
    await expectNoProductionApiRequests(network);
  });

  test("switches from Spanish to English and persists the selection", async ({ page, context }) => {
    await page.goto("/");

    const spanishLanguageSelect = page.getByLabel("Idioma del sitio");
    await expect(spanishLanguageSelect).toHaveValue("es");
    await spanishLanguageSelect.selectOption("en");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("#hero-title")).toContainText(
      "Turn every conversation into a sale, an appointment or a resolved task",
    );
    await expect(page.getByLabel("Site language")).toHaveValue("en");

    const localeCookie = (await context.cookies()).find((cookie) => cookie.name === "locale");
    expect(localeCookie?.value).toBe("en");

    await page.reload();
    await expect(page.getByLabel("Site language")).toHaveValue("en");
    await expect(page.locator("#hero-title")).toContainText(
      "Turn every conversation into a sale, an appointment or a resolved task",
    );
  });
});

test.describe("data deletion request", () => {
  test("submits the expected payload to a mocked API and displays its tracking code", async ({
    page,
  }) => {
    const network = await isolateLandingFromProduction(page);

    let submittedPayload: unknown;
    await page.route(
      "http://127.0.0.1:3999/api/v1/meta/data-deletion-request",
      async (route) => {
        expect(route.request().method()).toBe("POST");
        expect(route.request().headers()["content-type"]).toContain(
          "application/json",
        );
        submittedPayload = route.request().postDataJSON();

        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ confirmation_code: "DEL-E2E-2026" }),
        });
      },
    );

    await page.goto("/data-deletion");
    await page.locator("#legal-language").selectOption("es");
    await page.getByLabel("Correo electrónico").fill("qa+deletion@parallext.com");
    await page
      .getByLabel("Descripción adicional (opcional)")
      .fill("Cuenta de demostración creada para pruebas automatizadas.");
    await page.getByRole("button", { name: "Solicitar eliminación de cuenta y datos" }).click();

    await expect(
      page.getByRole("heading", { name: "Solicitud de eliminación recibida" }),
    ).toBeVisible();
    await expect(page.getByText("DEL-E2E-2026", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Consultar estado" })).toHaveAttribute(
      "href",
      "/data-deletion/status?code=DEL-E2E-2026",
    );
    expect(submittedPayload).toEqual({
      email: "qa+deletion@parallext.com",
      description: "Cuenta de demostración creada para pruebas automatizadas.",
    });
    await expectNoProductionApiRequests(network);
  });
});
