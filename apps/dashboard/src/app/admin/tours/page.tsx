"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCards } from "@/components/ui/skeleton-loader";
import { HelpPanel } from "@/components/ui/help-panel";
import Link from "next/link";
import {
    Compass, Plus, Clock, MapPin, Users, X, Tag,
} from "lucide-react";

const TOURS_API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";
function resolveMediaUrl(url: string): string {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    const apiOrigin = TOURS_API_BASE.replace(/\/api\/v1\/?$/, "");
    return `${apiOrigin}${url.startsWith("/") ? url : "/" + url}`;
}

interface TourPackage {
    id: string;
    name: string;
    description?: string;
    duration_type: "hours" | "days";
    duration_value: number;
    price: number;
    currency: string;
    max_capacity: number;
    destination?: string;
    languages: string[];
    images?: string[];
    is_active: boolean;
}

const AVAILABLE_LANGUAGES = [
    { key: "es", label: "Español" },
    { key: "en", label: "English" },
    { key: "pt", label: "Português" },
    { key: "fr", label: "Français" },
];

export default function ToursPage() {
    const { activeTenantId } = useTenant();
    const t = useTranslations("tours");
    const tHelp = useTranslations("help");
    const tc = useTranslations("common");

    const [packages, setPackages] = useState<TourPackage[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);

    useEffect(() => {
        if (!activeTenantId) return;
        loadPackages();
    }, [activeTenantId]);

    async function loadPackages() {
        if (!activeTenantId) return;
        setLoading(true);
        const res = await api.listTourPackages(activeTenantId);
        if (res.success && res.data) setPackages(res.data);
        setLoading(false);
    }

    if (loading) {
        return (
            <div className="p-4 md:p-6 max-w-7xl mx-auto">
                <SkeletonCards count={6} />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={Compass}
                action={
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                    >
                        <Plus size={16} /> {t("createPackage")}
                    </button>
                }
            />

            <HelpPanel
                title={tHelp("tours.title")}
                description={tHelp("tours.description")}
                tips={tHelp.raw("tours.tips") as string[]}
                mediaKey="tours"
            />

            {packages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-12 text-center">
                    <Compass size={40} className="mx-auto text-neutral-400 dark:text-neutral-600 mb-3" />
                    <p className="text-base font-medium text-neutral-700 dark:text-neutral-300 mb-1">{t("emptyTitle")}</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">{t("emptyDesc")}</p>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                    >
                        <Plus size={16} /> {t("createFirst")}
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                    {packages.map((p) => (
                        <Link
                            key={p.id}
                            href={`/admin/tours/${p.id}`}
                            className="group rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
                        >
                            {p.images?.[0] ? (
                                <div
                                    className="h-32 bg-cover bg-center"
                                    style={{ backgroundImage: `url(${resolveMediaUrl(p.images[0])})` }}
                                />
                            ) : (
                                <div className="h-32 bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-950/30 dark:to-indigo-900/20 flex items-center justify-center">
                                    <Compass size={32} className="text-indigo-300 dark:text-indigo-700" />
                                </div>
                            )}
                            <div className="p-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate flex-1">{p.name}</h3>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.duration_type === "days" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"}`}>
                                        {p.duration_type === "days" ? t("multiDay") : t("sameDay")}
                                    </span>
                                </div>
                                {p.destination && (
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 flex items-center gap-1">
                                        <MapPin size={12} /> {p.destination}
                                    </p>
                                )}
                                <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                                    <span className="flex items-center gap-1">
                                        <Clock size={12} /> {p.duration_value} {p.duration_type === "days" ? t("days") : t("hours")}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Users size={12} /> {p.max_capacity}
                                    </span>
                                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                                        {p.currency} {Number(p.price).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            {showCreateModal && (
                <CreatePackageModal
                    tenantId={activeTenantId!}
                    onClose={() => setShowCreateModal(false)}
                    onCreated={() => {
                        setShowCreateModal(false);
                        loadPackages();
                    }}
                    t={t}
                    tc={tc}
                />
            )}
        </div>
    );
}

function CreatePackageModal({
    tenantId, onClose, onCreated, t, tc,
}: {
    tenantId: string;
    onClose: () => void;
    onCreated: () => void;
    t: any;
    tc: any;
}) {
    const [form, setForm] = useState({
        name: "",
        description: "",
        durationType: "hours" as "hours" | "days",
        durationValue: 4,
        price: 0,
        currency: "COP",
        maxCapacity: 10,
        destination: "",
        languages: ["es"] as string[],
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSave() {
        if (!form.name.trim()) {
            setError(t("nameRequired"));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await api.createTourPackage(tenantId, form);
            if (res.success) onCreated();
            else setError(res.error || tc("errorSaving"));
        } catch (err: any) {
            setError(err?.message || tc("errorSaving"));
        } finally {
            setSaving(false);
        }
    }

    function toggleLanguage(key: string) {
        setForm(prev => ({
            ...prev,
            languages: prev.languages.includes(key)
                ? prev.languages.filter(l => l !== key)
                : [...prev.languages, key],
        }));
    }

    const inputCls = "w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-neutral-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
                    <h3 className="text-base font-semibold">{t("createPackage")}</h3>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        <X size={18} />
                    </button>
                </div>
                <div className="p-5 space-y-4">
                    {/* Type selector */}
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, durationType: "hours" })}
                            className={`flex flex-col items-center gap-1 px-3 py-3 rounded-lg border transition-colors ${form.durationType === "hours" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-neutral-200 dark:border-neutral-700"}`}
                        >
                            <span className="text-sm font-semibold">{t("sameDay")}</span>
                            <span className="text-[11px] text-neutral-500">{t("sameDayHint")}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, durationType: "days", durationValue: form.durationValue < 2 ? 3 : form.durationValue })}
                            className={`flex flex-col items-center gap-1 px-3 py-3 rounded-lg border transition-colors ${form.durationType === "days" ? "border-purple-500 bg-purple-50 dark:bg-purple-950/30" : "border-neutral-200 dark:border-neutral-700"}`}
                        >
                            <span className="text-sm font-semibold">{t("multiDay")}</span>
                            <span className="text-[11px] text-neutral-500">{t("multiDayHint")}</span>
                        </button>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("name")} *</label>
                        <input
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder={t("namePlaceholder")}
                            className={inputCls}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("description")}</label>
                        <textarea
                            rows={2}
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            placeholder={t("descriptionPlaceholder")}
                            className={`${inputCls} resize-y`}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("destination")}</label>
                            <input
                                value={form.destination}
                                onChange={(e) => setForm({ ...form, destination: e.target.value })}
                                placeholder={t("destinationPlaceholder")}
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                                {form.durationType === "days" ? t("days") : t("hours")}
                            </label>
                            <input
                                type="number"
                                min={1}
                                max={form.durationType === "days" ? 30 : 24}
                                value={form.durationValue}
                                onChange={(e) => setForm({ ...form, durationValue: parseInt(e.target.value) || 1 })}
                                className={inputCls}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("price")}</label>
                            <input
                                type="number"
                                min={0}
                                value={form.price}
                                onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("currency")}</label>
                            <select
                                value={form.currency}
                                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                                className={inputCls}
                            >
                                <option value="COP">COP</option>
                                <option value="USD">USD</option>
                                <option value="MXN">MXN</option>
                                <option value="ARS">ARS</option>
                                <option value="BRL">BRL</option>
                                <option value="CLP">CLP</option>
                                <option value="PEN">PEN</option>
                                <option value="EUR">EUR</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("maxCapacity")}</label>
                            <input
                                type="number"
                                min={1}
                                value={form.maxCapacity}
                                onChange={(e) => setForm({ ...form, maxCapacity: parseInt(e.target.value) || 1 })}
                                className={inputCls}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">{t("languagesOffered")}</label>
                        <div className="flex flex-wrap gap-2">
                            {AVAILABLE_LANGUAGES.map(l => (
                                <button
                                    key={l.key}
                                    type="button"
                                    onClick={() => toggleLanguage(l.key)}
                                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${form.languages.includes(l.key) ? "bg-indigo-500 text-white border-indigo-500" : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"}`}
                                >
                                    {l.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <p className="text-xs text-red-500">{error}</p>
                    )}
                </div>
                <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100 dark:border-neutral-800">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !form.name.trim()}
                        className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {saving ? tc("saving") : t("createPackage")}
                    </button>
                </div>
            </div>
        </div>
    );
}
