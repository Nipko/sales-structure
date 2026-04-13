"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Settings, Save, CheckCircle } from "lucide-react";

export default function PlatformPage() {
    const t = useTranslations("settings");
    const [values, setValues] = useState({
        "general.platform_name": "Parallext Engine",
        "general.default_language": "es-CO",
        "general.default_timezone": "America/Bogota",
        "general.max_conversations_per_tenant": "100",
        "general.enable_analytics": "true",
        "general.enable_rag": "true",
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        async function load() {
            const result = await api.getApiKeys();
            if (result.success && result.data) {
                setValues(prev => ({ ...prev, ...Object.fromEntries(
                    Object.entries(result.data).filter(([k]) => k.startsWith("general."))
                )}));
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

    const inputClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors";
    const selectClasses = cn(inputClasses, "cursor-pointer");

    return (
        <div className="max-w-2xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
                        {t("pages.advanced")}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        {t("pages.advancedDesc")}
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
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">Nombre de plataforma</label>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">Nombre visible en el dashboard</p>
                    <input
                        type="text"
                        value={values["general.platform_name"]}
                        onChange={e => setValues(prev => ({ ...prev, "general.platform_name": e.target.value }))}
                        className={inputClasses}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">Idioma por defecto</label>
                        <select
                            value={values["general.default_language"]}
                            onChange={e => setValues(prev => ({ ...prev, "general.default_language": e.target.value }))}
                            className={selectClasses}
                        >
                            {["es-CO", "es-MX", "es-ES", "en-US", "pt-BR"].map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">Zona horaria por defecto</label>
                        <select
                            value={values["general.default_timezone"]}
                            onChange={e => setValues(prev => ({ ...prev, "general.default_timezone": e.target.value }))}
                            className={selectClasses}
                        >
                            {["America/Bogota", "America/Mexico_City", "America/Lima", "America/New_York", "Europe/Madrid", "America/Sao_Paulo"].map(tz =>
                                <option key={tz} value={tz}>{tz}</option>
                            )}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">Max conversaciones por tenant</label>
                    <input
                        type="number"
                        value={values["general.max_conversations_per_tenant"]}
                        onChange={e => setValues(prev => ({ ...prev, "general.max_conversations_per_tenant": e.target.value }))}
                        className={cn(inputClasses, "max-w-[140px]")}
                    />
                </div>

                {/* Boolean toggles */}
                {[
                    { key: "general.enable_analytics", label: "Analytics habilitado", desc: "Tracking de eventos y métricas" },
                    { key: "general.enable_rag", label: "RAG habilitado", desc: "Búsqueda por Knowledge Base" },
                ].map(item => (
                    <div key={item.key} className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-800/50">
                        <div>
                            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{item.label}</div>
                            <div className="text-xs text-neutral-500 dark:text-neutral-400">{item.desc}</div>
                        </div>
                        <button
                            onClick={() => setValues(prev => ({ ...prev, [item.key]: prev[item.key as keyof typeof prev] === "true" ? "false" : "true" }))}
                            className={cn(
                                "relative h-6 w-12 shrink-0 cursor-pointer rounded-full border-none transition-colors",
                                values[item.key as keyof typeof values] === "true" ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-600"
                            )}
                        >
                            <div className={cn(
                                "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left] duration-200",
                                values[item.key as keyof typeof values] === "true" ? "left-[27px]" : "left-[3px]"
                            )} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
