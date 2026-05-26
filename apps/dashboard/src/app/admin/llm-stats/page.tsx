"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Brain, RefreshCw, Loader2, TrendingUp, DollarSign,
    Mic, Eye, Database, Cpu, ChevronDown,
} from "lucide-react";

interface AiUsageData {
    totals: {
        llmCostUsd: number; mediaCostUsd: number; embeddingsCostUsd: number; totalCostUsd: number;
        llmCalls: number; mediaCalls: number; embeddingsCalls: number;
    };
    byMonth: Array<{
        month: string; llmCostUsd: number; mediaCostUsd: number; embeddingsCostUsd: number;
        totalCostUsd: number; llmCalls: number; mediaCalls: number; embeddingsCalls: number;
    }>;
    byCategory: Array<{ category: string; calls: number; costUsd: number; tokensIn: number; tokensOut: number }>;
    byProvider: Array<{ provider: string; calls: number; costUsd: number; tokensIn: number; tokensOut: number }>;
    byTenant: Array<{
        tenantId: string; tenantName?: string; totalCostUsd: number;
        llmCalls: number; mediaCalls: number; embeddingsCalls: number;
    }>;
}

const MONTH_OPTIONS = [
    { months: 1, labelKey: "range1m" },
    { months: 3, labelKey: "range3m" },
    { months: 6, labelKey: "range6m" },
    { months: 12, labelKey: "range12m" },
];

const PROVIDER_COLORS: Record<string, string> = {
    openai: "bg-emerald-500/10 text-emerald-400",
    anthropic: "bg-orange-500/10 text-orange-400",
    google: "bg-blue-500/10 text-blue-400",
    xai: "bg-neutral-500/10 text-neutral-300",
    deepseek: "bg-purple-500/10 text-purple-400",
};

const CATEGORY_CONFIG: Record<string, { icon: any; color: string; barColor: string }> = {
    llm: { icon: Cpu, color: "text-indigo-400", barColor: "bg-indigo-500" },
    audio: { icon: Mic, color: "text-amber-400", barColor: "bg-amber-500" },
    image: { icon: Eye, color: "text-emerald-400", barColor: "bg-emerald-500" },
    embeddings: { icon: Database, color: "text-blue-400", barColor: "bg-blue-500" },
};

export default function AiUsagePage() {
    const t = useTranslations("aiUsage");
    const tc = useTranslations("common");
    const [months, setMonths] = useState(3);
    const [data, setData] = useState<AiUsageData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedTenant, setExpandedTenant] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.getAiUsage({ months });
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
    }, [months, tc]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
    const fmtCost = (n: number) => n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
    const fmtNum = (n: number) => n.toLocaleString();

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Brain className="h-6 w-6 text-indigo-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex bg-card border border-border rounded-lg p-0.5">
                        {MONTH_OPTIONS.map(r => (
                            <button
                                key={r.months}
                                onClick={() => setMonths(r.months)}
                                className={cn(
                                    "px-3 py-1.5 text-xs font-medium rounded transition",
                                    months === r.months
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
                        className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground rounded-lg text-sm transition disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {tc("refresh")}
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
                    {error}
                </div>
            )}

            {/* Summary tiles — total cost + breakdown */}
            {data && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <SummaryTile
                        label={t("totalCost")}
                        value={fmtCost(data.totals.totalCostUsd)}
                        icon={DollarSign}
                        color="text-emerald-400"
                        bg="bg-emerald-500/10"
                        large
                    />
                    <SummaryTile
                        label={t("llmCost")}
                        value={fmtCost(data.totals.llmCostUsd)}
                        sub={`${fmtNum(data.totals.llmCalls)} ${t("calls")}`}
                        icon={Cpu}
                        color="text-indigo-400"
                        bg="bg-indigo-500/10"
                    />
                    <SummaryTile
                        label={t("mediaCost")}
                        value={fmtCost(data.totals.mediaCostUsd)}
                        sub={`${fmtNum(data.totals.mediaCalls)} ${t("calls")}`}
                        icon={Mic}
                        color="text-amber-400"
                        bg="bg-amber-500/10"
                    />
                    <SummaryTile
                        label={t("embeddingsCost")}
                        value={fmtCost(data.totals.embeddingsCostUsd)}
                        sub={`${fmtNum(data.totals.embeddingsCalls)} ${t("calls")}`}
                        icon={Database}
                        color="text-blue-400"
                        bg="bg-blue-500/10"
                    />
                </div>
            )}

            {/* Monthly trend — stacked bar */}
            {data && data.byMonth.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4">
                    <h2 className="text-base font-semibold mb-1">{t("monthlyTrend")}</h2>
                    <p className="text-xs text-muted-foreground mb-4">{t("monthlyTrendHint")}</p>
                    <MonthlyBars data={data.byMonth} t={t} />
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* By category */}
                {data && data.byCategory.length > 0 && (
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-border">
                            <h2 className="text-base font-semibold">{t("byCategory")}</h2>
                            <p className="text-xs text-muted-foreground">{t("byCategoryHint")}</p>
                        </div>
                        <div className="divide-y divide-border">
                            {data.byCategory.map(cat => {
                                const cfg = CATEGORY_CONFIG[cat.category] || CATEGORY_CONFIG.llm;
                                const Icon = cfg.icon;
                                const pct = data.totals.totalCostUsd > 0
                                    ? Math.round((cat.costUsd / data.totals.totalCostUsd) * 100)
                                    : 0;
                                return (
                                    <div key={cat.category} className="p-4 flex items-center gap-3">
                                        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center bg-muted/40")}>
                                            <Icon className={cn("h-4 w-4", cfg.color)} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-sm font-medium capitalize">{t(`cat_${cat.category}` as any)}</span>
                                                <span className="text-sm font-mono">{fmtCost(cat.costUsd)}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                                                    <div className={cn("h-full rounded-full transition-all", cfg.barColor)} style={{ width: `${pct}%` }} />
                                                </div>
                                                <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
                                            </div>
                                            <div className="text-[10px] text-muted-foreground mt-0.5">
                                                {fmtNum(cat.calls)} {t("calls")}
                                                {cat.tokensIn > 0 && ` · ${fmtNum(cat.tokensIn)} → ${fmtNum(cat.tokensOut)} tokens`}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
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
                                        <td className="px-4 py-2 text-right font-mono">{fmtCost(p.costUsd)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Top tenants by total AI spend */}
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
                                <th className="px-4 py-2 font-semibold text-right">LLM</th>
                                <th className="px-4 py-2 font-semibold text-right">Media</th>
                                <th className="px-4 py-2 font-semibold text-right">Embed.</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("totalCost")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {data.byTenant.map((tenant, i) => (
                                <tr key={tenant.tenantId} className="hover:bg-muted/20">
                                    <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                                    <td className="px-4 py-2">
                                        <Link href={`/admin/tenants/${tenant.tenantId}`} className="hover:text-indigo-400 transition">
                                            {tenant.tenantName || tenant.tenantId.slice(0, 8)}
                                        </Link>
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono text-xs">{fmtNum(tenant.llmCalls)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-xs">{fmtNum(tenant.mediaCalls)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-xs">{fmtNum(tenant.embeddingsCalls)}</td>
                                    <td className="px-4 py-2 text-right font-mono font-semibold">{fmtCost(tenant.totalCostUsd)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {!loading && data && data.totals.totalCostUsd === 0 && data.totals.llmCalls === 0 && (
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
    label, value, sub, icon: Icon, color, bg, large,
}: { label: string; value: string; sub?: string; icon: any; color: string; bg: string; large?: boolean }) {
    return (
        <div className={cn("bg-card border border-border rounded-xl p-4", large && "ring-1 ring-indigo-500/20")}>
            <div className="flex items-center gap-2">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", bg)}>
                    <Icon className={cn("h-4 w-4", color)} />
                </div>
                <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <div className={cn("font-bold mt-2 font-mono", large ? "text-3xl" : "text-2xl")}>{value}</div>
            {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
    );
}

function MonthlyBars({ data, t }: { data: AiUsageData["byMonth"]; t: any }) {
    const maxCost = Math.max(...data.map(d => d.totalCostUsd), 0.001);

    const monthLabel = (m: string) => {
        const [y, mo] = m.split("-");
        const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
        return `${names[parseInt(mo, 10) - 1]} ${y.slice(2)}`;
    };

    return (
        <div className="space-y-3">
            {data.map(d => {
                const total = d.totalCostUsd;
                const pctTotal = (total / maxCost) * 100;
                const pctLlm = total > 0 ? (d.llmCostUsd / total) * pctTotal : 0;
                const pctMedia = total > 0 ? (d.mediaCostUsd / total) * pctTotal : 0;
                const pctEmbed = total > 0 ? (d.embeddingsCostUsd / total) * pctTotal : 0;
                return (
                    <div key={d.month}>
                        <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-medium">{monthLabel(d.month)}</span>
                            <span className="font-mono text-muted-foreground">
                                ${total.toFixed(4)} · {(d.llmCalls + d.mediaCalls + d.embeddingsCalls).toLocaleString()} {t("calls")}
                            </span>
                        </div>
                        <div className="h-6 bg-muted/20 rounded-md overflow-hidden flex">
                            {pctLlm > 0 && (
                                <div
                                    className="h-full bg-indigo-500 transition-all relative group"
                                    style={{ width: `${pctLlm}%` }}
                                    title={`LLM: $${d.llmCostUsd.toFixed(4)}`}
                                />
                            )}
                            {pctMedia > 0 && (
                                <div
                                    className="h-full bg-amber-500 transition-all relative group"
                                    style={{ width: `${pctMedia}%` }}
                                    title={`Media: $${d.mediaCostUsd.toFixed(4)}`}
                                />
                            )}
                            {pctEmbed > 0 && (
                                <div
                                    className="h-full bg-blue-500 transition-all relative group"
                                    style={{ width: `${pctEmbed}%` }}
                                    title={`Embeddings: $${d.embeddingsCostUsd.toFixed(4)}`}
                                />
                            )}
                        </div>
                    </div>
                );
            })}
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground mt-2">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" /> LLM</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Media</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Embeddings</span>
            </div>
        </div>
    );
}
