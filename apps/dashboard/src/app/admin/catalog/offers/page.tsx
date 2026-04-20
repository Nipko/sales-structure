"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Tag, Plus, Trash2, Save, X, Edit2, CheckCircle, Clock } from "lucide-react";

type OfferType = "discount" | "promo" | "bundle";

type Offer = {
    id: string;
    offerType: OfferType;
    title: string;
    conditions: Record<string, unknown>;
    courseId?: string;
    campaignId?: string;
    validFrom?: string;
    validTo?: string;
    active: boolean;
    createdAt: string;
};

type Form = {
    offerType: OfferType;
    title: string;
    conditionsRaw: string;
    validFrom: string;
    validTo: string;
    active: boolean;
};

const EMPTY: Form = {
    offerType: "discount",
    title: "",
    conditionsRaw: "{}",
    validFrom: "",
    validTo: "",
    active: true,
};

export default function OffersPage() {
    const { activeTenantId } = useTenant();
    const t = useTranslations("catalog.offers");
    const [offers, setOffers] = useState<Offer[]>([]);
    const [loading, setLoading] = useState(true);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<Offer | null>(null);
    const [form, setForm] = useState<Form>(EMPTY);
    const [error, setError] = useState("");

    const load = () => {
        if (!activeTenantId) return;
        setLoading(true);
        api.listOffers(activeTenantId).then((res: any) => {
            if (res.success && Array.isArray(res.data)) setOffers(res.data);
            setLoading(false);
        });
    };

    useEffect(() => { load(); }, [activeTenantId]);

    const openNew = () => {
        setEditing(null);
        setForm(EMPTY);
        setError("");
        setEditorOpen(true);
    };

    const openEdit = (o: Offer) => {
        setEditing(o);
        setForm({
            offerType: o.offerType,
            title: o.title,
            conditionsRaw: JSON.stringify(o.conditions ?? {}, null, 2),
            validFrom: o.validFrom ? o.validFrom.slice(0, 16) : "",
            validTo: o.validTo ? o.validTo.slice(0, 16) : "",
            active: o.active,
        });
        setError("");
        setEditorOpen(true);
    };

    const save = async () => {
        if (!activeTenantId) return;
        if (!form.title.trim()) { setError(t("errors.titleRequired")); return; }
        let conditions: Record<string, unknown> = {};
        try { conditions = JSON.parse(form.conditionsRaw || "{}"); }
        catch { setError(t("errors.conditionsInvalid")); return; }
        const payload = {
            offerType: form.offerType,
            title: form.title.trim(),
            conditions,
            validFrom: form.validFrom || undefined,
            validTo: form.validTo || undefined,
            active: form.active,
        };
        const result = editing
            ? await api.updateOffer(activeTenantId, editing.id, payload)
            : await api.createOffer(activeTenantId, payload);
        if (result.success) {
            setEditorOpen(false);
            load();
        } else {
            setError(result.error || t("errors.saveFailed"));
        }
    };

    const remove = async (id: string) => {
        if (!activeTenantId) return;
        if (!confirm(t("confirmDelete"))) return;
        const result = await api.deleteOffer(activeTenantId, id);
        if (result.success) load();
    };

    const isLive = (o: Offer) => {
        if (!o.active) return false;
        const now = Date.now();
        if (o.validFrom && new Date(o.validFrom).getTime() > now) return false;
        if (o.validTo && new Date(o.validTo).getTime() < now) return false;
        return true;
    };

    const inputCls = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500";

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                        <Tag size={20} className="text-indigo-600" />
                        {t("title")}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
                </div>
                <button
                    onClick={openNew}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-medium text-white transition-colors"
                >
                    <Plus size={16} />
                    {t("newOffer")}
                </button>
            </div>

            {loading ? (
                <div className="text-sm text-neutral-500">{t("loading")}</div>
            ) : offers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-12 text-center">
                    <Tag size={32} className="mx-auto text-neutral-400 mb-3" />
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("empty")}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {offers.map(o => {
                        const live = isLive(o);
                        return (
                            <div key={o.id} className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[10px] uppercase rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 px-1.5 py-0.5">
                                                {t(`types.${o.offerType}`)}
                                            </span>
                                            {live ? (
                                                <span className="text-[10px] rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 px-1.5 py-0.5 inline-flex items-center gap-1">
                                                    <CheckCircle size={10} />
                                                    {t("live")}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 px-1.5 py-0.5 inline-flex items-center gap-1">
                                                    <Clock size={10} />
                                                    {t("inactive")}
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">{o.title}</h3>
                                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                            {o.validFrom ? new Date(o.validFrom).toLocaleDateString() : "∞"}
                                            {" → "}
                                            {o.validTo ? new Date(o.validTo).toLocaleDateString() : "∞"}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        <button onClick={() => openEdit(o)} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800">
                                            <Edit2 size={14} className="text-neutral-600 dark:text-neutral-400" />
                                        </button>
                                        <button onClick={() => remove(o.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20">
                                            <Trash2 size={14} className="text-red-600 dark:text-red-400" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {editorOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setEditorOpen(false)}>
                    <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                                {editing ? t("editTitle") : t("newTitle")}
                            </h2>
                            <button onClick={() => setEditorOpen(false)} className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                                <X size={18} />
                            </button>
                        </div>

                        {error && (
                            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                                {error}
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.type")} *</label>
                                <select className={inputCls} value={form.offerType} onChange={e => setForm({ ...form, offerType: e.target.value as OfferType })}>
                                    <option value="discount">{t("types.discount")}</option>
                                    <option value="promo">{t("types.promo")}</option>
                                    <option value="bundle">{t("types.bundle")}</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.title")} *</label>
                                <input className={inputCls} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={t("placeholders.title")} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.validFrom")}</label>
                                    <input type="datetime-local" className={inputCls} value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.validTo")}</label>
                                    <input type="datetime-local" className={inputCls} value={form.validTo} onChange={e => setForm({ ...form, validTo: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.conditions")}</label>
                                <textarea
                                    className="w-full min-h-[120px] rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 text-xs font-mono text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 resize-y"
                                    value={form.conditionsRaw}
                                    onChange={e => setForm({ ...form, conditionsRaw: e.target.value })}
                                    placeholder='{"discount_pct": 20, "code": "SUMMER20"}'
                                />
                                <p className="mt-1 text-[10px] text-neutral-500">{t("conditionsHint")}</p>
                            </div>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} className="rounded" />
                                <span className="text-neutral-700 dark:text-neutral-300">{t("fields.active")}</span>
                            </label>
                        </div>

                        <div className="mt-6 flex justify-end gap-2">
                            <button onClick={() => setEditorOpen(false)} className="px-4 py-2 rounded-lg text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                                {t("cancel")}
                            </button>
                            <button onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-medium text-white">
                                <Save size={16} />
                                {t("save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
