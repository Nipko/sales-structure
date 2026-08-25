"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type BacklogState = "open" | "stale" | "external_gate" | "decision_gate" | "expert_gate";
type Responsibility = "internal" | "mixed" | "decision" | "external";

interface BacklogEvidence {
  key: string;
  status: "verified" | "missing" | "required";
  source: string;
  detail: string;
}

interface BacklogGate {
  kind: "internal" | "external" | "decision" | "expert";
  status: "verified" | "open" | "required";
  detail: string;
}

interface BacklogItem {
  alert: string;
  state: BacklogState;
  responsibility: Responsibility;
  detail: string;
  nextAction: string;
  evidence: readonly BacklogEvidence[];
  gates: readonly BacklogGate[];
  openCodeWork: readonly string[];
}

interface BacklogEntry {
  profileId: string;
  strategy: string;
  items: BacklogItem[];
  openCodeWork?: readonly string[];
}

interface BacklogPayload {
  generatedAt?: string;
  state?: Partial<Record<BacklogState, number>>;
  responsibility?: Partial<Record<Responsibility, number>>;
  entries: BacklogEntry[];
  certification?: {
    version: number;
    entries: Array<{
      profileId: string;
      product: { executionMode: "read_write" | "read_only_handoff" };
      overall: { certified: boolean };
      reasons: readonly unknown[];
    }>;
  };
}

const RESPONSIBILITIES: readonly Responsibility[] = ["internal", "mixed", "decision", "external"];
const STATES: readonly BacklogState[] = ["open", "stale", "external_gate", "decision_gate", "expert_gate"];

function StateBadge({ state, label }: { state: BacklogState; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
      state === "stale"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
        : state === "expert_gate"
          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
          : state === "open"
            ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            : state === "decision_gate"
              ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
              : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
    )}>
      {label}
    </span>
  );
}

export default function VerticalAuditPage() {
  const t = useTranslations("verticalAudit");
  const [payload, setPayload] = useState<BacklogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [responsibility, setResponsibility] = useState<Responsibility | "all">("all");
  const [state, setState] = useState<BacklogState | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.fetch("/verticals/audit/native-backlog");
      if (!response?.success || !response?.data?.entries) throw new Error(t("loadError"));
      setPayload(response.data as BacklogPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const flattened = useMemo(() => (payload?.entries || []).flatMap(entry => (
    entry.items.map(item => ({ ...item, profileId: entry.profileId, strategy: entry.strategy }))
  )), [payload]);

  const computedResponsibility = useMemo(() => {
    const counts: Record<Responsibility, number> = { internal: 0, mixed: 0, decision: 0, external: 0 };
    for (const item of flattened) counts[item.responsibility] += 1;
    return counts;
  }, [flattened]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return flattened.filter(item => {
      if (responsibility !== "all" && item.responsibility !== responsibility) return false;
      if (state !== "all" && item.state !== state) return false;
      if (!normalized) return true;
      return [item.profileId, item.strategy, item.alert, item.detail, item.nextAction]
        .some(value => String(value || "").toLocaleLowerCase().includes(normalized));
    });
  }, [flattened, query, responsibility, state]);

  const decisions = useMemo(() => flattened.filter(item => (
    item.gates?.some(gate => gate.kind === "decision" || gate.kind === "external" || gate.kind === "expert")
  )), [flattened]);
  const certificationSummary = useMemo(() => {
    const entries = payload?.certification?.entries || [];
    return {
      total: entries.length,
      readWrite: entries.filter(entry => entry.product.executionMode === "read_write").length,
      handoffOnly: entries.filter(entry => entry.product.executionMode === "read_only_handoff").length,
      certified: entries.filter(entry => entry.overall.certified).length,
    };
  }, [payload]);

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
            <ClipboardCheck size={14} /> {t("eyebrow")}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{t("title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> {t("refresh")}
        </button>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}

      {payload?.certification && (
        <section className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-indigo-950 dark:text-indigo-100">
                {t("sharedContractTitle", { version: payload.certification.version })}
              </div>
              <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-300">{t("sharedContractHint")}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold text-indigo-900 dark:text-indigo-100">
              <span className="rounded-full bg-white px-3 py-1 dark:bg-slate-900">{t("contractTotal", { count: certificationSummary.total })}</span>
              <span className="rounded-full bg-white px-3 py-1 dark:bg-slate-900">{t("contractReadWrite", { count: certificationSummary.readWrite })}</span>
              <span className="rounded-full bg-white px-3 py-1 dark:bg-slate-900">{t("contractHandoff", { count: certificationSummary.handoffOnly })}</span>
              <span className="rounded-full bg-white px-3 py-1 dark:bg-slate-900">{t("contractCertified", { count: certificationSummary.certified })}</span>
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {RESPONSIBILITIES.map(value => {
          const icons = { internal: Wrench, mixed: AlertTriangle, decision: ShieldAlert, external: ExternalLink };
          const Icon = icons[value];
          return (
            <button
              type="button"
              key={value}
              onClick={() => setResponsibility(previous => previous === value ? "all" : value)}
              className={cn(
                "rounded-xl border bg-white p-4 text-left shadow-sm transition dark:bg-slate-900",
                responsibility === value
                  ? "border-indigo-400 ring-2 ring-indigo-100 dark:border-indigo-500 dark:ring-indigo-950"
                  : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700",
              )}
            >
              <div className="flex items-center justify-between">
                <Icon size={18} className="text-indigo-500" />
                <span className="text-2xl font-bold text-slate-950 dark:text-white">
                  {payload?.responsibility?.[value] ?? computedResponsibility[value]}
                </span>
              </div>
              <div className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{t(`responsibility.${value}`)}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t(`responsibility.${value}Hint`)}</div>
            </button>
          );
        })}
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {STATES.map(value => (
          <button
            type="button"
            key={value}
            onClick={() => setState(previous => previous === value ? "all" : value)}
            className={cn(
              "flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-left shadow-sm dark:bg-slate-900",
              state === value
                ? "border-indigo-400 ring-2 ring-indigo-100 dark:border-indigo-500 dark:ring-indigo-950"
                : "border-slate-200 dark:border-slate-800",
            )}
          >
            <StateBadge state={value} label={t(`state.${value}`)} />
            <span className="text-lg font-bold text-slate-950 dark:text-white">{payload?.state?.[value] ?? 0}</span>
          </button>
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-indigo-950"
            />
          </label>
          <div className="flex items-center gap-2 text-sm text-slate-500"><Filter size={15} /> {t("filters")}</div>
          <select
            value={responsibility}
            onChange={event => setResponsibility(event.target.value as Responsibility | "all")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="all">{t("allResponsibilities")}</option>
            {RESPONSIBILITIES.map(value => <option key={value} value={value}>{t(`responsibility.${value}`)}</option>)}
          </select>
          <select
            value={state}
            onChange={event => setState(event.target.value as BacklogState | "all")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="all">{t("allStates")}</option>
            {STATES.map(value => (
              <option key={value} value={value}>{t(`state.${value}`)}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="font-semibold text-slate-900 dark:text-white">{t("findings")}</h2>
          <span className="text-xs text-slate-500">{t("resultCount", { count: filtered.length })}</span>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {loading && <div className="p-8 text-center text-sm text-slate-500">{t("loading")}</div>}
          {!loading && filtered.length === 0 && <div className="p-8 text-center text-sm text-slate-500">{t("empty")}</div>}
          {filtered.map((item, index) => (
            <article key={`${item.profileId}:${item.alert}:${index}`} className="grid gap-3 p-4 lg:grid-cols-[220px_110px_140px_1fr]">
              <div>
                <div className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-300">{item.profileId}</div>
                <div className="mt-1 text-xs text-slate-500">{item.strategy}</div>
              </div>
              <div><span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs font-bold dark:bg-slate-800">{item.alert}</span></div>
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t(`responsibility.${item.responsibility}`)}</div>
                <StateBadge state={item.state} label={t(`state.${item.state}`)} />
              </div>
              <div>
                <p className="text-sm text-slate-800 dark:text-slate-200">{item.detail}</p>
                <p className="mt-2 text-xs text-slate-500"><strong>{t("nextAction")}:</strong> {item.nextAction}</p>
                {item.openCodeWork?.length ? (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                    <strong>{t("openCodeWork")}:</strong>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {item.openCodeWork.map(work => <li key={work}>{work}</li>)}
                    </ul>
                  </div>
                ) : null}
                {item.evidence?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.evidence.map(evidence => (
                      <span
                        key={`${evidence.key}:${evidence.status}`}
                        title={evidence.detail}
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px]",
                          evidence.status === "verified"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : evidence.status === "missing"
                              ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                              : "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200",
                        )}
                      >
                        <CheckCircle2 size={10} /> {evidence.key}: {t(`evidence.${evidence.status}`)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <div>
            <h2 className="font-semibold text-amber-950 dark:text-amber-100">{t("decisionTitle")}</h2>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{t("decisionHint", { count: decisions.length })}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {decisions.map((item, index) => (
            <div
              key={`decision:${item.profileId}:${item.alert}:${index}`}
              className="rounded-lg border border-amber-200 bg-white/80 p-3 dark:border-amber-900 dark:bg-slate-950/50"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs font-semibold text-amber-800 dark:text-amber-200">{item.profileId}</span>
                <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">{item.alert}</span>
              </div>
              <p className="mt-2 text-xs text-amber-950 dark:text-amber-100">{item.nextAction}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.gates.filter(gate => gate.kind !== "internal").map(gate => (
                  <span key={`${gate.kind}:${gate.detail}`} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                    {t(`gate.${gate.kind}`)}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                {t(`responsibility.${item.responsibility}`)}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
