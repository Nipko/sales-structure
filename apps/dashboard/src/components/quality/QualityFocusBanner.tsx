"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertOctagon, Clock3, Compass, MessageCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  AgentQualityCheck,
  AgentQualityOverview,
  AgentQualitySeverity,
  AgentQualitySignal,
} from "@parallext/shared";
import {
  GUIDED_TOUR_START_EVENT,
  canRoleRunGuidedTour,
  findGuidedTourForQualityCode,
  type GuidedTourStartDetail,
} from "@parallext/shared";
import { useQualityHealth } from "@/contexts/QualityHealthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { canRunProductTourAtWidth } from "@/lib/product-tour-contract";
import { askAssistAboutQuality } from "@/lib/quality-health-events";
import {
  QUALITY_HEALTH_CACHE_MS,
  readQualityFocus,
  safeQualityHref,
  setFocusedQualitySignal,
  stripQualityFocus,
} from "@/lib/quality-health";
import { qualityCheckCodeFor, useRecommendationLabel } from "@/lib/quality-labels";
import { cn } from "@/lib/utils";

/**
 * The context bar that makes "Revisar" consequent.
 *
 * The global banner used to say "there is a critical action, check Laura Sofía
 * first" and send the person to Channels, where WhatsApp shows a green
 * "Connected" chip and nothing explains what is wrong. This bar travels with
 * the `?qa=&qagent=` pair and states, on the destination screen: which action,
 * for which agent, why (in plain language, from the check's own evidence) and
 * what to do about it — including a guided tour that points at the control.
 *
 * It never blocks the page: a 404 (the signal was resolved elsewhere) or an
 * older API during a rolling deploy degrades to a dismissible line.
 */

const SEVERITY_TONE: Record<AgentQualitySeverity, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  low: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200",
};

interface FocusPayload {
  signal: AgentQualitySignal;
  overview: AgentQualityOverview | null;
}

interface CachedFocus {
  data: FocusPayload | null;
  fetchedAt: number;
}

/** Module cache: navigating between the steps of one fix must not refetch. */
const focusCache = new Map<string, CachedFocus>();

function cacheKey(tenantId: string, signalId: string, agentId: string): string {
  return `${tenantId}:${signalId}:${agentId}`;
}

function findCheck(overview: AgentQualityOverview | null, code: string): AgentQualityCheck | null {
  if (!overview) return null;
  const wanted = qualityCheckCodeFor(code);
  for (const dimension of overview.preparation.dimensions) {
    const match = dimension.checks.find((check) => check.code === wanted);
    if (match) return match;
  }
  return null;
}

/** Evidence values are bounded scalars by contract; render them as-is. */
function evidenceEntries(check: AgentQualityCheck | null): [string, string | number | boolean][] {
  if (!check?.evidence) return [];
  return Object.entries(check.evidence)
    .filter((entry): entry is [string, string | number | boolean] =>
      entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
    .slice(0, 6);
}

function scalar(value: unknown, fallback = ""): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

export default function QualityFocusBanner() {
  const t = useTranslations("qualityHealth");
  const tQuality = useTranslations("agentQuality");
  const recommendationLabel = useRecommendationLabel();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeTenantId } = useTenant();
  const { role, isSuperAdmin, impersonating, canAccess } = useRole();
  const { snoozeSignal } = useQualityHealth();

  const eligible = role === "tenant_admin"
    || role === "tenant_supervisor"
    || (isSuperAdmin && impersonating);

  const focus = useMemo(() => readQualityFocus(searchParams), [searchParams]);
  const [payload, setPayload] = useState<FocusPayload | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "gone">("idle");
  const [snoozing, setSnoozing] = useState(false);
  const [wideEnoughForTour, setWideEnoughForTour] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const sync = () => setWideEnoughForTour(canRunProductTourAtWidth(window.innerWidth));
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!eligible || !activeTenantId || !focus) {
      setPayload(null);
      setState("idle");
      return;
    }

    let cancelled = false;
    const key = cacheKey(activeTenantId, focus.signalId, focus.agentId);
    const cached = focusCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < QUALITY_HEALTH_CACHE_MS) {
      setPayload(cached.data);
      setState(cached.data ? "ready" : "gone");
      return;
    }

    setState("loading");
    void (async () => {
      // The overview is best-effort: without it the bar still names the action,
      // it just cannot spell out the evidence.
      const [signalResponse, overviewResponse] = await Promise.all([
        api.getAgentQualitySignal(activeTenantId, focus.signalId, focus.agentId),
        api.getAgentQualityOverview(activeTenantId, focus.agentId).catch(() => null),
      ]);
      if (cancelled) return;

      if (!signalResponse?.success || !signalResponse.data) {
        focusCache.set(key, { data: null, fetchedAt: Date.now() });
        setPayload(null);
        setState("gone");
        return;
      }

      const overview = overviewResponse?.success && overviewResponse.data
        && overviewResponse.data.agent.id === focus.agentId
        ? overviewResponse.data
        : null;
      const next: FocusPayload = { signal: signalResponse.data, overview };
      focusCache.set(key, { data: next, fetchedAt: Date.now() });
      setPayload(next);
      setState("ready");
    })();

    return () => { cancelled = true; };
  }, [activeTenantId, eligible, focus]);

  const visible = Boolean(focus) && (state === "ready" || state === "gone");

  // Tell QualityAttentionBanner to stand down while this bar owns the signal.
  useEffect(() => {
    setFocusedQualitySignal(visible && focus ? focus.signalId : null);
    return () => setFocusedQualitySignal(null);
  }, [focus, visible]);

  const dismiss = useCallback(() => {
    setFocusedQualitySignal(null);
    router.replace(stripQualityFocus(pathname, searchParams));
  }, [pathname, router, searchParams]);

  const handleSnooze = useCallback(async () => {
    if (!focus) return;
    setSnoozing(true);
    await snoozeSignal(focus.signalId, 24);
    if (activeTenantId) focusCache.delete(cacheKey(activeTenantId, focus.signalId, focus.agentId));
    setSnoozing(false);
    dismiss();
  }, [activeTenantId, dismiss, focus, snoozeSignal]);

  if (!visible || !focus) return null;

  if (state === "gone" || !payload) {
    return (
      <div
        role="region"
        aria-live="polite"
        aria-label={t("focus.title")}
        className="shrink-0 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
      >
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-sm">{t("focus.signalGone")}</p>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-neutral-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 dark:hover:bg-neutral-800"
          >
            <X size={13} aria-hidden="true" /> {t("focus.close")}
          </button>
        </div>
      </div>
    );
  }

  const { signal, overview } = payload;
  const check = findCheck(overview, signal.code);
  const evidence = check?.evidence ?? {};
  const explanationCode = `focus.explanations.${signal.code}`;
  const explanation = t(t.has(explanationCode) ? explanationCode : "focus.explanations.generic", {
    agent: signal.agent.name,
    assigned: scalar(evidence.assigned ?? evidence.assignedChannels ?? evidence.assignedCount, "0"),
    connected: scalar(evidence.connected ?? evidence.connectedAssignments, "0"),
    disconnected: scalar(evidence.disconnectedChannels, t("focus.noneValue")),
    connectedChannels: scalar(evidence.connectedChannels, t("focus.noneValue")),
    credentialIssue: scalar(evidence.credentialIssue, "none"),
  });

  const tour = findGuidedTourForQualityCode(signal.code);
  const canShowMe = Boolean(tour)
    && canRoleRunGuidedTour(tour!, role)
    && wideEnoughForTour;
  const reviewHref = safeQualityHref(signal.href, signal.agent.id);

  const startTour = () => {
    if (!tour) return;
    const detail: GuidedTourStartDetail = {
      tourId: tour.id,
      signalId: focus.signalId,
      agentId: focus.agentId,
    };
    window.dispatchEvent(new CustomEvent<GuidedTourStartDetail>(GUIDED_TOUR_START_EVENT, { detail }));
  };

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={t("focus.title")}
      className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <AlertOctagon size={17} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold">{recommendationLabel(signal.code)}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", SEVERITY_TONE[signal.severity])}>
                {tQuality(`severities.${signal.severity}`)}
              </span>
              <span className="text-amber-900/80 dark:text-amber-100/80">
                {t("focus.from", { agent: signal.agent.name })}
              </span>
            </p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/90">{explanation}</p>
            {evidenceEntries(check).length > 0 && (
              <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {evidenceEntries(check).map(([key, value]) => (
                  <div key={key} className="flex gap-1 rounded-md bg-white/50 px-1.5 py-0.5 text-[11px] dark:bg-black/20">
                    <dt className="opacity-75">
                      {tQuality.has(`evidenceKeys.${key}`) ? tQuality(`evidenceKeys.${key}`) : tQuality("evidenceKeys.unknown")}:
                    </dt>
                    <dd className="font-semibold">
                      {typeof value === "boolean" ? tQuality(value ? "common.yes" : "common.no") : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-6 xl:pl-0">
          {canShowMe && (
            <button
              type="button"
              onClick={startTour}
              className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 dark:bg-amber-500 dark:text-neutral-950 dark:hover:bg-amber-400"
            >
              <Compass size={13} aria-hidden="true" /> {t("focus.showMe")}
            </button>
          )}
          <button
            type="button"
            onClick={() => askAssistAboutQuality({
              signalId: signal.id,
              agentId: signal.agent.id,
              agentName: signal.agent.name,
              code: signal.code,
              severity: signal.severity,
              href: canAccess(reviewHref) ? reviewHref : safeQualityHref(null, signal.agent.id),
            })}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:hover:bg-amber-500/20"
          >
            <MessageCircle size={13} aria-hidden="true" /> {t("askAssist")}
          </button>
          <button
            type="button"
            onClick={() => void handleSnooze()}
            disabled={snoozing}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-amber-500/20"
          >
            <Clock3 size={13} aria-hidden="true" /> {t("snooze24h")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("focus.close")}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:hover:bg-amber-500/20"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
