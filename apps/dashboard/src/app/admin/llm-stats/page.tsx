"use client";

/**
 * LLM observability dashboard for super_admin. Aggregates Redis-backed
 * usage stats (calls, tokens, cost, latency) across providers, tenants
 * and days. Range selector covers the last 1d / 7d / 30d / 90d.
 *
 * Note: stats only flow in for LLM calls that pass tenantId — the main
 * conversation pipeline does, but auxiliary callers (intent interpreter,
 * copilot, nurturing) currently do not. Coverage will improve over time.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Brain, RefreshCw, Loader2, TrendingUp, Clock, AlertTriangle, DollarSign,
} from "lucide-react";

interface ProviderStat {
    provider: string;
    calls: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    avgLatencyMs: number;
    errors: number;
}

interface TenantStat {
    tenantId: string;
    tenantName?: string;
    calls: number;
    costUsd: number;
}

interface DayStat {
    date: string;
    calls: number;
    costUsd: number;
}

interface StatsData {
    totals: { calls: number; tokensIn: number; tokensOut: number; costUsd: number; avgLatencyMs: number; errors: number };
    byProvider: ProviderStat[];
    byTenant: TenantStat[];
    byDay: DayStat[];
}

const RANGE_OPTIONS = [
    { days: 1, labelKey: "range1d" },
    { days: 7, labelKey: "range7d" },
    { days: 30, labelKey: "range30d" },
    { days: 90, labelKey: "range90d" },
];

const PROVIDER_COLORS: Record<string, string> = {
    openai: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    anthropic: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
    google: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    xai: "bg-neutral-500/10 text-neutral-700 dark:text-neutral-300",
    deepseek: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
};

export default function LlmStatsPage() {
    const t = useTranslations("llmStats");
    const tc = useTranslations("common");
    const [days, setDays] = useState(7);
    const [data, setData] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.getLlmStats({ days });
            if (res.success) {
                setData(res.data);
                setError(null);
            } else {
                setError(res.error || tc("connectionError"));
            }
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setLoading(false);
        }
    }, [days, tc]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
    const fmtNum = (n: number) => n.toLocaleString();

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Brain className="h-6 w-6 text-indigo-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <div className="flex items-center gap-2">
                    {/* Range selector */}
                    <div className="flex bg-card border border-border rounded-lg p-0.5">
                        {RANGE_OPTIONS.map(r => (
                            <button
                                key={r.days}
                                onClick={() => setDays(r.days)}
                                className={cn(
                                    "px-3 py-1.5 text-xs font-medium rounded transition",
                                    days === r.days
                                        ? "bg-indigo-600 text-white"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {t(r.labelKey as any)}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted rounded-lg text-sm transition disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {tc("refresh")}
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Summary tiles */}
            {data && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <SummaryTile
                        label={t("totalCalls")}
                        value={fmtNum(data.totals.calls)}
                        icon={TrendingUp}
                        color="text-blue-600"
                        bg="bg-blue-500/10"
                    />
                    <SummaryTile
                        label={t("totalCost")}
                        value={fmtUsd(data.totals.costUsd)}
                        icon={DollarSign}
                        color="text-emerald-600"
                        bg="bg-emerald-500/10"
                    />
                    <SummaryTile
                        label={t("avgLatency")}
                        value={`${data.totals.avgLatencyMs}ms`}
                        icon={Clock}
                        color="text-amber-600"
                        bg="bg-amber-500/10"
                    />
                    <SummaryTile
                        label={t("errors")}
                        value={fmtNum(data.totals.errors)}
                        icon={AlertTriangle}
                        color={data.totals.errors > 0 ? "text-red-600" : "text-muted-foreground"}
                        bg="bg-red-500/10"
                        highlight={data.totals.errors > 0}
                    />
                </div>
            )}

            {/* By provider */}
            {data && data.byProvider.length > 0 && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-border">
                        <h2 className="text-base font-semibold">{t("byProvider")}</h2>
                        <p className="text-xs text-muted-foreground">{t("byProviderHint")}</p>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr className="text-left">
                                <th className="px-4 py-2 font-semibold">{t("provider")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("calls")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("tokens")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("cost")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("avgLatency")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("errors")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {data.byProvider.map(p => (
                                <tr key={p.provider} className="hover:bg-muted/20">
                                    <td className="px-4 py-2">
                                        <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-medium font-mono", PROVIDER_COLORS[p.provider] || PROVIDER_COLORS.xai)}>
                                            {p.provider}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono">{fmtNum(p.calls)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">
                                        {fmtNum(p.tokensIn)} <span className="opacity-60">→</span> {fmtNum(p.tokensOut)}
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono">{fmtUsd(p.costUsd)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-xs">{p.avgLatencyMs}ms</td>
                                    <td className={cn("px-4 py-2 text-right font-mono text-xs", p.errors > 0 ? "text-red-600 font-semibold" : "text-muted-foreground")}>
                                        {p.errors}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Top tenants by spend */}
            {data && data.byTenant.length > 0 && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-border">
                        <h2 className="text-base font-semibold">{t("topTenants")}</h2>
                        <p className="text-xs text-muted-foreground">{t("topTenantsHint")}</p>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr className="text-left">
                                <th className="px-4 py-2 font-semibold">#</th>
                                <th className="px-4 py-2 font-semibold">{t("tenant")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("calls")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("cost")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {data.byTenant.slice(0, 10).map((t, i) => (
                                <tr key={t.tenantId} className="hover:bg-muted/20">
                                    <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                                    <td className="px-4 py-2">
                                        <Link href={`/admin/tenants/${t.tenantId}`} className="hover:text-indigo-600 transition">
                                            {t.tenantName || t.tenantId.slice(0, 8)}
                                        </Link>
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono">{fmtNum(t.calls)}</td>
                                    <td className="px-4 py-2 text-right font-mono">{fmtUsd(t.costUsd)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Daily trend (simple bar chart) */}
            {data && data.byDay.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4">
                    <h2 className="text-base font-semibold mb-3">{t("dailyTrend")}</h2>
                    <DailyBars data={data.byDay} />
                </div>
            )}

            {!loading && data && data.totals.calls === 0 && (
                <div className="bg-muted/30 border border-border rounded-xl p-8 text-center">
                    <Brain className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <h3 className="font-semibold">{t("emptyTitle")}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{t("emptyDesc")}</p>
                </div>
            )}
        </div>
    );
}

function SummaryTile({
    label, value, icon: Icon, color, bg, highlight,
}: { label: string; value: string; icon: any; color: string; bg: string; highlight?: boolean }) {
    return (
        <div className={cn(
            "bg-card border border-border rounded-xl p-4",
            highlight && "ring-2 ring-red-500/20",
        )}>
            <div className="flex items-center gap-2">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", bg)}>
                    <Icon className={cn("h-4 w-4", color)} />
                </div>
                <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <div className="text-2xl font-bold mt-2 font-mono">{value}</div>
        </div>
    );
}

function DailyBars({ data }: { data: DayStat[] }) {
    const maxCost = Math.max(...data.map(d => d.costUsd), 0.01);
    return (
        <div className="space-y-1.5">
            {data.map(d => {
                const pct = (d.costUsd / maxCost) * 100;
                return (
                    <div key={d.date} className="flex items-center gap-2 text-xs">
                        <div className="w-20 text-muted-foreground font-mono flex-shrink-0">{d.date}</div>
                        <div className="flex-1 h-5 bg-muted/30 rounded-sm overflow-hidden relative">
                            <div
                                className="h-full bg-indigo-500/80 transition-all"
                                style={{ width: `${pct}%` }}
                            />
                            <div className="absolute inset-0 flex items-center px-2 font-mono text-[10px]">
                                {d.calls.toLocaleString()} calls · ${d.costUsd.toFixed(3)}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
