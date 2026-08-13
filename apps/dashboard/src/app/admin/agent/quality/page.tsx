"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type {
  AgentQualityCheck,
  AgentQualityCheckStatus,
  AgentQualityOverview,
  AgentQualityPillarStatus,
  AgentQualityRecommendation,
  AgentQualitySeverity,
  AgentQualityStatus,
} from "@parallext/shared";
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, Bot, CheckCircle2,
  ChevronDown, CircleDashed, ClipboardCheck, ExternalLink, FlaskConical,
  Gauge, Lightbulb, Loader2, MessageSquareWarning, RefreshCw, ShieldCheck,
  Sparkles, XCircle,
} from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

interface AgentOption { id: string; name: string; is_default: boolean; is_active: boolean }

const CARD = "rounded-xl border border-neutral-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.035]";
const STATUS_TONE: Record<AgentQualityStatus | AgentQualityPillarStatus, string> = {
  not_evaluated: "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200",
  configuration_incomplete: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  at_risk: "border-red-300 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  ready_for_pilot: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  operating_with_evidence: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  review_required: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
  unknown: "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200",
  blocked: "border-red-300 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  needs_attention: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  ready: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  stale: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
  insufficient_evidence: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
  evidenced: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
};
const CHECK_ICON: Record<AgentQualityCheckStatus, typeof CheckCircle2> = { pass: CheckCircle2, warning: AlertTriangle, fail: XCircle, unknown: CircleDashed, not_applicable: CircleDashed };
const CHECK_TONE: Record<AgentQualityCheckStatus, string> = { pass: "text-emerald-600 dark:text-emerald-400", warning: "text-amber-600 dark:text-amber-400", fail: "text-red-600 dark:text-red-400", unknown: "text-neutral-500", not_applicable: "text-neutral-400" };
const SEVERITY_TONE: Record<AgentQualitySeverity, string> = { critical: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300", high: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300", medium: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", low: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" };

function safeAdminHref(href?: string | null) { return href?.startsWith("/admin") && !href.startsWith("//") ? href : "/admin/agent/quality"; }

export default function AgentQualityPage() {
  const t = useTranslations("agentQuality");
  const locale = useLocale();
  const { activeTenantId } = useTenant();
  const { canAccess } = useRole();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState("");
  const [overview, setOverview] = useState<AgentQualityOverview | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agentListRequest = useRef(0);
  const overviewRequest = useRef(0);

  const formatDate = useCallback((value?: string | null) => {
    if (!value) return t("common.notAvailable");
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? t("common.notAvailable") : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }, [locale, t]);

  const translatedCode = useCallback((group: "checks" | "recommendations" | "issues", code: string): string => {
    const key = `${group}.${code}`;
    if (t.has(key)) return t(key);
    if (group === "recommendations" && code.startsWith("fix_")) {
      const itemKey = `checks.${code.slice(4)}`;
      return t("recommendations.fix", { item: t.has(itemKey) ? t(itemKey) : t("checks.unknown") });
    }
    if (group === "recommendations" && code.startsWith("investigate_")) {
      const issueKey = `issues.${code.slice(12)}`;
      return t("recommendations.investigate", { item: t.has(issueKey) ? t(issueKey) : t("issues.unknown") });
    }
    if (group === "issues" && code.startsWith("qa_")) return t("issues.qa_generic");
    if (group === "checks" && code.startsWith("tool_")) return t("checks.vertical_tool");
    return t(`${group}.unknown`);
  }, [t]);

  const loadAgents = useCallback(async () => {
    const requestId = ++agentListRequest.current;
    if (!activeTenantId) { setAgents([]); setAgentId(""); setLoadingAgents(false); return; }
    overviewRequest.current += 1;
    setAgents([]);
    setAgentId("");
    setOverview(null);
    setLoadingAgents(true); setError(null);
    try {
      const response = await api.listAgentQualityAgents(activeTenantId);
      if (requestId !== agentListRequest.current) return;
      if (!response?.success || !Array.isArray(response.data)) throw new Error("unavailable");
      const list = response.data as AgentOption[];
      setAgents(list);
      setAgentId((current) => {
        if (current && list.some((agent) => agent.id === current)) return current;
        const requested = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("agent") : null;
        if (requested && list.some((agent) => agent.id === requested)) return requested;
        return list.find((agent) => agent.is_default)?.id || list[0]?.id || "";
      });
    } catch {
      if (requestId === agentListRequest.current) {
        setAgents([]);
        setAgentId("");
        setError(t("errors.loadAgents"));
      }
    }
    finally { if (requestId === agentListRequest.current) setLoadingAgents(false); }
  }, [activeTenantId, t]);

  const loadOverview = useCallback(async () => {
    const requestId = ++overviewRequest.current;
    if (!activeTenantId || !agentId) { setOverview(null); setLoadingOverview(false); return; }
    const requestedAgentId = agentId;
    setOverview(null);
    setLoadingOverview(true); setError(null);
    try {
      const response = await api.getAgentQualityOverview(activeTenantId, requestedAgentId);
      if (requestId !== overviewRequest.current) return;
      if (!response?.success || !response.data) throw new Error("unavailable");
      if (response.data.agent.id !== requestedAgentId) throw new Error("stale-response");
      setOverview(response.data);
    } catch {
      if (requestId === overviewRequest.current) {
        setOverview(null);
        setError(t("errors.loadOverview"));
      }
    }
    finally { if (requestId === overviewRequest.current) setLoadingOverview(false); }
  }, [activeTenantId, agentId, t]);

  useEffect(() => { void loadAgents(); }, [loadAgents]);
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const lastEvidenceDate = useMemo(() => {
    if (!overview) return null;
    return [overview.tested.latestEval?.createdAt, overview.tested.latestSimulation?.completedAt, overview.tested.latestSimulation?.createdAt, overview.production.attributedSince]
      .filter((value): value is string => Boolean(value)).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
  }, [overview]);

  return <div className="space-y-6 pb-8">
    <PageHeader icon={Gauge} title={t("title")} subtitle={t("subtitle")} action={overview ? <button type="button" onClick={() => void loadOverview()} disabled={loadingOverview} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-200"><RefreshCw size={15} className={cn(loadingOverview && "animate-spin")} aria-hidden="true" />{t("actions.refresh")}</button> : undefined} />

    <section className={cn(CARD, "p-4 sm:p-5")} aria-labelledby="quality-agent-label"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div className="w-full sm:max-w-md"><label id="quality-agent-label" htmlFor="quality-agent" className="mb-1.5 block text-sm font-medium text-foreground">{t("agentSelector.label")}</label><select id="quality-agent" value={agentId} onChange={(event) => { overviewRequest.current += 1; setOverview(null); setAgentId(event.target.value); }} disabled={loadingAgents || agents.length === 0} className="min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 dark:border-white/10 dark:bg-neutral-900">{agents.length === 0 && <option value="">{t("agentSelector.empty")}</option>}{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.is_default ? ` — ${t("agentSelector.default")}` : ""}</option>)}</select></div>{selectedAgent && canAccess(`/admin/agent/${selectedAgent.id}`) && <Link href={`/admin/agent/${selectedAgent.id}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">{t("actions.editAgent")}<ArrowRight size={15} aria-hidden="true" /></Link>}</div></section>

    {(loadingAgents || loadingOverview) && !overview && <div role="status" className={cn(CARD, "flex min-h-48 items-center justify-center gap-3 p-8 text-sm text-muted-foreground")}><Loader2 className="animate-spin" size={20} aria-hidden="true" />{t("loading")}</div>}
    {!loadingAgents && !error && agents.length === 0 && <EmptyState icon={Bot} title={t("empty.title")} description={t("empty.description")} action={canAccess("/admin/agent") ? <Link href="/admin/agent" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">{t("empty.action")}<ArrowRight size={15} aria-hidden="true" /></Link> : undefined} />}
    {error && !loadingOverview && <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 shrink-0" size={18} aria-hidden="true" /><div><p className="text-sm font-semibold">{t("errors.title")}</p><p className="mt-0.5 text-sm">{error}</p></div></div><button type="button" onClick={() => void (agentId ? loadOverview() : loadAgents())} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold"><RefreshCw size={15} aria-hidden="true" />{t("actions.retry")}</button></div>}

    {overview && <>
      <section className={cn("rounded-2xl border p-5 sm:p-6", STATUS_TONE[overview.status])} aria-labelledby="quality-current-status" aria-live="polite"><div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"><div className="max-w-3xl"><div className="mb-3 flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full border border-current/20 bg-white/60 px-2.5 py-1 text-xs font-semibold dark:bg-black/10"><ShieldCheck size={14} aria-hidden="true" />{t("statusLabel")}</span>{!overview.agent.isActive && <span className="rounded-full bg-neutral-900/10 px-2.5 py-1 text-xs font-semibold dark:bg-white/10">{t("agentInactive")}</span>}</div><h2 id="quality-current-status" className="text-xl font-semibold sm:text-2xl">{t(`statuses.${overview.status}.title`)}</h2><p className="mt-2 text-sm leading-6 opacity-90">{t(`statuses.${overview.status}.description`)}</p><p className="mt-4 text-sm font-medium">{t("nextMilestone.label")}: {t(`nextMilestone.${overview.nextMilestone}`)}</p></div><dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 text-sm lg:min-w-72"><EvidenceDatum term={t("evidence.generatedAt")} value={formatDate(overview.generatedAt)} /><EvidenceDatum term={t("evidence.agentVersion")} value={`v${overview.agent.version}`} /><EvidenceDatum term={t("evidence.agentUpdatedAt")} value={formatDate(overview.agent.updatedAt)} /><EvidenceDatum term={t("evidence.latestEvidence")} value={formatDate(lastEvidenceDate)} /></dl></div></section>

      <section aria-labelledby="quality-layers"><div className="mb-3"><h2 id="quality-layers" className="text-base font-semibold text-foreground">{t("layers.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("layers.description")}</p></div><div className="grid gap-4 lg:grid-cols-3">
        <PillarCard icon={ClipboardCheck} title={t("pillars.preparation.title")} description={t("pillars.preparation.description")} status={overview.preparation.status} statusLabel={t(`pillarStatuses.${overview.preparation.status}`)}><p className="text-2xl font-semibold text-foreground">{overview.preparation.passed}/{overview.preparation.applicable}</p><p className="text-xs text-muted-foreground">{t("pillars.preparation.passedChecks")}</p>{overview.preparation.criticalBlockers.length > 0 && <p className="mt-3 flex items-start gap-1.5 text-xs font-medium text-red-600 dark:text-red-400"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{t("pillars.preparation.blockers", { count: overview.preparation.criticalBlockers.length })}</p>}</PillarCard>
        <PillarCard icon={FlaskConical} title={t("pillars.tested.title")} description={t("pillars.tested.description")} status={overview.tested.status} statusLabel={t(`pillarStatuses.${overview.tested.status}`)}>{overview.tested.latestEval ? <><p className="text-lg font-semibold text-foreground">{overview.tested.latestEval.passed ? t("pillars.tested.gatePassed") : t("pillars.tested.gateFailed")}</p><p className="text-xs text-muted-foreground">{t("pillars.tested.result", { score: overview.tested.latestEval.score, threshold: overview.tested.latestEval.threshold })} · {t("pillars.tested.trials", { count: overview.tested.latestEval.trials })}</p><p className="mt-1 text-[11px] text-muted-foreground">{t("pillars.tested.automatedEvidence")} · {formatDate(overview.tested.latestEval.createdAt)}</p></> : <p className="text-sm font-medium text-muted-foreground">{t("pillars.tested.noEval")}</p>}{overview.tested.stale && <p className="mt-3 text-xs font-medium text-orange-600 dark:text-orange-400">{t("pillars.tested.stale")}</p>}{overview.tested.staleReasons.length > 0 && <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">{overview.tested.staleReasons.map((reason) => <li key={reason}>• {t.has(`staleReasons.${reason}`) ? t(`staleReasons.${reason}`) : t("staleReasons.unknown")}</li>)}</ul>}{overview.tested.latestSimulation && <p className="mt-3 text-xs text-muted-foreground">{t("pillars.tested.simulation", { count: overview.tested.latestSimulation.scenarioCount })}</p>}</PillarCard>
        <PillarCard icon={Activity} title={t("pillars.production.title")} description={t("pillars.production.description")} status={overview.production.status} statusLabel={t(`pillarStatuses.${overview.production.status}`)}><p className="text-2xl font-semibold text-foreground">{overview.production.sampleSize}</p><p className="text-xs text-muted-foreground">{t("pillars.production.sample", { minimum: overview.production.minimumSample, days: overview.production.periodDays })}</p>{overview.production.sampleSize < overview.production.minimumSample && <p className="mt-3 text-xs font-medium text-violet-600 dark:text-violet-400">{t("pillars.production.needMore", { count: Math.max(0, overview.production.minimumSample - overview.production.sampleSize) })}</p>}{overview.production.attributedSince && <p className="mt-2 text-xs text-muted-foreground">{t("pillars.production.attributedSince", { date: formatDate(overview.production.attributedSince) })}</p>}</PillarCard>
      </div></section>

      <section className={cn(CARD, "p-5 sm:p-6")} aria-labelledby="quality-actions"><div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Lightbulb size={18} aria-hidden="true" /></div><div><h2 id="quality-actions" className="text-base font-semibold text-foreground">{t("priority.title")}</h2><p className="mt-0.5 text-sm text-muted-foreground">{t("priority.description")}</p></div></div>{overview.recommendations.length > 0 ? <ol className="mt-5 divide-y divide-neutral-200 dark:divide-white/[0.08]">{overview.recommendations.map((recommendation, index) => <RecommendationRow key={`${recommendation.code}-${index}`} recommendation={recommendation} title={translatedCode("recommendations", recommendation.code)} severity={t(`severities.${recommendation.severity}`)} affectedLabel={t("priority.affected", { count: recommendation.evidenceCount ?? recommendation.conversationIds?.length ?? 0 })} actionLabel={t("actions.open")} canOpen={canAccess(safeAdminHref(recommendation.href))} restrictedLabel={t("actions.adminRequired")} />)}</ol> : <div className="mt-5 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><CheckCircle2 size={17} aria-hidden="true" />{t("priority.empty")}</div>}</section>

      <section aria-labelledby="quality-dimensions"><div className="mb-3"><h2 id="quality-dimensions" className="text-base font-semibold text-foreground">{t("dimensions.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("dimensions.description")}</p></div><div className="space-y-3">{overview.preparation.dimensions.map((dimension) => <details key={dimension.dimension} className={cn(CARD, "group overflow-hidden")}><summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden"><ChevronDown size={17} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-foreground">{t(`dimensions.names.${dimension.dimension}`)}</h3><p className="text-xs text-muted-foreground">{t("dimensions.passed", { passed: dimension.passed, applicable: dimension.applicable })}</p></div><StatusBadge status={dimension.status} label={t(`pillarStatuses.${dimension.status}`)} /></summary><div className="border-t border-neutral-200 px-4 py-2 dark:border-white/[0.08]">{dimension.checks.map((check) => <CheckRow key={check.code} check={check} title={translatedCode("checks", check.code)} statusLabel={t(`checkStatuses.${check.status}`)} evidenceLabel={(key) => t.has(`evidenceKeys.${key}`) ? t(`evidenceKeys.${key}`) : t("evidenceKeys.unknown")} booleanLabel={(value) => value ? t("common.yes") : t("common.no")} canOpen={check.href ? canAccess(safeAdminHref(check.href)) : false} restrictedLabel={t("actions.adminRequired")} />)}</div></details>)}</div></section>

      <section className="grid gap-4 xl:grid-cols-2" aria-label={t("productionDetails.label")}><div className={cn(CARD, "p-5 sm:p-6")}><h2 className="text-base font-semibold text-foreground">{t("productionDetails.metricsTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("productionDetails.metricsDescription", { days: overview.production.periodDays })}</p>{overview.production.metrics.length > 0 ? <dl className="mt-4 grid gap-3 sm:grid-cols-2">{overview.production.metrics.map((metric) => <div key={metric.code} className="rounded-lg bg-neutral-50 p-3 dark:bg-white/[0.035]"><dt className="text-xs text-muted-foreground">{t.has(`metrics.${metric.code}`) ? t(`metrics.${metric.code}`) : t("metrics.unknown")}</dt><dd className="mt-1 text-lg font-semibold text-foreground">{formatMetric(metric.value, metric.unit, locale, t("common.notAvailable"))}</dd>{typeof metric.denominator === "number" && <p className="text-[11px] text-muted-foreground">{t("productionDetails.basedOn", { count: metric.denominator })}</p>}</div>)}</dl> : <p className="mt-4 text-sm text-muted-foreground">{t("productionDetails.noMetrics")}</p>}</div>
        <div className={cn(CARD, "p-5 sm:p-6")}><h2 className="text-base font-semibold text-foreground">{t("productionDetails.issuesTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("productionDetails.issuesDescription")}</p>{overview.production.topIssues.length > 0 ? <ul className="mt-4 space-y-3">{overview.production.topIssues.map((issue) => <li key={issue.code} className="rounded-lg border border-neutral-200 p-3 dark:border-white/[0.08]"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2"><MessageSquareWarning size={17} className="mt-0.5 shrink-0 text-orange-500" aria-hidden="true" /><div><p className="text-sm font-medium text-foreground">{translatedCode("issues", issue.code)}</p><p className="text-xs text-muted-foreground">{t("productionDetails.affectedCount", { count: issue.count })}</p></div></div><span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">{issue.count}</span></div>{issue.conversationIds.length > 0 && <div className="mt-3"><Link href="/admin/inbox" className="inline-flex min-h-8 items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-white/[0.07] dark:text-neutral-200"><span>{t("productionDetails.openInbox")}</span><ExternalLink size={11} aria-hidden="true" /></Link></div>}</li>)}</ul> : <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><CircleDashed size={16} aria-hidden="true" />{t("productionDetails.noIssues")}</p>}</div></section>
      <aside className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-sm text-indigo-900 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200"><div className="flex items-start gap-2.5"><Sparkles size={17} className="mt-0.5 shrink-0" aria-hidden="true" /><div><p className="font-semibold">{t("method.title")}</p><p className="mt-1 leading-6 opacity-90">{t("method.description")}</p></div></div></aside>
    </>}
  </div>;
}

function EvidenceDatum({ term, value }: { term: string; value: string }) { return <div className="min-w-0"><dt className="text-xs opacity-70">{term}</dt><dd className="mt-0.5 break-words font-medium">{value}</dd></div>; }
function StatusBadge({ status, label }: { status: AgentQualityPillarStatus; label: string }) { return <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold", STATUS_TONE[status])}>{label}</span>; }
function PillarCard({ icon: Icon, title, description, status, statusLabel, children }: { icon: typeof Gauge; title: string; description: string; status: AgentQualityPillarStatus; statusLabel: string; children: ReactNode }) { return <article className={cn(CARD, "flex min-h-64 flex-col p-5")}><div className="flex items-start justify-between gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300"><Icon size={18} aria-hidden="true" /></div><StatusBadge status={status} label={statusLabel} /></div><h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3><p className="mt-1 min-h-10 text-sm leading-5 text-muted-foreground">{description}</p><div className="mt-auto pt-5">{children}</div></article>; }
function RecommendationRow({ recommendation, title, severity, affectedLabel, actionLabel, canOpen, restrictedLabel }: { recommendation: AgentQualityRecommendation; title: string; severity: string; affectedLabel: string; actionLabel: string; canOpen: boolean; restrictedLabel: string }) { const affected = recommendation.evidenceCount ?? recommendation.conversationIds?.length ?? 0; return <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-foreground">{title}</p><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", SEVERITY_TONE[recommendation.severity])}>{severity}</span></div>{affected > 0 && <p className="mt-1 text-xs text-muted-foreground">{affectedLabel}</p>}</div>{canOpen ? <Link href={safeAdminHref(recommendation.href)} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/10 dark:hover:bg-white/[0.06]">{actionLabel}<ArrowRight size={13} aria-hidden="true" /></Link> : <span className="text-xs font-medium text-muted-foreground">{restrictedLabel}</span>}</li>; }
function CheckRow({ check, title, statusLabel, evidenceLabel, booleanLabel, canOpen, restrictedLabel }: { check: AgentQualityCheck; title: string; statusLabel: string; evidenceLabel: (key: string) => string; booleanLabel: (value: boolean) => string; canOpen: boolean; restrictedLabel: string }) { const Icon = CHECK_ICON[check.status]; const evidence = Object.entries(check.evidence || {}).filter(([, value]) => value !== null && value !== ""); return <div className="flex flex-col gap-2 border-b border-neutral-100 py-3 last:border-0 dark:border-white/[0.05] sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-start gap-2.5"><Icon size={17} className={cn("mt-0.5 shrink-0", CHECK_TONE[check.status])} aria-hidden="true" /><div className="min-w-0"><p className="text-sm font-medium text-foreground">{title}</p>{evidence.length > 0 && <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{evidence.map(([key, value]) => <div key={key} className="flex gap-1 text-[11px] text-muted-foreground"><dt>{evidenceLabel(key)}:</dt><dd className="font-medium text-foreground/80">{typeof value === "boolean" ? booleanLabel(value) : String(value)}</dd></div>)}</dl>}</div></div><div className="flex shrink-0 items-center gap-2 pl-7 sm:pl-0"><span className={cn("text-xs font-medium", CHECK_TONE[check.status])}>{statusLabel}</span>{check.href && check.status !== "pass" && check.status !== "not_applicable" && (canOpen ? <Link href={safeAdminHref(check.href)} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"><ArrowRight size={12} aria-hidden="true" /><span className="sr-only">{title}</span></Link> : <span className="text-[11px] text-muted-foreground">{restrictedLabel}</span>)}</div></div>; }
function formatMetric(value: number | null, unit: "percent" | "score_10" | "milliseconds" | "count", locale: string, fallback: string) { if (value === null || !Number.isFinite(value)) return fallback; if (unit === "percent") return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(value / 100); if (unit === "score_10") return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}/10`; if (unit === "milliseconds") return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} ms`; return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value); }
