import type { AgentQualityOverview } from "@parallext/shared";
import { buildOwnerHealthSummary } from "./owner-health-summary";

function overview(overrides: Partial<AgentQualityOverview> = {}): AgentQualityOverview {
  return {
    generatedAt: "2026-09-18T12:00:00.000Z",
    agent: { id: "a", name: "Ana", version: 1, isActive: true, updatedAt: "2026-09-18T12:00:00.000Z" },
    status: "ready_for_pilot", nextMilestone: "collect_production_evidence",
    preparation: { status: "ready", score: null, passed: 2, applicable: 3, criticalBlockers: [], dimensions: [
      { dimension: "robustness_operations", score: null, status: "ready", passed: 1, applicable: 1, checks: [
        { code: "channel_connection", dimension: "robustness_operations", status: "pass", critical: true, weight: 1 },
      ] },
    ] },
    tested: { status: "ready", score: null, stale: false, staleReasons: [], latestEval: null, latestSimulation: null },
    production: { status: "insufficient_evidence", observedScore: null, sampleSize: 0, minimumSample: 10, periodDays: 7, attributedSince: null, metrics: [], topIssues: [] },
    recommendations: [], ...overrides,
  };
}

describe("owner health summary", () => {
  it("does not turn no traffic into a failure or a result", () => {
    expect(buildOwnerHealthSummary(overview())).toMatchObject({ attention: "confirmed", outcomes: "none", sampleSize: 0 });
  });
  it("keeps unknown channel evidence unverified", () => {
    const input = overview();
    input.preparation.dimensions[0].checks[0].status = "unknown";
    expect(buildOwnerHealthSummary(input).attention).toBe("unverified");
  });
  it("prioritizes a real recommendation and distinguishes a small sample", () => {
    const input = overview({ recommendations: [{ code: "fix_channel_connection", pillar: "preparation", dimension: "robustness_operations", severity: "critical", href: "/admin/channels" }] });
    input.production.sampleSize = 4;
    expect(buildOwnerHealthSummary(input)).toMatchObject({ outcomes: "insufficient", nextRecommendationCode: "fix_channel_connection", nextRecommendationHref: "/admin/channels" });
  });
});
