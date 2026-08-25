import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const RENTAL_ID = "33333333-3333-4333-8333-333333333333";

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
  options: {
    tourPending?: boolean;
    emailVerified?: boolean;
    vertical?: {
      industry: string;
      subType?: string;
      effectiveCapabilities: string[];
      sidebar?: {
        itemOrder?: string[];
        labelOverrides?: Record<string, Record<string, string>>;
      };
    };
  } = {},
): Promise<NetworkState> {
  const vertical = options.vertical || {
    industry: "technology",
    effectiveCapabilities: ["crm_pipeline", "faq_search", "appointment_booking"],
  };
  await page.context().addCookies([
    { name: "locale", value: "es", domain: "127.0.0.1", path: "/" },
  ]);

  await page.addInitScript(
    ({ user, tenantId, tourPending, verticalConfig }) => {
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
            industry: verticalConfig.industry,
            subType: verticalConfig.subType,
            manifestVersion: 2,
            effectiveCapabilities: verticalConfig.effectiveCapabilities,
            sidebar: verticalConfig.sidebar || {},
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
    {
      user: { ...tenantAdmin, emailVerified: options.emailVerified ?? true },
      tenantId: TENANT_ID,
      tourPending: options.tourPending === true,
      verticalConfig: vertical,
    },
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
        industry: vertical.industry,
        subType: vertical.subType,
        manifestVersion: 2,
        effectiveCapabilities: vertical.effectiveCapabilities,
        sidebar: vertical.sidebar || {},
      });
      return;
    }

    if (method === "GET" && path === `/repair-orders/${TENANT_ID}`) {
      await fulfillSuccess(route, { items: [], total: 0 });
      return;
    }

    if (method === "GET" && path === `/repair-orders/${TENANT_ID}/summary`) {
      await fulfillSuccess(route, {
        open: 0,
        awaitingApproval: 0,
        readyForDelivery: 0,
        deliveredLast30Days: 0,
      });
      return;
    }

    const rentalFixture = {
      id: RENTAL_ID,
      rental_type: "vehicle_rental",
      resource_id: "44444444-4444-4444-8444-444444444444",
      contact_id: "55555555-5555-4555-8555-555555555555",
      resource_name: "Renault Duster 2025",
      contact_name: "Ana Ruiz",
      start_date: "2026-09-01",
      end_date: "2026-09-05",
      status: "pending_review",
      version: 1,
      created_at: "2026-08-25T12:00:00.000Z",
      updated_at: "2026-08-25T12:00:00.000Z",
      metadata: {
        details: {
          driver: { name: "Ana Ruiz", declaredAge: 31, licenseCountry: "CO" },
          eligibility: {
            identity: { status: "pending" },
            driverLicense: { status: "pending" },
            insurance: { status: "pending" },
            payment: { status: "pending" },
          },
        },
      },
      events: [{ id: "66666666-6666-4666-8666-666666666666", event_type: "rental_requested", actor_type: "agent", created_at: "2026-08-25T12:00:00.000Z" }],
      inspections: [],
      damages: [],
    };

    if (method === "GET" && path === `/resource-rentals/${TENANT_ID}`) {
      await fulfillSuccess(route, [rentalFixture]);
      return;
    }

    if (method === "GET" && path === `/resource-rentals/${TENANT_ID}/${RENTAL_ID}`) {
      await fulfillSuccess(route, rentalFixture);
      return;
    }

    if (method === "GET" && path === `/tenants/${TENANT_ID}/regional/profile`) {
      await fulfillSuccess(route, {
        operatingCurrency: {
          value: "COP",
          source: "tenant_declared",
        },
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

    if (method === "GET" && path === `/dashboard-analytics/overview-kpis/${TENANT_ID}`) {
      await fulfillSuccess(route, { kpis: [] });
      return;
    }

    if (method === "GET" && path === `/dashboard-analytics/conversations-volume/${TENANT_ID}`) {
      await fulfillSuccess(route, { series: [] });
      return;
    }

    if (method === "GET" && path === `/dashboard-analytics/channel-accounts/${TENANT_ID}`) {
      await fulfillSuccess(route, {
        accounts: [{
          channelAccountId: "wa-sales-bogota",
          channelType: "whatsapp",
          displayName: "WhatsApp Ventas Bogotá",
          isActive: false,
          conversations: 7,
          messages: 18,
          handoffs: 1,
          llmCost: 0.12,
          appointments: 2,
          leads: 3,
          orders: 1,
        }],
        unattributed: 2,
      });
      return;
    }

    if (method === "GET" && path === `/dashboard-analytics/response-times/${TENANT_ID}`) {
      await fulfillSuccess(route, { series: [] });
      return;
    }

    if (method === "GET" && path === `/dashboard-analytics/ai-metrics/${TENANT_ID}`) {
      await fulfillSuccess(route, {});
      return;
    }

    if (method === "GET" && path === `/dashboard-analytics/heatmap/${TENANT_ID}`) {
      await fulfillSuccess(route, { data: [] });
      return;
    }

    if (method === "GET" && path === `/dashboard-analytics/automation/${TENANT_ID}`) {
      await fulfillSuccess(route, {});
      return;
    }

    if (method === "GET" && path === `/dashboard-analytics/broadcast/${TENANT_ID}`) {
      await fulfillSuccess(route, {});
      return;
    }

    if (method === "GET" && path === `/dashboard-analytics/anomalies/${TENANT_ID}`) {
      await fulfillSuccess(route, {});
      return;
    }

    if (method === "GET" && path === `/dashboard-analytics/cohorts/${TENANT_ID}`) {
      await fulfillSuccess(route, {});
      return;
    }

    if (method === "GET" && path === `/dashboard-analytics/realtime/${TENANT_ID}`) {
      await fulfillSuccess(route, {
        activeConversations: 0,
        agentsOnline: 0,
        agentsBusy: 0,
        queueDepth: 0,
        agentsOffline: 0,
        messagesToday: 0,
      });
      return;
    }

    if (method === "GET" && path === `/vertical-integrations/${TENANT_ID}/config`) {
      const health = (provider: string, resourceType: string, resourceId: string) => ({
        projectionVersion: 1,
        connectionId: `${provider}-primary`,
        resourceType,
        resourceId,
        sourceVersion: `${provider}-e2e-v1`,
        observedAt: "2026-08-24T12:00:00.000Z",
        degradedReason: null,
        status: "healthy",
        connected: true,
        credentialValidated: true,
        requiredScopes: ["read"],
        grantedScopes: ["read"],
        scopeStatus: "satisfied",
        lastCheckedAt: "2026-08-24T12:00:00.000Z",
        lastSuccessfulSyncAt: "2026-08-24T12:00:00.000Z",
        freshness: { maxAgeSeconds: 86_400, ageSeconds: 60, stale: false },
        industryEligible: true,
        consecutiveFailures: 0,
        circuitState: "closed",
        lastError: null,
      });
      await fulfillSuccess(route, {
        toast: {
          configured: true,
          connected: true,
          health: health("toast", "location", "loc-bogota"),
        },
        mindbody: {
          configured: true,
          connected: true,
          health: health("mindbody", "site", "site-01"),
        },
      });
      return;
    }

    if (method === "GET" && path === `/vertical-integrations/${TENANT_ID}/bindings/resources`) {
      const provider = url.searchParams.get("provider");
      await fulfillSuccess(route, provider === "toast" ? [{
        version: 1,
        id: "33333333-3333-4333-8333-333333333333",
        tenantId: TENANT_ID,
        provider: "toast",
        connectionId: "toast-primary",
        resourceType: "location",
        resourceId: "local-bogota",
        externalId: "ext-bogota",
        scopeType: "site",
        scopeId: "bogota",
        state: "active",
        generation: 3,
      }] : []);
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

test("a workshop reaches its repair-order register directly and does not see dealership inventory", async ({ page }) => {
  const network = await bootstrapTenantAdmin(page, {
    vertical: {
      industry: "automotriz",
      subType: "taller",
      effectiveCapabilities: ["crm_pipeline", "faq_search", "appointment_booking", "repair_orders"],
    },
  });

  await page.goto("/admin/repair-orders");
  await expect(page.getByRole("heading", { name: "Órdenes de taller", exact: true })).toBeVisible();
  await expect(page.getByText("Todavía no hay órdenes de taller", { exact: true })).toBeVisible();
  const navigation = mainNavigation(page);
  await expectSingleCurrentPage(navigation, /^\/admin\/repair-orders$/);
  await expect(navigation.getByRole("link", { name: "Vehículos", exact: true })).toHaveCount(0);
  await expectHermeticNetwork(page, network);
});

test("vehicle rental opens on requests and never presents pending eligibility as a reservation", async ({ page }) => {
  const network = await bootstrapTenantAdmin(page, {
    vertical: {
      industry: "automotriz",
      subType: "alquiler",
      effectiveCapabilities: ["crm_pipeline", "faq_search", "vehicle_inventory", "vehicle_rentals"],
      sidebar: {
        itemOrder: ["resourceRentals", "vehicles"],
        labelOverrides: {
          resourceRentals: { es: "Reservas", en: "Reservations", pt: "Reservas", fr: "Réservations" },
          vehicles: { es: "Flota", en: "Fleet", pt: "Frota", fr: "Flotte" },
        },
      },
    },
  });

  await page.goto("/admin/resource-rentals");
  await expect(page.getByRole("heading", { name: "Reservas de vehículos", exact: true })).toBeVisible();
  await expect(page.locator("tbody").getByText("Pendiente de revisión", { exact: true })).toBeVisible();
  const navigation = mainNavigation(page);
  await expectSingleCurrentPage(navigation, /^\/admin\/resource-rentals$/);
  await expect(navigation.getByRole("link", { name: "Reservas", exact: true })).toBeVisible();
  await navigation.getByRole("button", { name: "Catálogo y recursos", exact: true }).click();
  await expect(navigation.getByRole("link", { name: "Flota", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Datos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Datos del alquiler", exact: true })).toBeVisible();
  await expect(page.getByText("Revisión de elegibilidad", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprobar y reservar", exact: true })).toBeVisible();
  await expectHermeticNetwork(page, network);
});

test("legacy Email and SMS routes return to certified, non-SMS surfaces", async ({ page }) => {
  const network = await bootstrapTenantAdmin(page);

  await page.goto("/admin/channels/email");
  await expect(page).toHaveURL(/\/admin\/channels$/);
  await expect(page.getByRole("heading", { name: "Canales", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "WhatsApp", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Instagram DM", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Facebook Messenger", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Telegram", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Email", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "SMS", exact: true })).toHaveCount(0);

  await page.goto("/admin/channels/sms");
  await expect(page).toHaveURL(/\/admin\/channels$/);

  await page.goto("/admin/settings/integrations/sms-notifications");
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(page.getByRole("link", { name: /Notificaciones SMS/i })).toHaveCount(0);
  await expectHermeticNetwork(page, network);
});

test("an unverified tenant can read and test while sensitive capabilities remain visibly gated", async ({ page }) => {
  const network = await bootstrapTenantAdmin(page, { emailVerified: false });

  await page.goto("/admin/channels");
  await expect(page).toHaveURL(/\/admin\/channels$/);
  await expect(page.getByText(/Puedes explorar y probar; verifícalo para publicar/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reenviar código", exact: true })).toBeVisible();
  await expectHermeticNetwork(page, network);
});

test("analytics exposes historical performance by operational channel account", async ({ page }) => {
  const network = await bootstrapTenantAdmin(page);

  await page.goto("/admin/analytics-v2");
  await page.getByRole("button", { name: "Canales", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rendimiento por cuenta operativa", exact: true })).toBeVisible();
  await expect(page.getByText("WhatsApp Ventas Bogotá", { exact: true })).toBeVisible();
  await expect(page.getByText("wa-sales-bogota", { exact: true })).toBeVisible();
  await expect(page.getByText("Desconectada", { exact: true })).toBeVisible();
  await expect(page.getByText("2 eventos sin atribuir", { exact: true })).toBeVisible();
  await expectHermeticNetwork(page, network);
});

test("vertical integrations expose projection freshness, mappings, and the Mindbody live boundary", async ({ page }) => {
  const network = await bootstrapTenantAdmin(page);

  await page.goto("/admin/settings/integrations/vertical");
  await expect(page.getByRole("heading", { name: "Integraciones verticales", exact: true })).toBeVisible();
  await expect(page.getByText(/Recurso: location · loc-bogota · API toast-e2e-v1/)).toBeVisible();
  await expect(page.getByText("location:local-bogota", { exact: true })).toBeVisible();
  await expect(page.getByText("→ ext-bogota", { exact: true })).toBeVisible();
  await expect(page.getByText("v3", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "Sincroniza clases y horarios para descubrimiento. No confirma cupos ni reservas en vivo.",
    { exact: true },
  )).toBeVisible();
  await expectHermeticNetwork(page, network);
});
