"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RefreshCw, Save, CheckCircle, AlertTriangle, Info } from "lucide-react";

interface NurturingConfig {
    enabled: boolean;
    maxAttempts: number;
    delays: number[];
    allowedChannels: string[];
    finalAction: "mark_not_interested" | "create_task";
    whatsappTemplateName?: string;
    maxPerDay: number;
}

const CHANNEL_OPTIONS = [
    { key: "whatsapp", label: "WhatsApp", color: "bg-green-500" },
    { key: "instagram", label: "Instagram", color: "bg-pink-500" },
    { key: "messenger", label: "Messenger", color: "bg-blue-500" },
    { key: "telegram", label: "Telegram", color: "bg-sky-500" },
    { key: "sms", label: "SMS", color: "bg-purple-500" },
];

export default function NurturingSettingsPage() {
    const t = useTranslations("settings.nurturingPage");
    const tc = useTranslations("common");
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [config, setConfig] = useState<NurturingConfig>({
        enabled: false,
        maxAttempts: 3,
        delays: [14400, 86400, 259200],
        allowedChannels: ["whatsapp"],
        finalAction: "create_task",
        whatsappTemplateName: "",
        maxPerDay: 1,
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);

    const tenantId = activeTenantId || user?.tenantId;

    useEffect(() => {
        async function load() {
            if (!tenantId) return;
            const result = await api.getNurturingConfig(tenantId);
            if (result.success && result.data) {
                setConfig(result.data);
            }
            setLoading(false);
        }
        load();
    }, [tenantId]);

    const handleSave = async () => {
        if (!tenantId) return;
        setSaving(true);
        const result = await api.updateNurturingConfig(tenantId, config);
        if (result.success) {
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        }
        setSaving(false);
    };

    const toggleChannel = (channel: string) => {
        setConfig(prev => {
            const channels = prev.allowedChannels.includes(channel)
                ? prev.allowedChannels.filter(c => c !== channel)
                : [...prev.allowedChannels, channel];
            return { ...prev, allowedChannels: channels };
        });
        setSaved(false);
    };

    const setDelay = (index: number, hours: number) => {
        setConfig(prev => {
            const delays = [...prev.delays];
            delays[index] = hours * 3600;
            return { ...prev, delays };
        });
        setSaved(false);
    };

    if (loading) {
        return (
            <div className="max-w-2xl space-y-6 animate-pulse">
                <div className="h-8 w-48 rounded bg-neutral-200 dark:bg-neutral-800" />
                <div className="h-40 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
            </div>
        );
    }

    return (
        <div className="max-w-2xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                        {t("title")}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        {t("description")}
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
                    {saving ? tc("saving") : saved ? tc("saved") : tc("save")}
                </button>
            </div>

            {/* Warning banner */}
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <div>
                    <p className="font-medium">{t("warning")}</p>
                    <p className="mt-1 text-xs opacity-80">{t("warningDetail")}</p>
                </div>
            </div>

            {/* Enable/Disable toggle */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                            <RefreshCw size={20} className="text-amber-500" />
                        </div>
                        <div>
                            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                {t("enableLabel")}
                            </div>
                            <div className="text-xs text-neutral-500 dark:text-neutral-400">
                                {t("enableDesc")}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => { setConfig(p => ({ ...p, enabled: !p.enabled })); setSaved(false); }}
                        className={cn(
                            "relative h-6 w-11 rounded-full transition-colors",
                            config.enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"
                        )}
                    >
                        <span className={cn(
                            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform shadow-sm",
                            config.enabled && "translate-x-5"
                        )} />
                    </button>
                </div>
            </div>

            {config.enabled && (
                <>
                    {/* Allowed Channels */}
                    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                            {t("channelsTitle")}
                        </h3>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
                            {t("channelsDesc")}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {CHANNEL_OPTIONS.map(ch => (
                                <button
                                    key={ch.key}
                                    onClick={() => toggleChannel(ch.key)}
                                    className={cn(
                                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all",
                                        config.allowedChannels.includes(ch.key)
                                            ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
                                            : "border-neutral-200 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
                                    )}
                                >
                                    <span className={cn("h-2.5 w-2.5 rounded-full", ch.color)} />
                                    {ch.label}
                                </button>
                            ))}
                        </div>
                        <div className="mt-3 flex items-start gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                            <Info size={14} className="shrink-0 mt-0.5" />
                            {t("channelsNote")}
                        </div>
                    </div>

                    {/* 24h Window Explanation */}
                    <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                        <Info size={18} className="shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium">{t("windowRuleTitle")}</p>
                            <ul className="mt-1 text-xs opacity-80 space-y-1 list-disc list-inside">
                                <li>{t("windowRuleWa")}</li>
                                <li>{t("windowRuleIgFb")}</li>
                                <li>{t("windowRuleLimit")}</li>
                            </ul>
                        </div>
                    </div>

                    {/* WhatsApp Template config */}
                    {config.allowedChannels.includes("whatsapp") && (
                        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                                {t("waTemplateTitle")}
                            </h3>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
                                {t("waTemplateDesc")}
                            </p>
                            <input
                                type="text"
                                value={config.whatsappTemplateName || ""}
                                onChange={e => { setConfig(p => ({ ...p, whatsappTemplateName: e.target.value })); setSaved(false); }}
                                placeholder={t("waTemplatePlaceholder")}
                                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                            />
                            <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                                {t("waTemplateHint")}
                            </p>
                        </div>
                    )}

                    {/* Frequency / Delays */}
                    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                            {t("frequencyTitle")}
                        </h3>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
                            {t("frequencyDesc")}
                        </p>
                        <div className="space-y-3">
                            {[0, 1, 2].slice(0, config.maxAttempts).map(i => (
                                <div key={i} className="flex items-center gap-3">
                                    <span className="w-24 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                                        {t("attempt")} {i + 1}:
                                    </span>
                                    <select
                                        value={Math.round((config.delays[i] || 14400) / 3600)}
                                        onChange={e => setDelay(i, Number(e.target.value))}
                                        className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                                    >
                                        <option value={2}>2 {t("hours")}</option>
                                        <option value={4}>4 {t("hours")}</option>
                                        <option value={8}>8 {t("hours")}</option>
                                        <option value={12}>12 {t("hours")}</option>
                                        <option value={24}>24 {t("hours")}</option>
                                        <option value={48}>48 {t("hours")}</option>
                                        <option value={72}>72 {t("hours")}</option>
                                    </select>
                                    <span className="text-xs text-neutral-400">
                                        {i === 0 ? t("afterLastMessage") : t("afterPrevious")}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Max Attempts */}
                    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                            {t("attemptsTitle")}
                        </h3>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
                            {t("attemptsDesc")}
                        </p>
                        <div className="flex items-center gap-3">
                            <select
                                value={config.maxAttempts}
                                onChange={e => { setConfig(p => ({ ...p, maxAttempts: Number(e.target.value) })); setSaved(false); }}
                                className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                            >
                                <option value={1}>1</option>
                                <option value={2}>2</option>
                                <option value={3}>3</option>
                            </select>
                            <span className="text-sm text-neutral-500 dark:text-neutral-400">
                                {t("maxFollowUps")}
                            </span>
                        </div>
                    </div>

                    {/* Final Action */}
                    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                            {t("finalActionTitle")}
                        </h3>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
                            {t("finalActionDesc")}
                        </p>
                        <div className="flex flex-col gap-2">
                            <label className={cn(
                                "flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-all",
                                config.finalAction === "create_task"
                                    ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10"
                                    : "border-neutral-200 dark:border-neutral-700"
                            )}>
                                <input
                                    type="radio"
                                    name="finalAction"
                                    value="create_task"
                                    checked={config.finalAction === "create_task"}
                                    onChange={() => { setConfig(p => ({ ...p, finalAction: "create_task" })); setSaved(false); }}
                                    className="accent-indigo-600"
                                />
                                <div>
                                    <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t("actionCreateTask")}</div>
                                    <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("actionCreateTaskDesc")}</div>
                                </div>
                            </label>
                            <label className={cn(
                                "flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-all",
                                config.finalAction === "mark_not_interested"
                                    ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10"
                                    : "border-neutral-200 dark:border-neutral-700"
                            )}>
                                <input
                                    type="radio"
                                    name="finalAction"
                                    value="mark_not_interested"
                                    checked={config.finalAction === "mark_not_interested"}
                                    onChange={() => { setConfig(p => ({ ...p, finalAction: "mark_not_interested" })); setSaved(false); }}
                                    className="accent-indigo-600"
                                />
                                <div>
                                    <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t("actionMarkLost")}</div>
                                    <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("actionMarkLostDesc")}</div>
                                </div>
                            </label>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
