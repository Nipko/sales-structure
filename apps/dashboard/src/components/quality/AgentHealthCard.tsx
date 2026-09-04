"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Bot, MessageCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQualityHealth } from "@/contexts/QualityHealthContext";
import { useRole } from "@/hooks/useRole";
import { askAssistAboutQuality } from "@/lib/quality-health-events";
import { getQualityAttentionCount, QUALITY_STATUS_TONE, safeQualityHref, withQualityFocus } from "@/lib/quality-health";
import { useRecommendationLabel } from "@/lib/quality-labels";
import { cn } from "@/lib/utils";

export default function AgentHealthCard() {
  const t = useTranslations("qualityHealth");
  const tQuality = useTranslations("agentQuality");
  const recommendationLabel = useRecommendationLabel();
  const { summary, loading, error, refresh } = useQualityHealth();
  const { canAccess } = useRole();

  const topAction = summary?.topAction;
  const centerHref = safeQualityHref(null, topAction?.agentId);
  const requestedHref = safeQualityHref(topAction?.href, topAction?.agentId);
  const allowedHref = canAccess(requestedHref) ? requestedHref : centerHref;
  // The destination must be able to explain why it was opened.
  const reviewHref = topAction
    ? withQualityFocus(allowedHref, { signalId: topAction.signalId, agentId: topAction.agentId })
    : allowedHref;
  const attentionCount = getQualityAttentionCount(summary);
  const worstStatus = summary?.worstStatus || "not_evaluated";

  return (
    <section
      className="mb-8 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900 sm:p-6"
      aria-labelledby="agent-health-title"
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="agent-health-title" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h2>
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{t("description")}</p>
          </div>
        </div>
        <Link
          href="/admin/agent/quality"
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-3.5 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {t("openCenter")} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>

      {loading && !summary ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-3" aria-label={t("loading")}>
          {[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />)}
        </div>
      ) : error && !summary ? (
        <div className="mt-5 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center">
          <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">{t("unavailable")}</p>
          <button type="button" onClick={() => void refresh()} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:hover:bg-amber-500/15">
            <RefreshCw size={14} aria-hidden="true" /> {t("retry")}
          </button>
        </div>
      ) : summary ? (
        <>
          {error && (
            <div className="mt-5 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center" role="alert">
              <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-xs">{t("unavailable")}</p>
              <button type="button" onClick={() => void refresh()} className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:hover:bg-amber-500/15">
                <RefreshCw size={13} aria-hidden="true" /> {t("retry")}
              </button>
            </div>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className={cn("rounded-lg border p-3", QUALITY_STATUS_TONE[worstStatus])}>
              <p className="text-xs font-medium opacity-80">{t("currentState")}</p>
              <p className="mt-1 text-sm font-semibold">{tQuality(`statuses.${worstStatus}.title`)}</p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/60">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("agents")}</p>
              <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("agentsCount", {
                evaluated: summary.evaluatedAgents,
                total: summary.agentsTotal,
              })}</p>
            </div>
            <div className={cn(
              "rounded-lg border p-3",
              attentionCount > 0
                ? "border-orange-200 bg-orange-50 dark:border-orange-500/20 dark:bg-orange-500/10"
                : "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10",
            )}>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("attention")}</p>
              <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {attentionCount > 0 ? t("attentionCount", { count: attentionCount }) : t("noPriorityActions")}
              </p>
              {attentionCount > 0 && (
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {t("severityCounts", { critical: summary.openCritical, high: summary.openHigh })}
                </p>
              )}
            </div>
          </div>

          {topAction ? (
            <div className="mt-4 flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700 sm:flex-row sm:items-center">
              <Bot size={18} className="shrink-0 text-indigo-500" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("topAction", { agent: topAction.agentName })}</p>
                <p className="mt-0.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{recommendationLabel(topAction.code)}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => askAssistAboutQuality({
                    signalId: topAction.signalId,
                    agentId: topAction.agentId,
                    agentName: topAction.agentName,
                    code: topAction.code,
                    severity: topAction.severity,
                    href: allowedHref,
                  })}
                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <MessageCircle size={14} aria-hidden="true" /> {t("askAssist")}
                </button>
                <Link href={reviewHref} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                  {t("review")} <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
              {summary.agentsTotal === 0
                ? t("noAgents")
                : summary.evaluatedAgents < summary.agentsTotal
                  ? t("evaluationPending", { count: summary.agentsTotal - summary.evaluatedAgents })
                  : t("noOpenAction")}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
