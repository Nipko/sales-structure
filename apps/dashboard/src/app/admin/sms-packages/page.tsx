"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { MessageSquare, Plus, Trash2, Save, Loader2, X, Wallet, Search } from "lucide-react";

interface Pkg {
    id: string;
    name: string;
    credits: number;
    priceCents: number;
    currency: string;
    active: boolean;
    highlight?: boolean;
}
interface Balance {
    tenant_id: string;
    tenant_name: string;
    slug: string;
    balance_credits: number;
    updated_at: string;
}

const inputCls =
    "w-full text-sm px-2 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-indigo-400";

export default function SmsPackagesAdminPage() {
    const t = useTranslations("smsPackages");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [senderId, setSenderId] = useState("");
    const [packages, setPackages] = useState<Pkg[]>([]);
    const [balances, setBalances] = useState<Balance[]>([]);
    const [query, setQuery] = useState("");
    const [toast, setToast] = useState<string | null>(null);

    const [adjustTarget, setAdjustTarget] = useState<Balance | null>(null);
    const [adjustDelta, setAdjustDelta] = useState("");
    const [adjustReason, setAdjustReason] = useState("");
    const [adjusting, setAdjusting] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [cfg, bal] = await Promise.all([api.getSmsConfig(), api.getSmsBalances()]);
            if (cfg?.success) {
                const d = cfg.data as any;
                setEnabled(d?.enabled === true);
                setSenderId(d?.senderId || "");
                setPackages(d?.packages || []);
            }
            if (bal?.success) setBalances((bal.data as Balance[]) || []);
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (!toast) return;
        const id = setTimeout(() => setToast(null), 3500);
        return () => clearTimeout(id);
    }, [toast]);

    const updatePkg = (i: number, patch: Partial<Pkg>) =>
        setPackages((p) => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
    const addPkg = () =>
        setPackages((p) => [
            ...p,
            { id: `paquete-${p.length + 1}`, name: "", credits: 0, priceCents: 0, currency: "COP", active: true },
        ]);
    const removePkg = (i: number) => setPackages((p) => p.filter((_, idx) => idx !== i));

    const save = async () => {
        setSaving(true);
        try {
            const res = await api.updateSmsConfig({ enabled, senderId: senderId || undefined, packages });
            if (res?.success) {
                setToast(t("saved"));
                if (res.data) setPackages(((res.data as any).packages as Pkg[]) || []);
            } else {
                setToast(res?.error || t("saveError"));
            }
        } catch {
            setToast(t("saveError"));
        } finally {
            setSaving(false);
        }
    };

    const doAdjust = async () => {
        if (!adjustTarget) return;
        const delta = parseInt(adjustDelta, 10);
        if (!Number.isInteger(delta) || delta === 0 || !adjustReason.trim()) {
            setToast(t("adjustInvalid"));
            return;
        }
        setAdjusting(true);
        try {
            const res = await api.adjustSmsBalance(adjustTarget.tenant_id, { delta, reason: adjustReason.trim() });
            if (res?.success) {
                setToast(t("adjustDone"));
                setAdjustTarget(null);
                setAdjustDelta("");
                setAdjustReason("");
                load();
            } else {
                setToast(res?.error || t("adjustError"));
            }
        } catch {
            setToast(t("adjustError"));
        } finally {
            setAdjusting(false);
        }
    };

    const filtered = balances.filter(
        (b) => !query || b.tenant_name?.toLowerCase().includes(query.toLowerCase()) || b.slug?.toLowerCase().includes(query.toLowerCase()),
    );

    return (
        <div className="max-w-5xl mx-auto p-6 space-y-6">
            <div className="flex items-center gap-2">
                <MessageSquare className="text-indigo-500" size={22} />
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h1>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20 text-neutral-400">
                    <Loader2 className="animate-spin" size={22} />
                </div>
            ) : (
                <>
                    {/* Master switch */}
                    <section className={`rounded-xl border p-5 ${enabled
                        ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20"
                        : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"}`}>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("switchTitle")}</h2>
                                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-xl">
                                    {enabled ? t("switchOnHint") : t("switchOffHint")}
                                </p>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={enabled}
                                onClick={() => setEnabled((v) => !v)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"}`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${enabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                            </button>
                        </div>
                        <p className="text-[11px] text-neutral-400 mt-3">{t("switchSaveNote")}</p>
                    </section>

                    {/* Tiers editor */}
                    <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("tiersTitle")}</h2>
                            <button
                                onClick={addPkg}
                                className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300"
                            >
                                <Plus size={13} /> {t("addTier")}
                            </button>
                        </div>

                        <div className="mb-4">
                            <label className="text-xs text-neutral-500 dark:text-neutral-400">{t("senderLabel")}</label>
                            <input
                                value={senderId}
                                onChange={(e) => setSenderId(e.target.value)}
                                placeholder={t("senderPlaceholder")}
                                className={`${inputCls} mt-1 max-w-xs`}
                            />
                            <p className="text-[11px] text-neutral-400 mt-1">{t("senderHint")}</p>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-400 border-b border-neutral-100 dark:border-neutral-800">
                                        <th className="py-2 pr-2 font-medium">{t("colId")}</th>
                                        <th className="py-2 pr-2 font-medium">{t("colName")}</th>
                                        <th className="py-2 pr-2 font-medium">{t("colCredits")}</th>
                                        <th className="py-2 pr-2 font-medium">{t("colPrice")}</th>
                                        <th className="py-2 pr-2 font-medium">{t("colCurrency")}</th>
                                        <th className="py-2 pr-2 font-medium text-center">{t("colActive")}</th>
                                        <th className="py-2 pr-2 font-medium text-center">{t("colHighlight")}</th>
                                        <th className="py-2 font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {packages.map((pkg, i) => (
                                        <tr key={i} className="border-b border-neutral-50 dark:border-neutral-800/50">
                                            <td className="py-2 pr-2">
                                                <input value={pkg.id} onChange={(e) => updatePkg(i, { id: e.target.value })} className={`${inputCls} w-24`} />
                                            </td>
                                            <td className="py-2 pr-2">
                                                <input value={pkg.name} onChange={(e) => updatePkg(i, { name: e.target.value })} className={`${inputCls} w-28`} />
                                            </td>
                                            <td className="py-2 pr-2">
                                                <input
                                                    type="number"
                                                    value={pkg.credits || ""}
                                                    onChange={(e) => updatePkg(i, { credits: parseInt(e.target.value, 10) || 0 })}
                                                    className={`${inputCls} w-24`}
                                                />
                                            </td>
                                            <td className="py-2 pr-2">
                                                <input
                                                    type="number"
                                                    value={pkg.priceCents ? pkg.priceCents / 100 : ""}
                                                    onChange={(e) => updatePkg(i, { priceCents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                                                    className={`${inputCls} w-28`}
                                                />
                                            </td>
                                            <td className="py-2 pr-2">
                                                <input value={pkg.currency} onChange={(e) => updatePkg(i, { currency: e.target.value.toUpperCase() })} className={`${inputCls} w-20`} />
                                            </td>
                                            <td className="py-2 pr-2 text-center">
                                                <input type="checkbox" checked={pkg.active} onChange={(e) => updatePkg(i, { active: e.target.checked })} className="accent-indigo-600" />
                                            </td>
                                            <td className="py-2 pr-2 text-center">
                                                <input type="checkbox" checked={!!pkg.highlight} onChange={(e) => updatePkg(i, { highlight: e.target.checked })} className="accent-indigo-600" />
                                            </td>
                                            <td className="py-2 text-right">
                                                <button onClick={() => removePkg(i)} className="text-neutral-400 hover:text-red-500 p-1">
                                                    <Trash2 size={15} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {packages.length === 0 && (
                                        <tr>
                                            <td colSpan={8} className="py-6 text-center text-neutral-400 text-sm">{t("noTiers")}</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between mt-4">
                            <p className="text-[11px] text-neutral-400">{t("priceNote")}</p>
                            <button
                                onClick={save}
                                disabled={saving}
                                className="text-sm font-semibold px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white flex items-center gap-1.5"
                            >
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t("save")}
                            </button>
                        </div>
                    </section>

                    {/* Balances */}
                    <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                                <Wallet size={15} className="text-indigo-500" /> {t("balancesTitle")}
                            </h2>
                            <div className="relative">
                                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" />
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder={t("searchTenant")}
                                    className={`${inputCls} pl-7 w-52`}
                                />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-400 border-b border-neutral-100 dark:border-neutral-800">
                                        <th className="py-2 pr-2 font-medium">{t("colTenant")}</th>
                                        <th className="py-2 pr-2 font-medium text-right">{t("colBalance")}</th>
                                        <th className="py-2 font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((b) => (
                                        <tr key={b.tenant_id} className="border-b border-neutral-50 dark:border-neutral-800/50">
                                            <td className="py-2 pr-2">
                                                <div className="text-neutral-900 dark:text-neutral-100">{b.tenant_name}</div>
                                                <div className="text-[11px] text-neutral-400">{b.slug}</div>
                                            </td>
                                            <td className="py-2 pr-2 text-right tabular-nums font-medium text-neutral-800 dark:text-neutral-200">
                                                {b.balance_credits.toLocaleString()}
                                            </td>
                                            <td className="py-2 text-right">
                                                <button
                                                    onClick={() => { setAdjustTarget(b); setAdjustDelta(""); setAdjustReason(""); }}
                                                    className="text-xs font-medium px-2.5 py-1 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                                                >
                                                    {t("adjust")}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {filtered.length === 0 && (
                                        <tr>
                                            <td colSpan={3} className="py-6 text-center text-neutral-400 text-sm">{t("noBalances")}</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}

            {/* Adjust modal */}
            {adjustTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setAdjustTarget(null)}>
                    <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("adjustTitle", { tenant: adjustTarget.tenant_name })}</h3>
                            <button onClick={() => setAdjustTarget(null)} className="text-neutral-400 hover:text-neutral-600"><X size={16} /></button>
                        </div>
                        <label className="text-xs text-neutral-500 dark:text-neutral-400">{t("adjustDeltaLabel")}</label>
                        <input
                            type="number"
                            value={adjustDelta}
                            onChange={(e) => setAdjustDelta(e.target.value)}
                            placeholder={t("adjustDeltaPlaceholder")}
                            className={`${inputCls} mt-1 mb-3`}
                        />
                        <label className="text-xs text-neutral-500 dark:text-neutral-400">{t("adjustReasonLabel")}</label>
                        <textarea
                            value={adjustReason}
                            onChange={(e) => setAdjustReason(e.target.value)}
                            rows={2}
                            className={`${inputCls} mt-1 mb-4 resize-none`}
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setAdjustTarget(null)} className="text-sm px-3 py-1.5 rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">{t("cancel")}</button>
                            <button onClick={doAdjust} disabled={adjusting} className="text-sm font-semibold px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white flex items-center gap-1.5">
                                {adjusting ? <Loader2 size={13} className="animate-spin" /> : null} {t("applyAdjust")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <div className="fixed bottom-6 right-6 z-50 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm px-4 py-2.5 rounded-lg shadow-lg">
                    {toast}
                </div>
            )}
        </div>
    );
}
