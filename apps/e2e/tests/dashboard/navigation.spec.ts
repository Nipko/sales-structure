import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

type NetworkState = {
  productionApiRequests: string[];
  unexpectedApiRequests: string[];
};

const tenantAdmin = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "navigation-e2e@example.test",
  firstName: "Navegacion",
  lastName: "E2E",
  role: "tenant_admin",
  tenantId: TENANT_ID,
  tenantName: "Tenant E2E",
  emailVerified: true,
  onboardingCompleted: true,
};

async function fulfillSuccess(route: Route, data: unknown = {}) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data }),
  });
}

/**
 * Boot an authenticated tenant session without contacting a real backend.
 * Every API used by the shell and the pages exercised below is declared here;
 * an undeclared call fails the test instead of silently falling through.
 */
async function bootstrapTenantAdmin(
  page: Page,
  options: { tourPending?: boolean } = {},
): Promise<NetworkState> {
  await page.context().addCookies([
    { name: "locale", value: "es", domain: "127.0.0.1", path: "/" },
  ]);

  await page.addInitScript(
    ({ user, tenantId, tourPending }) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("accessToken", "e2e-access-token");
      localStorage.setItem("refreshToken", "e2e-refresh-token");
      localStorage.setItem("user", JSON.stringify(user));
      localStorage.setItem(
        "verticalConfig",
        JSON.stringify({
          tenantId,
          config: {
            industry: "technology",
            manifestVersion: 2,
            effectiveCapabilities: ["crm_pipeline", "faq_search", "appointment_booking"],
            sidebar: {},
          },
        }),
      );
      localStorage.setItem(`checklist_dismissed_${tenantId}`, "true");
      localStorage.setItem("pwa-install-snooze-until", String(Date.now() + 86_400_000));
      sessionStorage.setItem("parallly:assistant-announced", "1");
      if (tourPending) localStorage.setItem("parallly:tour:pending", "true");

      // Keep socket.io deterministic: the navigation contract does not depend
      // on a live inbox socket, and no polling fallback should escape the test.
      class E2EWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;
        readonly CONNECTING = 0;
        readonly OPEN = 1;
        readonly CLOSING = 2;
        readonly CLOSED = 3;
        readyState = E2EWebSocket.CLOSED;
        binaryType: BinaryType = "blob";
        bufferedAmount = 0;
        extensions = "";
        protocol = "";
        url: string;
        onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
        onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
        onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
        onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;

        constructor(url: string | URL) {
          this.url = String(url);
          queueMicrotask(() => this.onerror?.call(this as unknown as WebSocket, new Event("error")));
        }

        close() {}
        send() {}
        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() { return false; }
      }

      Object.defineProperty(window, "WebSocket", {
        configurable: true,
        value: E2EWebSocket,
      });
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: undefined,
      });
    },
    { user: tenantAdmin, tenantId: TENANT_ID, tourPending: options.tourPending === true },
  );

  const state: NetworkState = {
    productionApiRequests: [],
    unexpectedApiRequests: [],
  };

  const recordProductionApi = (rawUrl: string) => {
    try {
      const url = new URL(rawUrl);
      if (url.hostname === "api.parallly-chat.cloud") {
        state.productionApiRequests.push(url.toString());
      }
    } catch {
      // Invalid URLs are not network requests and can be ignored here.
    }
  };

  page.on("request", (request) => recordProductionApi(request.url()));
  page.on("websocket", (socket) => recordProductionApi(socket.url()));

  await page.route(/\/api\/v1(?:\/|$)/, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname.replace(/^\/api\/v1/, "") || "/";

    if (url.hostname === "api.parallly-chat.cloud") {
      await route.abort("blockedbyclient");
      return;
    }

    if (method === "POST" && path === "/auth/activity-ping") {
      await fulfillSuccess(route);
      return;
    }

    // Telemetría de navegación del shell.
    //
    // El emisor se agregó con el rediseño de navegación y esta lista no se
    // tocó, así que el POST caía en el catch-all de abajo y se contaba como
    // llamada inesperada. No fallaba siempre porque la cola se vacía a los 3s
    // (`navigation-telemetry.ts`): que el POST cayera dentro o fuera del caso
    // dependía de cuánto tardara el caso. Con `retries: 1` y
    // `failOnFlakyTests` en CI, un solo intento rojo tiñe el deploy aunque el
    // reintento pase — que es exactamente lo que venía pasando.
    //
    // `/admin/inbox` es pantalla operativa, así que cargarla SIEMPRE encola un
    // `navigation.task_reached`: es una llamada declarada del shell, no una
    // fuga.
    if (
      method === "POST" &&
      path === `/analytics/navigation-telemetry/${TENANT_ID}`
    ) {
      await fulfillSuccess(route);
      return;
    }

    if (method === "GET" && path === `/verticals/${TENANT_ID}`) {
      await fulfillSuccess(route, {
        industry: "technology",
        manifestVersion: 2,
        effectiveCapabilities: ["crm_pipeline", "faq_search", "appointment_booking"],
        sidebar: {},
      });
      return;
    }

    if (method === "GET" && path === `/billing/${TENANT_ID}/restriction-status`) {
      await fulfillSuccess(route, {
        level: "none",
        daysElapsed: 0,
        daysRemaining: 7,
        status: "active",
      });
      return;
    }

    if (method === "GET" && path === "/platform-status") {
      await fulfillSuccess(route, {
        enabled: false,
        message: "",
        severity: "info",
      });
      return;
    }

    if (method === "GET" && path === "/system-updates") {
      await fulfillSuccess(route, []);
      return;
    }

    if (method === "GET" && path === `/business-info/${TENANT_ID}`) {
      await fulfillSuccess(route, {});
      return;
    }

    if (method === "GET" && path === "/auth/tenant/timezone") {
      await fulfillSuccess(route, { timezone: "America/Bogota" });
      return;
    }

    if (method === "GET" && path === `/fiscal/${TENANT_ID}/data`) {
      await fulfillSuccess(route, { required: false, complete: true });
      return;
    }

    if (method === "GET" && path === `/billing/${TENANT_ID}/subscription`) {
      await fulfillSuccess(route, { status: "active", trialEndsAt: null });
      return;
    }

    if (method === "GET" && path === `/persona/${TENANT_ID}/setup-status`) {
      await fulfillSuccess(route, {
        setupWizardCompleted: true,
        hasPersona: true,
        hasAnyChannel: true,
        hasConversations: true,
        hasKnowledge: true,
        hasTeam: true,
        hasInstagram: true,
        hasAutomation: true,
        hasTemplates: true,
      });
      return;
    }

    if (method === "GET" && path === `/persona/${TENANT_ID}/plan-features`) {
      await fulfillSuccess(route, {});
      return;
    }

    if (method === "GET" && path === `/quality/${TENANT_ID}/attention-summary`) {
      await fulfillSuccess(route, {
        generatedAt: "2026-08-13T12:00:00.000Z",
        worstStatus: null,
        agentsTotal: 0,
        evaluatedAgents: 0,
        agentsNeedingAttention: 0,
        openCritical: 0,
        openHigh: 0,
        attentionCount: 0,
        agents: [],
      });
      return;
    }

    if (method === "GET" && path === "/channels/overview") {
      await fulfillSuccess(route, []);
      return;
    }

    if (
      method === "GET"
      && [
        `/agent-console/inbox/${TENANT_ID}`,
        `/agent-console/macros/${TENANT_ID}`,
        `/agent-console/canned/${TENANT_ID}`,
        `/crm/custom-attributes/${TENANT_ID}`,
      ].includes(path)
    ) {
      await fulfillSuccess(route, []);
      return;
    }

    if (method === "GET" && path === `/analytics/commercial-overview/${TENANT_ID}`) {
      await fulfillSuccess(route, {
        leadsToday: 0,
        leadsHot: 0,
        leadsReadyToClose: 0,
        conversations: 0,
        handoffs: 0,
        llmCostToday: 0,
        messagesProcessed: 0,
      });
      return;
    }

    if (method === "GET" && path === `/analytics/overview/${TENANT_ID}`) {
      await fulfillSuccess(route, { recentActivity: [], modelUsage: [] });
      return;
    }

    if (method === "GET" && path === `/crm/leads/${TENANT_ID}`) {
      await fulfillSuccess(route, []);
      return;
    }

    state.unexpectedApiRequests.push(`${method} ${path}`);
    await route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        message: "Unexpected API request in navigation E2E test",
      }),
    });
  });

  await page.route(/^https:\/\/api\.parallly-chat\.cloud\//, async (route) => {
    await route.abort("blockedbyclient");
  });

  return state;
}

async function expectHermeticNetwork(page: Page, state: NetworkState) {
  // Effects in the dashboard shell issue their declared calls just after paint.
  await page.waitForTimeout(150);
  await expect.poll(() => state.productionApiRequests).toEqual([]);
  await expect.poll(() => state.unexpectedApiRequests).toEqual([]);
}

function mainNavigation(page: Page): Locator {
  return page.getByRole("navigation", { name: "Menú", exact: true }).first();
}

async function expectSingleCurrentPage(navigation: Locator, href: RegExp) {
  const current = navigation.locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute("href", href);
}

async function expectDrawerFitsViewport(drawer: Locator) {
  await expect(drawer).toBeVisible();
  await expect.poll(async () => drawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      startsInsideViewport: rect.left >= -1,
      endsInsideViewport: rect.right <= window.innerWidth + 1,
      hasVisibleWidth: rect.width > 0,
    };
  })).toEqual({
    startsInsideViewport: true,
    endsInsideViewport: true,
    hasVisibleWidth: true,
  });

  const widths = await drawer.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth + 1);
  expect(widths.documentWidth).toBeLessThanOrEqual(widths.viewport + 1);
}

test("the Parallly logo returns home and the main navigation has one active page", async ({ page }) => {
  const network = await bootstrapTenantAdmin(page);

  await page.goto(`/admin/settings/profile?returnTo=${encodeURIComponent("/admin/inbox")}`);
  await expect(page.getByRole("heading", { name: "Perfil", exact: true })).toBeVisible();
  await expectSingleCurrentPage(mainNavigation(page), /^\/admin\/settings/);

  await page.getByRole("link", { name: "Parallly", exact: true }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expectSingleCurrentPage(mainNavigation(page), /^\/admin$/);
  await expectHermeticNetwork(page, network);
});

test("Ctrl+K opens global search, launches actions, and Alt shortcuts navigate", async ({ page }) => {
  const network = await bootstrapTenantAdmin(page);

  await page.goto("/admin/inbox");
  await expectSingleCurrentPage(mainNavigation(page), /^\/admin\/inbox$/);

  await page.keyboard.press("Control+K");
  let palette = page.getByRole("dialog", { name: "Buscar y navegar", exact: true });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox", { name: "Buscar secciones y acciones…" }).fill("Perfil");
  const profileResult = palette
    .getByRole("option")
    .filter({ hasText: "/admin/settings/profile" });
  await expect(profileResult).toHaveCount(1);
  await profileResult.click();
  await expect(page).toHaveURL(/\/admin\/settings\/profile\?returnTo=%2Fadmin%2Finbox$/);
  await page.getByRole("link", { name: "Volver a la sección anterior", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/inbox$/);

  await page.keyboard.press("Control+K");
  palette = page.getByRole("dialog", { name: "Buscar y navegar", exact: true });
  await expect(palette).toBeVisible();
  await palette.getByRole("option", { name: /Crear contacto/ }).click();

  await expect(page).toHaveURL(/\/admin\/contacts$/);
  await expect(page.getByRole("heading", { name: "Nuevo contacto", exact: true })).toBeVisible();

  await page.keyboard.press("Alt+2");
  await expect(page).toHaveURL(/\/admin\/inbox$/);

  const desktopSearch = page.getByRole("button", { name: "Abrir búsqueda global", exact: true });
  await desktopSearch.click();
  await expect(page.getByRole("dialog", { name: "Buscar y navegar", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 844 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Buscar y navegar", exact: true })).toBeHidden();
  await expect(page.locator("#main-content")).toBeFocused();
  await expectHermeticNetwork(page, network);
});

test("Settings preserves its origin, keeps one active item, and returns there", async ({ page }) => {
  const network = await bootstrapTenantAdmin(page);

  await page.goto("/admin/inbox?channel=telegram#queue");
  const settingsLink = mainNavigation(page).getByRole("link", {
    name: "Configuración",
    exact: true,
  });
  await expect(settingsLink).toHaveAttribute(
    "href",
    "/admin/settings?returnTo=%2Fadmin%2Finbox%3Fchannel%3Dtelegram%23queue",
  );
  await settingsLink.click();
  await expect(page).toHaveURL(/\/admin\/settings\?returnTo=%2Fadmin%2Finbox%3Fchannel%3Dtelegram%23queue$/);

  const settingsNavigation = page.getByRole("navigation", {
    name: "Navegación de configuración",
    exact: true,
  });
  await settingsNavigation.getByRole("link", { name: "Perfil", exact: true }).click();
  await expect(page).toHaveURL(
    /\/admin\/settings\/profile\?returnTo=%2Fadmin%2Finbox%3Fchannel%3Dtelegram%23queue$/,
  );
  await expectSingleCurrentPage(settingsNavigation, /^\/admin\/settings\/profile/);
  await expectSingleCurrentPage(mainNavigation(page), /^\/admin\/settings/);

  await page
    .getByRole("link", { name: "Volver a la sección anterior", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/inbox\?channel=telegram#queue$/);
  await expectSingleCurrentPage(mainNavigation(page), /^\/admin\/inbox$/);
  await expectHermeticNetwork(page, network);
});

test("mobile main and Settings drawers fit the viewport and close with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const network = await bootstrapTenantAdmin(page);

  await page.goto("/admin/inbox");
  const mainMenuButton = page.locator("header").getByRole("button", { name: "Menú", exact: true });
  await mainMenuButton.click();

  const mainDrawer = page.getByRole("dialog", { name: "Menú", exact: true });
  await expectDrawerFitsViewport(mainDrawer);
  await expectSingleCurrentPage(
    mainDrawer.getByRole("navigation", { name: "Menú", exact: true }),
    /^\/admin\/inbox$/,
  );
  await page.keyboard.press("Escape");
  await expect(mainDrawer).toBeHidden();
  await expect(mainMenuButton).toBeFocused();

  await mainMenuButton.click();
  await page.setViewportSize({ width: 900, height: 844 });
  await expect(mainDrawer).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Menú", exact: true }).first()).toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/settings/profile?returnTo=${encodeURIComponent("/admin/inbox")}`);
  await expect(page.locator("header").getByRole("link", { name: "Volver: Configuración", exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Navegación de configuración", exact: true })
    .click();

  const settingsDrawer = page.getByRole("dialog", {
    name: "Configuración",
    exact: true,
  });
  await expectDrawerFitsViewport(settingsDrawer);
  await expectSingleCurrentPage(
    settingsDrawer.getByRole("navigation", {
      name: "Navegación de configuración",
      exact: true,
    }),
    /^\/admin\/settings\/profile/,
  );
  await page.keyboard.press("Escape");
  await expect(settingsDrawer).toBeHidden();
  await expect(page.getByRole("button", { name: "Navegación de configuración", exact: true })).toBeFocused();

  await page
    .getByRole("button", { name: "Navegación de configuración", exact: true })
    .click();
  await page.setViewportSize({ width: 1100, height: 844 });
  await expect(settingsDrawer).toBeHidden();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await expect(page.getByRole("navigation", { name: "Navegación de configuración", exact: true }).first()).toBeVisible();
  await expectHermeticNetwork(page, network);
});

test("the setup tour waits for the persistent sidebar and anchors to the AI agent", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const network = await bootstrapTenantAdmin(page, { tourPending: true });

  await page.goto("/admin");
  await page.waitForTimeout(900);
  await expect(page.locator('[data-name="onborda-card"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("parallly:tour:pending")))
    .toBe("true");

  await page.setViewportSize({ width: 1024, height: 844 });
  const tourCard = page.locator('[data-name="onborda-card"]');
  await expect(tourCard).toBeVisible();
  const tourDialog = tourCard.getByRole("dialog", { name: "Tu agente de IA", exact: true });
  const tourHeading = tourDialog.getByRole("heading", { name: "Tu agente de IA", exact: true });
  await expect(tourDialog).toBeVisible();
  await expect(tourHeading).toBeFocused();
  await expect(page.locator("#tour-aiAgent")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("parallly:tour:pending")))
    .toBeNull();

  await page.keyboard.press("Shift+Tab");
  await expect(tourDialog.getByRole("button", { name: /Siguiente/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(tourDialog.getByRole("button", { name: "Cerrar", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tourCard).toBeHidden();
  await expect(page.locator("#main-content")).toBeFocused();
  await expectHermeticNetwork(page, network);
});
