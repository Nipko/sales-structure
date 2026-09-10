import { expect, type Page, type Route } from "@playwright/test";

/**
 * A signed-in dashboard, with nothing behind it.
 *
 * The authenticated half of this product could not be tested at all before
 * this: the existing specs cover the landing site and the login screen, and
 * everything past it needs a session and an API. Standing up the real API is
 * not the answer — a browser test that needs PostgreSQL, Redis and a model key
 * is a test nobody runs — so the session is seeded and the API is declared.
 *
 * ── Declared, and nothing else ──────────────────────────────────────────────
 *
 * Every call a page makes has to be named by the test that opens it. An
 * undeclared call is recorded and fails the assertion at the end rather than
 * being quietly stubbed, and that strictness is the point: it is how a test
 * notices that a page started asking for something new, which is exactly the
 * moment a screen silently depends on an endpoint nobody reviewed.
 *
 * Undeclared calls are still answered — with a 404 — so the page renders and
 * the test can say what it saw as well as what it asked for. A hang would only
 * produce a timeout, and a timeout tells you nothing about which call was
 * missing.
 *
 * ── Nothing leaves the machine ──────────────────────────────────────────────
 *
 * The Playwright config already maps every hostname to NOTFOUND except
 * loopback. This adds the second half: any request to the production API is
 * recorded by name, so a hard-coded URL fails loudly instead of failing as a
 * network error somebody reads as flakiness.
 */

export type DashboardRole =
  | "super_admin"
  | "tenant_admin"
  | "tenant_supervisor"
  | "tenant_agent";

export interface SeededUser {
  id: string;
  email: string;
  name: string;
  role: DashboardRole;
  tenantId: string | null;
  onboardingStage?: string;
}

export interface HermeticState {
  /** Calls to the production API. Always a defect. */
  productionRequests: string[];
  /** Calls no test declared. The list is the finding, not the count. */
  undeclared: string[];
  /** Every API path the page asked for, in order. */
  observed: string[];
  /**
   * `METHOD path` for everything that was not a GET.
   *
   * Separate from `observed` because "did this change anything" is a different
   * question from "what did it read", and it is the one a guided tour has to
   * answer with an empty list: a tour opens screens and points at them, and a
   * tour that saved something would be changing a business's configuration
   * while claiming to explain it.
   */
  writes: string[];
}

/** `null` tenant is the real shape of a super_admin: platform mode, no implicit tenant. */
export const users: Record<DashboardRole, SeededUser> = {
  super_admin: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "operator@parallly.test",
    name: "Operadora de plataforma",
    role: "super_admin",
    tenantId: null,
  },
  tenant_admin: {
    id: "22222222-2222-4222-8222-222222222222",
    email: "duena@negocio.test",
    name: "Dueña del negocio",
    role: "tenant_admin",
    tenantId: "33333333-3333-4333-8333-333333333333",
    onboardingStage: "ready",
  },
  tenant_supervisor: {
    id: "44444444-4444-4444-8444-444444444444",
    email: "supervisora@negocio.test",
    name: "Supervisora",
    role: "tenant_supervisor",
    tenantId: "33333333-3333-4333-8333-333333333333",
    onboardingStage: "ready",
  },
  tenant_agent: {
    id: "55555555-5555-4555-8555-555555555555",
    email: "agente@negocio.test",
    name: "Agente",
    role: "tenant_agent",
    tenantId: "33333333-3333-4333-8333-333333333333",
    onboardingStage: "ready",
  },
};

/**
 * Seeds the session the way a login would leave it.
 *
 * `addInitScript` rather than a click through the login form: the form is
 * already covered by its own spec, and repeating it in front of every
 * authenticated test would make each of them fail for two reasons instead of
 * one.
 */
export async function signIn(
  page: Page,
  role: DashboardRole,
  overrides: Partial<SeededUser> = {},
): Promise<SeededUser> {
  const user = { ...users[role], ...overrides };
  await page.addInitScript((seeded: SeededUser) => {
    window.localStorage.setItem("accessToken", "e2e.access.token");
    window.localStorage.setItem("refreshToken", "e2e.refresh.token");
    window.localStorage.setItem("user", JSON.stringify(seeded));
    if (seeded.tenantId) {
      window.localStorage.setItem("activeTenantId", seeded.tenantId);
    }
  }, user);
  return user;
}

export type ApiReply = { status?: number; body?: unknown };
export type ApiRoutes = Record<string, ApiReply | ((url: URL) => ApiReply)>;

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

/**
 * Installs the guard and the declared API.
 *
 * Keys are matched as a prefix of the path after `/api/v1`, longest first, so
 * `agents/33333333` wins over `agents`. A prefix rather than an exact match
 * because most of these paths carry a tenant id, and repeating it in every key
 * would make the tests about string assembly.
 */
export async function hermeticDashboard(
  page: Page,
  routes: ApiRoutes = {},
): Promise<HermeticState> {
  const state: HermeticState = {
    productionRequests: [],
    undeclared: [],
    observed: [],
    writes: [],
  };
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);

  // Google Identity, which the login screen loads and every page inherits.
  await page.route(
    /^https:\/\/[^/]*(?:google|gstatic|googleapis)[^/]*\//,
    async (route) => {
      if (route.request().resourceType() === "script") {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: "window.google={accounts:{id:{initialize(){},renderButton(e){e.innerHTML='<button type=\"button\"></button>';},prompt(){}}}};",
        });
        return;
      }
      await route.fulfill({ status: 204, body: "" });
    },
  );

  await page.route(/\/api\/v1(?:\/|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname.endsWith("parallly-chat.cloud")) {
      state.productionRequests.push(url.toString());
      await route.abort("blockedbyclient");
      return;
    }
    const path = url.pathname.replace(/^.*\/api\/v1\/?/, "");
    state.observed.push(path);
    const method = route.request().method();
    if (method !== "GET") state.writes.push(`${method} ${path}`);
    const key = keys.find((candidate) => path.startsWith(candidate));
    if (!key) {
      // Answered, not hung: a timeout would say nothing about which call was
      // missing, and the list below is the whole finding.
      state.undeclared.push(path);
      await json(route, 404, { success: false, error: "e2e_undeclared_route" });
      return;
    }
    const reply = routes[key];
    const resolved = typeof reply === "function" ? reply(url) : reply;
    await json(route, resolved.status ?? 200, resolved.body ?? { success: true, data: null });
  });

  // WebSockets are a different transport and would otherwise dial out.
  await page.route(/\/socket\.io\//, (route) => route.fulfill({ status: 204, body: "" }));

  return state;
}

/** Nothing left the machine, and nothing was asked for that nobody declared. */
export async function expectHermetic(state: HermeticState): Promise<void> {
  await expect.poll(() => state.productionRequests).toEqual([]);
  expect({ undeclared: [...new Set(state.undeclared)].sort() }).toEqual({ undeclared: [] });
}

/**
 * Waits until the app has decided what to show.
 *
 * `networkidle` is the wrong tool here and it took a parallel run to notice: the
 * dashboard sends a session heartbeat, so the network is never idle and the wait
 * only ever ends in a timeout. What actually settles is the DOM — either the
 * authenticated shell with its main landmark, or the login form — so that is
 * what is waited for.
 */
export async function settled(page: Page, timeout = 25_000): Promise<"shell" | "login"> {
  // The URL first. `/admin` mounts its shell and then routes on to the setup
  // wizard, so a check made between the two sees a `main` that is about to be
  // torn down — which is how this helper first reported "login" for a page
  // that never went near it.
  const deadline = Date.now() + timeout;
  let previous = "";
  let stableSince = 0;
  while (Date.now() < deadline) {
    const current = page.url();
    if (current !== previous) { previous = current; stableSince = Date.now(); }
    else if (Date.now() - stableSince > 600) break;
    await page.waitForTimeout(100);
  }

  const shell = page.locator("main, [role='main']").first();
  const login = page.locator("input[type='password']").first();
  await Promise.race([
    shell.waitFor({ state: "attached", timeout: Math.max(1_000, deadline - Date.now()) }),
    login.waitFor({ state: "attached", timeout: Math.max(1_000, deadline - Date.now()) }),
  ]);
  return (await shell.count()) ? "shell" : "login";
}

/** The reply shape the dashboard's `apiGet` expects. */
export const ok = (data: unknown): ApiReply => ({ body: { success: true, data } });
