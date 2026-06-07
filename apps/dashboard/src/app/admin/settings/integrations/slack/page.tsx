"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { Slack, Loader2, CheckCircle, Send } from "lucide-react";

interface SlackConfig {
    enabled: boolean;
    webhookUrl: string;
    events: { handoff: boolean; appointment: boolean };
}

const inputCls =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40";

export default function SlackSettingsPage() {
    const t = useTranslations("slackIntegration");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();

    const [cfg, setCfg] = useState<SlackConfig>({ enabled: false, webhookUrl: "", events: { handoff: true, appointment: true } });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res: any = await api.getSlackConfig(activeTenantId);
            if (res?.success && res.data) setCfg(res.data);
        } catch { /* noop */ }
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { load(); }, [load]);

    const flash = (ok: boolean, msg: string) => {
        setToast({ ok, msg });
        setTimeout(() => setToast(null), 3500);
    };

    const save = async () => {
        if (!activeTenantId || saving) return;
        setSaving(true);
        try {
            const res: any = await api.updateSlackConfig(activeTenantId, cfg);
            if (res?.success) { setCfg(res.data); flash(true, t("saved")); }
            else flash(false, res?.message || t("saveFailed"));
        } catch (e: any) {
            flash(false, e?.message || t("saveFailed"));
        }
        setSaving(false);
    };

    const sendTest = async () => {
        if (!activeTenantId || testing) return;
        setTesting(true);
        try {
            const res: any = await api.testSlack(activeTenantId);
            flash(!!res?.success, res?.success ? t("testSent") : (res?.message || t("testFailed")));
        } catch (e: any) {
            flash(false, e?.message || t("testFailed"));
        }
        setTesting(false);
    };

    return (
        <div className="max-w-2xl mx-auto p-6">
            <PageHeader icon={Slack} title={t("title")} subtitle={t("subtitle")} />

            <HelpPanel
                title={tHelp("settingsIntegrationsSlack.title")}
                description={tHelp("settingsIntegrationsSlack.description")}
                tips={tHelp.raw("settingsIntegrationsSlack.tips") as string[]}
                mediaKey="settingsIntegrationsSlack"
            />

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : (
                <div className="rounded-[14px] border border-border bg-card p-6 flex flex-col gap-5">
                    {/* Enable toggle */}
                    <label className="flex items-center justify-between cursor-pointer">
                        <div>
                            <div className="text-sm font-semibold text-foreground">{t("enable")}</div>
                            <div className="text-xs text-muted-foreground">{t("enableHint")}</div>
                        </div>
                        <input
                            type="checkbox"
                            checked={cfg.enabled}
                            onChange={e => setCfg({ ...cfg, enabled: e.target.checked })}
                            className="h-5 w-5 accent-indigo-500"
                        />
                    </label>

                    {/* Webhook URL */}
                    <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("webhookUrl")}</label>
                        <input
                            className={inputCls}
                            placeholder="https://hooks.slack.com/services/..."
                            value={cfg.webhookUrl}
                            onChange={e => setCfg({ ...cfg, webhookUrl: e.target.value })}
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">{t("webhookHint")}</p>
                    </div>

                    {/* Events */}
                    <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-2">{t("events")}</div>
                        <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                                <input type="checkbox" checked={cfg.events.handoff}
                                    onChange={e => setCfg({ ...cfg, events: { ...cfg.events, handoff: e.target.checked } })}
                                    className="h-4 w-4 accent-indigo-500" />
                                {t("eventHandoff")}
                            </label>
                            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                                <input type="checkbox" checked={cfg.events.appointment}
                                    onChange={e => setCfg({ ...cfg, events: { ...cfg.events, appointment: e.target.checked } })}
                                    className="h-4 w-4 accent-indigo-500" />
                                {t("eventAppointment")}
                            </label>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-2">
                        <button
                            onClick={save}
                            disabled={saving}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                            {tc("save")}
                        </button>
                        <button
                            onClick={sendTest}
                            disabled={testing || !cfg.webhookUrl}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                        >
                            {testing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                            {t("sendTest")}
                        </button>
                        {toast && (
                            <span className={`text-xs font-medium ${toast.ok ? "text-emerald-500" : "text-red-400"}`}>
                                {toast.msg}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
