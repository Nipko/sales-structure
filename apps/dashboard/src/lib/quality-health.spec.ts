import type { AgentQualityAttentionSummary } from "@parallext/shared";
import {
  QUALITY_HEALTH_CACHE_MS,
  getQualityAttentionCount,
  safeQualityHref,
  shouldBootstrapQualitySummary,
  shouldShowQualityAttentionBanner,
} from "./quality-health";

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
