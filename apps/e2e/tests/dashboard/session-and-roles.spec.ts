import { expect, test } from "@playwright/test";
import { dashboardShell } from "../../fixtures/dashboard-routes";
import {
  expectHermetic,
  hermeticDashboard,
  settled,
  signIn,
  users,
  type DashboardRole,
} from "../../fixtures/dashboard-session";

/**
 * Who gets in, what they see, and whose data it is.
 *
 * Everything past the login screen was untested in a browser. That matters
 * most here rather than anywhere else, because the access rules are the one
 * part of this product where a mistake is not a bad experience — it is one
 * business reading another's conversations, or an agent seeing the owner's
 * billing.
 *
 * The rules themselves live in `roles.ts` and are deny-by-default. What this
 * checks is the half a unit test cannot: that the browser actually honours
 * them, that a page does not render its content for a second before deciding,
 * and that the tenant a page loads for is the tenant in the session.
 */

const shell = dashboardShell();

test.describe("a signed-in dashboard", () => {
  test("puts a tenant admin on their own dashboard, asking for nothing undeclared", async ({ page }) => {
    const state = await hermeticDashboard(page, shell);
    const user = await signIn(page, "tenant_admin");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin(?:\/|$|\?)/);
    await settled(page);

    // The strict half: a page that grew a new dependency fails here by name,
    // which is the moment a screen starts depending on an endpoint nobody
    // reviewed.
    await expectHermetic(state);

    // Every tenant-scoped call carries the session's tenant and no other.
    const scoped = state.observed.filter((path) => /[0-9a-f-]{36}/.test(path));
    expect(scoped.length).toBeGreaterThan(0);
    for (const path of scoped) {
      const found = path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
      expect({ path, foreign: found.filter((id) => id !== user.tenantId) })
        .toEqual({ path, foreign: [] });
    }
  });

  test("sends an unauthenticated visitor to the login screen instead of rendering the shell", async ({ page }) => {
    const state = await hermeticDashboard(page, shell);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await settled(page);
    // And it does not ask the API anything on the way: an unauthenticated
    // request that still fetches is a request carrying `Bearer null`.
    expect(state.observed.filter((path) => path.startsWith("analytics/"))).toEqual([]);
    await expectHermetic(state);
  });

  test("does not accept half a session", async ({ page }) => {
    const state = await hermeticDashboard(page, shell);
    // The user, without the token. This is what a browser is left holding when
    // a refresh fails or a sign-out is interrupted, and it is the state where
    // rendering the shell anyway would show a cached tenant to whoever opens
    // the machine next — and send `Bearer null` on every call while doing it.
    await page.addInitScript(() => {
      window.localStorage.removeItem("accessToken");
      window.localStorage.setItem("user", JSON.stringify({
        id: "22222222-2222-4222-8222-222222222222",
        email: "duena@negocio.test", role: "tenant_admin",
        tenantId: "33333333-3333-4333-8333-333333333333",
      }));
    });
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await settled(page);
    expect(state.observed.filter((path) => path.startsWith("analytics/"))).toEqual([]);
    await expectHermetic(state);
  });

  test("keeps a super_admin out of a tenant it has not been asked to act on", async ({ page }) => {
    const state = await hermeticDashboard(page, shell);
    const operator = await signIn(page, "super_admin");
    // Platform mode: no implicit tenant. This is the rule
    // `docs/superadmin-governance.md` exists for — acting on a tenant is an
    // impersonation with a reason, never a side effect of being an operator.
    expect(operator.tenantId).toBeNull();
    await page.goto("/admin");
    await settled(page);
    const tenantScoped = state.observed.filter((path) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(path));
    expect({ tenantScoped: [...new Set(tenantScoped)] }).toEqual({ tenantScoped: [] });
    await expectHermetic(state);
  });

  for (const role of ["tenant_admin", "tenant_supervisor", "tenant_agent"] as DashboardRole[]) {
    test(`loads the shell for a ${role} without asking for another tenant's data`, async ({ page }) => {
      const state = await hermeticDashboard(page, shell);
      await signIn(page, role);
      await page.goto("/admin");
      await settled(page);
      const stranger = state.observed.filter((path) =>
        (path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])
          .some((id) => id !== users[role].tenantId));
      expect({ role, stranger }).toEqual({ role, stranger: [] });
      await expectHermetic(state);
    });
  }
});
