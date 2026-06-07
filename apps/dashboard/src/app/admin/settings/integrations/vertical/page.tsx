"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { Plug, Loader2, CheckCircle2, RefreshCw, Trash2, Plug2, UtensilsCrossed, Dumbbell, Stethoscope } from "lucide-react";

type Provider = "toast" | "mindbody" | "cliniko";

interface Field { key: string; label: string; secret?: boolean; placeholder?: string }

const PROVIDERS: { key: Provider; icon: any; fields: Field[] }[] = [
    {
        key: "toast", icon: UtensilsCrossed, fields: [
            { key: "hostname", label: "Hostname", placeholder: "https://ws-api.toasttab.com" },
            { key: "clientId", label: "Client ID" },
            { key: "clientSecret", label: "Client Secret", secret: true },
            { key: "locationGuid", label: "Restaurant GUID" },
        ],
    },
    {
        key: "mindbody", icon: Dumbbell, fields: [
            { key: "apiKey", label: "API Key", secret: true },
            { key: "siteId", label: "Site ID" },
        ],
    },
    {
        key: "cliniko", icon: Stethoscope, fields: [
            { key: "apiKey", label: "API Key", secret: true },
            { key: "baseUrl", label: "Base URL (shard)", placeholder: "https://api.au1.cliniko.com/v1" },
            { key: "businessId", label: "Business ID" },
            { key: "practitionerId", label: "Practitioner ID" },
        ],
    },
];

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40";

export default function VerticalIntegrationsPage() {
    const t = useTranslations("verticalIntegrations");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();

    const [configs, setConfigs] = useState<Record<string, any>>({});
    const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string>("");
    const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res: any = await api.getVerticalIntegrations(activeTenantId);
            if (res?.success) setConfigs(res.data || {});
        } catch { /* noop */ }
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { load(); }, [load]);

    const flash = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 3500); };
    const setField = (p: Provider, key: string, val: string) =>
        setForms((f) => ({ ...f, [p]: { ...(f[p] || {}), [key]: val } }));

    const save = async (p: Provider) => {
        if (!activeTenantId) return;
        setBusy(`save:${p}`);
        try {
            const res: any = await api.updateVerticalIntegration(activeTenantId, p, forms[p] || {});
            if (res?.success) { flash(true, t("saved")); await load(); setForms((f) => ({ ...f, [p]: {} })); }
            else flash(false, t("saveFailed"));
        } catch (e: any) { flash(false, e?.message || t("saveFailed")); }
        setBusy("");
    };

    const test = async (p: Provider) => {
        if (!activeTenantId) return;
        setBusy(`test:${p}`);
        try {
            const res: any = await api.testVerticalIntegration(activeTenantId, p);
            const ok = res?.success && res.data?.ok;
            flash(!!ok, ok ? t("testOk") : `${t("testFailed")}${res?.data?.message ? `: ${res.data.message}` : ""}`);
        } catch (e: any) { flash(false, e?.message || t("testFailed")); }
        setBusy("");
    };

    const sync = async (p: Provider) => {
        if (!activeTenantId) return;
        setBusy(`sync:${p}`);
        try {
            const res: any = await api.syncVerticalIntegration(activeTenantId, p);
            if (res?.success) flash(true, t("syncedCount", { count: res.data?.synced ?? 0 }));
            else flash(false, t("syncFailed"));
        } catch (e: any) { flash(false, e?.message || t("syncFailed")); }
        setBusy("");
    };

    const disconnect = async (p: Provider) => {
        if (!activeTenantId) return;
        setBusy(`disc:${p}`);
        try {
            await api.disconnectVerticalIntegration(activeTenantId, p);
            flash(true, t("disconnected"));
            await load();
        } catch (e: any) { flash(false, e?.message || t("saveFailed")); }
        setBusy("");
    };

    return (
        <div className="max-w-3xl mx-auto p-6">
            <PageHeader icon={Plug} title={t("title")} subtitle={t("subtitle")} />

            <HelpPanel
                title={tHelp("settingsIntegrationsVertical.title")}
                description={tHelp("settingsIntegrationsVertical.description")}
                tips={tHelp.raw("settingsIntegrationsVertical.tips") as string[]}
                mediaKey="settingsIntegrationsVertical"
            />

            {toast && (
                <div className={cn("mb-4 text-sm font-medium", toast.ok ? "text-emerald-500" : "text-red-400")}>{toast.msg}</div>
            )}

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : (
                <div className="space-y-5">
                    {PROVIDERS.map(({ key, icon: Icon, fields }) => {
                        const connected = !!configs[key]?.connected;
                        const form = forms[key] || {};
                        return (
                            <div key={key} className="rounded-[14px] border border-border bg-card p-6">
                                <div className="flex items-center gap-3 mb-1">
                                    <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                                        <Icon size={20} className="text-orange-500" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-sm font-semibold text-foreground">{t(`provider_${key}`)}</h3>
                                            {connected && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 font-medium flex items-center gap-1">
                                                    <CheckCircle2 size={11} /> {t("connected")}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{t(`provider_${key}_desc`)}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                    {fields.map((f) => (
                                        <div key={f.key}>
                                            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{f.label}</label>
                                            <input
                                                type={f.secret ? "password" : "text"}
                                                className={inputCls}
                                                placeholder={f.secret && connected ? "••••••" : (f.placeholder || "")}
                                                value={form[f.key] ?? ""}
                                                onChange={(e) => setField(key, f.key, e.target.value)}
                                            />
                                        </div>
                                    ))}
                                </div>

                                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                                    <button onClick={() => save(key)} disabled={busy === `save:${key}`}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
                                        {busy === `save:${key}` ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} {t("save")}
                                    </button>
                                    {connected && (
                                        <>
                                            <button onClick={() => test(key)} disabled={busy === `test:${key}`}
                                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50">
                                                {busy === `test:${key}` ? <Loader2 size={15} className="animate-spin" /> : <Plug2 size={15} />} {t("test")}
                                            </button>
                                            <button onClick={() => sync(key)} disabled={busy === `sync:${key}`}
                                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50">
                                                {busy === `sync:${key}` ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {t("sync")}
                                            </button>
                                            <button onClick={() => disconnect(key)} disabled={busy === `disc:${key}`}
                                                className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-red-400 disabled:opacity-50">
                                                <Trash2 size={15} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
