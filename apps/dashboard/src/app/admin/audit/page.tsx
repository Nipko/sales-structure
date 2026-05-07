"use client";

/**
 * Cross-tenant audit log viewer for super_admin. Filterable by tenant,
 * action substring, and date range. Each row reveals the JSON details
 * inline on click — useful for tracing handoff escalations, channel
 * disconnects with provider errors, billing events, etc.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    ShieldCheck, RefreshCw, Loader2, ChevronDown, ChevronRight, Search,
    Calendar, X, AlertTriangle, CheckCircle, Info,
} from "lucide-react";

interface AuditRow {
    id: string;
    action: string;
    resource: string | null;
    details: any;
    tenantId: string | null;
    tenantName: string | null;
    tenantSlug: string | null;
    createdAt: string;
}

interface AuditResponse {
    total: number;
    rows: AuditRow[];
}

const PAGE_SIZE = 100;

// Color hint by action prefix — gives a quick visual cue without parsing JSON
function actionAccent(action: string): string {
    if (action.includes("disconnect") || action.includes("suspend") || action.includes("offboard")
        || action.includes("purge") || action.includes("revoke")) return "text-red-600";
    if (action.includes("reactivate") || action.includes("connect") || action.includes("trial_extended")) return "text-emerald-600";
    if (action.includes("escalat") || action.includes("warn") || action.includes("stale")) return "text-amber-600";
    return "text-muted-foreground";
}

function actionIcon(action: string) {
    if (action.includes("disconnect") || action.includes("suspend") || action.includes("purge")) return AlertTriangle;
    if (action.includes("reactivate") || action.includes("connect")) return CheckCircle;
    return Info;
}

export default function AuditPage() {
    const t = useTranslations("platformAudit");
    const tc = useTranslations("common");

    const [data, setData] = useState<AuditResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [page, setPage] = useState(0);

    // Filters
    const [filterTenant, setFilterTenant] = useState("");
    const [filterAction, setFilterAction] = useState("");
    const [filterSince, setFilterSince] = useState("");

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.getAuditLogs({
                tenantId: filterTenant || undefined,
                action: filterAction || undefined,
                since: filterSince || undefined,
                limit: PAGE_SIZE,
                offset: page * PAGE_SIZE,
            });
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
    }, [filterTenant, filterAction, filterSince, page, tc]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const toggleRow = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const clearFilters = () => {
        setFilterTenant("");
        setFilterAction("");
        setFilterSince("");
        setPage(0);
    };

    const hasFilters = filterTenant || filterAction || filterSince;
    const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <ShieldCheck className="h-6 w-6 text-indigo-500" />
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

            {/* Filters */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label className="block text-xs font-medium mb-1">{t("filterTenant")}</label>
                        <div className="relative">
                            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="text"
                                value={filterTenant}
                                onChange={e => { setFilterTenant(e.target.value); setPage(0); }}
                                placeholder={t("filterTenantPlaceholder")}
                                className="w-full bg-background border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm font-mono"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium mb-1">{t("filterAction")}</label>
                        <input
                            type="text"
                            value={filterAction}
                            onChange={e => { setFilterAction(e.target.value); setPage(0); }}
                            placeholder={t("filterActionPlaceholder")}
                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm font-mono"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium mb-1">{t("filterSince")}</label>
                        <input
                            type="datetime-local"
                            value={filterSince}
                            onChange={e => { setFilterSince(e.target.value); setPage(0); }}
                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm"
                        />
                    </div>
                </div>
                {hasFilters && (
                    <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                        <X className="h-3 w-3" /> {t("clearFilters")}
                    </button>
                )}
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Results count */}
            {data && (
                <p className="text-xs text-muted-foreground">
                    {t("resultsCount", { count: data.rows.length, total: data.total })}
                </p>
            )}

            {/* Audit log table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="divide-y divide-border">
                    {loading && (!data || data.rows.length === 0) ? (
                        <div className="px-4 py-8 text-center text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> {tc("loading")}
                        </div>
                    ) : !data || data.rows.length === 0 ? (
                        <div className="px-4 py-8 text-center text-muted-foreground">
                            {t("empty")}
                        </div>
                    ) : data.rows.map(row => {
                        const isExpanded = expanded.has(row.id);
                        const Icon = actionIcon(row.action);
                        const accent = actionAccent(row.action);
                        const dt = new Date(row.createdAt);
                        return (
                            <div key={row.id} className="hover:bg-muted/20">
                                <button
                                    onClick={() => toggleRow(row.id)}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm"
                                >
                                    {isExpanded
                                        ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                    }
                                    <Icon className={cn("h-4 w-4 flex-shrink-0", accent)} />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-mono text-xs">
                                            <span className={cn("font-semibold", accent)}>{row.action}</span>
                                            {row.resource && <span className="text-muted-foreground"> · {row.resource}</span>}
                                        </div>
                                        {row.tenantName ? (
                                            <Link
                                                href={`/admin/tenants/${row.tenantId}`}
                                                onClick={e => e.stopPropagation()}
                                                className="text-xs text-muted-foreground hover:text-indigo-600"
                                            >
                                                {row.tenantName} ({row.tenantSlug})
                                            </Link>
                                        ) : (
                                            <span className="text-xs text-muted-foreground italic">{t("platformLevel")}</span>
                                        )}
                                    </div>
                                    <div className="text-xs text-muted-foreground font-mono flex-shrink-0 hidden sm:block">
                                        <Calendar className="h-3 w-3 inline mr-1" />
                                        {dt.toLocaleString()}
                                    </div>
                                </button>
                                {isExpanded && (
                                    <div className="px-12 pb-4">
                                        <pre className="bg-muted/40 border border-border rounded-lg p-3 text-xs overflow-x-auto font-mono max-h-96">
                                            {JSON.stringify(row.details, null, 2)}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Pagination */}
            {data && totalPages > 1 && (
                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                        {t("pageOf", { page: page + 1, total: totalPages })}
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage(Math.max(0, page - 1))}
                            disabled={page === 0}
                            className="px-3 py-1.5 bg-card border border-border hover:bg-muted disabled:opacity-50 rounded-lg"
                        >
                            {tc("previous")}
                        </button>
                        <button
                            onClick={() => setPage(page + 1)}
                            disabled={page >= totalPages - 1}
                            className="px-3 py-1.5 bg-card border border-border hover:bg-muted disabled:opacity-50 rounded-lg"
                        >
                            {tc("next")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
