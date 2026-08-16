"use client";

/**
 * Conectar la cuenta de MercadoPago del NEGOCIO, para cobrarle a sus clientes.
 *
 * No confundir con Configuración → Billing, que es lo que el negocio nos paga a
 * nosotros. Acá es al revés: la seña de una cita, el anticipo de un tour, la
 * matrícula de un curso, el pedido de un restaurante.
 *
 * El dinero va DIRECTO a la cuenta del tenant — la plataforma no queda en el
 * medio ni cobra comisión por transacción. Se dice explícitamente en la
 * pantalla porque es lo primero que alguien se pregunta al pegar un token de
 * pagos en un sistema de terceros.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api, type TenantPaymentsConfig } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { CreditCard, Save, Loader2, CheckCircle2, AlertTriangle, Unplug } from "lucide-react";

export default function TenantPaymentsPage() {
    const t = useTranslations("tenantPayments");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [cfg, setCfg] = useState<TenantPaymentsConfig>({ connected: false });
    const [accessToken, setAccessToken] = useState("");
    const [publicKey, setPublicKey] = useState("");
    const [webhookSecret, setWebhookSecret] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        const res = await api.getTenantPaymentsConfig(activeTenantId).catch(() => null);
        if (res?.success) {
            setCfg(res.data ?? { connected: false });
            setPublicKey(res.data?.publicKey || "");
        }
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { void load(); }, [load]);

    async function handleSave() {
        if (!activeTenantId) return;
        setSaving(true);
        setFeedback(null);
        const res = await api.setTenantPaymentsConfig(activeTenantId, {
            // Sólo se manda el token si el dueño escribió uno nuevo: si no, el
            // backend conserva el que ya tiene guardado y cifrado.
            ...(accessToken ? { accessToken } : {}),
            ...(webhookSecret ? { webhookSecret } : {}),
            publicKey: publicKey || undefined,
        }).catch((e: any) => ({ success: false, error: e?.message }));
        setSaving(false);
        if ((res as any)?.success) {
            setAccessToken("");
            setWebhookSecret("");
            setFeedback({ ok: true, text: t("saved") });
            load();
        } else {
            // El backend verifica el token contra MercadoPago antes de guardarlo,
            // así que este mensaje distingue "credencial mal pegada" de "no se
            // pudo guardar" — que es la diferencia entre saber qué corregir y no.
            setFeedback({ ok: false, text: (res as any)?.error || t("invalidCredentials") });
        }
    }

    async function handleDisconnect() {
        if (!activeTenantId) return;
        if (!confirm(t("disconnectConfirm"))) return;
        await api.disconnectTenantPayments(activeTenantId).catch(() => null);
        setAccessToken("");
        setWebhookSecret("");
        load();
    }

    if (loading) {
        return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <div className="max-w-2xl space-y-6">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={CreditCard} />

            <div className="flex items-start gap-2 p-3 rounded-lg text-[13px] border bg-sky-500/10 text-sky-800 dark:text-sky-200 border-sky-500/20">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{t("directNotice")}</span>
            </div>

            {feedback && (
                <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border ${feedback.ok
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                    : "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20"}`}>
                    {feedback.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <AlertTriangle className="h-4 w-4 mt-0.5" />}
                    <span>{feedback.text}</span>
                </div>
            )}

            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                {cfg.connected && (
                    <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        {cfg.accountEmail ? t("connectedAs", { email: cfg.accountEmail }) : t("connected")}
                    </div>
                )}

                <div>
                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("accessToken")}</label>
                    <input
                        type="password"
                        value={accessToken}
                        onChange={e => setAccessToken(e.target.value)}
                        placeholder={cfg.connected ? "••••••••••••" : "APP_USR-..."}
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">{t("accessTokenHint")}</p>
                </div>

                <div>
                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("webhookSecret")}</label>
                    <input
                        type="password"
                        value={webhookSecret}
                        onChange={e => setWebhookSecret(e.target.value)}
                        placeholder={cfg.webhookConfigured ? "••••••••••••" : t("webhookSecretPlaceholder")}
                        autoComplete="new-password"
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">{t("webhookSecretHint")}</p>
                </div>

                <div>
                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("publicKey")}</label>
                    <input
                        value={publicKey}
                        onChange={e => setPublicKey(e.target.value)}
                        placeholder="APP_USR-..."
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                    />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border">
                    {cfg.connected ? (
                        <button
                            onClick={handleDisconnect}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted cursor-pointer transition-colors text-red-600 dark:text-red-400"
                        >
                            <Unplug className="h-4 w-4" /> {t("disconnect")}
                        </button>
                    ) : <span />}
                    <button
                        onClick={handleSave}
                        disabled={saving
                            || (!cfg.connected && !accessToken)
                            || (!cfg.webhookConfigured && !webhookSecret)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors cursor-pointer"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </div>

            <div className="space-y-1 text-xs text-muted-foreground">
                <p>{t("footnote")}</p>
                <p>{t("scopeNotice")}</p>
            </div>
        </div>
    );
}
