"use client";

/**
 * Cross-tenant compliance center for super_admin. Surfaces:
 *   - Pending deletion requests across every active tenant (GDPR/LGPD
 *     Article 17 — right to erasure)
 *   - Recent opt-out events across every tenant
 *   - On-demand data subject export (Article 15) for any contact
 *
 * Tenant_admin compliance UI lives at /admin/compliance and is scoped
 * to a single tenant. This page is its operator-level counterpart.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Scale, RefreshCw, Loader2, Trash2, Ban, Download, Calendar, Search,
    ExternalLink, AlertTriangle, CheckCircle,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

interface DeletionRow {
    id: string;
    lead_id: string;
    requested_by: string;
    status: string;
    created_at: string;
    processed_at: string | null;
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
}

interface OptOutRow {
    id: string;
    lead_id: string;
    channel: string;
    scope: string;
    reason: string | null;
    status: string;
    created_at: string;
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
}

interface OverviewData {
    pendingDeletions: DeletionRow[];
    recentOptOuts: OptOutRow[];
    totalsByStatus: { pending?: number; optOuts?: number };
}

type TabId = "deletions" | "optouts" | "export";

export default function ComplianceAdminPage() {
    const t = useTranslations("complianceAdmin");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const [data, setData] = useState<OverviewData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<TabId>("deletions");

    // Export form state
    const [exportTenantId, setExportTenantId] = useState("");
    const [exportContactId, setExportContactId] = useState("");
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        try {
            const res = await api.getComplianceAdminOverview();
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
    }

    useEffect(() => { load(); }, []);

    async function handleExport() {
        if (!exportTenantId || !exportContactId) return;
        setExporting(true);
        setExportError(null);
        try {
            const res = await api.exportContactData(exportTenantId.trim(), exportContactId.trim());
            if (res.success && res.data) {
                const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `data-export-${exportContactId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                setExportError(res.error || tc("connectionError"));
            }
        } catch (e: any) {
            setExportError(e?.message || tc("connectionError"));
        } finally {
            setExporting(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Scale className="h-6 w-6 text-amber-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground rounded-lg text-sm transition disabled:opacity-50"
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {tc("refresh")}
                </button>
            </div>

            <HelpPanel
                title={tHelp("complianceAdmin.title")}
                description={tHelp("complianceAdmin.description")}
                tips={tHelp.raw("complianceAdmin.tips") as string[]}
                mediaKey="complianceAdmin"
            />

            {/* Summary tiles */}
            <div className="grid grid-cols-2 gap-3">
                <div className={cn("rounded-xl border p-4", (data?.totalsByStatus.pending ?? 0) > 0 ? "border-red-500/20 bg-red-500/5" : "border-border bg-card")}>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("pendingDeletions")}
                    </div>
                    <div className={cn("text-2xl font-bold mt-1", (data?.totalsByStatus.pending ?? 0) > 0 && "text-red-600")}>
                        {data?.totalsByStatus.pending ?? 0}
                    </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Ban className="h-3.5 w-3.5" />
                        {t("recentOptOuts")}
                    </div>
                    <div className="text-2xl font-bold mt-1">{data?.totalsByStatus.optOuts ?? 0}</div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex bg-card border border-border rounded-lg p-0.5 w-fit">
                {([
                    { id: "deletions" as const, label: t("tabDeletions"), icon: Trash2 },
                    { id: "optouts" as const, label: t("tabOptOuts"), icon: Ban },
                    { id: "export" as const, label: t("tabExport"), icon: Download },
                ]).map(tabDef => {
                    const Icon = tabDef.icon;
                    return (
                        <button
                            key={tabDef.id}
                            onClick={() => setTab(tabDef.id)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded transition inline-flex items-center gap-1.5",
                                tab === tabDef.id ? "bg-amber-600 text-white" : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            <Icon className="h-3.5 w-3.5" />
                            {tabDef.label}
                        </button>
                    );
                })}
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Pending deletions */}
            {tab === "deletions" && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-border">
                        <h2 className="text-base font-semibold">{t("tabDeletions")}</h2>
                        <p className="text-xs text-muted-foreground">{t("tabDeletionsHint")}</p>
                    </div>
                    {loading && !data ? (
                        <div className="px-4 py-8 text-center text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> {tc("loading")}
                        </div>
                    ) : !data?.pendingDeletions?.length ? (
                        <div className="px-4 py-8 text-center text-muted-foreground">{t("noPending")}</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-muted/30">
                                <tr className="text-left">
                                    <th className="px-4 py-2 font-semibold">{t("tenant")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("leadId")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("requestedBy")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("created")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("status")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {data.pendingDeletions.map(r => (
                                    <tr key={r.id} className="hover:bg-muted/20">
                                        <td className="px-4 py-2">
                                            <Link href={`/admin/tenants/${r.tenantId}`} className="hover:text-indigo-600 transition">
                                                {r.tenantName}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-2 font-mono text-xs">{r.lead_id?.slice(0, 8) || '—'}</td>
                                        <td className="px-4 py-2 text-xs text-muted-foreground">{r.requested_by || '—'}</td>
                                        <td className="px-4 py-2 text-xs text-muted-foreground font-mono">
                                            <Calendar className="h-3 w-3 inline mr-1" />
                                            {new Date(r.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-4 py-2">
                                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                                {r.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Recent opt-outs */}
            {tab === "optouts" && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-border">
                        <h2 className="text-base font-semibold">{t("tabOptOuts")}</h2>
                        <p className="text-xs text-muted-foreground">{t("tabOptOutsHint")}</p>
                    </div>
                    {!data?.recentOptOuts?.length ? (
                        <div className="px-4 py-8 text-center text-muted-foreground">{t("noOptOuts")}</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-muted/30">
                                <tr className="text-left">
                                    <th className="px-4 py-2 font-semibold">{t("tenant")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("channel")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("scope")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("reason")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("status")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("created")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {data.recentOptOuts.map(r => (
                                    <tr key={r.id} className="hover:bg-muted/20">
                                        <td className="px-4 py-2">
                                            <Link href={`/admin/tenants/${r.tenantId}`} className="hover:text-indigo-600 transition">
                                                {r.tenantName}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-2 text-xs font-mono">{r.channel}</td>
                                        <td className="px-4 py-2 text-xs">{r.scope}</td>
                                        <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[200px]">{r.reason || '—'}</td>
                                        <td className="px-4 py-2">
                                            <span className={cn(
                                                "inline-flex px-2 py-0.5 rounded text-xs font-medium",
                                                r.status === 'confirmed' ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                                    : r.status === 'rejected' ? "bg-red-500/10 text-red-700 dark:text-red-300"
                                                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                                            )}>
                                                {r.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-xs text-muted-foreground font-mono">
                                            {new Date(r.created_at).toLocaleDateString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Data subject export */}
            {tab === "export" && (
                <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                    <div>
                        <h2 className="text-base font-semibold flex items-center gap-2">
                            <Download className="h-4 w-4 text-amber-500" />
                            {t("tabExport")}
                        </h2>
                        <p className="text-xs text-muted-foreground mt-1">{t("exportHint")}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("tenantIdLabel")}</label>
                            <input
                                type="text"
                                value={exportTenantId}
                                onChange={e => setExportTenantId(e.target.value)}
                                placeholder="00000000-0000-0000-0000-000000000000"
                                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("contactIdLabel")}</label>
                            <input
                                type="text"
                                value={exportContactId}
                                onChange={e => setExportContactId(e.target.value)}
                                placeholder="00000000-0000-0000-0000-000000000000"
                                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm font-mono"
                            />
                        </div>
                    </div>

                    {exportError && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <span>{exportError}</span>
                        </div>
                    )}

                    <div className="text-xs text-muted-foreground border-t border-border pt-3">
                        {t("exportNote")}
                    </div>

                    <div className="flex justify-end">
                        <button
                            onClick={handleExport}
                            disabled={exporting || !exportTenantId || !exportContactId}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
                        >
                            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            {t("downloadJson")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
