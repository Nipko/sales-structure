"use client";

import { SkeletonPage } from "@/components/ui/skeleton-loader";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    RotateCcw, Save, Loader2, MessageSquare, CheckCircle, AlertCircle, Send,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

const CHANNEL_OPTIONS = [
    { value: "whatsapp", label: "WhatsApp" },
    { value: "instagram", label: "Instagram DM" },
    { value: "messenger", label: "Messenger" },
    { value: "telegram", label: "Telegram" },
    { value: "sms", label: "SMS" },
];

export default function RecallSettingsPage() {
    const t = useTranslations("settings.recall");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const tenantId = activeTenantId || user?.tenantId;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

    const [form, setForm] = useState({
        enabled: false,
        daysThreshold: 180,
        cooldownDays: 90,
        channelType: "whatsapp",
        message:
            "Hola {name}, ya pasaron {months} meses desde tu última visita. ¿Quieres agendar tu cita de control?",
    });

    const fetchConfig = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const res = await api.getRecallConfig(tenantId);
            if (res.success && res.data) {
                setForm({
                    enabled: !!res.data.enabled,
                    daysThreshold: Number(res.data.daysThreshold ?? 180),
                    cooldownDays: Number(res.data.cooldownDays ?? 90),
                    channelType: res.data.channelType || "whatsapp",
                    message: res.data.message || form.message,
                });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId]);

    useEffect(() => { fetchConfig(); }, [fetchConfig]);

    const handleSave = async () => {
        if (!tenantId) return;
        if (form.daysThreshold < 1 || form.cooldownDays < 1) {
            setFeedback({ type: "error", text: t("invalidDays") });
            return;
        }
        if (!form.message.trim()) {
            setFeedback({ type: "error", text: t("messageRequired") });
            return;
        }
        setSaving(true);
        setFeedback(null);
        try {
            const res = await api.updateRecallConfig(tenantId, form);
            if (res.success) {
                setFeedback({ type: "success", text: t("savedSuccess") });
            } else {
                setFeedback({ type: "error", text: res.error || tc("connectionError") });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setSaving(false);
        }
    };

    const handleRunNow = async () => {
        if (!tenantId) return;
        if (!form.enabled) {
            setFeedback({ type: "error", text: t("enableFirst") });
            return;
        }
        setRunning(true);
        setFeedback(null);
        try {
            const res = await api.runRecallNow(tenantId);
            if (res.success) {
                const sent = res.data?.sent ?? 0;
                setFeedback({
                    type: sent > 0 ? "success" : "info",
                    text: t("runResult", { count: sent }),
                });
            } else {
                setFeedback({ type: "error", text: res.error || tc("connectionError") });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setRunning(false);
        }
    };

    if (loading) return <SkeletonPage />;

    return (
        <div className="max-w-3xl mx-auto p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-semibold flex items-center gap-2">
                    <RotateCcw className="h-6 w-6 text-indigo-500" />
                    {t("title")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>
            </div>

            <HelpPanel
                title={tHelp("settingsRecall.title")}
                description={tHelp("settingsRecall.description")}
                tips={tHelp.raw("settingsRecall.tips") as string[]}
                mediaKey="settingsRecall"
            />

            {feedback && (
                <div
                    className={
                        feedback.type === "error"
                            ? "p-4 rounded-xl text-sm border bg-[rgba(255,71,87,0.1)] text-[var(--danger)] border-[rgba(255,71,87,0.2)] flex items-start gap-2"
                            : feedback.type === "info"
                            ? "p-4 rounded-xl text-sm border bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 flex items-start gap-2"
                            : "p-4 rounded-xl text-sm border bg-[rgba(0,214,143,0.1)] text-[var(--success)] border-[rgba(0,214,143,0.2)] flex items-start gap-2"
                    }
                >
                    {feedback.type === "error" ? <AlertCircle className="h-4 w-4 mt-0.5" /> : <CheckCircle className="h-4 w-4 mt-0.5" />}
                    <span>{feedback.text}</span>
                </div>
            )}

            <div className="bg-card border border-border rounded-xl p-6 space-y-5">
                {/* Enabled toggle */}
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="font-medium">{t("enabledLabel")}</div>
                        <div className="text-sm text-muted-foreground mt-0.5">{t("enabledHelp")}</div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setForm({ ...form, enabled: !form.enabled })}
                        className={
                            form.enabled
                                ? "relative inline-flex h-6 w-11 items-center rounded-full bg-indigo-600 transition"
                                : "relative inline-flex h-6 w-11 items-center rounded-full bg-neutral-300 dark:bg-neutral-700 transition"
                        }
                        aria-pressed={form.enabled}
                    >
                        <span
                            className={
                                form.enabled
                                    ? "inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-6"
                                    : "inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-1"
                            }
                        />
                    </button>
                </div>

                {/* Threshold + cooldown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("daysThresholdLabel")}</label>
                        <input
                            type="number"
                            min={1}
                            value={form.daysThreshold}
                            onChange={(e) => setForm({ ...form, daysThreshold: parseInt(e.target.value || "0", 10) })}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2"
                        />
                        <p className="text-xs text-muted-foreground mt-1">{t("daysThresholdHelp")}</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("cooldownDaysLabel")}</label>
                        <input
                            type="number"
                            min={1}
                            value={form.cooldownDays}
                            onChange={(e) => setForm({ ...form, cooldownDays: parseInt(e.target.value || "0", 10) })}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2"
                        />
                        <p className="text-xs text-muted-foreground mt-1">{t("cooldownDaysHelp")}</p>
                    </div>
                </div>

                {/* Channel */}
                <div>
                    <label className="block text-sm font-medium mb-1">{t("channelLabel")}</label>
                    <select
                        value={form.channelType}
                        onChange={(e) => setForm({ ...form, channelType: e.target.value })}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2"
                    >
                        {CHANNEL_OPTIONS.map(c => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">{t("channelHelp")}</p>
                </div>

                {/* Message */}
                <div>
                    <label className="block text-sm font-medium mb-1 flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        {t("messageLabel")}
                    </label>
                    <textarea
                        value={form.message}
                        onChange={(e) => setForm({ ...form, message: e.target.value })}
                        rows={4}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                        {t("messageHelp")}{" "}
                        <code className="px-1 py-0.5 bg-muted rounded">{"{name}"}</code>{" · "}
                        <code className="px-1 py-0.5 bg-muted rounded">{"{months}"}</code>
                    </p>
                </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-3">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t("save")}
                </button>
                <button
                    onClick={handleRunNow}
                    disabled={running || !form.enabled}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition"
                    title={form.enabled ? "" : t("enableFirst")}
                >
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {t("runNow")}
                </button>
            </div>

            <div className="text-xs text-muted-foreground border-t border-border pt-4">
                <p className="font-medium mb-1">{t("scheduleTitle")}</p>
                <p>{t("scheduleDesc")}</p>
            </div>
        </div>
    );
}
