"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SlidersHorizontal, Save, CheckCircle } from "lucide-react";
import { SuperAdminGuard } from "@/components/SuperAdminGuard";

const MODELS = [
    "gpt-4o", "gpt-4o-mini", "gemini-2.0-flash", "gemini-2.0-pro",
    "claude-sonnet-4-20250514", "grok-2", "deepseek-chat",
];

export default function AIConfigPage() {
    return (
        <SuperAdminGuard>
            <AIConfigContent />
        </SuperAdminGuard>
    );
}

function AIConfigContent() {
    const t = useTranslations("settings");
    const [values, setValues] = useState({
        "llm.default_model": "gpt-4o-mini",
        "llm.default_temperature": "0.7",
        "llm.max_tokens": "800",
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        async function load() {
            const result = await api.getApiKeys();
            if (result.success && result.data) {
                setValues(prev => ({
                    ...prev,
                    "llm.default_model": result.data["llm.default_model"] || "gpt-4o-mini",
                    "llm.default_temperature": result.data["llm.default_temperature"] || "0.7",
                    "llm.max_tokens": result.data["llm.max_tokens"] || "800",
                }));
            }
        }
        load();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.updateSettings(values);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch { /* ignore */ }
        setSaving(false);
    };

    const selectClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 cursor-pointer transition-colors";
    const inputClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors";

    return (
        <div className="max-w-2xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                        {t("pages.aiConfig")}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        {t("pages.aiConfigDesc")}
                    </p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                        "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all",
                        saved ? "bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-700",
                        saving && "opacity-70"
                    )}
                >
                    {saved ? <CheckCircle size={16} /> : <Save size={16} />}
                    {saving ? t("saving") : saved ? t("saved") : t("save")}
                </button>
            </div>

            <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                {/* Default model */}
                <div>
                    <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        <SlidersHorizontal size={14} className="text-neutral-400" /> Modelo por defecto
                    </label>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                        Used when the router cannot decide which model to use
                    </p>
                    <select
                        value={values["llm.default_model"]}
                        onChange={e => setValues(prev => ({ ...prev, "llm.default_model": e.target.value }))}
                        className={selectClasses}
                    >
                        {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>

                {/* Temperature */}
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        Temperatura
                    </label>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                        Creatividad de respuestas (0.0 = preciso, 1.0 = creativo)
                    </p>
                    <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={values["llm.default_temperature"]}
                        onChange={e => setValues(prev => ({ ...prev, "llm.default_temperature": e.target.value }))}
                        className={cn(inputClasses, "max-w-[120px]")}
                    />
                </div>

                {/* Max tokens */}
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        Max Tokens
                    </label>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                        Token limit per model response
                    </p>
                    <input
                        type="number"
                        min="100"
                        max="4096"
                        step="100"
                        value={values["llm.max_tokens"]}
                        onChange={e => setValues(prev => ({ ...prev, "llm.max_tokens": e.target.value }))}
                        className={cn(inputClasses, "max-w-[120px]")}
                    />
                </div>
            </div>
        </div>
    );
}
