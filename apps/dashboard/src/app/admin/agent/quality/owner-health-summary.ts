import type { AgentQualityOverview } from "@parallext/shared";

export type OwnerAttentionState = "confirmed" | "attention" | "unverified";
export type OwnerOutcomeState = "none" | "insufficient" | "observed";

export interface OwnerHealthSummary {
  attention: OwnerAttentionState;
  preparation: { passed: number; applicable: number };
  outcomes: OwnerOutcomeState;
  sampleSize: number;
  minimumSample: number;
  nextRecommendationCode: string | null;
  nextRecommendationHref: string | null;
}

export function buildOwnerHealthSummary(overview: AgentQualityOverview): OwnerHealthSummary {
  const checks = overview.preparation.dimensions.flatMap((dimension) => dimension.checks);
  const operational = checks.filter((check) =>
    ["agent_active", "channel_connection", "channel_unanswered", "whatsapp_delivery"].includes(check.code),
  );
  const attention: OwnerAttentionState = operational.some((check) => check.status === "fail" || check.status === "warning")
    ? "attention"
    : operational.length > 0 && operational.every((check) => check.status === "pass" || check.status === "not_applicable")
      ? "confirmed"
      : "unverified";
  const outcomes: OwnerOutcomeState = overview.production.sampleSize === 0
    ? "none"
    : overview.production.sampleSize < overview.production.minimumSample
      ? "insufficient"
      : "observed";
  const next = overview.recommendations[0] ?? null;
  return {
    attention,
    preparation: { passed: overview.preparation.passed, applicable: overview.preparation.applicable },
    outcomes,
    sampleSize: overview.production.sampleSize,
    minimumSample: overview.production.minimumSample,
    nextRecommendationCode: next?.code ?? null,
    nextRecommendationHref: next?.href ?? null,
  };
}
