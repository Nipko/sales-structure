import * as fs from "fs";
import * as path from "path";
import {
  AGENT_REVIEW_MODE_COPY,
  agentReviewModeCopyKey,
  reviewModeFromResponse,
  reviewModeFromWorkspace,
  reviewedOnlyAgentReviewModeKeys,
  withinNamespace,
} from "./agent-review-mode";

/**
 * The one table that decides what each surface says a save does.
 *
 * Three readings, not two: `unknown` (the read failed, or the role cannot read
 * the mode) must get a sentence that is true in BOTH modes — never the default
 * mode's promise that the change is already live, and never the draft wording.
 */

const MESSAGES = path.join(__dirname, "..", "..", "messages");
const LOCALES = ["es", "en", "pt", "fr"] as const;
const lookup = (source: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), source);

describe("agent review mode readings", () => {
  it("reads the editor's workspace, and nothing it cannot vouch for", () => {
    expect(reviewModeFromWorkspace({ directCommit: true })).toBe("immediate");
    expect(reviewModeFromWorkspace({ directCommit: false })).toBe("reviewed");
    expect(reviewModeFromWorkspace(null)).toBe("unknown");
    expect(reviewModeFromWorkspace({})).toBe("unknown");
    expect(reviewModeFromWorkspace({ directCommit: "true" })).toBe("unknown");
  });

  it("reads the review-mode endpoint, and treats every failure as unknown", () => {
    expect(reviewModeFromResponse({ success: true, data: { mode: "immediate" } })).toBe("immediate");
    expect(reviewModeFromResponse({ success: true, data: { mode: "reviewed" } })).toBe("reviewed");
    expect(reviewModeFromResponse({ success: true, data: { mode: "published" } })).toBe("unknown");
    expect(reviewModeFromResponse({ success: false, data: { mode: "reviewed" } })).toBe("unknown");
    expect(reviewModeFromResponse(undefined)).toBe("unknown");
  });

  it("keeps namespaces out of a scoped translator's key", () => {
    expect(withinNamespace(agentReviewModeCopyKey("toolModuleScope", "immediate"), "agentToolNavigation")).toBe("liveScope");
    expect(withinNamespace("agentDraft.save", "agentToolNavigation")).toBe("agentDraft.save");
  });
});

describe("agent review mode copy", () => {
  const sources = Object.fromEntries(LOCALES.map((locale) => [locale,
    JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"))]));

  it.each(LOCALES)("has every sentence of every mode in %s", (locale) => {
    const missing = Object.values(AGENT_REVIEW_MODE_COPY)
      .flatMap((copy) => Object.values(copy))
      .filter((key) => typeof lookup(sources[locale], key) !== "string");
    expect({ locale, missing }).toEqual({ locale, missing: [] });
  });

  it("never lets the unknown reading promise either mode", () => {
    for (const copy of Object.values(AGENT_REVIEW_MODE_COPY)) {
      const unknown = String(lookup(sources.es, copy.unknown));
      expect(unknown).not.toMatch(/borrador|publica|de inmediato|en cuanto guardas|ya responde/i);
      expect(copy.unknown).not.toBe(copy.immediate);
      expect(copy.unknown).not.toBe(copy.reviewed);
    }
  });

  it("puts the pipeline words only in the reviewed sentences", () => {
    for (const copy of Object.values(AGENT_REVIEW_MODE_COPY)) {
      expect(String(lookup(sources.es, copy.immediate))).not.toMatch(/borrador|publica|revisi[oó]n/i);
    }
    // And exempts from the day-0 jargon check exactly those, nothing shown otherwise.
    const reviewedOnly = reviewedOnlyAgentReviewModeKeys();
    expect(reviewedOnly).toEqual(expect.arrayContaining(["agentToolNavigation.draftScope", "agentToolNavigation.editorScopeReviewed"]));
    const shownOtherwise = Object.values(AGENT_REVIEW_MODE_COPY).flatMap((copy) => [copy.immediate, copy.unknown] as string[]);
    expect(reviewedOnly.filter((key) => shownOtherwise.includes(key))).toEqual([]);
  });
});
