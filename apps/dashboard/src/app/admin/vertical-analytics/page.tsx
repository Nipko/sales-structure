"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import {
    PieChart as PieIcon, RefreshCw, Loader2, AlertCircle, Building2,
    LayoutGrid, BarChart3, Sparkles, ChevronRight,
} from "lucide-react";
import { SkeletonKPIs, SkeletonCards } from "@/components/ui/skeleton-loader";

interface IndustryRow {
    industry: string;
    count: number;
    activated: number;
    paying: number;
    trialing: number;
    recent7d: number;
    subTypes: Record<string, number>;
}

interface ActivationGap {
    industry: string;
    tenantId: string;
    tenantName: string;
    missing: string;
}

interface OverviewData {
    generatedAt: string;
    totals: {
        tenantsTotal: number;
        tenantsActivated: number;
        tenantsPaying: number;
        tenantsTrialing: number;
        tenantsRecent7d: number;
        industriesCovered: number;
    };
    byIndustry: IndustryRow[];
    activationGaps: ActivationGap[];
}

interface IndustryDrilldown {
    industry: string;
    generatedAt: string;
    tenantCount: number;
    totals: Record<string, number> | null;
    tenants: Array<{
        tenantId: string;
        tenantName: string;
        plan: string;
        createdAt: string;
        firstMessageAt: string | null;
        stats: Record<string, any> | null;
    }>;
}

const INDUSTRY_COLORS: Record<string, string> = {
    salud: "bg-rose-500",
    veterinaria: "bg-pink-500",
    restaurantes: "bg-orange-500",
    gimnasios: "bg-red-500",
    education: "bg-indigo-500",
    seguros: "bg-blue-500",
    inmobiliaria: "bg-emerald-500",
    turismo: "bg-cyan-500",
    servicios_hogar: "bg-amber-500",
    pet_services: "bg-purple-500",
    fotografia: "bg-fuchsia-500",
    legal: "bg-slate-500",
    otro: "bg-neutral-500",
};

const COLOR_FALLBACK = "bg-neutral-500";

export default function VerticalAnalyticsPage() {
    const t = useTranslations("verticalAnalytics");
    const tc = useTranslations("common");
    const tInd = useTranslations("onboarding.industries");
    const { user } = useAuth();
    const router = useRouter();

    const [activeTab, setActiveTab] = useState<"overview" | "drilldown">("overview");
    const [overview, setOverview] = useState<OverviewData | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [drill, setDrill] = useState<IndustryDrilldown | null>(null);
    const [loading, setLoading] = useState(true);
    const [drillLoading, setDrillLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const loadOverview = useCallback(async (refresh = false) => {
        if (refresh) setRefreshing(true);
        else setLoading(true);
        const res = await api.getVerticalOverview(refresh);
        if (res.success) setOverview(res.data ?? null);
        setLoading(false);
        setRefreshing(false);
    }, []);

    const loadDrilldown = useCallback(async (industry: string, refresh = false) => {
        setDrillLoading(true);
        const res = await api.getVerticalIndustry(industry, refresh);
        if (res.success) setDrill(res.data ?? null);
        setDrillLoading(false);
    }, []);

    useEffect(() => {
        if (user && user.role !== "super_admin") {
            router.push("/admin");
            return;
        }
        loadOverview();
    }, [user, router, loadOverview]);

    useEffect(() => {
        if (selected) loadDrilldown(selected);
    }, [selected, loadDrilldown]);

    const tabs = [
        { id: "overview", label: t("tabs.overview"), icon: LayoutGrid },
        { id: "drilldown", label: t("tabs.drilldown"), icon: BarChart3 },
    ];

    return (
        <div className="max-w-[1400px] mx-auto space-y-6">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={PieIcon}
                action={
                    <button
                        onClick={() => loadOverview(true)}
                        disabled={refreshing}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
                    >
                        {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        {tc("refresh")}
                    </button>
                }
            />

            <TabNav
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as any)}
            />

            {loading && (
                <div className="space-y-6">
                    <SkeletonKPIs count={6} />
                    <SkeletonCards count={6} />
                </div>
            )}

            {!loading && activeTab === "overview" && overview && (
                <OverviewTab
                    data={overview}
                    onSelectIndustry={(ind) => {
                        setSelected(ind);
                        setActiveTab("drilldown");
                    }}
                    t={t}
                    tInd={tInd}
                />
            )}

            {!loading && activeTab === "drilldown" && (
                <DrilldownTab
                    overview={overview}
                    selected={selected}
                    setSelected={setSelected}
                    drill={drill}
                    drillLoading={drillLoading}
                    t={t}
                    tc={tc}
                    tInd={tInd}
                />
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────
// Overview tab — distribution + activation gaps
// ────────────────────────────────────────────────────────────

function OverviewTab({ data, onSelectIndustry, t, tInd }: {
    data: OverviewData;
    onSelectIndustry: (industry: string) => void;
    t: any;
    tInd: any;
}) {
    const total = data.totals.tenantsTotal || 1;
    const sortedIndustries = [...data.byIndustry].sort((a, b) => b.count - a.count);

    return (
        <div className="space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard label={t("kpi.totalTenants")} value={data.totals.tenantsTotal} />
                <KpiCard label={t("kpi.activated")} value={data.totals.tenantsActivated}
                    hint={`${Math.round(100 * data.totals.tenantsActivated / total)}%`} />
                <KpiCard label={t("kpi.paying")} value={data.totals.tenantsPaying}
                    hint={`${Math.round(100 * data.totals.tenantsPaying / total)}%`} />
                <KpiCard label={t("kpi.trialing")} value={data.totals.tenantsTrialing} />
                <KpiCard label={t("kpi.recent7d")} value={data.totals.tenantsRecent7d} />
                <KpiCard label={t("kpi.industries")} value={data.totals.industriesCovered} />
            </div>

            {/* Distribution */}
            <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                <header className="mb-4">
                    <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("distribution.title")}</h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("distribution.hint")}</p>
                </header>
                <div className="space-y-2">
                    {sortedIndustries.map((row) => {
                        const pct = (row.count / total) * 100;
                        const color = INDUSTRY_COLORS[row.industry] || COLOR_FALLBACK;
                        return (
                            <button
                                key={row.industry}
                                onClick={() => onSelectIndustry(row.industry)}
                                className="w-full flex items-center gap-3 px-2 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 rounded-md text-left transition-colors group"
                            >
                                <div className="w-32 flex-shrink-0 text-sm font-medium text-neutral-700 dark:text-neutral-300 truncate">
                                    {tInd.has(row.industry) ? tInd(row.industry) : row.industry}
                                </div>
                                <div className="flex-1 h-7 bg-neutral-100 dark:bg-neutral-800 rounded-md overflow-hidden relative">
                                    <div
                                        className={`h-full ${color} transition-all`}
                                        style={{ width: `${Math.max(pct, 2)}%` }}
                                    />
                                    <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-neutral-700 dark:text-neutral-200 mix-blend-difference">
                                        {row.count} · {pct.toFixed(1)}%
                                    </div>
                                </div>
                                <div className="w-32 flex-shrink-0 text-xs text-neutral-500 dark:text-neutral-400 text-right">
                                    {row.paying} {t("paying")} · {row.activated} {t("activated")}
                                </div>
                                <ChevronRight className="w-4 h-4 text-neutral-400 group-hover:text-neutral-700 dark:group-hover:text-neutral-200 flex-shrink-0" />
                            </button>
                        );
                    })}
                </div>
            </section>

            {/* Activation gaps */}
            {data.activationGaps.length > 0 && (
                <section className="bg-white dark:bg-neutral-900 border border-amber-200 dark:border-amber-900/40 rounded-xl p-5">
                    <header className="mb-3 flex items-start gap-2">
                        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                        <div>
                            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                                {t("gaps.title")} ({data.activationGaps.length})
                            </h2>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("gaps.hint")}</p>
                        </div>
                    </header>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-xs text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                                <tr>
                                    <th className="py-2 pr-4 font-medium">{t("gaps.tenant")}</th>
                                    <th className="py-2 pr-4 font-medium">{t("gaps.industry")}</th>
                                    <th className="py-2 pr-4 font-medium">{t("gaps.missing")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.activationGaps.slice(0, 30).map((g) => (
                                    <tr key={`${g.tenantId}-${g.missing}`} className="border-b border-neutral-100 dark:border-neutral-800/60">
                                        <td className="py-2 pr-4">
                                            <Link
                                                href={`/admin/tenants/${g.tenantId}`}
                                                className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                                            >
                                                {g.tenantName}
                                            </Link>
                                        </td>
                                        <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-400">
                                            {tInd.has(g.industry) ? tInd(g.industry) : g.industry}
                                        </td>
                                        <td className="py-2 pr-4">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">
                                                {t.has(`gaps.missingKeys.${g.missing}`)
                                                    ? t(`gaps.missingKeys.${g.missing}`)
                                                    : g.missing}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────
// Drilldown tab — per-vertical KPIs + ranked tenants
// ────────────────────────────────────────────────────────────

function DrilldownTab({
    overview, selected, setSelected, drill, drillLoading, t, tc, tInd,
}: {
    overview: OverviewData | null;
    selected: string | null;
    setSelected: (v: string) => void;
    drill: IndustryDrilldown | null;
    drillLoading: boolean;
    t: any; tc: any; tInd: any;
}) {
    const industries = overview?.byIndustry.map((r) => r.industry) || [];

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                {industries.map((ind) => (
                    <button
                        key={ind}
                        onClick={() => setSelected(ind)}
                        className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                            selected === ind
                                ? "bg-indigo-600 text-white border-indigo-600"
                                : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                        }`}
                    >
                        {tInd.has(ind) ? tInd(ind) : ind}
                    </button>
                ))}
            </div>

            {!selected && (
                <div className="bg-white dark:bg-neutral-900 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl py-12 text-center">
                    <Sparkles className="w-8 h-8 text-neutral-400 mx-auto mb-3" />
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("drilldown.pickIndustry")}</p>
                </div>
            )}

            {selected && drillLoading && (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                </div>
            )}

            {selected && !drillLoading && drill && (
                <>
                    {/* Platform totals */}
                    {drill.totals && Object.keys(drill.totals).length > 0 && (
                        <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                            <header className="mb-3">
                                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                                    {t("drilldown.platformTotals")} — {tInd.has(drill.industry) ? tInd(drill.industry) : drill.industry}
                                </h2>
                                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                    {drill.tenantCount} {t("drilldown.tenants")}
                                </p>
                            </header>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                {Object.entries(drill.totals).map(([key, val]) => (
                                    <KpiCard
                                        key={key}
                                        label={t.has(`metrics.${key}`) ? t(`metrics.${key}`) : key}
                                        value={typeof val === "number" ? val : (val ?? 0)}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Tenant ranking */}
                    <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                        <header className="mb-3">
                            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                                {t("drilldown.tenantRanking")}
                            </h2>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                {t("drilldown.tenantRankingHint")}
                            </p>
                        </header>
                        {drill.tenants.length === 0 ? (
                            <p className="text-sm text-neutral-500 dark:text-neutral-400 py-6 text-center">
                                {t("drilldown.noTenants")}
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-left text-xs text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                                        <tr>
                                            <th className="py-2 pr-3 font-medium">#</th>
                                            <th className="py-2 pr-3 font-medium">{t("gaps.tenant")}</th>
                                            <th className="py-2 pr-3 font-medium">{t("plan")}</th>
                                            <th className="py-2 pr-3 font-medium">{t("activated")}</th>
                                            <th className="py-2 pr-3 font-medium">{t("drilldown.metrics")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {drill.tenants.map((row, idx) => (
                                            <tr key={row.tenantId} className="border-b border-neutral-100 dark:border-neutral-800/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                                                <td className="py-2 pr-3 text-neutral-500">{idx + 1}</td>
                                                <td className="py-2 pr-3">
                                                    <Link href={`/admin/tenants/${row.tenantId}`}
                                                        className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                                                        {row.tenantName}
                                                    </Link>
                                                </td>
                                                <td className="py-2 pr-3">
                                                    <span className="inline-flex px-2 py-0.5 text-xs rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                                                        {row.plan}
                                                    </span>
                                                </td>
                                                <td className="py-2 pr-3 text-neutral-600 dark:text-neutral-400">
                                                    {row.firstMessageAt
                                                        ? <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400">●</span>
                                                        : <span className="text-neutral-400">○</span>}
                                                </td>
                                                <td className="py-2 pr-3 text-xs text-neutral-600 dark:text-neutral-400 max-w-md">
                                                    {row.stats ? (
                                                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                                                            {Object.entries(row.stats)
                                                                .filter(([, v]) => typeof v === "number")
                                                                .slice(0, 6)
                                                                .map(([k, v]) => (
                                                                    <span key={k} className="whitespace-nowrap">
                                                                        <span className="text-neutral-500">{t.has(`metrics.${k}`) ? t(`metrics.${k}`) : k}:</span>{" "}
                                                                        <span className="font-medium text-neutral-700 dark:text-neutral-200">{v as number}</span>
                                                                    </span>
                                                                ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-neutral-400 italic">{t("drilldown.noStats")}</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}

function KpiCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
    return (
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3">
            <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 truncate">{label}</div>
            <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">
                {value}
            </div>
            {hint && <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{hint}</div>}
        </div>
    );
}
