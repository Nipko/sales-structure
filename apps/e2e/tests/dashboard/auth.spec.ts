import { expect, test, type Page, type Route } from "@playwright/test";

type ApiHandler = (route: Route, url: URL) => Promise<boolean> | boolean;

type NetworkState = {
  productionApiRequests: string[];
  unexpectedApiRequests: string[];
};

/**
 * Keep authentication tests hermetic. The dashboard is compiled with a local
 * dummy API URL, and this guard also records any regression to the production
 * hostname while providing a deterministic Google Identity stub.
 */
async function mockDashboardDependencies(
  page: Page,
  apiHandler?: ApiHandler,
): Promise<NetworkState> {
  const state: NetworkState = {
    productionApiRequests: [],
    unexpectedApiRequests: [],
  };

  await page.route(
    /^https:\/\/[^/]*(?:google|gstatic|googleapis)[^/]*\//,
    async (route) => {
      if (route.request().resourceType() === "script") {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: `
            window.google = {
              accounts: {
                id: {
                  initialize: function () {},
                  renderButton: function (element) {
                    element.innerHTML = '<button role="button" type="button"></button>';
                  },
                  prompt: function () {}
                }
              }
            };
          `,
        });
        return;
      }

      await route.fulfill({ status: 204, body: "" });
    },
  );

  await page.route(/\/api\/v1(?:\/|$)/, async (route) => {
    const url = new URL(route.request().url());

    if (url.hostname === "api.parallly-chat.cloud") {
      state.productionApiRequests.push(url.toString());
    }

    if (apiHandler && (await apiHandler(route, url))) {
      return;
    }

    if (url.pathname.endsWith("/auth/saml/check")) {
      await route.fulfill({
        status: 200,
        json: {
          success: true,
          data: { ssoAvailable: false, forceSso: false },
        },
      });
      return;
    }

    state.unexpectedApiRequests.push(`${route.request().method()} ${url.pathname}`);
    await route.fulfill({
      status: 501,
      json: { success: false, message: "Unexpected API request in E2E test" },
    });
  });

  return state;
}

async function expectHermeticNetwork(state: NetworkState) {
  await expect.poll(() => state.productionApiRequests).toEqual([]);
  await expect.poll(() => state.unexpectedApiRequests).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

test("redirects an unauthenticated admin visit to login", async ({ page }) => {
  const network = await mockDashboardDependencies(page);

  await page.goto("/admin");

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión", exact: true }),
  ).toBeVisible();
  await expectHermeticNetwork(network);
});

test("shows the normalized API error without creating a session", async ({
  page,
}) => {
  const loginRequests: Array<Record<string, unknown>> = [];
  const network = await mockDashboardDependencies(page, async (route, url) => {
    if (!url.pathname.endsWith("/auth/login")) return false;

    loginRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 401,
      json: { success: false, message: "Credenciales inválidas" },
    });
    return true;
  });

  await page.goto("/login");
  const form = page.locator("form");
  await form.locator('input[type="email"]').fill("qa-login@example.test");
  await form.locator('input[type="password"]').fill("not-a-real-password");
  await form
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();

  await expect(page.getByText("Credenciales inválidas", { exact: true })).toBeVisible();
  expect(loginRequests).toEqual([
    {
      email: "qa-login@example.test",
      password: "not-a-real-password",
      rememberMe: false,
      force: false,
    },
  ]);
  expect(
    await page.evaluate(() => ({
      accessToken: localStorage.getItem("accessToken"),
      refreshToken: localStorage.getItem("refreshToken"),
      user: localStorage.getItem("user"),
    })),
  ).toEqual({ accessToken: null, refreshToken: null, user: null });
  await expectHermeticNetwork(network);
});

test("retries a session conflict with force enabled", async ({ page }) => {
  const loginRequests: Array<Record<string, unknown>> = [];
  const network = await mockDashboardDependencies(page, async (route, url) => {
    if (!url.pathname.endsWith("/auth/login")) return false;

    loginRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (loginRequests.length === 1) {
      await route.fulfill({
        status: 409,
        json: { success: false, message: "Active session" },
      });
    } else {
      // A rejected second response keeps this test focused on the force-login
      // request contract instead of bootstrapping an authenticated tenant.
      await route.fulfill({
        status: 401,
        json: { success: false, message: "Rejected by E2E fixture" },
      });
    }
    return true;
  });

  await page.goto("/login");
  const form = page.locator("form");
  await form.locator('input[type="email"]').fill("qa-conflict@example.test");
  await form.locator('input[type="password"]').fill("not-a-real-password");
  await form.locator('input[type="checkbox"]').check();
  await form
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();

  await expect(
    page.getByRole("heading", {
      name: "Sesión activa en otro dispositivo",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Iniciar sesión aquí", exact: true })
    .click();

  await expect.poll(() => loginRequests.length).toBe(2);
  expect(loginRequests).toEqual([
    {
      email: "qa-conflict@example.test",
      password: "not-a-real-password",
      rememberMe: true,
      force: false,
    },
    {
      email: "qa-conflict@example.test",
      password: "not-a-real-password",
      rememberMe: true,
      force: true,
    },
  ]);
  await expect(
    page.getByRole("heading", {
      name: "Sesión activa en otro dispositivo",
      exact: true,
    }),
  ).toBeHidden();
  await expectHermeticNetwork(network);
});

test("normalizes and preserves signup pricing intent", async ({ page }) => {
  const network = await mockDashboardDependencies(page);

  await page.goto("/signup?plan=Pro&country=co&cycle=annual");

  await expect(
    page.getByRole("heading", { name: "Crear cuenta", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = sessionStorage.getItem("pricingIntent");
        return value ? JSON.parse(value) : null;
      }),
    )
    .toEqual({ plan: "pro", country: "CO", cycle: "annual" });
  await expectHermeticNetwork(network);
});
