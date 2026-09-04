import type { AgentQualityAttentionSummary } from "@parallext/shared";
import {
  QUALITY_FOCUS_AGENT_PARAM,
  QUALITY_FOCUS_SIGNAL_PARAM,
  QUALITY_HEALTH_CACHE_MS,
  getFocusedQualitySignal,
  getQualityAttentionCount,
  readQualityFocus,
  safeQualityHref,
  setFocusedQualitySignal,
  shouldBootstrapQualitySummary,
  shouldShowQualityAttentionBanner,
  stripQualityFocus,
  subscribeFocusedQualitySignal,
  withQualityFocus,
} from "./quality-health";

const SIGNAL_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const AGENT_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

function summary(overrides: Partial<AgentQualityAttentionSummary> = {}): AgentQualityAttentionSummary {
  return {
    generatedAt: new Date(0).toISOString(),
    worstStatus: "review_required",
    agentsTotal: 1,
    evaluatedAgents: 1,
    agentsNeedingAttention: 1,
    openCritical: 0,
    openHigh: 2,
    attentionCount: 2,
    agents: [],
    ...overrides,
  };
}

describe("quality health presentation rules", () => {
  it("uses only critical and high actions for the navigation badge", () => {
    expect(getQualityAttentionCount(summary({ openCritical: 2, openHigh: 3, attentionCount: 99 }))).toBe(5);
  });

  it("only promotes critical or at-risk health into a global banner", () => {
    const topAction = {
      signalId: "s1", agentId: "a1", agentName: "Ventas", code: "refresh_eval" as const,
      severity: "high" as const, href: "/admin/agent/quality", evidenceCount: 1,
    };
    expect(shouldShowQualityAttentionBanner(summary({ topAction }))).toBe(false);
    expect(shouldShowQualityAttentionBanner(summary({ worstStatus: "at_risk", topAction }))).toBe(true);
    expect(shouldShowQualityAttentionBanner(summary({ topAction: { ...topAction, severity: "critical" } }))).toBe(true);
  });

  it("rejects external hrefs and falls back to an agent-scoped center link", () => {
    expect(safeQualityHref("https://example.test", "agent one")).toBe("/admin/agent/quality?agent=agent%20one");
    expect(safeQualityHref("/admin/knowledge", "a1")).toBe("/admin/knowledge");
  });

  it("bootstraps only missing snapshots and retries after the bounded cooldown", () => {
    const now = QUALITY_HEALTH_CACHE_MS * 2;
    const missing = summary({ agentsTotal: 3, evaluatedAgents: 1 });
    expect(shouldBootstrapQualitySummary(missing, 0, now)).toBe(true);
    expect(shouldBootstrapQualitySummary(missing, now - 1_000, now)).toBe(false);
    expect(shouldBootstrapQualitySummary(missing, now - QUALITY_HEALTH_CACHE_MS, now)).toBe(true);
    // A legitimate not_evaluated snapshot still counts as evaluated server-side.
    expect(shouldBootstrapQualitySummary(summary({
      worstStatus: "not_evaluated", agentsTotal: 1, evaluatedAgents: 1,
    }), 0, now)).toBe(false);
  });
});

describe("quality focus parameters", () => {
  const focus = { signalId: SIGNAL_ID, agentId: AGENT_ID };

  it("keeps the query the destination already carried", () => {
    expect(withQualityFocus("/admin/channels", focus))
      .toBe(`/admin/channels?${QUALITY_FOCUS_SIGNAL_PARAM}=${SIGNAL_ID}&${QUALITY_FOCUS_AGENT_PARAM}=${AGENT_ID}`);
    const withTab = withQualityFocus("/admin/agent/1?tab=persona&focus=name", focus);
    const params = new URLSearchParams(withTab.split("?")[1]);
    expect(withTab.startsWith("/admin/agent/1?")).toBe(true);
    expect(params.get("tab")).toBe("persona");
    expect(params.get("focus")).toBe("name");
    expect(params.get(QUALITY_FOCUS_SIGNAL_PARAM)).toBe(SIGNAL_ID);
    expect(withQualityFocus("/admin/knowledge#faqs", focus).endsWith("#faqs")).toBe(true);
  });

  it("refuses to decorate anything that is not an in-app admin route", () => {
    expect(withQualityFocus("https://example.test/admin", focus)).toBe("https://example.test/admin");
    expect(withQualityFocus("//evil.test/admin", focus)).toBe("//evil.test/admin");
    expect(withQualityFocus("/admin/../login", focus)).toBe("/admin/../login");
    expect(withQualityFocus("/login", focus)).toBe("/login");
    // A malformed pair must not produce a link the reader cannot explain.
    expect(withQualityFocus("/admin/channels", { signalId: "not-a-uuid", agentId: AGENT_ID }))
      .toBe("/admin/channels");
    expect(withQualityFocus("/admin/channels", null)).toBe("/admin/channels");
  });

  it("only accepts a complete pair of UUIDs coming back from the URL", () => {
    expect(readQualityFocus(new URLSearchParams(`qa=${SIGNAL_ID}&qagent=${AGENT_ID}`)))
      .toEqual({ signalId: SIGNAL_ID, agentId: AGENT_ID });
    expect(readQualityFocus(new URLSearchParams(`qa=${SIGNAL_ID}`))).toBeNull();
    expect(readQualityFocus(new URLSearchParams(`qa=1 OR 1=1&qagent=${AGENT_ID}`))).toBeNull();
    expect(readQualityFocus(null)).toBeNull();
  });

  it("strips the pair without losing the rest of the query", () => {
    const params = new URLSearchParams(`tab=persona&qa=${SIGNAL_ID}&qagent=${AGENT_ID}`);
    expect(stripQualityFocus("/admin/agent/1", params)).toBe("/admin/agent/1?tab=persona");
    expect(stripQualityFocus("/admin/channels", new URLSearchParams(`qa=${SIGNAL_ID}`)))
      .toBe("/admin/channels");
    expect(stripQualityFocus("/admin/channels", null)).toBe("/admin/channels");
  });

  it("publishes the focused signal so only one red bar can claim it", () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeFocusedQualitySignal(() => seen.push(getFocusedQualitySignal()));
    setFocusedQualitySignal(SIGNAL_ID);
    setFocusedQualitySignal(SIGNAL_ID); // idempotent: no duplicate notification
    setFocusedQualitySignal(null);
    unsubscribe();
    setFocusedQualitySignal(SIGNAL_ID);
    expect(seen).toEqual([SIGNAL_ID, null]);
    setFocusedQualitySignal(null);
  });
});
