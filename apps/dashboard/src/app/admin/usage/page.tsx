"use client";

/**
 * Platform usage dashboard — sortable table of every active tenant's
 * automation and outbound message consumption against their plan limit.
 * Surfaces who is approaching / exceeding quota so super_admin can
 * upgrade them, throttle abuse, or upsell proactively.
 */

import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    TrendingUp, RefreshCw, Loader2, ArrowDown, ArrowUp, AlertTriangle, Search,
} from "lucide-react";

interface UsageRow {
    tenantId: string;
    tenantName: string;
    plan: string;
    usage: {
        automationCurrent: number;
        automationLimit: number;
        outboundCurrent: number;
        outboundLimit: number;
    };
}

type SortKey = "name" | "plan" | "automation" | "outbound";
type SortDir = "asc" | "desc";

const planColor: Record<string, string> = {
    starter: "bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300",
    pro: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    enterprise: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    custom: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
};

export default function UsagePage() {
    const t = useTranslations("platformUsage");
    const tc = useTranslations("common");
    const [data, setData] = useState<UsageRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>("automation");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    async function fetchData() {
        setLoading(true);
        try {
            const res = await api.getPlatformUsage();
            if (res.success) {
                setData(res.data || []);
                setError(null);
            } else {
                setError(res.error || tc("connectionError"));
            }
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { fetchData(); }, []);

    const usagePct = (current: number, limit: number) => {
        if (!limit || limit < 0) return 0;
        return Math.min(100, Math.round((current / limit) * 100));
    };

    const filteredSorted = useMemo(() => {
        let rows = data.filter(r =>
            !search ||
            r.tenantName.toLowerCase().includes(search.toLowerCase()) ||
            r.plan.toLowerCase().includes(search.toLowerCase()),
        );
        rows = [...rows].sort((a, b) => {
            let cmp = 0;
            if (sortKey === "name") cmp = a.tenantName.localeCompare(b.tenantName);
            else if (sortKey === "plan") cmp = a.plan.localeCompare(b.plan);
            else if (sortKey === "automation") cmp = usagePct(a.usage.automationCurrent, a.usage.automationLimit) - usagePct(b.usage.automationCurrent, b.usage.automationLimit);
            else if (sortKey === "outbound") cmp = usagePct(a.usage.outboundCurrent, a.usage.outboundLimit) - usagePct(b.usage.outboundCurrent, b.usage.outboundLimit);
            return sortDir === "asc" ? cmp : -cmp;
        });
        return rows;
    }, [data, search, sortKey, sortDir]);

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else { setSortKey(key); setSortDir("desc"); }
    };

    const SortIcon = ({ k }: { k: SortKey }) => {
        if (sortKey !== k) return null;
        return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
    };

    const overQuotaCount = data.filter(r =>
        usagePct(r.usage.automationCurrent, r.usage.automationLimit) >= 100 ||
        usagePct(r.usage.outboundCurrent, r.usage.outboundLimit) >= 100,
    ).length;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <TrendingUp className="h-6 w-6 text-blue-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
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

            {/* Summary tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{t("activeTenants")}</div>
                    <div className="text-2xl font-bold mt-1">{data.length}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{t("overQuota")}</div>
                    <div className={cn("text-2xl font-bold mt-1", overQuotaCount > 0 && "text-amber-600")}>
                        {overQuotaCount}
                    </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{t("totalAutomations")}</div>
                    <div className="text-2xl font-bold mt-1">
                        {data.reduce((sum, r) => sum + (r.usage.automationCurrent || 0), 0).toLocaleString()}
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                    type="text"
                    placeholder={t("search")}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-sm"
                />
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                        <tr className="text-left">
                            <th className="px-4 py-2 font-semibold cursor-pointer" onClick={() => toggleSort("name")}>
                                <span className="inline-flex items-center gap-1">{t("tenant")} <SortIcon k="name" /></span>
                            </th>
                            <th className="px-4 py-2 font-semibold cursor-pointer" onClick={() => toggleSort("plan")}>
                                <span className="inline-flex items-center gap-1">{t("plan")} <SortIcon k="plan" /></span>
                            </th>
                            <th className="px-4 py-2 font-semibold cursor-pointer" onClick={() => toggleSort("automation")}>
                                <span className="inline-flex items-center gap-1">{t("automations")} <SortIcon k="automation" /></span>
                            </th>
                            <th className="px-4 py-2 font-semibold cursor-pointer" onClick={() => toggleSort("outbound")}>
                                <span className="inline-flex items-center gap-1">{t("outbound")} <SortIcon k="outbound" /></span>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {loading && data.length === 0 ? (
                            <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> {tc("loading")}</td></tr>
                        ) : filteredSorted.length === 0 ? (
                            <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{t("noResults")}</td></tr>
                        ) : filteredSorted.map(row => (
                            <tr key={row.tenantId} className="hover:bg-muted/20">
                                <td className="px-4 py-2">
                                    <Link href={`/admin/tenants/${row.tenantId}`} className="font-medium hover:text-indigo-600 transition">
                                        {row.tenantName}
                                    </Link>
                                </td>
                                <td className="px-4 py-2">
                                    <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-medium", planColor[row.plan] || planColor.starter)}>
                                        {row.plan}
                                    </span>
                                </td>
                                <UsageCell current={row.usage.automationCurrent} limit={row.usage.automationLimit} />
                                <UsageCell current={row.usage.outboundCurrent} limit={row.usage.outboundLimit} />
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function UsageCell({ current, limit }: { current: number; limit: number }) {
    const tc = useTranslations("platformUsage");
    if (limit < 0) {
        return <td className="px-4 py-2 text-xs text-muted-foreground italic">{tc("unlimited")}</td>;
    }
    const pct = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;
    const over = pct >= 100;
    const warn = pct >= 80 && !over;

    return (
        <td className="px-4 py-2">
            <div className="flex items-center gap-2">
                <div className="flex-1 max-w-[120px]">
                    <div className="text-xs flex items-center justify-between mb-1">
                        <span className="font-mono">{current.toLocaleString()}/{limit.toLocaleString()}</span>
                        {over && <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />}
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className={cn(
                                "h-full transition-all",
                                over ? "bg-red-500" : warn ? "bg-amber-500" : "bg-emerald-500",
                            )}
                            style={{ width: `${Math.min(100, pct)}%` }}
                        />
                    </div>
                </div>
                <span className={cn("text-xs font-medium w-10 text-right", over ? "text-red-600" : warn ? "text-amber-600" : "text-muted-foreground")}>
                    {pct}%
                </span>
            </div>
        </td>
    );
}
