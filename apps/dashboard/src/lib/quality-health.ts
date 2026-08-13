import type {
  AgentQualityAttentionSummary,
  AgentQualityStatus,
} from "@parallext/shared";

export const QUALITY_HEALTH_CACHE_MS = 5 * 60 * 1000;

export function getQualityAttentionCount(summary: AgentQualityAttentionSummary | null): number {
  if (!summary) return 0;
  return Math.max(0, Number(summary.openCritical) || 0)
    + Math.max(0, Number(summary.openHigh) || 0);
}

export function shouldShowQualityAttentionBanner(summary: AgentQualityAttentionSummary | null): boolean {
  if (!summary?.topAction) return false;
  return summary.topAction.severity === "critical" || summary.worstStatus === "at_risk";
}

export function shouldBootstrapQualitySummary(
  summary: AgentQualityAttentionSummary,
  lastAttemptAt = 0,
  now = Date.now(),
): boolean {
  return summary.agentsTotal > summary.evaluatedAgents
    && now - lastAttemptAt >= QUALITY_HEALTH_CACHE_MS;
}

export function safeQualityHref(href: string | null | undefined, agentId?: string | null): string {
  if (href
    && (href === "/admin" || href.startsWith("/admin/"))
    && !href.startsWith("//")
    && !href.includes("..")
    && !href.includes("\\")) return href;
  const suffix = agentId ? `?agent=${encodeURIComponent(agentId)}` : "";
  return `/admin/agent/quality${suffix}`;
}

export const QUALITY_STATUS_TONE: Record<AgentQualityStatus, string> = {
  not_evaluated: "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200",
  configuration_incomplete: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  at_risk: "border-red-300 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  ready_for_pilot: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  operating_with_evidence: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  review_required: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
};
