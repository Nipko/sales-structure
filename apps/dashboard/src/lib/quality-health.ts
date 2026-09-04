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

/**
 * Quality focus — how a screen learns it was opened FROM a quality signal.
 *
 * The banner sends the person to the screen that fixes the problem, and that
 * screen used to say nothing about why they were there (WhatsApp shows green
 * while the agent is flagged critical). These two parameters carry the signal
 * across the navigation so `QualityFocusBanner` can explain it in place.
 * Anything that is not a pair of UUIDs is ignored: the parameters reach the
 * URL bar, so they are treated as untrusted input on the way back in.
 */
export const QUALITY_FOCUS_SIGNAL_PARAM = "qa";
export const QUALITY_FOCUS_AGENT_PARAM = "qagent";

export interface QualityFocus {
  signalId: string;
  agentId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSafeAdminHref(href: string): boolean {
  const path = href.split("?")[0].split("#")[0];
  return (path === "/admin" || path.startsWith("/admin/"))
    && !href.startsWith("//")
    && !href.includes("..")
    && !href.includes("\\");
}

/**
 * Adds the focus pair to an in-app href, preserving any query it already has.
 * Returns the href untouched when it is not an `/admin` route or when the focus
 * is not a valid pair, so a caller can pipe every href through it safely.
 */
export function withQualityFocus(href: string, focus: Partial<QualityFocus> | null | undefined): string {
  if (!href || !isSafeAdminHref(href)) return href;
  if (!focus || !isUuid(focus.signalId) || !isUuid(focus.agentId)) return href;

  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "");
  params.set(QUALITY_FOCUS_SIGNAL_PARAM, focus.signalId);
  params.set(QUALITY_FOCUS_AGENT_PARAM, focus.agentId);
  return `${path}?${params.toString()}${hash}`;
}

/** Reads the focus pair from the current query. Both ids must be valid UUIDs. */
export function readQualityFocus(
  params: URLSearchParams | { get(name: string): string | null } | null | undefined,
): QualityFocus | null {
  if (!params) return null;
  const signalId = params.get(QUALITY_FOCUS_SIGNAL_PARAM);
  const agentId = params.get(QUALITY_FOCUS_AGENT_PARAM);
  if (!isUuid(signalId) || !isUuid(agentId)) return null;
  return { signalId, agentId };
}

/** The same route without the focus pair, keeping every other parameter. */
export function stripQualityFocus(
  pathname: string,
  params: URLSearchParams | { toString(): string } | null | undefined,
): string {
  const next = new URLSearchParams(params ? params.toString() : "");
  next.delete(QUALITY_FOCUS_SIGNAL_PARAM);
  next.delete(QUALITY_FOCUS_AGENT_PARAM);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Which signal the focus bar is currently explaining.
 *
 * `QualityAttentionBanner` hides while the focus bar shows the SAME signal —
 * two red bars saying the same thing read as two problems. The state lives in
 * a module store rather than the URL because only the focus bar may call
 * `useSearchParams` (it is the component the layout wraps in `<Suspense>`).
 */
let focusedQualitySignalId: string | null = null;
const focusedQualitySignalListeners = new Set<() => void>();

export function setFocusedQualitySignal(signalId: string | null): void {
  if (focusedQualitySignalId === signalId) return;
  focusedQualitySignalId = signalId;
  focusedQualitySignalListeners.forEach((listener) => listener());
}

export function getFocusedQualitySignal(): string | null {
  return focusedQualitySignalId;
}

/** Server render never has a focused signal; the URL is read on the client. */
export function getFocusedQualitySignalServerSnapshot(): string | null {
  return null;
}

export function subscribeFocusedQualitySignal(listener: () => void): () => void {
  focusedQualitySignalListeners.add(listener);
  return () => { focusedQualitySignalListeners.delete(listener); };
}

export const QUALITY_STATUS_TONE: Record<AgentQualityStatus, string> = {
  not_evaluated: "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200",
  configuration_incomplete: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  at_risk: "border-red-300 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  ready_for_pilot: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  operating_with_evidence: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  review_required: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
};
