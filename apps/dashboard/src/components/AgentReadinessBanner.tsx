"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AgentQualityOverview } from "@parallext/shared";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, Gauge, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  tenantId: string | null | undefined;
  agentId: string;
  refreshKey?: number | string;
}

const STATUS_STYLES: Record<AgentQualityOverview["status"], string> = {
  not_evaluated: "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/60",
  configuration_incomplete: "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
  at_risk: "border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10",
  ready_for_pilot: "border-blue-300 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10",
  operating_with_evidence: "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
  review_required: "border-orange-300 bg-orange-50 dark:border-orange-500/30 dark:bg-orange-500/10",
};

/** Persistent quality passport summary. It remains visible because test
 * evidence can become stale and production evidence changes over time. */
export function AgentReadinessBanner({ tenantId, agentId, refreshKey = 0 }: Props) {
  const t = useTranslations("agentQuality");
  const [overview, setOverview] = useState<AgentQualityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!tenantId || !agentId) { setLoading(false); return; }
    setOverview(null);
    setLoading(true);
    setFailed(false);
    api.getAgentQualityOverview(tenantId, agentId)
      .then((response) => {
        if (!active) return;
        if (response?.success && response.data) setOverview(response.data);
        else setFailed(true);
      })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId, agentId, refreshKey]);

  if (!tenantId || !agentId) return null;
  const href = `/admin/agent/quality?agent=${encodeURIComponent(agentId)}`;

  if (loading) return (
    <div role="status" className="mb-6 flex min-h-20 items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
      <RefreshCw size={17} className="animate-spin" aria-hidden="true" /> {t("banner.loading")}
    </div>
  );

  if (failed || !overview) return (
    <aside className="mb-6 flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-white/10 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3"><CircleDashed size={18} className="mt-0.5 shrink-0 text-neutral-500" aria-hidden="true" /><div><p className="text-sm font-semibold text-foreground">{t("banner.unavailableTitle")}</p><p className="mt-0.5 text-xs text-muted-foreground">{t("banner.unavailableDescription")}</p></div></div>
      <Link href={href} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-500/10">{t("banner.openCenter")} <ArrowRight size={13} aria-hidden="true" /></Link>
    </aside>
  );

  const blockers = overview.preparation.criticalBlockers.length;
  const needsEvidence = overview.production.sampleSize < overview.production.minimumSample;
  const Icon = overview.status === "operating_with_evidence" ? CheckCircle2 : AlertTriangle;
  return (
    <aside className={cn("mb-6 rounded-xl border p-4", STATUS_STYLES[overview.status])} aria-labelledby="agent-quality-banner-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70 text-indigo-600 shadow-sm dark:bg-black/10 dark:text-indigo-300"><Gauge size={18} aria-hidden="true" /></div>
          <div className="min-w-0"><p id="agent-quality-banner-title" className="text-sm font-semibold text-foreground">{t(`statuses.${overview.status}.title`)}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{blockers > 0 ? t("banner.blockers", { count: blockers }) : overview.tested.stale ? t("banner.stale") : needsEvidence ? t("banner.evidence", { current: overview.production.sampleSize, minimum: overview.production.minimumSample }) : t("banner.current")}</p></div>
        </div>
        <Link href={href} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-current/15 bg-white/70 px-3 py-2 text-xs font-semibold text-foreground hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-black/10 dark:hover:bg-black/20"><Icon size={14} aria-hidden="true" /> {t("banner.openCenter")} <ArrowRight size={13} aria-hidden="true" /></Link>
      </div>
    </aside>
  );
}
