"use client";

/**
 * Centro de Operaciones — the super_admin NOC hub. A single unified view of
 * platform health: active incidents, system vitals (services + queues), storage,
 * and quick links to the detailed panels. Reuses existing endpoints; polls 30s.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Gauge, RefreshCw, Loader2, AlertCircle, AlertTriangle, Info, CheckCircle2,
    Server, Database, HardDrive, Siren, TrendingUp, Brain, DollarSign, Building2,
    Activity, ChevronRight,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

interface Summary { activeCritical: number; activeWarning: number; acknowledged: number; resolved24h: number; }
interface Incident { id: string; key: string; severity: "info" | "warning" | "critical"; title: string; count: number; }
interface Health {
    services: { api: boolean; redis: boolean; postgres: boolean };
    queues: Array<{ name: string; waiting: number; active: number; delayed: number; failed: number }>;
}
interface Overview {
    disk: { totalBytes: number; freeBytes: number; usedBytes: number; usedPct: number } | null;
    totalMediaBytes: number; totalDbBytes: number; tenantCount: number;
    projection: { daysUntilFull: number; slopePctPerDay: number; currentPct: number } | null;
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function OpsCenterPage() {
    const t = useTranslations("ops");
    const tInc = useTranslations("incidents");
    const tHealth = useTranslations("platformHealth");
    const tStorage = useTranslations("platformStorage");
    const tNav = useTranslations("nav");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");

    const [summary, setSummary] = useState<Summary | null>(null);
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [health, setHealth] = useState<Health | null>(null);
    const [storage, setStorage] = useState<Overview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updatedAt, setUpdatedAt] = useState<string>("");

    const fetchData = useCallback(async () => {
        try {
            const [sum, list, hp, ov] = await Promise.all([
                api.getIncidentsSummary(),
                api.getIncidents("active"),
                api.getPlatformHealth(),
                api.getStorageOverview(),
            ]);
            if (sum.success) setSummary(sum.data as Summary);
            if (list.success) setIncidents(((list.data?.items as Incident[]) || []).slice(0, 6));
            if (hp.success) setHealth(hp.data as Health);
            if (ov.success) setStorage(ov.data as Overview);
            setError(null);
            setUpdatedAt(new Date().toLocaleTimeString());
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setLoading(false);
        }
    }, [tc]);

    useEffect(() => {
        fetchData();
        const id = setInterval(fetchData, 30000);
        return () => clearInterval(id);
    }, [fetchData]);

    const servicesUp = health?.services ? health.services.api && health.services.redis && health.services.postgres : true;
    const anyFailed = health?.queues?.some(q => q.failed > 0) || false;
    const diskPct = storage?.disk?.usedPct ?? 0;
    const critical = (summary?.activeCritical ?? 0) > 0 || !servicesUp;
    const warning = !critical && ((summary?.activeWarning ?? 0) > 0 || anyFailed || diskPct >= 80);
    const status = critical ? "critical" : warning ? "warning" : "operational";

    const statusStyle = {
        critical: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300",
        warning: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
        operational: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
    }[status];

    const StatusIcon = status === "critical" ? AlertCircle : status === "warning" ? AlertTriangle : CheckCircle2;

    const SevIcon = ({ s }: { s: string }) =>
        s === "critical" ? <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            : s === "warning" ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                : <Info className="h-4 w-4 text-blue-500 shrink-0" />;

    const quickLinks = [
        { href: "/admin/incidents", label: tNav("items.incidents"), icon: Siren, accent: "text-rose-500" },
        { href: "/admin/health", label: tNav("items.platformHealth"), icon: Activity, accent: "text-emerald-500" },
        { href: "/admin/storage", label: tNav("items.storage"), icon: HardDrive, accent: "text-cyan-500" },
        { href: "/admin/usage", label: tNav("items.platformUsage"), icon: TrendingUp, accent: "text-blue-500" },
        { href: "/admin/llm-stats", label: tNav("items.llmStats"), icon: Brain, accent: "text-violet-500" },
        { href: "/admin/tenants", label: tNav("items.tenants"), icon: Building2, accent: "text-blue-500" },
        { href: "/admin/financials", label: tNav("items.financials"), icon: DollarSign, accent: "text-emerald-500" },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Gauge className="h-6 w-6 text-indigo-500" />
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
                title={tHelp("ops.title")}
                description={tHelp("ops.description")}
                tips={tHelp.raw("ops.tips") as string[]}
                mediaKey="ops"
            />

            {/* Overall status banner */}
            <div className={cn("rounded-xl border p-4 flex items-center justify-between gap-3", statusStyle)}>
                <div className="flex items-center gap-3">
                    <StatusIcon className="h-6 w-6" />
                    <div>
                        <div className="font-semibold">{t(`status_${status}`)}</div>
                        {updatedAt && <div className="text-xs opacity-80">{t("lastUpdated", { time: updatedAt })}</div>}
                    </div>
                </div>
                <Link href="/admin/incidents" className="text-sm font-medium inline-flex items-center gap-1 hover:underline">
                    {t("viewAll")} <ChevronRight className="h-4 w-4" />
                </Link>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">{error}</div>
            )}

            {/* Incident summary tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Link href="/admin/incidents" className="bg-card border border-border rounded-xl p-4 hover:bg-muted/30 transition">
                    <div className="text-xs text-muted-foreground">{tInc("activeCritical")}</div>
                    <div className={cn("text-2xl font-bold mt-1", (summary?.activeCritical ?? 0) > 0 && "text-red-600")}>{summary?.activeCritical ?? 0}</div>
                </Link>
                <Link href="/admin/incidents" className="bg-card border border-border rounded-xl p-4 hover:bg-muted/30 transition">
                    <div className="text-xs text-muted-foreground">{tInc("activeWarning")}</div>
                    <div className={cn("text-2xl font-bold mt-1", (summary?.activeWarning ?? 0) > 0 && "text-amber-600")}>{summary?.activeWarning ?? 0}</div>
                </Link>
                <Link href="/admin/incidents" className="bg-card border border-border rounded-xl p-4 hover:bg-muted/30 transition">
                    <div className="text-xs text-muted-foreground">{tInc("acknowledged")}</div>
                    <div className="text-2xl font-bold mt-1">{summary?.acknowledged ?? 0}</div>
                </Link>
                <Link href="/admin/incidents" className="bg-card border border-border rounded-xl p-4 hover:bg-muted/30 transition">
                    <div className="text-xs text-muted-foreground">{tInc("resolved24h")}</div>
                    <div className="text-2xl font-bold mt-1 text-emerald-600">{summary?.resolved24h ?? 0}</div>
                </Link>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Active incidents */}
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold flex items-center gap-2"><Siren className="h-4 w-4 text-rose-500" /> {t("incidentsTitle")}</h3>
                        <Link href="/admin/incidents" className="text-xs text-muted-foreground hover:text-foreground">{t("viewAll")}</Link>
                    </div>
                    {incidents.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                            {t("noActiveIncidents")}
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {incidents.map(inc => (
                                <li key={inc.id} className="flex items-center gap-2 text-sm">
                                    <SevIcon s={inc.severity} />
                                    <span className="truncate flex-1">{inc.title}</span>
                                    {inc.count > 1 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">×{inc.count}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* System vitals */}
                <div className="bg-card border border-border rounded-xl p-4">
                    <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><Activity className="h-4 w-4 text-emerald-500" /> {t("systemVitalsTitle")}</h3>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        {([["api", Server], ["postgres", Database], ["redis", Server]] as const).map(([svc, SvcIcon]) => {
                            const up = health?.services?.[svc] ?? false;
                            return (
                                <div key={svc} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
                                    <SvcIcon className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-xs capitalize flex-1">{svc}</span>
                                    <span className={cn("h-2 w-2 rounded-full", up ? "bg-emerald-500" : "bg-red-500")} />
                                </div>
                            );
                        })}
                    </div>
                    <div className="space-y-1.5">
                        {(health?.queues || []).map(q => (
                            <div key={q.name} className="flex items-center justify-between text-xs">
                                <span className="font-mono text-muted-foreground truncate">{q.name}</span>
                                <span className="flex items-center gap-2">
                                    <span>{tHealth("waiting")}: {q.waiting}</span>
                                    <span className={cn(q.failed > 0 && "text-red-600 font-semibold")}>{tHealth("failed")}: {q.failed}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Storage */}
            <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><HardDrive className="h-4 w-4 text-cyan-500" /> {t("storageTitle")}</h3>
                {storage?.disk ? (
                    <>
                        <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-muted-foreground">{tStorage("diskUsage")}</span>
                            <span className={cn("font-semibold", diskPct >= 90 ? "text-red-600" : diskPct >= 80 ? "text-amber-600" : "text-emerald-600")}>{diskPct}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className={cn("h-full", diskPct >= 90 ? "bg-red-500" : diskPct >= 80 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, diskPct)}%` }} />
                        </div>
                        {storage.projection && (
                            <div className={cn("text-xs mt-1.5 font-medium", storage.projection.daysUntilFull < 14 ? "text-red-600" : "text-muted-foreground")}>
                                {tStorage("projection", { days: storage.projection.daysUntilFull, rate: storage.projection.slopePctPerDay })}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-xs text-muted-foreground italic">{tStorage("diskUnavailable")}</div>
                )}
                <div className="grid grid-cols-3 gap-3 mt-4">
                    <div><div className="text-xs text-muted-foreground">{tStorage("totalDb")}</div><div className="text-lg font-bold">{formatBytes(storage?.totalDbBytes ?? 0)}</div></div>
                    <div><div className="text-xs text-muted-foreground">{tStorage("totalMedia")}</div><div className="text-lg font-bold">{formatBytes(storage?.totalMediaBytes ?? 0)}</div></div>
                    <div><div className="text-xs text-muted-foreground">{tStorage("activeTenants")}</div><div className="text-lg font-bold">{storage?.tenantCount ?? 0}</div></div>
                </div>
            </div>

            {/* Quick links */}
            <div>
                <h3 className="text-sm font-semibold mb-3">{t("quickLinksTitle")}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                    {quickLinks.map(l => {
                        const LinkIcon = l.icon;
                        return (
                            <Link key={l.href} href={l.href} className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card p-3 hover:bg-muted/30 transition text-center">
                                <LinkIcon className={cn("h-5 w-5", l.accent)} />
                                <span className="text-[11px] text-muted-foreground leading-tight">{l.label}</span>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
