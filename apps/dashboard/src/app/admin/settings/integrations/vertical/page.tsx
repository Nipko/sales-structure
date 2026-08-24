"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import {
    Plug, Loader2, CheckCircle2, RefreshCw, Trash2, Plug2,
    UtensilsCrossed, Dumbbell, Stethoscope, AlertTriangle, Building2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { resolveVerticalCapabilityManifest } from "@parallext/shared";
import { IntegrationHealthPanel } from "./_components/IntegrationHealthPanel";

type Provider = "toast" | "mindbody" | "cliniko";

/**
 * De que rubro es cada proveedor.
 *
 * La pagina listaba los tres a todo el mundo: una peluqueria veia "Toast (POS
 * de restaurante)" y "Cliniko (salud)" como cosas que podria conectar. Ofrecer
 * lo que no aplica no es neutral - le ensena al dueno que la pantalla no sabe
 * que negocio tiene, y entonces tampoco confia en lo que si le muestra.
 *
 * El grupo de tools sale del manifiesto, que es la misma fuente que decide que
 * puede hacer el agente. Si manana un subtipo nuevo gana `restaurants`, Toast
 * aparece solo.
 */
const PROVIDER_TOOL_GROUP: Record<Provider, string> = {
    toast: "restaurants",
    mindbody: "gyms",
    cliniko: "treatments",
};

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
    const tChannelManager = useTranslations("channelManager");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();
    const { verticalConfig } = useAuth();

    // Los grupos de tools que el rubro del tenant concede. Sin config resuelta
    // no se filtra: esconder integraciones por no saber el rubro seria peor que
    // mostrar una de mas.
    const tenantToolGroups = (() => {
        const industry = verticalConfig?.industry;
        if (!industry) return null;
        try {
            return new Set(
                resolveVerticalCapabilityManifest(industry, verticalConfig?.subType).toolGroups as string[],
            );
        } catch {
            return null;
        }
    })();

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
            // Probar es lo que ACTUALIZA la salud: sin recargar, el panel
            // seguia mostrando el estado anterior a la prueba recien hecha.
            await load();
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

            {/* Decir la verdad sobre el estado de esto.
                Las cuatro integraciones verticales son de SOLO LECTURA, se
                congelaron en agosto de 2026 (no se les construye escritura) y
                nunca se probaron contra una cuenta real porque no hay
                credenciales. Presentarlas al mismo nivel que WhatsApp o Google
                Calendar era prometer algo que no está verificado — y el dueño se
                entera recién cuando conecta y no funciona. */}
            <div className="mb-5 flex items-start gap-2 p-3 rounded-lg text-[13px] border bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/20">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{t("betaNotice")}</span>
            </div>

            {verticalConfig?.industry === "turismo"
                && ["hotel", "alquiler_vacacional"].includes(verticalConfig?.subType || "") && (
                <Link href="/admin/settings/integrations/channel-manager"
                    className="mb-5 flex items-center gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-sm hover:bg-indigo-500/15">
                    <Building2 className="h-5 w-5 shrink-0 text-indigo-500" />
                    <span className="flex-1">
                        <strong className="block text-foreground">{tChannelManager("title")}</strong>
                        <span className="text-muted-foreground">{tChannelManager("entryDescription")}</span>
                    </span>
                </Link>
            )}

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
                    {PROVIDERS.filter(({ key }) => {
                        // Lo ya configurado se muestra SIEMPRE, aunque el rubro
                        // haya cambiado despues: si no, un tenant que migro de
                        // vertical pierde el boton de desconectar y la
                        // credencial queda viva sin pantalla que la administre.
                        if (configs[key]?.configured) return true;
                        if (!tenantToolGroups) return true;
                        return tenantToolGroups.has(PROVIDER_TOOL_GROUP[key]);
                    }).map(({ key, icon: Icon, fields }) => {
                        const connected = !!configs[key]?.connected;
                        // Hay credencial guardada. NO significa que funcione:
                        // esa es la distincion que faltaba y que dejaba el
                        // boton "Probar" detras de haber probado.
                        const configured = !!configs[key]?.configured;
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
                                                placeholder={f.secret && configured ? "••••••" : (f.placeholder || "")}
                                                value={form[f.key] ?? ""}
                                                onChange={(e) => setField(key, f.key, e.target.value)}
                                            />
                                        </div>
                                    ))}
                                </div>

                                {configured && <IntegrationHealthPanel health={configs[key]?.health} />}

                                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                                    <button onClick={() => save(key)} disabled={busy === `save:${key}`}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
                                        {busy === `save:${key}` ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} {t("save")}
                                    </button>
                                    {configured && (
                                        <>
                                            <button onClick={() => test(key)} disabled={busy === `test:${key}`}
                                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50">
                                                {busy === `test:${key}` ? <Loader2 size={15} className="animate-spin" /> : <Plug2 size={15} />} {t("test")}
                                            </button>
                                            {/* Sincronizar antes de validar solo
                                                produce un error del proveedor;
                                                el camino es Probar y despues
                                                Sincronizar. */}
                                            <button onClick={() => sync(key)} disabled={busy === `sync:${key}` || !connected}
                                                title={connected ? undefined : t("testFirst")}
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
