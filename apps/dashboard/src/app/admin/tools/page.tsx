"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Access = "read" | "write";
type Mode = "live" | "agent_test" | "eval" | "draft" | "all";
type Tab = "catalog" | "tenants" | "usage";

interface CatalogEntry {
  tool: string;
  family: string;
  description: string | null;
  access: Access;
  effect: string;
  commitsBusiness: boolean;
  confirmation: string;
  humanApproval: string;
  idempotency: string;
  assurance: string;
  subpermission: { family: string; flag: string } | null;
  gaps: string[];
  verticalScoped: boolean;
  profiles: string[];
  planFeature: string | null;
  readiness: string | null;
  advertised: boolean;
}

interface PlanCoverage {
  available: boolean;
  plans: Array<{ slug: string; name: string; isActive: boolean; toolFamilies: string[] | null }>;
  /** Familia → planes activos que la incluyen. Sólo familias que el plan gobierna. */
  byFamily: Record<string, string[]>;
}

interface CatalogPayload {
  totals: { tools: number; reads: number; writes: number; withGaps: number; families: number };
  families: Array<{ family: string; tools: number; reads: number; writes: number; planGated?: boolean }>;
  entries: CatalogEntry[];
  planCoverage?: PlanCoverage;
}

interface TenantRow {
  tenantId: string;
  name: string;
  plan: string;
  industry: string | null;
  subtype: string | null;
  isActive: boolean;
  isInternal: boolean;
  agentsError: string | null;
  agents: Array<{
    id: string;
    name: string | null;
    version: number | null;
    enabledFamilies: string[];
    paymentsEnabled: boolean;
    subpermissionDenials: Array<{ family: string; flag: string; tools: string[] }>;
  }>;
  planFeatures: Record<string, boolean | null>;
  /** `null` = el plan no limita familias. */
  planToolFamilies?: string[] | null;
  enabledTools: string[];
  usedTools: string[];
  enabledButUnused: string[];
  usedButNotEnabled: string[];
  blockedByPlan: string[];
  usage: Array<{ tool: string; calls: number; errors: number; blocked: number; lastAt: string | null }>;
  nonLiveCalls: number;
}

interface TenantsPayload {
  windowDays: number;
  usageAvailable: boolean;
  skippedSchemas: number;
  tenants: TenantRow[];
}

interface UsageTool {
  tool: string;
  calls: number;
  errors: number;
  blocked: number;
  pending: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number;
  lastAt: string | null;
  lastErrorCode: string | null;
  tenants: number;
}

interface UsagePayload {
  available: boolean;
  totals: { calls: number; errors: number; blocked: number; pending: number; errorRate: number; p50Ms: number | null; p95Ms: number | null; maxMs: number; tools: number };
  tools: UsageTool[];
  days: Array<{ day: string; calls: number; errors: number; blocked: number }>;
  topErrors: Array<{ tool: string; errorCode: string | null; calls: number; tenants: number; lastAt: string | null }>;
}

const PERIODS = [7, 30, 90] as const;
const MODES: readonly Mode[] = ["live", "agent_test", "eval", "draft", "all"];

const pill = "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold";
const selectClass = "rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground";
const thClass = "px-3 py-2 font-semibold";
const tdClass = "px-3 py-2.5 align-top";

function fmtNum(value: number): string {
  return value.toLocaleString();
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 2 : 1)}%`;
}

function fmtMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

function AccessBadge({ access, label }: { access: Access; label: string }) {
  return (
    <span className={cn(pill, access === "write"
      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
      : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300")}
    >
      {label}
    </span>
  );
}

function ToolChips({ tools, tone }: { tools: string[]; tone: "warn" | "danger" | "muted" }) {
  if (!tools.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tools.map(tool => (
        <span
          key={tool}
          className={cn("rounded px-1.5 py-0.5 font-mono text-[11px]",
            tone === "danger" && "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
            tone === "warn" && "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
            tone === "muted" && "bg-muted text-muted-foreground")}
        >
          {tool}
        </span>
      ))}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className={cn("text-2xl font-bold", tone === "danger" ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** Qué planes activos incluyen la familia; las que el plan no gobierna van en todos. */
function PlanCoverageCell({ family, coverage, t }: { family: string; coverage?: PlanCoverage; t: ReturnType<typeof useTranslations> }) {
  if (!coverage?.available) return <span className="text-muted-foreground">—</span>;
  const plans = coverage.byFamily[family];
  if (!plans) return <span className="text-[11px] text-muted-foreground">{t("catalog.allPlans")}</span>;
  if (!plans.length) return <span className="text-[11px] text-rose-600 dark:text-rose-400">{t("catalog.noPlans")}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {plans.map(slug => (
        <span key={slug} className={cn(pill, "border-border text-muted-foreground")}>{slug}</span>
      ))}
    </div>
  );
}

function CatalogTab({ data, t }: { data: CatalogPayload; t: ReturnType<typeof useTranslations> }) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("all");
  const [access, setAccess] = useState<Access | "all">("all");
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return data.entries.filter(entry => {
      if (family !== "all" && entry.family !== family) return false;
      if (access !== "all" && entry.access !== access) return false;
      if (onlyGaps && entry.gaps.length === 0) return false;
      if (!normalized) return true;
      return [entry.tool, entry.family, entry.description, entry.planFeature, entry.readiness]
        .some(value => String(value || "").toLocaleLowerCase().includes(normalized));
    });
  }, [data.entries, query, family, access, onlyGaps]);

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t("catalog.totals", data.totals)}
      </p>
      {data.planCoverage && !data.planCoverage.available && (
        <p className="text-xs text-amber-700 dark:text-amber-300">{t("catalog.planCoverageUnavailable")}</p>
      )}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <label className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t("catalog.search")}
            aria-label={t("catalog.search")}
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground"
          />
        </label>
        <select value={family} onChange={event => setFamily(event.target.value)} aria-label={t("catalog.colFamily")} className={selectClass}>
          <option value="all">{t("catalog.allFamilies")}</option>
          {data.families.map(item => (
            <option key={item.family} value={item.family}>{item.family} ({item.tools})</option>
          ))}
        </select>
        <select value={access} onChange={event => setAccess(event.target.value as Access | "all")} aria-label={t("catalog.colAccess")} className={selectClass}>
          <option value="all">{t("catalog.allAccess")}</option>
          <option value="read">{t("catalog.read")}</option>
          <option value="write">{t("catalog.write")}</option>
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={onlyGaps} onChange={event => setOnlyGaps(event.target.checked)} />
          {t("catalog.onlyGaps")}
        </label>
      </div>
      <div className="overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
            <tr>
              <th className={thClass}>{t("catalog.colTool")}</th>
              <th className={thClass}>{t("catalog.colFamily")}</th>
              <th className={thClass}>{t("catalog.colAccess")}</th>
              <th className={thClass}>{t("catalog.colConfirmation")}</th>
              <th className={thClass}>{t("catalog.colApproval")}</th>
              <th className={thClass}>{t("catalog.colPlan")}</th>
              <th className={thClass}>{t("catalog.colReadiness")}</th>
              <th className={thClass}>{t("catalog.colProfiles")}</th>
              <th className={thClass}>{t("catalog.colGaps")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(entry => (
              <Fragment key={entry.tool}>
                <tr className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === entry.tool ? null : entry.tool)}>
                  <td className={tdClass}>
                    <div className="flex items-center gap-1 font-mono font-semibold text-foreground">
                      {expanded === entry.tool ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {entry.tool}
                    </div>
                    {!entry.advertised && <div className="mt-1 text-[10px] text-muted-foreground">{t("catalog.notAdvertised")}</div>}
                  </td>
                  <td className={tdClass}>{entry.family}</td>
                  <td className={tdClass}><AccessBadge access={entry.access} label={t(`catalog.${entry.access}`)} /></td>
                  <td className={tdClass}>{entry.confirmation}</td>
                  <td className={tdClass}>{entry.humanApproval}</td>
                  <td className={tdClass}>
                    {entry.planFeature && <div>{entry.planFeature}</div>}
                    <PlanCoverageCell family={entry.family} coverage={data.planCoverage} t={t} />
                  </td>
                  <td className={tdClass}>{entry.readiness ?? "—"}</td>
                  <td className={tdClass}>
                    {entry.verticalScoped ? t("catalog.profilesCount", { count: entry.profiles.length }) : t("catalog.horizontal")}
                  </td>
                  <td className={tdClass}>
                    {entry.gaps.length
                      ? <span className="text-rose-600 dark:text-rose-400">{entry.gaps.join(" · ")}</span>
                      : "—"}
                  </td>
                </tr>
                {expanded === entry.tool && (
                  <tr className="bg-muted/30">
                    <td colSpan={9} className="px-6 py-3">
                      <p className="max-w-4xl text-xs text-foreground">{entry.description || t("catalog.noDescription")}</p>
                      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                        <div><dt className="inline font-semibold">{t("catalog.effect")}: </dt><dd className="inline">{entry.effect}</dd></div>
                        <div><dt className="inline font-semibold">{t("catalog.assurance")}: </dt><dd className="inline">{entry.assurance}</dd></div>
                        <div><dt className="inline font-semibold">{t("catalog.idempotency")}: </dt><dd className="inline">{entry.idempotency}</dd></div>
                        <div><dt className="inline font-semibold">{t("catalog.subpermission")}: </dt><dd className="inline">{entry.subpermission ? `${entry.subpermission.family}.${entry.subpermission.flag}` : "—"}</dd></div>
                      </dl>
                      {entry.verticalScoped && entry.profiles.length > 0 && (
                        <p className="mt-2 text-[11px] text-muted-foreground">{entry.profiles.join(" · ")}</p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-muted-foreground">{t("catalog.noResults")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TenantsTab({ data, t }: { data: TenantsPayload; t: ReturnType<typeof useTranslations> }) {
  const [query, setQuery] = useState("");
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return data.tenants.filter(row => {
      if (onlyAnomalies && row.usedButNotEnabled.length === 0) return false;
      if (!normalized) return true;
      return [row.name, row.plan, row.industry, row.subtype, row.tenantId]
        .some(value => String(value || "").toLocaleLowerCase().includes(normalized));
    });
  }, [data.tenants, query, onlyAnomalies]);

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("tenants.windowHint", { days: data.windowDays })}</p>
      {!data.usageAvailable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t("usageUnavailable")}
        </div>
      )}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <label className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t("tenants.search")}
            aria-label={t("tenants.search")}
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground"
          />
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={onlyAnomalies} onChange={event => setOnlyAnomalies(event.target.checked)} />
          {t("tenants.onlyAnomalies")}
        </label>
        {data.skippedSchemas > 0 && (
          <span className="text-xs text-muted-foreground">{t("tenants.skipped", { count: data.skippedSchemas })}</span>
        )}
      </div>
      <div className="overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
            <tr>
              <th className={thClass}>{t("tenants.colTenant")}</th>
              <th className={thClass}>{t("tenants.colPlan")}</th>
              <th className={thClass}>{t("tenants.colAgents")}</th>
              <th className={thClass}>{t("tenants.colEnabled")}</th>
              <th className={thClass}>{t("tenants.colUsed")}</th>
              <th className={thClass}>{t("tenants.colUnused")}</th>
              <th className={thClass}>{t("tenants.colAnomaly")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(row => (
              <Fragment key={row.tenantId}>
                <tr className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.tenantId ? null : row.tenantId)}>
                  <td className={tdClass}>
                    <div className="flex items-center gap-1 font-semibold text-foreground">
                      {expanded === row.tenantId ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {row.name}
                      {row.isInternal && <span className={cn(pill, "border-border text-muted-foreground")}>{t("tenants.internal")}</span>}
                      {!row.isActive && <span className={cn(pill, "border-border text-muted-foreground")}>{t("tenants.inactive")}</span>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{[row.industry, row.subtype].filter(Boolean).join(" / ") || "—"}</div>
                  </td>
                  <td className={tdClass}>
                    {row.plan}
                    {row.planFeatures.customerPayments === false && <div className="text-[10px] text-muted-foreground">{t("tenants.noPayments")}</div>}
                    {Array.isArray(row.planToolFamilies) && (
                      <div className="text-[10px] text-muted-foreground">{t("tenants.planFamiliesCount", { count: row.planToolFamilies.length })}</div>
                    )}
                  </td>
                  <td className={tdClass}>
                    {row.agentsError ? <span className="text-rose-600 dark:text-rose-400">{t("tenants.agentsError")}</span> : row.agents.length}
                  </td>
                  <td className={tdClass}>{row.enabledTools.length}</td>
                  <td className={tdClass}>{row.usedTools.length}</td>
                  <td className={tdClass}>
                    <span className={row.enabledButUnused.length ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>{row.enabledButUnused.length}</span>
                  </td>
                  <td className={tdClass}>
                    {row.usedButNotEnabled.length
                      ? <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400"><AlertTriangle size={12} />{row.usedButNotEnabled.length}</span>
                      : "—"}
                  </td>
                </tr>
                {expanded === row.tenantId && (
                  <tr className="bg-muted/30">
                    <td colSpan={7} className="space-y-3 px-6 py-3">
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("tenants.agents")}</div>
                        {row.agents.length === 0 && <div className="text-xs text-muted-foreground">{t("tenants.noAgents")}</div>}
                        {row.agents.map(agent => (
                          <div key={agent.id} className="text-xs text-foreground">
                            <span className="font-semibold">{agent.name || agent.id}</span>
                            {agent.version !== null && <span className="text-muted-foreground"> · v{agent.version}</span>}
                            <span className="text-muted-foreground"> · {[...agent.enabledFamilies, ...(agent.paymentsEnabled ? ["payments"] : [])].join(", ") || "—"}</span>
                            {agent.subpermissionDenials.map(denial => (
                              <span key={denial.flag} className="ml-2 text-amber-700 dark:text-amber-300">
                                {t("tenants.subpermissionDenied", { flag: `${denial.family}.${denial.flag}` })}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("tenants.usedButNotEnabled")}</div>
                        <ToolChips tools={row.usedButNotEnabled} tone="danger" />
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("tenants.enabledButUnused")}</div>
                        <ToolChips tools={row.enabledButUnused} tone="warn" />
                      </div>
                      {row.blockedByPlan.length > 0 && (
                        <div>
                          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("tenants.blockedByPlan")}</div>
                          <ToolChips tools={row.blockedByPlan} tone="muted" />
                        </div>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        {Array.isArray(row.planToolFamilies)
                          ? t("tenants.planFamilies", { families: row.planToolFamilies.join(", ") || "—" })
                          : t("tenants.planAllFamilies")}
                      </div>
                      {row.usage.length > 0 && (
                        <table className="w-full max-w-2xl text-left text-[11px]">
                          <thead className="text-muted-foreground">
                            <tr>
                              <th className="py-1 pr-3 font-semibold">{t("usage.colTool")}</th>
                              <th className="py-1 pr-3 font-semibold">{t("usage.colCalls")}</th>
                              <th className="py-1 pr-3 font-semibold">{t("usage.colErrors")}</th>
                              <th className="py-1 pr-3 font-semibold">{t("usage.colBlocked")}</th>
                              <th className="py-1 pr-3 font-semibold">{t("usage.colLastUsed")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.usage.map(usage => (
                              <tr key={usage.tool}>
                                <td className="py-0.5 pr-3 font-mono">{usage.tool}</td>
                                <td className="py-0.5 pr-3">{fmtNum(usage.calls)}</td>
                                <td className="py-0.5 pr-3">{fmtNum(usage.errors)}</td>
                                <td className="py-0.5 pr-3">{fmtNum(usage.blocked)}</td>
                                <td className="py-0.5 pr-3">{fmtDate(usage.lastAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {row.nonLiveCalls > 0 && (
                        <div className="text-[11px] text-muted-foreground">{t("tenants.nonLive", { count: row.nonLiveCalls })}</div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">{t("tenants.noResults")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DayBars({ days, t }: { days: UsagePayload["days"]; t: ReturnType<typeof useTranslations> }) {
  const max = Math.max(1, ...days.map(day => day.calls));
  if (!days.length) return <div className="text-sm text-muted-foreground">{t("usage.noData")}</div>;
  return (
    <div className="flex h-32 items-end gap-1" role="img" aria-label={t("usage.perDay")}>
      {days.map(day => {
        const height = Math.max(2, Math.round((day.calls / max) * 100));
        const errorShare = day.calls > 0 ? (day.errors / day.calls) * 100 : 0;
        return (
          <div
            key={day.day}
            className="relative flex-1 overflow-hidden rounded-t bg-indigo-500/80"
            style={{ height: `${height}%` }}
            title={t("usage.dayTooltip", { day: day.day, calls: day.calls, errors: day.errors })}
          >
            <div className="absolute inset-x-0 top-0 bg-rose-500" style={{ height: `${errorShare}%` }} />
          </div>
        );
      })}
    </div>
  );
}

function UsageTab({ t, tenants }: { t: ReturnType<typeof useTranslations>; tenants: TenantRow[] }) {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [mode, setMode] = useState<Mode>("live");
  const [tenantId, setTenantId] = useState("");
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days), mode });
      if (tenantId) params.set("tenantId", tenantId);
      const response = await api.fetch(`/admin/tools/usage?${params.toString()}`);
      if (!response?.success || !response?.data) throw new Error(t("loadError"));
      setData(response.data as UsagePayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [days, mode, tenantId, t]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {PERIODS.map(period => (
            <button
              key={period}
              type="button"
              onClick={() => setDays(period)}
              className={cn("rounded px-3 py-1.5 text-xs font-medium transition",
                days === period ? "bg-indigo-600 text-white" : "text-muted-foreground hover:text-foreground")}
            >
              {t("usage.period", { days: period })}
            </button>
          ))}
        </div>
        <select value={mode} onChange={event => setMode(event.target.value as Mode)} aria-label={t("usage.mode")} className={selectClass}>
          {MODES.map(item => <option key={item} value={item}>{t(`usage.modes.${item}`)}</option>)}
        </select>
        <select value={tenantId} onChange={event => setTenantId(event.target.value)} aria-label={t("usage.tenant")} className={selectClass}>
          <option value="">{t("usage.allTenants")}</option>
          {tenants.map(row => <option key={row.tenantId} value={row.tenantId}>{row.name}</option>)}
        </select>
        {loading && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>
      )}
      {data && !data.available && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t("usageUnavailable")}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={t("usage.kpiCalls")} value={fmtNum(data.totals.calls)} />
            <Kpi label={t("usage.kpiErrorRate")} value={fmtPct(data.totals.errorRate)} tone={data.totals.errorRate >= 0.05 ? "danger" : undefined} />
            <Kpi label={t("usage.kpiP95")} value={fmtMs(data.totals.p95Ms)} />
            <Kpi label={t("usage.kpiBlocked")} value={fmtNum(data.totals.blocked)} />
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 text-sm font-semibold text-foreground">{t("usage.perDay")}</div>
            <DayBars days={data.days} t={t} />
            <p className="mt-2 text-[11px] text-muted-foreground">{t("usage.perDayHint")}</p>
          </div>

          <div className="overflow-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[1000px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                <tr>
                  <th className={thClass}>{t("usage.colTool")}</th>
                  <th className={thClass}>{t("usage.colCalls")}</th>
                  <th className={thClass}>{t("usage.colErrors")}</th>
                  <th className={thClass}>{t("usage.colErrorRate")}</th>
                  <th className={thClass}>{t("usage.colBlocked")}</th>
                  <th className={thClass}>{t("usage.colP50")}</th>
                  <th className={thClass}>{t("usage.colP95")}</th>
                  <th className={thClass}>{t("usage.colMax")}</th>
                  <th className={thClass}>{t("usage.colTenants")}</th>
                  <th className={thClass}>{t("usage.colLastUsed")}</th>
                  <th className={thClass}>{t("usage.colLastError")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.tools.map(tool => (
                  <tr key={tool.tool}>
                    <td className={cn(tdClass, "font-mono font-semibold text-foreground")}>{tool.tool}</td>
                    <td className={tdClass}>{fmtNum(tool.calls)}</td>
                    <td className={cn(tdClass, tool.errors > 0 && "font-semibold text-rose-600 dark:text-rose-400")}>{fmtNum(tool.errors)}</td>
                    <td className={tdClass}>{fmtPct(tool.errorRate)}</td>
                    <td className={tdClass}>{fmtNum(tool.blocked)}</td>
                    <td className={tdClass}>{fmtMs(tool.p50Ms)}</td>
                    <td className={tdClass}>{fmtMs(tool.p95Ms)}</td>
                    <td className={tdClass}>{fmtMs(tool.maxMs)}</td>
                    <td className={tdClass}>{tool.tenants}</td>
                    <td className={tdClass}>{fmtDate(tool.lastAt)}</td>
                    <td className={cn(tdClass, "font-mono")}>{tool.lastErrorCode ?? "—"}</td>
                  </tr>
                ))}
                {data.tools.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-6 text-center text-sm text-muted-foreground">{t("usage.noData")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("usage.estimateHint")}</p>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 text-sm font-semibold text-foreground">{t("usage.topErrors")}</div>
            {data.topErrors.length === 0
              ? <div className="text-sm text-muted-foreground">{t("usage.noErrors")}</div>
              : (
                <ul className="divide-y divide-border text-xs">
                  {data.topErrors.map(item => (
                    <li key={`${item.tool}:${item.errorCode}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-mono text-foreground">{item.tool} · <span className="text-rose-600 dark:text-rose-400">{item.errorCode ?? "—"}</span></span>
                      <span className="text-muted-foreground">{t("usage.topErrorLine", { calls: item.calls, tenants: item.tenants })}</span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </>
      )}
    </section>
  );
}

export default function AgentToolsPage() {
  const t = useTranslations("agentTools");
  const [tab, setTab] = useState<Tab>("catalog");
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [tenants, setTenants] = useState<TenantsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    const response = await api.fetch("/admin/tools/catalog");
    if (!response?.success || !response?.data?.entries) throw new Error(t("loadError"));
    setCatalog(response.data as CatalogPayload);
  }, [t]);

  const loadTenants = useCallback(async () => {
    const response = await api.fetch("/admin/tools/tenants");
    if (!response?.success || !response?.data?.tenants) throw new Error(t("loadError"));
    setTenants(response.data as TenantsPayload);
  }, [t]);

  const load = useCallback(async (which: Tab, force = false) => {
    setLoading(true);
    setError(null);
    try {
      if (which === "catalog" && (force || !catalog)) await loadCatalog();
      // Uso y salud ofrece el filtro por tenant, así que también necesita la lista.
      if ((which === "tenants" || which === "usage") && (force || !tenants)) await loadTenants();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [catalog, tenants, loadCatalog, loadTenants, t]);

  useEffect(() => { void load(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: Array<{ key: Tab; icon: typeof Wrench }> = [
    { key: "catalog", icon: Wrench },
    { key: "tenants", icon: Building2 },
    { key: "usage", icon: Activity },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
            <Wrench size={14} /> {t("eyebrow")}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {tab !== "usage" && (
          <button
            type="button"
            onClick={() => void load(tab, true)}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> {t("refresh")}
          </button>
        )}
      </header>

      <div role="tablist" aria-label={t("title")} className="flex gap-1 border-b border-border">
        {tabs.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn("-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition",
              tab === key ? "border-indigo-600 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <Icon size={15} /> {t(`tabs.${key}`)}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>
      )}
      {loading && tab !== "usage" && !(tab === "catalog" ? catalog : tenants) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> {t("loading")}</div>
      )}

      {tab === "catalog" && catalog && <CatalogTab data={catalog} t={t} />}
      {tab === "tenants" && tenants && <TenantsTab data={tenants} t={t} />}
      {tab === "usage" && <UsageTab t={t} tenants={tenants?.tenants ?? []} />}
    </div>
  );
}
