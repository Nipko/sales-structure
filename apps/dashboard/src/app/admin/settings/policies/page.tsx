"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Scale, Save, CheckCircle, AlertCircle, History, Info } from "lucide-react";

const POLICY_TYPES = ["shipping", "return", "warranty", "cancellation", "terms", "privacy"] as const;
type PolicyType = typeof POLICY_TYPES[number];

type Policy = {
    id: string;
    type: PolicyType;
    title: string;
    content: string;
    version: number;
    isActive: boolean;
    effectiveFrom: string;
    effectiveTo?: string;
    createdAt: string;
};

export default function PoliciesPage() {
    const { activeTenantId } = useTenant();
    const t = useTranslations("settings.policies");
    const [policies, setPolicies] = useState<Record<PolicyType, Policy | null>>({} as any);
    const [selectedType, setSelectedType] = useState<PolicyType>("shipping");
    const [form, setForm] = useState({ title: "", content: "" });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");
    const [versions, setVersions] = useState<Policy[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    const load = () => {
        if (!activeTenantId) return;
        setLoading(true);
        api.listPolicies(activeTenantId).then((res: any) => {
            if (res.success && Array.isArray(res.data)) {
                const byType: Record<PolicyType, Policy | null> = {} as any;
                for (const type of POLICY_TYPES) byType[type] = null;
                for (const p of res.data) byType[p.type as PolicyType] = p;
                setPolicies(byType);
            }
            setLoading(false);
        });
    };

    useEffect(() => { load(); }, [activeTenantId]);

    useEffect(() => {
        const current = policies[selectedType];
        setForm({
            title: current?.title || "",
            content: current?.content || "",
        });
        setError("");
        setShowHistory(false);
    }, [selectedType, policies]);

    const loadHistory = async () => {
        if (!activeTenantId) return;
        const res = await api.listPolicyVersions(activeTenantId, selectedType);
        if (res.success && Array.isArray(res.data)) setVersions(res.data);
        setShowHistory(true);
    };

    const save = async () => {
        if (!activeTenantId) return;
        if (!form.title.trim() || !form.content.trim()) {
            setError(t("errors.required"));
            return;
        }
        setSaving(true);
        setError("");
        try {
            const result = await api.upsertPolicy(activeTenantId, {
                type: selectedType,
                title: form.title.trim(),
                content: form.content.trim(),
            });
            if (result.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
                load();
            } else {
                setError(result.error || t("errors.saveFailed"));
            }
        } catch {
            setError(t("errors.connection"));
        }
        setSaving(false);
    };

    const currentPolicy = policies[selectedType];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                    <Scale size={20} className="text-indigo-600" />
                    {t("title")}
                </h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
            </div>

            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 flex gap-2">
                <Info size={16} className="flex-shrink-0 mt-0.5" />
                <span>{t("hint")}</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
                {/* Type selector */}
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2">
                    {POLICY_TYPES.map((type) => {
                        const p = policies[type];
                        const isActive = selectedType === type;
                        return (
                            <button
                                key={type}
                                onClick={() => setSelectedType(type)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between gap-2 ${
                                    isActive
                                        ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium"
                                        : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                }`}
                            >
                                <span>{t(`types.${type}`)}</span>
                                {p && (
                                    <span className="text-[10px] rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 px-1.5 py-0.5">
                                        v{p.version}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Editor */}
                <div className="space-y-4">
                    {loading ? (
                        <div className="text-sm text-neutral-500">{t("loading")}</div>
                    ) : (
                        <>
                            {error && (
                                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                                    <AlertCircle size={16} /> {error}
                                </div>
                            )}
                            {saved && (
                                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-600 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400">
                                    <CheckCircle size={16} /> {t("saved")}
                                </div>
                            )}

                            <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t(`types.${selectedType}`)}</h2>
                                    {currentPolicy && (
                                        <button
                                            onClick={loadHistory}
                                            className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:text-indigo-600"
                                        >
                                            <History size={12} />
                                            {t("viewHistory")} ({t("versionPrefix")}{currentPolicy.version})
                                        </button>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.title")} *</label>
                                    <input
                                        className="w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500"
                                        value={form.title}
                                        onChange={e => setForm({ ...form, title: e.target.value })}
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.content")} *</label>
                                    <textarea
                                        className="w-full min-h-[300px] rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 resize-y font-mono"
                                        value={form.content}
                                        onChange={e => setForm({ ...form, content: e.target.value })}
                                        placeholder={t("placeholders.content")}
                                    />
                                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("markdownHint")}</p>
                                </div>

                                <div className="flex justify-end">
                                    <button
                                        onClick={save}
                                        disabled={saving}
                                        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 px-4 py-2 text-sm font-medium text-white"
                                    >
                                        <Save size={16} />
                                        {saving ? t("saving") : (currentPolicy ? t("saveNewVersion") : t("createPolicy"))}
                                    </button>
                                </div>
                            </div>

                            {showHistory && versions.length > 0 && (
                                <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
                                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">{t("history")}</h3>
                                    <div className="space-y-2">
                                        {versions.map(v => (
                                            <div key={v.id} className="flex items-center justify-between rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-2 text-sm">
                                                <div>
                                                    <span className="font-medium text-neutral-900 dark:text-neutral-100">v{v.version}</span>
                                                    {v.isActive && (
                                                        <span className="ml-2 text-[10px] rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 px-1.5 py-0.5">
                                                            {t("active")}
                                                        </span>
                                                    )}
                                                    <span className="ml-2 text-neutral-500 dark:text-neutral-400">{v.title}</span>
                                                </div>
                                                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                                    {new Date(v.createdAt).toLocaleDateString()}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
