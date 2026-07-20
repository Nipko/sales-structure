"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { MessageSquare, Loader2, CheckCircle } from "lucide-react";

interface SmsNotificationsConfig {
    enabled: boolean;
    events: { handoff: boolean };
}

export default function SmsNotificationsSettingsPage() {
    const t = useTranslations("smsNotificationsIntegration");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [cfg, setCfg] = useState<SmsNotificationsConfig>({ enabled: false, events: { handoff: true } });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res: any = await api.getSmsNotificationsConfig(activeTenantId);
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
            const res: any = await api.updateSmsNotificationsConfig(activeTenantId, cfg);
            if (res?.success) { setCfg(res.data); flash(true, t("saved")); }
            else flash(false, res?.message || t("saveFailed"));
        } catch (e: any) {
            flash(false, e?.message || t("saveFailed"));
        }
        setSaving(false);
    };

    return (
        <div className="max-w-2xl mx-auto p-6">
            <PageHeader icon={MessageSquare} title={t("title")} subtitle={t("subtitle")} />

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
                        </div>
                    </div>

                    <p className="text-[11px] text-muted-foreground">{t("channelHint")}</p>
                    <p className="text-[11px] text-muted-foreground">{t("planHint")}</p>

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
