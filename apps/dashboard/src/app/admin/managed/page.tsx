"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { ShieldCheck, Loader2, Plus, Target, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface ManagedRow {
    tenantId: string; name: string; slug: string; targetPct: number; monthlyFeeCents?: number | null;
    notes?: string | null; deltaPct: number | null; status: string;
    resolution?: { closed: number; aiResolved: number; aiVerified: number; resolutionRate: number; verifiedResolutionRate: number };
}

const STATUS: Record<string, { color: string; icon: any }> = {
    met: { color: "text-emerald-500", icon: CheckCircle2 },
    at_risk: { color: "text-amber-500", icon: AlertTriangle },
    breached: { color: "text-red-400", icon: XCircle },
    unknown: { color: "text-muted-foreground", icon: Target },
};
const CARD = "rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]";

export default function ManagedPage() {
    const t = useTranslations("managed");
    const [rows, setRows] = useState<ManagedRow[]>([]);
    const [tenants, setTenants] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState("");
    const [addTenant, setAddTenant] = useState("");
    const [addTarget, setAddTarget] = useState(70);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [m, tn]: any[] = await Promise.all([api.listManaged(), api.getTenants()]);
            if (m?.success) setRows(m.data || []);
            if (tn?.success) setTenants(tn.data || []);
        } catch { /* noop */ }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const managedIds = new Set(rows.map((r) => r.tenantId));
    const available = tenants.filter((t: any) => !managedIds.has(t.id));

    const enable = async () => {
        if (!addTenant) return;
        setBusy("add");
        try { await api.setManagedConfig(addTenant, { enabled: true, resolutionTargetPct: addTarget }); setAddTenant(""); await load(); }
        finally { setBusy(""); }
    };
    const updateTarget = async (r: ManagedRow, target: number) => {
        setBusy(`t:${r.tenantId}`);
        try { await api.setManagedConfig(r.tenantId, { resolutionTargetPct: target }); await load(); } finally { setBusy(""); }
    };
    const disable = async (r: ManagedRow) => {
        setBusy(`d:${r.tenantId}`);
        try { await api.setManagedConfig(r.tenantId, { enabled: false }); await load(); } finally { setBusy(""); }
    };

    const summary = {
        total: rows.length,
        met: rows.filter((r) => r.status === "met").length,
        atRisk: rows.filter((r) => r.status === "at_risk").length,
        breached: rows.filter((r) => r.status === "breached").length,
    };

    return (
        <div className="space-y-6">
            <PageHeader icon={ShieldCheck} title={t("title")} subtitle={t("subtitle")} />

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : (
                <>
                    {/* Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Kpi label={t("managedAccounts")} value={summary.total} color="text-indigo-500" />
                        <Kpi label={t("met")} value={summary.met} color="text-emerald-500" />
                        <Kpi label={t("atRisk")} value={summary.atRisk} color="text-amber-500" />
                        <Kpi label={t("breached")} value={summary.breached} color="text-red-400" />
                    </div>

                    {/* Add managed account */}
                    <div className={cn(CARD, "p-4 flex flex-col sm:flex-row gap-2 sm:items-end")}>
                        <div className="flex-1">
                            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{t("addAccount")}</label>
                            <select value={addTenant} onChange={(e) => setAddTenant(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <option value="">{t("selectTenant")}</option>
                                {available.map((tn: any) => <option key={tn.id} value={tn.id}>{tn.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{t("targetPct")}</label>
                            <input type="number" min={1} max={100} value={addTarget} onChange={(e) => setAddTarget(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                                className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                        </div>
                        <button onClick={enable} disabled={busy === "add" || !addTenant} className="inline-flex items-center gap-2 rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                            {busy === "add" ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} {t("enable")}
                        </button>
                    </div>

                    {/* Managed list */}
                    <div className={cn(CARD, "p-5")}>
                        <h3 className="text-sm font-semibold text-foreground mb-3">{t("guaranteeTracking")}</h3>
                        {rows.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-8 text-center">{t("empty")}</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 dark:border-white/10 text-left">
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium">{t("account")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("target")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("verifiedRate")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("delta")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("closed")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium">{t("status")}</th>
                                            <th className="w-8"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r) => {
                                            const st = STATUS[r.status] || STATUS.unknown;
                                            const StIcon = st.icon;
                                            return (
                                                <tr key={r.tenantId} className="border-b border-neutral-100 dark:border-white/5">
                                                    <td className="py-2.5 px-3 font-medium text-foreground">{r.name}</td>
                                                    <td className="py-2.5 px-3 text-center">
                                                        <input type="number" min={1} max={100} defaultValue={r.targetPct}
                                                            onBlur={(e) => { const v = parseInt(e.target.value); if (v && v !== r.targetPct) updateTarget(r, v); }}
                                                            className="w-16 rounded border border-border bg-background px-2 py-1 text-sm text-center text-foreground" />%
                                                    </td>
                                                    <td className="py-2.5 px-3 text-center text-foreground font-medium">{r.resolution?.verifiedResolutionRate ?? 0}%</td>
                                                    <td className={cn("py-2.5 px-3 text-center font-medium", (r.deltaPct ?? 0) >= 0 ? "text-emerald-500" : "text-red-400")}>
                                                        {r.deltaPct != null ? `${r.deltaPct >= 0 ? "+" : ""}${r.deltaPct}` : "—"}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-center text-text-secondary">{r.resolution?.closed ?? 0}</td>
                                                    <td className="py-2.5 px-3"><span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", st.color)}><StIcon size={13} /> {t(`status_${r.status}`)}</span></td>
                                                    <td className="py-2.5 px-3"><button onClick={() => disable(r)} disabled={busy === `d:${r.tenantId}`} className="text-xs text-muted-foreground hover:text-red-400">{t("disable")}</button></td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className={cn(CARD, "p-4")}>
            <div className="text-xs text-muted-foreground mb-1">{label}</div>
            <div className={cn("text-xl font-semibold", color)}>{value}</div>
        </div>
    );
}
