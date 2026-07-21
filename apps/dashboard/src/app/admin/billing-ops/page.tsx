"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { SkeletonTable } from "@/components/ui/skeleton-loader";
import { EmptyState } from "@/components/ui/empty-state";
import { CreditCard, Users, Receipt, Activity, CheckCircle, AlertCircle, Loader2, RotateCcw } from "lucide-react";

type TabId = "subscriptions" | "payments" | "events";

const PAGE_SIZE = 25;

export default function BillingOpsPage() {
    const t = useTranslations("billingOps");
    const { user } = useAuth();
    const router = useRouter();

    const [activeTab, setActiveTab] = useState<TabId>("subscriptions");
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
    const [refundFor, setRefundFor] = useState<any | null>(null);
    const [refunding, setRefunding] = useState(false);

    const load = useCallback(async (tab: TabId, pg: number) => {
        setLoading(true);
        try {
            const res = tab === "subscriptions" ? await api.listAdminSubscriptions({ page: pg, limit: PAGE_SIZE })
                : tab === "payments" ? await api.listAdminPayments({ page: pg, limit: PAGE_SIZE })
                    : await api.listAdminBillingEvents({ page: pg, limit: PAGE_SIZE });
            if (res.success) { setRows(res.data?.items ?? []); setTotal(res.data?.total ?? 0); }
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => {
        if (user && user.role !== "super_admin") { router.push("/admin"); return; }
        if (user) load(activeTab, page);
    }, [user, router, activeTab, page, load]);

    useEffect(() => {
        if (toast) { const id = setTimeout(() => setToast(null), 4000); return () => clearTimeout(id); }
    }, [toast]);

    const changeTab = (id: TabId) => { setPage(1); setActiveTab(id); };

    const doRefund = async (reason: string) => {
        if (!refundFor) return;
        setRefunding(true);
        try {
            const res = await api.refundBillingPayment(refundFor.id, { reason });
            if (res.success) { setToast({ type: "success", msg: t("refundDone") }); setRefundFor(null); load(activeTab, page); }
            else setToast({ type: "error", msg: res.error || "Error" });
        } catch { setToast({ type: "error", msg: "Connection error" }); }
        setRefunding(false);
    };

    const tabs = [
        { id: "subscriptions" as const, label: t("tabs.subscriptions"), icon: Users },
        { id: "payments" as const, label: t("tabs.payments"), icon: Receipt },
        { id: "events" as const, label: t("tabs.events"), icon: Activity },
    ];

    const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString() : "—";
    const fmtMoney = (cents: number, cur: string) => `${(cents / 100).toLocaleString()} ${cur}`;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const statusPill = (s: string) => {
        const map: Record<string, string> = {
            active: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
            trialing: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
            past_due: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
            succeeded: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
            failed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
            refunded: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
            cancelled: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
            expired: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
        };
        return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${map[s] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"}`}>{s}</span>;
    };

    const thCls = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400";
    const tdCls = "px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200";

    return (
        <div className="max-w-[1400px] mx-auto space-y-6">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={CreditCard} />

            {toast && (
                <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${toast.type === "success"
                    ? "border border-green-200 bg-green-50 text-green-600 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400"
                    : "border border-red-200 bg-red-50 text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"}`}>
                    {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}{toast.msg}
                </div>
            )}

            <TabNav tabs={tabs} activeTab={activeTab} onTabChange={(id) => changeTab(id as TabId)} />

            <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-x-auto">
                {loading ? (
                    <div className="p-4"><SkeletonTable rows={6} cols={5} /></div>
                ) : rows.length === 0 ? (
                    <div className="p-8"><EmptyState icon={activeTab === "payments" ? Receipt : activeTab === "events" ? Activity : Users} title={t("empty")} /></div>
                ) : (
                    <table className="w-full min-w-[720px]">
                        <thead>
                            <tr className="border-b border-neutral-200 dark:border-neutral-700">
                                {activeTab === "subscriptions" && (<>
                                    <th className={thCls}>{t("cols.tenant")}</th><th className={thCls}>{t("cols.plan")}</th><th className={thCls}>{t("cols.status")}</th><th className={thCls}>{t("cols.provider")}</th><th className={thCls}>{t("cols.periodEnd")}</th><th className={thCls}>{t("cols.pending")}</th>
                                </>)}
                                {activeTab === "payments" && (<>
                                    <th className={thCls}>{t("cols.tenant")}</th><th className={thCls}>{t("cols.amount")}</th><th className={thCls}>{t("cols.status")}</th><th className={thCls}>{t("cols.provider")}</th><th className={thCls}>{t("cols.date")}</th><th className={thCls} />
                                </>)}
                                {activeTab === "events" && (<>
                                    <th className={thCls}>{t("cols.date")}</th><th className={thCls}>{t("cols.eventType")}</th><th className={thCls}>{t("cols.provider")}</th><th className={thCls}>{t("cols.tenant")}</th><th className={thCls}>{t("cols.eventId")}</th>
                                </>)}
                            </tr>
                        </thead>
                        <tbody>
                            {activeTab === "subscriptions" && rows.map((r) => (
                                <tr key={r.id} className="border-b border-neutral-100 dark:border-neutral-800">
                                    <td className={tdCls}>{r.tenant?.name ?? "—"}</td>
                                    <td className={tdCls}>{r.plan?.name ?? r.plan?.slug ?? "—"}</td>
                                    <td className={tdCls}>{statusPill(r.status)}</td>
                                    <td className={tdCls}><span className="text-xs">{r.provider}</span></td>
                                    <td className={tdCls}><span className="text-xs">{fmtDate(r.currentPeriodEnd)}</span></td>
                                    <td className={tdCls}>{r.pendingPlan ? <span className="text-[11px] text-amber-600 dark:text-amber-400">{r.pendingPlan.slug} · {fmtDate(r.pendingPlanChangeAt)}</span> : "—"}</td>
                                </tr>
                            ))}
                            {activeTab === "payments" && rows.map((r) => (
                                <tr key={r.id} className="border-b border-neutral-100 dark:border-neutral-800">
                                    <td className={tdCls}>{r.subscription?.tenant?.name ?? (r.tenantId ? String(r.tenantId).slice(0, 8) : "—")}</td>
                                    <td className={tdCls}><span className="font-mono text-xs">{fmtMoney(r.amountCents, r.currency)}</span></td>
                                    <td className={tdCls}>{statusPill(r.status)}</td>
                                    <td className={tdCls}><span className="text-xs">{r.provider}</span></td>
                                    <td className={tdCls}><span className="text-xs">{fmtDate(r.paidAt ?? r.createdAt)}</span></td>
                                    <td className={tdCls}>{r.status === "succeeded" && r.providerPaymentId ? (
                                        <button onClick={() => setRefundFor(r)} className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 hover:underline"><RotateCcw size={11} /> {t("refund")}</button>
                                    ) : null}</td>
                                </tr>
                            ))}
                            {activeTab === "events" && rows.map((r) => (
                                <tr key={r.id} className="border-b border-neutral-100 dark:border-neutral-800">
                                    <td className={tdCls}><span className="text-xs">{fmtDate(r.processedAt)}</span></td>
                                    <td className={tdCls}><span className="text-xs font-medium">{r.eventType}</span></td>
                                    <td className={tdCls}><span className="text-xs">{r.provider}</span></td>
                                    <td className={tdCls}><span className="text-xs">{r.tenantId ? String(r.tenantId).slice(0, 8) : "—"}</span></td>
                                    <td className={tdCls}><span className="font-mono text-[10px] text-neutral-400">{String(r.providerEventId).slice(0, 18)}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {total > PAGE_SIZE && (
                <div className="flex items-center justify-between text-sm text-neutral-500">
                    <span>{t("pageOf", { page: String(page), total: String(pages) })}</span>
                    <div className="flex gap-2">
                        <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="px-3 py-1 rounded border border-neutral-200 dark:border-neutral-700 disabled:opacity-40">{t("prev")}</button>
                        <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded border border-neutral-200 dark:border-neutral-700 disabled:opacity-40">{t("next")}</button>
                    </div>
                </div>
            )}

            {refundFor && (
                <RefundModal payment={refundFor} busy={refunding} onCancel={() => setRefundFor(null)} onConfirm={doRefund} t={t} fmtMoney={fmtMoney} />
            )}
        </div>
    );
}

function RefundModal({ payment, busy, onCancel, onConfirm, t, fmtMoney }: any) {
    const [reason, setReason] = useState("");
    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
            <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">{t("refundTitle")}</h3>
                <p className="text-sm text-neutral-500 mb-3">{t("refundDesc", { amount: fmtMoney(payment.amountCents, payment.currency) })}</p>
                <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder={t("refundReason")} rows={2} className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 mb-4" />
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 dark:text-neutral-400">{t("cancel")}</button>
                    <button onClick={() => onConfirm(reason)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm disabled:opacity-50">
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} {t("refundConfirm")}
                    </button>
                </div>
            </div>
        </div>
    );
}
