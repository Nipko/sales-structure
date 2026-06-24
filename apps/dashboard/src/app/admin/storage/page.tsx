"use client";

/**
 * Platform storage dashboard — per-tenant storage visibility for super_admin.
 * Combines PostgreSQL schema size + media files on disk per tenant, plus
 * platform-wide disk usage. Surfaces who is consuming storage and who is
 * approaching their media quota so super_admin can act before the VPS fills.
 */

import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    HardDrive, RefreshCw, Loader2, ArrowDown, ArrowUp, AlertTriangle, Search,
    Database, Image as ImageIcon, Trash2,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

interface StorageRow {
    tenantId: string;
    tenantName: string;
    plan: string;
    dbBytes: number;
    mediaBytes: number;
    mediaFiles: number;
    totalBytes: number;
    mediaLimitMb: number;
    mediaUsedMb: number;
    mediaPct: number;
}

interface Overview {
    disk: { totalBytes: number; freeBytes: number; usedBytes: number; usedPct: number } | null;
    totalMediaBytes: number;
    totalMediaFiles: number;
    totalDbBytes: number;
    tenantCount: number;
}

interface CleanupResult {
    dryRun: boolean;
    tenantsAffected: number;
    totalOrphanedFiles: number;
    totalFreedMB: number;
}

type SortKey = "name" | "plan" | "db" | "media" | "total" | "quota";
type SortDir = "asc" | "desc";

const planColor: Record<string, string> = {
    starter: "bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300",
    pro: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    enterprise: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    custom: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
};

function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function StoragePage() {
    const t = useTranslations("platformStorage");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");

    const [overview, setOverview] = useState<Overview | null>(null);
    const [data, setData] = useState<StorageRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>("total");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    const [cleanup, setCleanup] = useState<CleanupResult | null>(null);
    const [cleaning, setCleaning] = useState(false);

    async function fetchData() {
        setLoading(true);
        try {
            const [ov, rows] = await Promise.all([
                api.getStorageOverview(),
                api.getStorageTenants(),
            ]);
            if (ov.success) setOverview(ov.data as Overview);
            if (rows.success) {
                setData((rows.data as StorageRow[]) || []);
                setError(null);
            } else {
                setError(rows.error || tc("connectionError"));
            }
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { fetchData(); }, []);

    async function runCleanup(dryRun: boolean) {
        setCleaning(true);
        try {
            const res = await api.runMediaCleanup(dryRun);
            if (res.success) {
                setCleanup(res.data as CleanupResult);
                if (!dryRun) await fetchData();
            } else {
                setError(res.error || tc("connectionError"));
            }
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setCleaning(false);
        }
    }

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
            else if (sortKey === "db") cmp = a.dbBytes - b.dbBytes;
            else if (sortKey === "media") cmp = a.mediaBytes - b.mediaBytes;
            else if (sortKey === "total") cmp = a.totalBytes - b.totalBytes;
            else if (sortKey === "quota") cmp = a.mediaPct - b.mediaPct;
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

    const overQuotaCount = data.filter(r => r.mediaLimitMb > 0 && r.mediaPct >= 80).length;
    const disk = overview?.disk;
    const diskCritical = (disk?.usedPct ?? 0) >= 90;
    const diskWarn = (disk?.usedPct ?? 0) >= 80 && !diskCritical;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <HardDrive className="h-6 w-6 text-cyan-500" />
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
                title={tHelp("storage.title")}
                description={tHelp("storage.description")}
                tips={tHelp.raw("storage.tips") as string[]}
                mediaKey="storage"
            />

            {/* Disk usage banner */}
            <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                        {t("diskUsage")}
                    </span>
                    {disk ? (
                        <span className={cn("text-sm font-semibold", diskCritical ? "text-red-600" : diskWarn ? "text-amber-600" : "text-emerald-600")}>
                            {disk.usedPct}%
                        </span>
                    ) : (
                        <span className="text-xs text-muted-foreground italic">{t("diskUnavailable")}</span>
                    )}
                </div>
                {disk && (
                    <>
                        <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                            <div
                                className={cn("h-full transition-all", diskCritical ? "bg-red-500" : diskWarn ? "bg-amber-500" : "bg-emerald-500")}
                                style={{ width: `${Math.min(100, disk.usedPct)}%` }}
                            />
                        </div>
                        <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
                            <span>{t("diskUsed", { used: formatBytes(disk.usedBytes), total: formatBytes(disk.totalBytes) })}</span>
                            <span>{t("diskFree", { free: formatBytes(disk.freeBytes) })}</span>
                        </div>
                    </>
                )}
            </div>

            {/* Summary tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> {t("totalDb")}</div>
                    <div className="text-2xl font-bold mt-1">{formatBytes(overview?.totalDbBytes ?? 0)}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> {t("totalMedia")}</div>
                    <div className="text-2xl font-bold mt-1">{formatBytes(overview?.totalMediaBytes ?? 0)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{t("mediaFiles", { count: overview?.totalMediaFiles ?? 0 })}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{t("activeTenants")}</div>
                    <div className="text-2xl font-bold mt-1">{overview?.tenantCount ?? data.length}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{t("nearQuota")}</div>
                    <div className={cn("text-2xl font-bold mt-1", overQuotaCount > 0 && "text-amber-600")}>{overQuotaCount}</div>
                </div>
            </div>

            {/* Orphan cleanup */}
            <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <div className="text-sm font-medium flex items-center gap-2"><Trash2 className="h-4 w-4 text-muted-foreground" /> {t("cleanupTitle")}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t("cleanupDesc")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => runCleanup(true)}
                            disabled={cleaning}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground rounded-lg text-sm transition disabled:opacity-50"
                        >
                            {cleaning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            {t("cleanupAnalyze")}
                        </button>
                        {cleanup?.dryRun && cleanup.totalOrphanedFiles > 0 && (
                            <button
                                onClick={() => runCleanup(false)}
                                disabled={cleaning}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-700 dark:text-red-300 rounded-lg text-sm transition disabled:opacity-50"
                            >
                                <Trash2 className="h-4 w-4" />
                                {t("cleanupRun")}
                            </button>
                        )}
                    </div>
                </div>
                {cleanup && (
                    <div className="mt-3 text-sm text-muted-foreground">
                        {cleanup.totalOrphanedFiles === 0
                            ? t("cleanupNone")
                            : cleanup.dryRun
                                ? t("cleanupFound", { files: cleanup.totalOrphanedFiles, mb: cleanup.totalFreedMB, tenants: cleanup.tenantsAffected })
                                : t("cleanupDone", { files: cleanup.totalOrphanedFiles, mb: cleanup.totalFreedMB })}
                    </div>
                )}
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
                            <th className="px-4 py-2 font-semibold cursor-pointer" onClick={() => toggleSort("db")}>
                                <span className="inline-flex items-center gap-1">{t("db")} <SortIcon k="db" /></span>
                            </th>
                            <th className="px-4 py-2 font-semibold cursor-pointer" onClick={() => toggleSort("media")}>
                                <span className="inline-flex items-center gap-1">{t("media")} <SortIcon k="media" /></span>
                            </th>
                            <th className="px-4 py-2 font-semibold cursor-pointer" onClick={() => toggleSort("total")}>
                                <span className="inline-flex items-center gap-1">{t("total")} <SortIcon k="total" /></span>
                            </th>
                            <th className="px-4 py-2 font-semibold cursor-pointer" onClick={() => toggleSort("quota")}>
                                <span className="inline-flex items-center gap-1">{t("mediaQuota")} <SortIcon k="quota" /></span>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {loading && data.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> {tc("loading")}</td></tr>
                        ) : filteredSorted.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t("noResults")}</td></tr>
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
                                <td className="px-4 py-2 font-mono text-xs">{formatBytes(row.dbBytes)}</td>
                                <td className="px-4 py-2 font-mono text-xs">{formatBytes(row.mediaBytes)}</td>
                                <td className="px-4 py-2 font-mono text-xs font-semibold">{formatBytes(row.totalBytes)}</td>
                                <QuotaCell usedMb={row.mediaUsedMb} limitMb={row.mediaLimitMb} pct={row.mediaPct} />
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function QuotaCell({ usedMb, limitMb, pct }: { usedMb: number; limitMb: number; pct: number }) {
    const t = useTranslations("platformStorage");
    if (limitMb < 0) {
        return <td className="px-4 py-2 text-xs text-muted-foreground italic">{t("unlimited")}</td>;
    }
    if (limitMb === 0) {
        return <td className="px-4 py-2 text-xs text-muted-foreground italic">{t("notConfigured")}</td>;
    }
    const over = pct >= 100;
    const warn = pct >= 80 && !over;

    return (
        <td className="px-4 py-2">
            <div className="flex items-center gap-2">
                <div className="flex-1 max-w-[120px]">
                    <div className="text-xs flex items-center justify-between mb-1">
                        <span className="font-mono">{usedMb.toLocaleString()}/{limitMb.toLocaleString()} MB</span>
                        {over && <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className={cn("h-full transition-all", over ? "bg-red-500" : warn ? "bg-amber-500" : "bg-emerald-500")}
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
