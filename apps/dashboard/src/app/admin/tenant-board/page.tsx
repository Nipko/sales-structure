"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  HeartPulse,
  Loader2,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Status = "ok" | "atencion" | "critico" | "error";
type Severity = "atencion" | "critico";

interface Reason {
  code: string;
  severity: Severity;
  params: Record<string, string | number>;
}

interface BoardChannel {
  type: string;
  displayName: string | null;
  health: string;
  connectedAt: string | null;
  lastError: string | null;
  refreshState: string | null;
}

interface BoardRow {
  tenantId: string;
  name: string;
  slug: string | null;
  plan: string;
  subscriptionStatus: string | null;
  industry: string | null;
  subtype: string | null;
  isActive: boolean;
  isInternal: boolean;
  goLiveState: string;
  goLiveAt: string | null;
  createdAt: string | null;
  onboardingCompletedAt: string | null;
  firstChannelConnectedAt: string | null;
  firstMessageAt: string | null;
  status: Status;
  reasons: Reason[];
  readiness: {
    verdict: string | null;
    blockingFailing: number;
    necessaryFailing: number;
    coveragePct: number | null;
    blockingGaps: string[];
    evaluatedAt: string | null;
  } | null;
  channels: BoardChannel[];
  widgets: number;
  delivery: {
    pending: number;
    unknown: number;
    failed: number;
    stuck: number;
    delivered: number | null;
    total: number | null;
    lastDeliveredAt: string | null;
  } | null;
  dispatch: { reconciliationRequired: number; reconciliationOverdue: number; stalled: number } | null;
  volume: { inbound: number; outbound: number; conversations: number; lastInboundAt: string | null } | null;
  tools: { calls: number; errors: number; blocked: number; errorRate: number; lastErrorCode: string | null } | null;
  agents: { active: number; total: number; published: number | null } | null;
  sectionErrors: string[];
  error: string | null;
}

interface BoardPayload {
  generatedAt: string;
  cached: boolean;
  windowDays: number;
  skipped: { evalReplicas: number; missingSchemas: number };
  unavailable: string[];
  summary: {
    total: number;
    byStatus: Record<Status, number>;
    live: number;
    stuckDeliveries: number;
    reconciliationRequired: number;
    channelErrors: number;
  };
  tenants: BoardRow[];
}

type Translate = ReturnType<typeof useTranslations>;

const STATUSES: readonly Status[] = ["critico", "error", "atencion", "ok"];
const STATUS_ORDER: Record<Status, number> = { critico: 0, error: 1, atencion: 2, ok: 3 };
const NO_CHANNEL = "__none__";
const WEB_WIDGET = "web_widget";

const pill = "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold";
const selectClass = "rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground";
const thClass = "px-3 py-2 font-semibold";
const tdClass = "px-3 py-2.5 align-top";

const STATUS_TONE: Record<Status, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  atencion: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  critico: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  error: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

/** Mismo criterio que `isCredentialFailure` del paquete compartido. */
const FAILING_HEALTH = new Set(["missing", "error", "revoked", "expired"]);

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 2 : 1)}%`;
}

function StatusBadge({ status, t }: { status: Status; t: Translate }) {
  return <span className={cn(pill, STATUS_TONE[status])}>{t(`status.${status}`)}</span>;
}

function reasonText(reason: Reason, t: Translate): string {
  // Un código nuevo del API que el panel todavía no traduce se muestra tal cual, nunca vacío.
  return t.has(`reasons.${reason.code}`) ? t(`reasons.${reason.code}`, reason.params) : reason.code;
}

function Tile({ label, value, tone, active, onClick }: {
  label: string;
  value: number;
  tone?: Status | "neutral";
  active?: boolean;
  onClick?: () => void;
}) {
  const color = tone === "critico" ? "text-rose-600 dark:text-rose-400"
    : tone === "atencion" ? "text-amber-600 dark:text-amber-400"
      : tone === "ok" ? "text-emerald-600 dark:text-emerald-400"
        : "text-foreground";
  const body = (
    <>
      <div className={cn("text-2xl font-bold", color)}>{value.toLocaleString()}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </>
  );
  const className = cn("rounded-xl border bg-card p-4 text-left", active ? "border-indigo-500 ring-1 ring-indigo-500" : "border-border");
  return onClick
    ? <button type="button" onClick={onClick} aria-pressed={active} className={cn(className, "hover:bg-muted/40")}>{body}</button>
    : <div className={className}>{body}</div>;
}

function ChannelChips({ row, t }: { row: BoardRow; t: Translate }) {
  if (row.channels.length === 0 && row.widgets === 0) {
    return <span className="text-xs text-muted-foreground">{t("filters.noChannel")}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {row.channels.map((channel, index) => (
        <span
          key={`${channel.type}-${index}`}
          title={`${channel.displayName ?? channel.type} · ${channel.health}`}
          className={cn("rounded px-1.5 py-0.5 text-[11px]",
            FAILING_HEALTH.has(channel.health) ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
              : channel.health === "expiring" ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-muted text-muted-foreground")}
        >
          {channel.type}
        </span>
      ))}
      {row.widgets > 0 && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t("filters.webWidget")}</span>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xs text-foreground">{children}</dd>
    </div>
  );
}

function RowDetails({ row, windowDays, t }: { row: BoardRow; windowDays: number; t: Translate }) {
  const noData = <span className="text-muted-foreground">{t("noData")}</span>;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-1 text-xs font-semibold text-foreground">{t("details.reasons")}</h3>
        {row.reasons.length === 0
          ? <p className="text-xs text-muted-foreground">{t("noReasons")}</p>
          : (
            <ul className="flex flex-col gap-1">
              {row.reasons.map((reason, index) => (
                <li key={`${reason.code}-${index}`} className="flex items-start gap-2 text-xs">
                  <StatusBadge status={reason.severity} t={t} />
                  <span className="text-foreground">{reasonText(reason, t)}</span>
                </li>
              ))}
            </ul>
          )}
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label={t("details.setup")}>
          <div>{t("details.createdAt")}: {fmtDate(row.createdAt)}</div>
          <div>{t("details.onboardingCompletedAt")}: {fmtDate(row.onboardingCompletedAt)}</div>
          <div>{t("details.firstChannelConnectedAt")}: {fmtDate(row.firstChannelConnectedAt)}</div>
          <div>{t("details.firstMessageAt")}: {fmtDate(row.firstMessageAt)}</div>
          <div>{t("details.goLiveAt")}: {row.goLiveState === "on" ? fmtDate(row.goLiveAt) : t("liveOff")}</div>
          <div>{t("details.subscription")}: {row.subscriptionStatus ?? "—"}</div>
        </Detail>

        <Detail label={t("details.readiness")}>
          {row.readiness ? (
            <>
              <div>{t("details.readinessLine", {
                verdict: t(`verdict.${row.readiness.verdict && t.has(`verdict.${row.readiness.verdict}`) ? row.readiness.verdict : "none"}`),
                blocking: row.readiness.blockingFailing,
                necessary: row.readiness.necessaryFailing,
                coverage: row.readiness.coveragePct === null ? "—" : `${row.readiness.coveragePct}%`,
              })}</div>
              <div>{t("details.evaluatedAt")}: {fmtDate(row.readiness.evaluatedAt)}</div>
              {row.readiness.blockingGaps.length > 0 && (
                <div className="mt-1 font-mono text-[11px] text-rose-600 dark:text-rose-400">
                  {t("details.blockingGaps")}: {row.readiness.blockingGaps.join(" · ")}
                </div>
              )}
            </>
          ) : row.sectionErrors.includes("readiness") ? noData : t("verdict.none")}
        </Detail>

        <Detail label={t("details.channels")}>
          {row.channels.length === 0 && row.widgets === 0 && t("filters.noChannel")}
          {row.channels.map((channel, index) => (
            <div key={`${channel.type}-${index}`}>
              <span className={cn(FAILING_HEALTH.has(channel.health) && "text-rose-600 dark:text-rose-400")}>
                {t("details.channelLine", { type: channel.displayName ? `${channel.type} (${channel.displayName})` : channel.type, health: channel.health })}
              </span>
              {channel.connectedAt && <span className="text-muted-foreground"> · {t("details.connectedAt", { date: fmtDate(channel.connectedAt) })}</span>}
              {channel.lastError && <div className="font-mono text-[11px] text-rose-600 dark:text-rose-400">{channel.lastError}</div>}
            </div>
          ))}
          {row.widgets > 0 && <div>{t("details.widgets", { count: row.widgets })}</div>}
        </Detail>

        <Detail label={t("details.delivery", { days: windowDays })}>
          {row.delivery ? (
            <>
              <div>{t("details.deliveryLine", {
                pending: row.delivery.pending,
                unknown: row.delivery.unknown,
                failed: row.delivery.failed,
                delivered: row.delivery.delivered ?? "—",
                total: row.delivery.total ?? "—",
              })}</div>
              <div>{t("details.lastDeliveredAt")}: {fmtDate(row.delivery.lastDeliveredAt)}</div>
            </>
          ) : noData}
          {row.dispatch && (
            <div className="mt-1">
              <span className="font-semibold">{t("details.dispatch")}: </span>
              {t("details.dispatchLine", {
                reconciliation: row.dispatch.reconciliationRequired,
                overdue: row.dispatch.reconciliationOverdue,
                stalled: row.dispatch.stalled,
              })}
            </div>
          )}
        </Detail>

        <Detail label={t("details.volume", { days: windowDays })}>
          {row.volume ? (
            <>
              <div>{t("details.volumeLine", { inbound: row.volume.inbound, outbound: row.volume.outbound, conversations: row.volume.conversations })}</div>
              <div>{t("details.lastInboundAt")}: {fmtDate(row.volume.lastInboundAt)}</div>
            </>
          ) : noData}
        </Detail>

        <Detail label={t("details.tools")}>
          {row.tools ? (
            <>
              <div>{t("details.toolsLine", { calls: row.tools.calls, errors: row.tools.errors, blocked: row.tools.blocked })}</div>
              {row.tools.lastErrorCode && <div className="font-mono text-[11px] text-rose-600 dark:text-rose-400">{t("details.lastErrorCode")}: {row.tools.lastErrorCode}</div>}
            </>
          ) : noData}
          <div className="mt-1">
            <span className="font-semibold">{t("details.agents")}: </span>
            {row.agents
              ? t("details.agentsLine", { active: row.agents.active, total: row.agents.total, published: row.agents.published ?? "—" })
              : noData}
          </div>
        </Detail>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/admin/tenants/${row.tenantId}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
        >
          <ExternalLink size={13} /> {t("details.openTenant")}
        </Link>
        <Link
          href="/admin/tools"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
        >
          <Wrench size={13} /> {t("details.openTools")}
        </Link>
      </div>
    </div>
  );
}

export default function TenantBoardPage() {
  const t = useTranslations("tenantBoard");
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const [plan, setPlan] = useState("all");
  const [channel, setChannel] = useState("all");
  const [onlyLive, setOnlyLive] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.fetch(`/admin/tenant-board${refresh ? "?refresh=true" : ""}`);
      if (!response?.success || !Array.isArray(response?.data?.tenants)) throw new Error(t("loadError"));
      setData(response.data as BoardPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const plans = useMemo(
    () => [...new Set((data?.tenants ?? []).map(row => row.plan))].sort(),
    [data],
  );
  const channelTypes = useMemo(() => {
    const types = new Set<string>();
    for (const row of data?.tenants ?? []) {
      for (const item of row.channels) types.add(item.type);
      if (row.widgets > 0) types.add(WEB_WIDGET);
    }
    return [...types].sort();
  }, [data]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (data?.tenants ?? [])
      .filter(row => {
        if (status !== "all" && row.status !== status) return false;
        if (plan !== "all" && row.plan !== plan) return false;
        if (onlyLive && row.goLiveState !== "on") return false;
        if (channel === NO_CHANNEL && (row.channels.length > 0 || row.widgets > 0)) return false;
        if (channel === WEB_WIDGET && row.widgets === 0) return false;
        if (channel !== "all" && channel !== NO_CHANNEL && channel !== WEB_WIDGET
          && !row.channels.some(item => item.type === channel)) return false;
        if (!normalized) return true;
        return [row.name, row.slug, row.tenantId, row.industry, row.subtype]
          .some(value => String(value || "").toLocaleLowerCase().includes(normalized));
      })
      .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || a.name.localeCompare(b.name));
  }, [data, query, status, plan, channel, onlyLive]);

  const toggleStatus = (value: Status) => setStatus(current => (current === value ? "all" : value));

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            <HeartPulse size={14} /> {t("eyebrow")}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitle")}</p>
          {data && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("generatedAt", { time: fmtDate(data.generatedAt) })} {data.cached && t("cachedNote")} · {t("windowHint", { days: data.windowDays })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> {t("refresh")}
        </button>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>
      )}
      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> {t("loading")}</div>
      )}

      {data && (
        <>
          {data.unavailable.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {t("unavailable", { sources: data.unavailable.join(", ") })}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Tile label={t("tiles.total")} value={data.summary.total} active={status === "all"} onClick={() => setStatus("all")} />
            {STATUSES.map(value => (
              <Tile
                key={value}
                label={t(`tiles.${value}`)}
                value={data.summary.byStatus[value] ?? 0}
                tone={value}
                active={status === value}
                onClick={() => toggleStatus(value)}
              />
            ))}
            <Tile label={t("tiles.live")} value={data.summary.live} active={onlyLive} onClick={() => setOnlyLive(current => !current)} />
            <Tile label={t("tiles.stuck")} value={data.summary.stuckDeliveries} tone={data.summary.stuckDeliveries > 0 ? "critico" : "neutral"} />
            <Tile label={t("tiles.reconciliation")} value={data.summary.reconciliationRequired} tone={data.summary.reconciliationRequired > 0 ? "critico" : "neutral"} />
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <label className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t("filters.search")}
                aria-label={t("filters.search")}
                className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground"
              />
            </label>
            <select value={status} onChange={event => setStatus(event.target.value as Status | "all")} aria-label={t("columns.status")} className={selectClass}>
              <option value="all">{t("filters.allStatuses")}</option>
              {STATUSES.map(value => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
            </select>
            <select value={plan} onChange={event => setPlan(event.target.value)} aria-label={t("filters.allPlans")} className={selectClass}>
              <option value="all">{t("filters.allPlans")}</option>
              {plans.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <select value={channel} onChange={event => setChannel(event.target.value)} aria-label={t("columns.channels")} className={selectClass}>
              <option value="all">{t("filters.allChannels")}</option>
              {channelTypes.map(value => (
                <option key={value} value={value}>{value === WEB_WIDGET ? t("filters.webWidget") : value}</option>
              ))}
              <option value={NO_CHANNEL}>{t("filters.noChannel")}</option>
            </select>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={onlyLive} onChange={event => setOnlyLive(event.target.checked)} />
              {t("filters.onlyLive")}
            </label>
          </div>

          <p className="text-xs text-muted-foreground">
            {t("filters.showing", { shown: filtered.length, total: data.tenants.length })}
            {(data.skipped.evalReplicas > 0 || data.skipped.missingSchemas > 0) && ` · ${t("skipped", data.skipped)}`}
          </p>

          <div className="overflow-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[1100px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                <tr>
                  <th className={thClass}>{t("columns.tenant")}</th>
                  <th className={thClass}>{t("columns.status")}</th>
                  <th className={thClass}>{t("columns.readiness")}</th>
                  <th className={thClass}>{t("columns.live")}</th>
                  <th className={thClass}>{t("columns.channels")}</th>
                  <th className={thClass}>{t("columns.delivery")}</th>
                  <th className={thClass}>{t("columns.inbound")}</th>
                  <th className={thClass}>{t("columns.tools")}</th>
                  <th className={thClass}>{t("columns.reason")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(row => {
                  const open = expanded === row.tenantId;
                  const verdict = row.readiness?.verdict;
                  return (
                    <Fragment key={row.tenantId}>
                      <tr
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setExpanded(open ? null : row.tenantId)}
                        aria-expanded={open}
                      >
                        <td className={tdClass}>
                          <div className="flex items-center gap-1 font-semibold text-foreground">
                            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            {row.name}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                            <span>{row.plan}</span>
                            {row.industry && <span>· {row.subtype ? `${row.industry}/${row.subtype}` : row.industry}</span>}
                            {row.isInternal && <span className="rounded bg-muted px-1">{t("internal")}</span>}
                            {!row.isActive && <span className="rounded bg-muted px-1">{t("inactive")}</span>}
                          </div>
                        </td>
                        <td className={tdClass}><StatusBadge status={row.status} t={t} /></td>
                        <td className={tdClass}>
                          {row.readiness
                            ? t(`verdict.${verdict && t.has(`verdict.${verdict}`) ? verdict : "none"}`)
                            : row.sectionErrors.includes("readiness") ? t("noData") : t("verdict.none")}
                        </td>
                        <td className={tdClass}>{row.goLiveState === "on" ? t("liveOn") : t("liveOff")}</td>
                        <td className={tdClass}><ChannelChips row={row} t={t} /></td>
                        <td className={tdClass}>
                          {row.delivery
                            ? t("deliverySummary", { delivered: row.delivery.delivered ?? "—", stuck: row.delivery.stuck, failed: row.delivery.failed })
                            : t("noData")}
                        </td>
                        <td className={tdClass}>{row.volume ? row.volume.inbound.toLocaleString() : t("noData")}</td>
                        <td className={tdClass}>
                          {row.tools ? t("toolsSummary", { calls: row.tools.calls, rate: fmtPct(row.tools.errorRate) }) : t("noData")}
                        </td>
                        <td className={cn(tdClass, "max-w-[320px]")}>
                          {row.reasons[0]
                            ? <span className={row.reasons[0].severity === "critico" ? "text-rose-600 dark:text-rose-400" : "text-amber-700 dark:text-amber-300"}>{reasonText(row.reasons[0], t)}</span>
                            : <span className="text-muted-foreground">—</span>}
                          {row.reasons.length > 1 && <span className="text-muted-foreground"> (+{row.reasons.length - 1})</span>}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-muted/30">
                          <td colSpan={9} className="px-6 py-4">
                            <RowDetails row={row} windowDays={data.windowDays} t={t} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-muted-foreground">{t("noResults")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
