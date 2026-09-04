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

/**
 * Where a person actually fixes each critical check. Anything not listed here
 * falls back to the quality center, which explains the check in full — never to
 * a page that cannot resolve it (that mismatch is the defect this replaces).
 */
const BLOCKER_TARGETS: Record<string, (agentId: string) => string> = {
  agent_active: (id) => `/admin/agent/${id}?focus=active`,
  persona_identity: (id) => `/admin/agent/${id}?tab=persona&focus=name`,
  agent_language: (id) => `/admin/agent/${id}?tab=persona&focus=name`,
  brand_voice: (id) => `/admin/agent/${id}?tab=persona&focus=name`,
  greeting: (id) => `/admin/agent/${id}?tab=persona&focus=greeting`,
  fallback_message: (id) => `/admin/agent/${id}?tab=persona&focus=fallback`,
  custom_prompt: (id) => `/admin/agent/${id}?tab=persona&focus=name`,
  llm_limits: (id) => `/admin/agent/${id}?tab=persona&focus=name`,
  behavior_rules: (id) => `/admin/agent/${id}?tab=instructions&focus=rules`,
  forbidden_topics: (id) => `/admin/agent/${id}?tab=instructions&focus=rules`,
  handoff_triggers: (id) => `/admin/agent/${id}?tab=instructions&focus=handoff`,
  channel_assignment: (id) => `/admin/agent/${id}?focus=channels`,
  channel_coverage: (id) => `/admin/agent/${id}?focus=channels`,
  operational_channel_scope: (id) => `/admin/agent/${id}?focus=channels`,
  channel_connection: () => "/admin/channels",
  business_identity: () => "/admin/settings/business-info",
  business_contact: () => "/admin/settings/business-info",
  business_context: () => "/admin/settings/business-info",
  business_hours: () => "/admin/settings/business-hours",
  after_hours_behavior: () => "/admin/settings/business-hours",
  human_handoff_route: () => "/admin/users",
  knowledge_coverage: () => "/admin/knowledge",
  rag_knowledge: () => "/admin/knowledge",
  rag_configuration: () => "/admin/knowledge",
  tool_knowledge: () => "/admin/knowledge",
  tool_faqs: () => "/admin/knowledge/faqs",
  tool_policies: () => "/admin/knowledge",
  tool_appointments: () => "/admin/appointments",
};

/** Recommendation codes arrive as `fix_<check>`; both forms name the same check. */
function normalizeBlockerCode(code: string): string {
  const normalized = String(code || "").trim().toLowerCase();
  return normalized.startsWith("fix_") ? normalized.slice(4) : normalized;
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
  const ta = useTranslations("agent");
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

  const blockerCodes = overview.preparation.criticalBlockers.map(normalizeBlockerCode).filter(Boolean);
  const blockers = blockerCodes.length;
  const needsEvidence = overview.production.sampleSize < overview.production.minimumSample;
  const Icon = overview.status === "operating_with_evidence" ? CheckCircle2 : AlertTriangle;

  // Naming the blockers is the whole point: a bare count sends the owner to a
  // page that looks fine and says nothing about what to correct.
  const namedBlockers = blockerCodes.slice(0, 3).map((code) => ({
    code,
    label: t.has(`checks.${code}`) ? t(`checks.${code}`) : t("checks.unknown"),
    href: (BLOCKER_TARGETS[code] ?? (() => href))(agentId),
  }));
  const extraBlockers = blockers - namedBlockers.length;

  return (
    <aside className={cn("mb-6 rounded-xl border p-4", STATUS_STYLES[overview.status])} aria-labelledby="agent-quality-banner-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70 text-indigo-600 shadow-sm dark:bg-black/10 dark:text-indigo-300"><Gauge size={18} aria-hidden="true" /></div>
          <div className="min-w-0"><p id="agent-quality-banner-title" className="text-sm font-semibold text-foreground">{t(`statuses.${overview.status}.title`)}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{blockers > 0 ? t("banner.blockers", { count: blockers }) : overview.tested.stale ? t("banner.stale") : needsEvidence ? t("banner.evidence", { current: overview.production.sampleSize, minimum: overview.production.minimumSample }) : t("banner.current")}</p></div>
        </div>
        <Link href={href} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-current/15 bg-white/70 px-3 py-2 text-xs font-semibold text-foreground hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-black/10 dark:hover:bg-black/20"><Icon size={14} aria-hidden="true" /> {t("banner.openCenter")} <ArrowRight size={13} aria-hidden="true" /></Link>
      </div>

      {namedBlockers.length > 0 && (
        <div className="mt-3 border-t border-current/10 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {ta("readiness.blockersTitle")}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {namedBlockers.map((blocker) => (
              <li key={blocker.code}>
                <Link
                  href={blocker.href}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-foreground hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-black/20"
                >
                  <AlertTriangle size={12} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <span>{blocker.label}</span>
                  <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-300">{ta("readiness.fix")}</span>
                  <ArrowRight size={11} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {extraBlockers > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">{ta("readiness.more", { count: extraBlockers })}</p>
          )}
        </div>
      )}
    </aside>
  );
}
