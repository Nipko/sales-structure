import * as fs from "fs";
import * as path from "path";

/**
 * Review of 2026-10-08, narrow screens: the floating assistant covered the
 * agent's Save button and table columns, and the trial and agent-alert banners
 * took about a third of the screen.
 *
 * jsdom has no layout, so these pin the contract in the source: the classes and
 * the attribute that make the layout behave, which is what a refactor drops.
 */
const SRC = path.join(__dirname, "..");
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), "utf8");

describe("floating assistant launcher", () => {
  const css = read("app", "globals.css");
  const launcher = read("components", "HelpAssistant.tsx");

  it("is smaller on a phone and keeps its place in the stylesheet hook", () => {
    expect(launcher).toContain("parallly-launcher");
    expect(launcher).toMatch(/scale-\[0\.7\][^"`]*sm:scale-100/);
  });

  it("is lifted above the bottom of the screen on narrow widths", () => {
    expect(css).toMatch(/@media \(max-width: 767px\)\s*{\s*button\.parallly-launcher\s*{\s*bottom: 5\.25rem;/);
  });

  it("is lifted over a screen's fixed action bar, at any width", () => {
    expect(css).toMatch(/body:has\(\[data-sticky-actions\]\) button\.parallly-launcher\s*{\s*bottom: 5rem;/);
  });

  it.each([
    ["app/admin/agent/[agentId]/page.tsx", ["app", "admin", "agent", "[agentId]", "page.tsx"]],
    ["app/admin/settings/pipeline/page.tsx", ["app", "admin", "settings", "pipeline", "page.tsx"]],
    ["app/admin/settings/scoring-config/page.tsx", ["app", "admin", "settings", "scoring-config", "page.tsx"]],
  ])("declares its fixed save bar in %s", (_label, parts) => {
    expect(read(...parts)).toMatch(/<div data-sticky-actions className="fixed bottom-0 /);
  });
});

describe("banners on a phone", () => {
  it("are capped to a scrollable strip below md and unconstrained from md up", () => {
    const layout = read("app", "admin", "layout.tsx");
    expect(layout).toContain("max-h-[22vh]");
    expect(layout).toContain("md:max-h-none");
    expect(layout.indexOf("max-h-[22vh]")).toBeLessThan(layout.indexOf("<TrialCountdownBanner"));
    expect(layout.indexOf("<QualityFocusBanner")).toBeLessThan(layout.indexOf('<main id="main-content"'));
  });

  it("keep the agent alert to a compact row with icon-only secondary actions", () => {
    const banner = read("components", "quality", "QualityAttentionBanner.tsx");
    expect(banner).toContain("line-clamp-2");
    expect(banner).toContain('<div className="flex items-center gap-2">');
    // The labels stay available to assistive technology.
    expect(banner).toContain('<span className="sr-only sm:not-sr-only">{t("askAssist")}</span>');
    expect(banner).toContain('<span className="sr-only sm:not-sr-only">{t("snooze24h")}</span>');
  });
});
