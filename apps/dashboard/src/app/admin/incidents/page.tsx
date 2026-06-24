"use client";

/**
 * Platform incidents — the super_admin ops center's alert inbox.
 * Lists persisted platform incidents (disk, RAM, Redis, queues, LLM, storage
 * projection, per-tenant quota, billing, tokens...) with severity, dedup count,
 * and acknowledge/resolve actions. Polls every 30s.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Siren, RefreshCw, Loader2, AlertTriangle, AlertCircle, Info,
    CheckCircle2, Check, ChevronDown, ChevronRight,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

interface Incident {
    id: string;
    key: string;
    severity: "info" | "warning" | "critical";
    title: string;
    body: string | null;
    value: number | null;
    status: "active" | "acknowledged" | "resolved";
    count: number;
    firstSeenAt: string;
    lastSeenAt: string;
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null;
}

interface Summary {
    activeCritical: number;
    activeWarning: number;
    acknowledged: number;
    resolved24h: number;
}

type Filter = "active" | "acknowledged" | "resolved" | "all";

const sevStyle: Record<string, string> = {
    critical: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
    info: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
};

export default function IncidentsPage() {
    const t = useTranslations("incidents");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const format = useFormatter();

    const [summary, setSummary] = useState<Summary | null>(null);
    const [items, setItems] = useState<Incident[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>("active");
    const [expanded, setExpanded] = useState<string | null>(null);
    const [acting, setActing] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const [sum, list] = await Promise.all([
                api.getIncidentsSummary(),
                api.getIncidents(filter),
            ]);
            if (sum.success) setSummary(sum.data as Summary);
            if (list.success) {
                setItems((list.data?.items as Incident[]) || []);
                setError(null);
            } else {
                setError(list.error || tc("connectionError"));
            }
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setLoading(false);
        }
    }, [filter, tc]);

    useEffect(() => {
        setLoading(true);
        fetchData();
        const id = setInterval(fetchData, 30000);
        return () => clearInterval(id);
    }, [fetchData]);

    async function act(id: string, kind: "ack" | "resolve") {
        setActing(id);
        try {
            const res = kind === "ack" ? await api.ackIncident(id) : await api.resolveIncident(id);
            if (res.success) await fetchData();
            else setError(res.error || tc("connectionError"));
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setActing(null);
        }
    }

    const filters: Filter[] = ["active", "acknowledged", "resolved", "all"];

    const SevIcon = ({ s }: { s: string }) =>
        s === "critical" ? <AlertCircle className="h-4 w-4 text-red-500" />
            : s === "warning" ? <AlertTriangle className="h-4 w-4 text-amber-500" />
                : <Info className="h-4 w-4 text-blue-500" />;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Siren className="h-6 w-6 text-rose-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
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

            <HelpPanel
                title={tHelp("incidents.title")}
                description={tHelp("incidents.description")}
                tips={tHelp.raw("incidents.tips") as string[]}
                mediaKey="incidents"
            />

            {/* Summary tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{t("activeCritical")}</div>
                    <div className={cn("text-2xl font-bold mt-1", (summary?.activeCritical ?? 0) > 0 && "text-red-600")}>
                        {summary?.activeCritical ?? 0}
                    </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{t("activeWarning")}</div>
                    <div className={cn("text-2xl font-bold mt-1", (summary?.activeWarning ?? 0) > 0 && "text-amber-600")}>
                        {summary?.activeWarning ?? 0}
                    </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{t("acknowledged")}</div>
                    <div className="text-2xl font-bold mt-1">{summary?.acknowledged ?? 0}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{t("resolved24h")}</div>
                    <div className="text-2xl font-bold mt-1 text-emerald-600">{summary?.resolved24h ?? 0}</div>
                </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
                {filters.map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={cn(
                            "px-3 py-1.5 rounded-lg text-sm border transition",
                            filter === f
                                ? "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300 font-medium"
                                : "bg-card border-border text-muted-foreground hover:bg-muted",
                        )}
                    >
                        {t(`filter_${f}`)}
                    </button>
                ))}
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* List */}
            <div className="space-y-2">
                {loading && items.length === 0 ? (
                    <div className="px-4 py-10 text-center text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> {tc("loading")}
                    </div>
                ) : items.length === 0 ? (
                    <div className="px-4 py-12 text-center text-muted-foreground bg-card border border-border rounded-xl flex flex-col items-center gap-2">
                        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                        {t("noIncidents")}
                    </div>
                ) : items.map(inc => {
                    const isOpen = expanded === inc.id;
                    return (
                        <div key={inc.id} className={cn("bg-card border rounded-xl overflow-hidden", sevStyle[inc.severity].split(" ").find(c => c.startsWith("border")) || "border-border")}>
                            <div className="flex items-start gap-3 p-3">
                                <button onClick={() => setExpanded(isOpen ? null : inc.id)} className="mt-0.5 text-muted-foreground hover:text-foreground">
                                    {inc.body ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="inline-block w-4" />}
                                </button>
                                <SevIcon s={inc.severity} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-sm">{inc.title}</span>
                                        {inc.count > 1 && (
                                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">×{inc.count}</span>
                                        )}
                                        <span className={cn("text-[11px] px-1.5 py-0.5 rounded border", sevStyle[inc.severity])}>
                                            {t(`severity_${inc.severity}`)}
                                        </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                                        <code className="font-mono">{inc.key}</code>
                                        <span>·</span>
                                        <span>{t("lastSeen")}: {format.relativeTime(new Date(inc.lastSeenAt))}</span>
                                        {inc.status === "resolved" && inc.resolvedBy && (
                                            <>
                                                <span>·</span>
                                                <span className="text-emerald-600 dark:text-emerald-400">{t("resolvedBy", { who: inc.resolvedBy })}</span>
                                            </>
                                        )}
                                        {inc.status === "acknowledged" && inc.acknowledgedBy && (
                                            <>
                                                <span>·</span>
                                                <span>{t("ackedBy", { who: inc.acknowledgedBy })}</span>
                                            </>
                                        )}
                                    </div>
                                    {isOpen && inc.body && (
                                        <div
                                            className="mt-2 text-xs text-muted-foreground leading-relaxed border-t border-border pt-2"
                                            dangerouslySetInnerHTML={{ __html: inc.body }}
                                        />
                                    )}
                                </div>
                                {inc.status !== "resolved" && (
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {inc.status === "active" && (
                                            <button
                                                onClick={() => act(inc.id, "ack")}
                                                disabled={acting === inc.id}
                                                title={t("ack")}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-card border border-border hover:bg-muted disabled:opacity-50"
                                            >
                                                <Check className="h-3.5 w-3.5" /> {t("ack")}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => act(inc.id, "resolve")}
                                            disabled={acting === inc.id}
                                            title={t("resolve")}
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                                        >
                                            <CheckCircle2 className="h-3.5 w-3.5" /> {t("resolve")}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
