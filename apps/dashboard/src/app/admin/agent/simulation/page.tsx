"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    FlaskConical, Play, Loader2, Bot, Sparkles, History as HistoryIcon,
    TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle, ChevronRight, X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";

// ── Types ───────────────────────────────────────────────────
interface Agent { id: string; name: string; is_default?: boolean; is_active?: boolean; }

interface RunSummary {
    id: string;
    agentId: string;
    channelType: string;
    scenarioSource: "synthetic" | "replay";
    vertical: string | null;
    status: "pending" | "running" | "completed" | "failed";
    scenarioCount: number;
    avgScore: number | null;
    resolvedRate: number | null;
    summary: any;
    baselineRunId: string | null;
    error: string | null;
    createdAt: string;
    completedAt: string | null;
}

interface ScenarioResult {
    key: string;
    title: string;
    goal: string;
    difficulty?: string;
    source: string;
    transcript: Array<{ role: "customer" | "agent"; content: string }>;
    judge: {
        overall: number; resolution: number; tone: number; accuracy: number; empathy: number;
        flags: string[]; resolved: boolean; resolutionReason: string;
    };
    turns: number;
    error?: string;
}

interface RunDetail extends RunSummary { results: ScenarioResult[]; personaVersion?: number; }

const STATUS_COLORS: Record<string, string> = {
    pending: "text-muted-foreground",
    running: "text-amber-500",
    completed: "text-emerald-500",
    failed: "text-red-400",
};

function scoreColor(n: number): string {
    return n >= 8 ? "text-emerald-500" : n >= 5 ? "text-amber-500" : "text-red-400";
}

const CARD = "p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]";

export default function AgentSimulationPage() {
    const t = useTranslations("simulation");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();

    const [agents, setAgents] = useState<Agent[]>([]);
    const [runs, setRuns] = useState<RunSummary[]>([]);
    const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
    const [openScenario, setOpenScenario] = useState<ScenarioResult | null>(null);
    const [launching, setLaunching] = useState(false);
    const [loadingRun, setLoadingRun] = useState(false);

    // Form state
    const [agentId, setAgentId] = useState<string>("");
    const [source, setSource] = useState<"synthetic" | "replay">("synthetic");
    const [count, setCount] = useState(50);
    const [baselineRunId, setBaselineRunId] = useState<string>("");

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Data loading ──────────────────────────────────────────
    const loadAgents = useCallback(async () => {
        if (!activeTenantId) return;
        const res: any = await api.listAgents(activeTenantId);
        if (res?.success && Array.isArray(res.data)) {
            setAgents(res.data);
            const def = res.data.find((a: Agent) => a.is_default) || res.data[0];
            if (def && !agentId) setAgentId(def.id);
        }
    }, [activeTenantId, agentId]);

    const loadRuns = useCallback(async () => {
        if (!activeTenantId) return;
        const res: any = await api.listAgentSimulations(activeTenantId, 20);
        if (res?.success) setRuns(res.data as RunSummary[]);
    }, [activeTenantId]);

    const loadRunDetail = useCallback(async (runId: string) => {
        if (!activeTenantId) return;
        setLoadingRun(true);
        const res: any = await api.getAgentSimulation(activeTenantId, runId);
        if (res?.success && res.data) setSelectedRun(res.data as RunDetail);
        setLoadingRun(false);
    }, [activeTenantId]);

    useEffect(() => { loadAgents(); loadRuns(); }, [loadAgents, loadRuns]);

    // ── Poll while a run is pending/running ──────────────────
    useEffect(() => {
        const active = selectedRun && (selectedRun.status === "pending" || selectedRun.status === "running");
        if (active) {
            pollRef.current = setInterval(() => {
                loadRunDetail(selectedRun!.id);
                loadRuns();
            }, 4000);
        }
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [selectedRun?.id, selectedRun?.status, loadRunDetail, loadRuns]);

    // ── Actions ──────────────────────────────────────────────
    const launch = async () => {
        if (!activeTenantId || !agentId) return;
        setLaunching(true);
        try {
            const res: any = await api.runAgentSimulation(activeTenantId, {
                agentId,
                scenarioSource: source,
                count,
                baselineRunId: baselineRunId || undefined,
            });
            if (res?.success && res.data?.runId) {
                await loadRuns();
                await loadRunDetail(res.data.runId);
            }
        } finally {
            setLaunching(false);
        }
    };

    const completedRuns = runs.filter((r) => r.status === "completed");

    // ── Render ───────────────────────────────────────────────
    return (
        <div className="space-y-6">
            <PageHeader icon={FlaskConical} title={t("title")} subtitle={t("subtitle")} />
            <HelpPanel
                title={tHelp("agentSimulation.title")}
                description={tHelp("agentSimulation.description")}
                tips={tHelp.raw("agentSimulation.tips") as string[]}
                mediaKey="agentSimulation"
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Launch panel */}
                <div className={cn(CARD, "lg:col-span-1 space-y-5 h-fit")}>
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Sparkles size={16} className="text-accent" />
                        {t("newRun")}
                    </h3>

                    {/* Agent */}
                    <div className="space-y-1.5">
                        <label className="text-[13px] text-text-secondary">{t("agent")}</label>
                        <select
                            value={agentId}
                            onChange={(e) => setAgentId(e.target.value)}
                            className="w-full rounded-lg bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/10 px-3 py-2 text-sm text-foreground"
                        >
                            {agents.map((a) => (
                                <option key={a.id} value={a.id}>{a.name}{a.is_default ? ` (${t("default")})` : ""}</option>
                            ))}
                        </select>
                    </div>

                    {/* Scenario source */}
                    <div className="space-y-1.5">
                        <label className="text-[13px] text-text-secondary">{t("scenarioSource")}</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(["synthetic", "replay"] as const).map((s) => (
                                <button
                                    key={s}
                                    onClick={() => setSource(s)}
                                    className={cn(
                                        "rounded-lg border px-3 py-2 text-[13px] transition-colors",
                                        source === s
                                            ? "border-accent bg-accent/10 text-foreground"
                                            : "border-neutral-200 dark:border-white/10 text-text-secondary hover:bg-neutral-50 dark:hover:bg-white/[0.04]",
                                    )}
                                >
                                    {t(`source_${s}`)}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">{t(`source_${source}_hint`)}</p>
                    </div>

                    {/* Count */}
                    <div className="space-y-1.5">
                        <label className="text-[13px] text-text-secondary">{t("scenarioCount")}</label>
                        <input
                            type="number" min={1} max={100} value={count}
                            onChange={(e) => setCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                            className="w-full rounded-lg bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/10 px-3 py-2 text-sm text-foreground"
                        />
                    </div>

                    {/* Baseline */}
                    <div className="space-y-1.5">
                        <label className="text-[13px] text-text-secondary">{t("baseline")}</label>
                        <select
                            value={baselineRunId}
                            onChange={(e) => setBaselineRunId(e.target.value)}
                            className="w-full rounded-lg bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/10 px-3 py-2 text-sm text-foreground"
                        >
                            <option value="">{t("baselineNone")}</option>
                            {completedRuns.map((r) => (
                                <option key={r.id} value={r.id}>
                                    {new Date(r.createdAt).toLocaleString()} · {r.avgScore ?? "—"}/10
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-muted-foreground">{t("baselineHint")}</p>
                    </div>

                    <button
                        onClick={launch}
                        disabled={launching || !agentId}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent text-white px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                        {launching ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                        {t("runButton")}
                    </button>
                </div>

                {/* Results + history */}
                <div className="lg:col-span-2 space-y-6">
                    {selectedRun ? (
                        <RunResults run={selectedRun} loading={loadingRun} onOpenScenario={setOpenScenario} t={t} />
                    ) : (
                        <div className={cn(CARD, "flex flex-col items-center justify-center py-16 text-center")}>
                            <FlaskConical size={32} className="text-muted-foreground mb-3" />
                            <p className="text-text-secondary text-sm">{t("emptyState")}</p>
                        </div>
                    )}

                    {/* History */}
                    <div className={CARD}>
                        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                            <HistoryIcon size={16} className="text-muted-foreground" />
                            {t("history")}
                        </h3>
                        {runs.length === 0 ? (
                            <p className="text-muted-foreground text-sm py-4 text-center">{t("noRuns")}</p>
                        ) : (
                            <div className="space-y-1.5">
                                {runs.map((r) => {
                                    const reg = r.summary?.baseline?.hasRegression;
                                    return (
                                        <button
                                            key={r.id}
                                            onClick={() => loadRunDetail(r.id)}
                                            className={cn(
                                                "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-white/[0.04]",
                                                selectedRun?.id === r.id && "bg-neutral-50 dark:bg-white/[0.04]",
                                            )}
                                        >
                                            <span className={cn("text-xs font-medium capitalize w-20", STATUS_COLORS[r.status])}>
                                                {r.status === "running" || r.status === "pending"
                                                    ? <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" />{t(`status_${r.status}`)}</span>
                                                    : t(`status_${r.status}`)}
                                            </span>
                                            <span className="text-xs text-text-secondary flex-1 truncate">
                                                {t(`source_${r.scenarioSource}`)} · {r.scenarioCount} · {new Date(r.createdAt).toLocaleString()}
                                            </span>
                                            {reg && <AlertTriangle size={13} className="text-red-400" />}
                                            {r.avgScore != null && (
                                                <span className={cn("text-sm font-semibold", scoreColor(r.avgScore))}>{r.avgScore}/10</span>
                                            )}
                                            <ChevronRight size={14} className="text-muted-foreground" />
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {openScenario && (
                <ScenarioDrawer scenario={openScenario} onClose={() => setOpenScenario(null)} t={t} />
            )}
        </div>
    );
}

// ── Run results ─────────────────────────────────────────────
function RunResults({ run, loading, onOpenScenario, t }: {
    run: RunDetail; loading: boolean;
    onOpenScenario: (s: ScenarioResult) => void;
    t: ReturnType<typeof useTranslations>;
}) {
    const busy = run.status === "pending" || run.status === "running";

    if (run.status === "failed") {
        return (
            <div className={cn(CARD, "border-red-300 dark:border-red-500/30")}>
                <div className="flex items-center gap-2 text-red-400 mb-2"><XCircle size={18} />{t("status_failed")}</div>
                <p className="text-sm text-text-secondary">{run.error || t("genericError")}</p>
            </div>
        );
    }

    const s = run.summary || {};
    const base = s.baseline;
    const sub = s.avgSubScores || {};

    return (
        <div className={CARD}>
            <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-semibold text-foreground">{t("results")}</h3>
                {busy && (
                    <span className="flex items-center gap-1.5 text-xs text-amber-500">
                        <Loader2 size={13} className="animate-spin" />{t("runningProgress", { done: s.scored ?? 0, total: run.scenarioCount })}
                    </span>
                )}
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <Kpi label={t("avgScore")} value={run.avgScore != null ? `${run.avgScore}/10` : "—"} color={run.avgScore != null ? scoreColor(run.avgScore) : ""} />
                <Kpi label={t("resolvedRate")} value={run.resolvedRate != null ? `${run.resolvedRate}%` : "—"} />
                <Kpi label={t("scenarios")} value={`${s.scored ?? 0}/${run.scenarioCount}`} />
                <Kpi label={t("failedScenarios")} value={s.failed ?? 0} color={s.failed ? "text-red-400" : ""} />
            </div>

            {/* Baseline diff */}
            {base && (
                <div className={cn(
                    "rounded-lg border p-4 mb-6",
                    base.hasRegression ? "border-red-300 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/[0.04]"
                        : "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/[0.04]",
                )}>
                    <div className="flex items-center gap-2 mb-3">
                        {base.hasRegression
                            ? <><AlertTriangle size={16} className="text-red-400" /><span className="text-sm font-medium text-foreground">{t("regressionDetected")}</span></>
                            : <><CheckCircle2 size={16} className="text-emerald-500" /><span className="text-sm font-medium text-foreground">{t("noRegression")}</span></>}
                        <span className={cn("ml-auto text-sm font-semibold flex items-center gap-1", base.avgDelta >= 0 ? "text-emerald-500" : "text-red-400")}>
                            {base.avgDelta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                            {base.avgDelta >= 0 ? "+" : ""}{base.avgDelta}
                        </span>
                    </div>
                    {base.regressions?.length > 0 && (
                        <div className="space-y-1">
                            {base.regressions.map((r: any) => (
                                <div key={r.key} className="text-xs text-text-secondary flex items-center gap-2">
                                    <TrendingDown size={12} className="text-red-400 shrink-0" />
                                    <span className="truncate flex-1">{r.title}</span>
                                    <span className="text-muted-foreground">{r.before} → <span className="text-red-400">{r.after}</span></span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Sub-scores */}
            {s.scored > 0 && (
                <div className="space-y-3 mb-6">
                    {["resolution", "tone", "accuracy", "empathy"].map((k) => {
                        const v = sub[k] ?? 0;
                        return (
                            <div key={k}>
                                <div className="flex justify-between text-[13px] mb-1">
                                    <span className="text-text-secondary">{t(k)}</span>
                                    <span className="text-foreground font-medium">{v}/10</span>
                                </div>
                                <div className="h-2 rounded-full bg-neutral-100 dark:bg-white/[0.06] overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${(v / 10) * 100}%`, background: v >= 8 ? "#10b981" : v >= 5 ? "#f59e0b" : "#ef4444" }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Scenarios table */}
            {run.results?.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-neutral-200 dark:border-white/10">
                                <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t("scenario")}</th>
                                <th className="text-center py-2.5 px-3 text-muted-foreground font-medium">{t("score")}</th>
                                <th className="text-center py-2.5 px-3 text-muted-foreground font-medium">{t("resolved")}</th>
                                <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t("issues")}</th>
                                <th className="w-8"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {run.results.map((r) => (
                                <tr
                                    key={r.key}
                                    onClick={() => onOpenScenario(r)}
                                    className="border-b border-neutral-100 dark:border-white/5 cursor-pointer hover:bg-neutral-50 dark:hover:bg-white/[0.03]"
                                >
                                    <td className="py-2.5 px-3 text-text-secondary max-w-[280px] truncate">{r.title}</td>
                                    <td className="py-2.5 px-3 text-center">
                                        {r.error ? <span className="text-red-400 text-xs">{t("error")}</span>
                                            : <span className={cn("font-semibold", scoreColor(r.judge.overall))}>{r.judge.overall}/10</span>}
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                        {r.error ? "—" : r.judge.resolved
                                            ? <CheckCircle2 size={15} className="text-emerald-500 inline" />
                                            : <XCircle size={15} className="text-red-400 inline" />}
                                    </td>
                                    <td className="py-2.5 px-3 text-text-secondary max-w-[220px] truncate text-xs">
                                        {r.judge.flags?.length ? r.judge.flags.join("; ") : "—"}
                                    </td>
                                    <td className="py-2.5 px-3"><ChevronRight size={14} className="text-muted-foreground" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function Kpi({ label, value, color }: { label: string; value: string | number; color?: string }) {
    return (
        <div className="rounded-lg bg-neutral-50 dark:bg-white/[0.03] border border-neutral-200 dark:border-white/[0.06] p-3">
            <div className="text-xs text-muted-foreground mb-1">{label}</div>
            <div className={cn("text-lg font-semibold text-foreground", color)}>{value}</div>
        </div>
    );
}

// ── Scenario transcript drawer ──────────────────────────────
function ScenarioDrawer({ scenario, onClose, t }: {
    scenario: ScenarioResult; onClose: () => void; t: ReturnType<typeof useTranslations>;
}) {
    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-lg h-full bg-white dark:bg-[#12121e] border-l border-neutral-200 dark:border-white/10 overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 bg-white dark:bg-[#12121e] border-b border-neutral-200 dark:border-white/10 px-5 py-4 flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">{scenario.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{scenario.goal}</p>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-5">
                    {/* Judge scores */}
                    {!scenario.error && (
                        <div className="grid grid-cols-5 gap-2 text-center">
                            {(["overall", "resolution", "tone", "accuracy", "empathy"] as const).map((k) => (
                                <div key={k} className="rounded-lg bg-neutral-50 dark:bg-white/[0.03] p-2">
                                    <div className={cn("text-sm font-semibold", scoreColor(scenario.judge[k]))}>{scenario.judge[k]}</div>
                                    <div className="text-[10px] text-muted-foreground mt-0.5">{t(k)}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {scenario.judge?.resolutionReason && (
                        <p className="text-xs text-text-secondary italic border-l-2 border-accent/40 pl-3">{scenario.judge.resolutionReason}</p>
                    )}

                    {scenario.judge?.flags?.length > 0 && (
                        <div className="space-y-1">
                            {scenario.judge.flags.map((f, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />{f}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Transcript */}
                    <div className="space-y-3 pt-2">
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("transcript")}</h4>
                        {scenario.transcript.map((m, i) => (
                            <div key={i} className={cn("flex", m.role === "customer" ? "justify-start" : "justify-end")}>
                                <div className={cn(
                                    "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                                    m.role === "customer"
                                        ? "bg-neutral-100 dark:bg-white/[0.06] text-foreground rounded-bl-sm"
                                        : "bg-accent/90 text-white rounded-br-sm",
                                )}>
                                    <div className="text-[10px] opacity-70 mb-0.5 flex items-center gap-1">
                                        {m.role === "customer" ? t("roleCustomer") : <><Bot size={10} /> {t("roleAgent")}</>}
                                    </div>
                                    {m.content}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
