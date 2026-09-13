import { expect, test, type Page } from "@playwright/test";
import { dashboardShell } from "../../fixtures/dashboard-routes";
import { expectHermetic, hermeticDashboard, settled, signIn } from "../../fixtures/dashboard-session";

/**
 * Four languages, a keyboard, and no mouse.
 *
 * Both halves of this file exist for the same reason: the failures they catch
 * are invisible to everything else. A missing translation key renders as the
 * key itself — `admin.dashboard.title` in the middle of a page — and every unit
 * test passes while a customer reads a variable name. A control that only works
 * with a mouse looks identical in a screenshot to one that works with both.
 *
 * The locale comes from a cookie, which is what the language switcher writes,
 * so setting it directly exercises the same path a person does.
 */

const shell = dashboardShell();
const locales = ["es", "en", "pt", "fr"] as const;

/** A raw key that leaked through instead of a translation. */
const UNTRANSLATED = /\b[a-z][a-zA-Z]*(?:\.[a-z][a-zA-Z0-9]*){2,}\b/;

async function withLocale(page: Page, locale: string) {
  await page.context().addCookies([
    { name: "locale", value: locale, url: "http://127.0.0.1:3001" },
  ]);
}

test.describe("the dashboard in four languages", () => {
  for (const locale of locales) {
    test(`renders the login screen in ${locale} without leaking a key`, async ({ page }) => {
      const state = await hermeticDashboard(page, shell);
      await withLocale(page, locale);
      await page.goto("/login");
      await settled(page);
      const main = page.locator("body");
      await expect(main).toBeVisible();
      const text = (await main.innerText()).replace(/\S+@\S+\.\S+/g, "");
      // A missing key renders as the key. Nobody notices in review, because
      // review is done in Spanish and the key looks like Spanish.
      expect({ locale, leaked: UNTRANSLATED.exec(text)?.[0] ?? null })
        .toEqual({ locale, leaked: null });
      await expectHermetic(state);
    });
  }

  test("changes what the page says when the language changes", async ({ page }) => {
    const state = await hermeticDashboard(page, shell);
    await withLocale(page, "es");
    await page.goto("/login");
    await settled(page);
    const spanish = await page.locator("body").innerText();
    await page.context().clearCookies();
    await withLocale(page, "fr");
    await page.goto("/login");
    await settled(page);
    const french = await page.locator("body").innerText();
    // A locale that is honoured everywhere except in the strings is a locale
    // that changes nothing a customer can see.
    expect(spanish).not.toBe(french);
    await expectHermetic(state);
  });
});

test.describe("without a mouse", () => {
  test("reaches and operates the login form from the keyboard alone", async ({ page }) => {
    const state = await hermeticDashboard(page, {
      ...shell,
      "auth/login": { status: 401, body: { success: false, error: "invalid_credentials" } },
    });
    await page.goto("/login");
    await settled(page);

    const reached: string[] = [];
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return null;
        // The Next.js dev overlay puts its own element in the tab order. It is
        // not shipped and not ours, so measuring its focus ring would be
        // measuring the toolchain.
        if (element.tagName.toLowerCase().startsWith("nextjs-")) return null;
        const style = window.getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          type: (element as HTMLInputElement).type ?? null,
          // A focus a sighted keyboard user cannot see is a focus they lose.
          visible: style.outlineStyle !== "none" || style.boxShadow !== "none",
        };
      });
      if (focused) reached.push(`${focused.tag}:${focused.type ?? ""}:${focused.visible}`);
    }

    // The two fields and a way to submit, all reachable by Tab.
    expect(reached.some((entry) => entry.startsWith("input:email"))).toBe(true);
    expect(reached.some((entry) => entry.startsWith("input:password"))).toBe(true);
    expect(reached.some((entry) => entry.startsWith("button"))).toBe(true);
    // And every one of them shows where the focus is.
    expect({ invisible: reached.filter((entry) => entry.endsWith(":false")) })
      .toEqual({ invisible: [] });
    await expectHermetic(state);
  });

  test("labels its fields, so a screen reader has something to read", async ({ page }) => {
    const state = await hermeticDashboard(page, shell);
    await page.goto("/login");
    await settled(page);
    const unlabelled = await page.evaluate(() =>
      [...document.querySelectorAll("input, select, textarea")]
        .filter((element) => {
          const id = element.getAttribute("id");
          return !element.getAttribute("aria-label")
            && !element.getAttribute("aria-labelledby")
            && !(id && document.querySelector(`label[for="${id}"]`))
            && !element.closest("label");
        })
        .map((element) => element.outerHTML.slice(0, 80)));
    // An unlabelled field is read out as "edit text" and nothing else.
    expect({ unlabelled }).toEqual({ unlabelled: [] });
    await expectHermetic(state);
  });

  test("gives the page one main landmark and a first heading", async ({ page }) => {
    const state = await hermeticDashboard(page, shell);
    await signIn(page, "tenant_admin");
    await page.goto("/admin");
    // The shell renders a loading screen while it resolves the tenant's plan
    // and vertical, and then may route on to the setup wizard. Both have to
    // settle before anything is sampled: asserting on the spinner would fail
    // for the wrong reason, and evaluating mid-redirect fails for no reason.
    expect(await settled(page)).toBe("shell");
    // Landmarks are how a screen reader user skips the navigation instead of
    // hearing it on every page, and the heading is how they know where they
    // landed. Both are read through locators scoped to `main`, not through
    // `document.querySelector`: the Next dev overlay keeps headings inside a
    // shadow root, which a locator pierces and `querySelector` does not — so
    // the naive version waited happily for a heading that belongs to the
    // toolchain and then found none of the page's own.
    const landmark = page.locator("main, [role='main']").first();
    await expect(landmark).toBeAttached();
    const heading = landmark.locator("h1, h2, [role='heading']").first();
    await expect(heading).toBeAttached({ timeout: 15_000 });
    expect((await heading.innerText()).trim().length).toBeGreaterThan(0);
    await expectHermetic(state);
  });
});
