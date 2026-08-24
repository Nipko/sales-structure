"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { MessageSquare, Plus, X, Save, GripVertical, Smartphone } from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";
import { PageHeader } from "@/components/ui/page-header";

interface PrechatField { key: string; label: string; type: string; required: boolean; options: string; map_to: string; }
interface PrechatConfig { is_active: boolean; greeting_message: string; fields: PrechatField[]; }

function toSnakeCase(str: string): string {
    return str.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
const defaultConfig = (): PrechatConfig => ({ is_active: false, greeting_message: "", fields: [] });
const emptyField = (): PrechatField => ({ key: "", label: "", type: "text", required: false, options: "", map_to: "metadata" });

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors";
const labelCls = "block text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1";

export default function PrechatPage() {
    const t = useTranslations("prechatPage");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();
    const [config, setConfig] = useState<PrechatConfig>(defaultConfig());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const fieldTypes = [
        { value: "text", label: t("typeText") },
        { value: "email", label: t("typeEmail") },
        { value: "phone", label: t("typePhone") },
        { value: "select", label: t("typeSelect") },
    ];
    const mapToOptions = [
        { value: "contact.name", label: t("mapContactName") },
        { value: "contact.email", label: t("mapContactEmail") },
        { value: "contact.phone", label: t("mapContactPhone") },
        { value: "lead.stage", label: t("mapLeadStage") },
        { value: "metadata", label: t("mapMetadata") },
    ];

    async function loadConfig() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res = await api.fetch(`/conversations/prechat-form/${activeTenantId}`);
            if (res.success && res.data) {
                const d = res.data;
                setConfig({
                    is_active: d.is_active ?? false,
                    greeting_message: d.greeting_message || "",
                    fields: Array.isArray(d.fields)
                        ? d.fields.map((f: any) => ({
                            key: f.key || "",
                            label: f.label || "",
                            type: f.type || "text",
                            required: f.required ?? false,
                            options: Array.isArray(f.options) ? f.options.join(", ") : (f.options || ""),
                            map_to: f.map_to || "metadata",
                        }))
                        : [],
                });
            }
        } catch { /* first time — no form yet */ }
        setLoading(false);
    }

    useEffect(() => { loadConfig(); }, [activeTenantId]);

    function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }
    function addField() { setConfig(prev => ({ ...prev, fields: [...prev.fields, emptyField()] })); }
    function removeField(idx: number) { setConfig(prev => ({ ...prev, fields: prev.fields.filter((_, i) => i !== idx) })); }
    function updateField(idx: number, key: keyof PrechatField, value: any) {
        setConfig(prev => ({
            ...prev,
            fields: prev.fields.map((f, i) => {
                if (i !== idx) return f;
                const updated = { ...f, [key]: value };
                if (key === "label") updated.key = toSnakeCase(value as string);
                return updated;
            }),
        }));
    }

    async function handleSave() {
        if (!activeTenantId) return;
        setSaving(true);
        try {
            const payload = {
                is_active: config.is_active,
                greeting_message: config.greeting_message,
                fields: config.fields.map(f => ({
                    key: f.key || toSnakeCase(f.label),
                    label: f.label,
                    type: f.type,
                    required: f.required,
                    options: f.type === "select" ? f.options.split(",").map(o => o.trim()).filter(Boolean) : [],
                    map_to: f.map_to === "metadata" ? `metadata.${f.key || toSnakeCase(f.label)}` : f.map_to,
                })),
            };
            const res = await api.fetch(`/conversations/prechat-form/${activeTenantId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            showToast(res.success ? t("saved") : tc("errorSaving"));
        } catch {
            showToast(tc("connectionError"));
        }
        setSaving(false);
    }

    if (loading) return <div className="p-8 text-center text-neutral-500">{tc("loading")}</div>;

    return (
        <div className="max-w-[1100px] space-y-6">
            {toast && (
                <div className={cn(
                    "fixed top-6 right-6 z-[9999] text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-lg",
                    toast === t("saved") ? "bg-emerald-500" : "bg-red-500",
                )}>
                    {toast}
                </div>
            )}

            <div className="flex justify-between items-start">
                <PageHeader title={t("title")} subtitle={t("subtitle")} icon={MessageSquare} />
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                        "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white bg-neutral-900 dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-all",
                        saving && "opacity-50 cursor-not-allowed",
                    )}
                >
                    <Save size={16} /> {saving ? tc("saving") : tc("saveChanges")}
                </button>
            </div>

            <HelpPanel
                title={tHelp("settingsPrechat.title")}
                description={tHelp("settingsPrechat.description")}
                tips={tHelp.raw("settingsPrechat.tips") as string[]}
                mediaKey="settingsPrechat"
            />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
                <div className="space-y-5">
                    {/* Active toggle */}
                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-5 py-4 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("formActive")}</div>
                            <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t("formActiveDesc")}</div>
                        </div>
                        <button
                            onClick={() => setConfig(prev => ({ ...prev, is_active: !prev.is_active }))}
                            className={cn(
                                "relative w-11 h-6 rounded-full transition-colors",
                                config.is_active ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600",
                            )}
                        >
                            <div className={cn(
                                "w-4.5 h-4.5 rounded-full bg-white absolute top-[3px] transition-all",
                                config.is_active ? "left-[22px]" : "left-[3px]",
                            )} />
                        </button>
                    </div>

                    {/* Greeting */}
                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-5 py-4">
                        <label className={labelCls}>{t("greetingLabel")}</label>
                        <textarea
                            value={config.greeting_message}
                            onChange={e => setConfig(prev => ({ ...prev, greeting_message: e.target.value }))}
                            placeholder={t("greetingPlaceholder")}
                            rows={3}
                            className={cn(inputCls, "resize-y")}
                        />
                    </div>

                    {/* Fields builder */}
                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-5 py-4">
                        <div className="flex justify-between items-center mb-4">
                            <label className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("fieldsTitle")}</label>
                            <span className="text-xs text-neutral-500">{t("fieldsCount", { count: config.fields.length })}</span>
                        </div>
                        <div className="space-y-3">
                            {config.fields.map((field, idx) => (
                                <div key={idx} className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <GripVertical size={14} className="text-neutral-400" />
                                            <span className="text-xs text-neutral-500 font-semibold">{t("fieldNumber", { number: idx + 1 })}</span>
                                            {field.key && <span className="text-[11px] text-indigo-500 font-mono bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded">{field.key}</span>}
                                        </div>
                                        <button onClick={() => removeField(idx)} className="w-6 h-6 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-500 flex items-center justify-center hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors">
                                            <X size={12} />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                                        <div>
                                            <label className={labelCls}>{t("labelField")} *</label>
                                            <input value={field.label} onChange={e => updateField(idx, "label", e.target.value)} placeholder={t("labelPlaceholder")} className={inputCls} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>{t("typeField")}</label>
                                            <select value={field.type} onChange={e => updateField(idx, "type", e.target.value)} className={inputCls}>
                                                {fieldTypes.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    {field.type === "select" && (
                                        <div className="mb-2.5">
                                            <label className={labelCls}>{t("optionsLabel")}</label>
                                            <input value={field.options} onChange={e => updateField(idx, "options", e.target.value)} placeholder={t("optionsPlaceholder")} className={inputCls} />
                                        </div>
                                    )}
                                    <div className="grid grid-cols-[1fr_auto] gap-2.5 items-end">
                                        <div>
                                            <label className={labelCls}>{t("mapToField")}</label>
                                            <select value={field.map_to.startsWith("metadata") ? "metadata" : field.map_to} onChange={e => updateField(idx, "map_to", e.target.value)} className={inputCls}>
                                                {mapToOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2 pb-1">
                                            <button
                                                onClick={() => updateField(idx, "required", !field.required)}
                                                className={cn(
                                                    "relative w-9 h-5 rounded-full transition-colors",
                                                    field.required ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600",
                                                )}
                                            >
                                                <div className={cn(
                                                    "w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all",
                                                    field.required ? "left-[18px]" : "left-[3px]",
                                                )} />
                                            </button>
                                            <span className="text-xs text-neutral-500 whitespace-nowrap">{t("required")}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button onClick={addField} className="flex items-center gap-1.5 mt-3.5 px-4 py-2.5 rounded-lg bg-transparent border border-dashed border-neutral-300 dark:border-neutral-600 text-indigo-500 text-[13px] font-semibold w-full justify-center hover:bg-indigo-50 dark:hover:bg-indigo-500/5 transition-colors">
                            <Plus size={14} /> {t("addField")}
                        </button>
                    </div>
                </div>

                {/* Preview */}
                <div className="sticky top-8 h-fit">
                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-5 py-4">
                        <div className="flex items-center gap-2 mb-4">
                            <Smartphone size={16} className="text-indigo-500" />
                            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("preview")}</span>
                        </div>
                        <div className="bg-[#0b141a] rounded-xl p-3.5 min-h-[300px]">
                            {config.greeting_message && (
                                <div className="bg-[#005c4b] rounded-[10px_10px_10px_0] px-3 py-2 mb-2 max-w-[85%]">
                                    <p className="text-[13px] text-[#e9edef] m-0 leading-snug">{config.greeting_message}</p>
                                    <span className="text-[10px] text-[#e9edef]/50 float-right mt-1">12:00</span>
                                </div>
                            )}
                            {config.fields.length > 0 ? config.fields.map((field, idx) => (
                                <div key={idx} className="mb-2">
                                    <div className="bg-[#005c4b] rounded-[10px_10px_10px_0] px-3 py-2 max-w-[85%] mb-1">
                                        <p className="text-[13px] text-[#e9edef] m-0">
                                            {field.label || `${t("fieldNumber", { number: idx + 1 })}`}
                                            {field.required && <span className="text-red-400"> *</span>}
                                        </p>
                                        {field.type === "select" && field.options && (
                                            <div className="mt-1.5">{field.options.split(",").map((opt, oi) => <div key={oi} className="text-xs text-[#e9edef]/70 py-0.5">{oi + 1}. {opt.trim()}</div>)}</div>
                                        )}
                                        <span className="text-[10px] text-[#e9edef]/50 float-right mt-1">12:{String(idx + 1).padStart(2, "0")}</span>
                                    </div>
                                    <div className="bg-[#1d282f] rounded-[10px_10px_0_10px] px-3 py-2 max-w-[70%] ml-auto">
                                        <p className="text-[13px] text-[#e9edef]/40 m-0 italic">
                                            {field.type === "email" ? t("exampleEmail") : field.type === "phone" ? t("examplePhone") : field.type === "select" ? (field.options.split(",")[0]?.trim() || "...") : t("clientResponse")}
                                        </p>
                                    </div>
                                </div>
                            )) : (
                                <div className="text-center py-10 px-5 text-[#e9edef]/30 text-[13px]">{t("previewEmpty")}</div>
                            )}
                        </div>
                        {!config.is_active && (
                            <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 text-center">
                                {t("formDisabled")}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
