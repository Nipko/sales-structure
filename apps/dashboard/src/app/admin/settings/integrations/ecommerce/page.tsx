"use client";

/**
 * Conectar la tienda (Shopify / WooCommerce).
 *
 * El editor de agente ya permitía ENCENDER las herramientas de e-commerce
 * (CapabilitiesSection) y no existía ninguna pantalla para poner la URL de la
 * tienda ni las credenciales: el dueño encendía un agente que consultaba un
 * catálogo permanentemente vacío. El backend expone GET/PUT /ecommerce/config
 * y POST /ecommerce/sync desde siempre; faltaba la puerta.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { ShoppingBag, Save, Loader2, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";

type Provider = "shopify" | "woocommerce";

interface Config {
    provider: Provider;
    shopUrl: string;
    apiKey: string;
    apiSecret: string;
    accessToken?: string;
    syncProducts: boolean;
}

const EMPTY: Config = {
    provider: "shopify",
    shopUrl: "",
    apiKey: "",
    apiSecret: "",
    accessToken: "",
    syncProducts: true,
};

export default function EcommerceIntegrationPage() {
    const t = useTranslations("ecommerceIntegration");
    const tc = useTranslations("common");

    const [form, setForm] = useState<Config>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
    const [productCount, setProductCount] = useState<number | null>(null);

    async function load() {
        setLoading(true);
        const [cfg, prods] = await Promise.all([
            api.fetch("/ecommerce/config").catch(() => null),
            api.fetch("/ecommerce/products?limit=1").catch(() => null),
        ]);
        if (cfg?.data) setForm({ ...EMPTY, ...cfg.data });
        // Cuántos productos hay de verdad: es la única prueba de que la
        // conexión sirve para algo, y es lo que el agente va a poder mostrar.
        if (prods?.data) setProductCount((prods.data as any).total ?? (prods.data as any).products?.length ?? null);
        setLoading(false);
    }

    useEffect(() => { load(); }, []);

    async function handleSave() {
        if (!form.shopUrl.trim()) {
            setFeedback({ type: "err", text: t("missingShopUrl") });
            return;
        }
        setSaving(true);
        setFeedback(null);
        const res = await api.fetch("/ecommerce/config", {
            method: "PUT",
            body: JSON.stringify(form),
        }).catch(() => null);
        setSaving(false);
        setFeedback(res?.success
            ? { type: "ok", text: tc("saved") }
            : { type: "err", text: tc("errorSaving") });
        if (res?.success) load();
    }

    async function handleSync() {
        setSyncing(true);
        setFeedback(null);
        const res = await api.fetch("/ecommerce/sync", { method: "POST" }).catch(() => null);
        setSyncing(false);
        setFeedback(res?.success
            ? { type: "ok", text: t("syncDone", { count: (res.data as any)?.synced ?? 0 }) }
            : { type: "err", text: t("syncFailed") });
        if (res?.success) load();
    }

    if (loading) {
        return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    }

    const isShopify = form.provider === "shopify";

    return (
        <div className="max-w-2xl space-y-6">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={ShoppingBag} />

            {feedback && (
                <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border ${feedback.type === "ok"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                    : "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20"}`}>
                    {feedback.type === "ok" ? <CheckCircle className="h-4 w-4 mt-0.5" /> : <AlertTriangle className="h-4 w-4 mt-0.5" />}
                    <span>{feedback.text}</span>
                </div>
            )}

            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <div>
                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("provider")}</label>
                    <select
                        value={form.provider}
                        onChange={e => setForm({ ...form, provider: e.target.value as Provider })}
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm cursor-pointer"
                    >
                        <option value="shopify">Shopify</option>
                        <option value="woocommerce">WooCommerce</option>
                    </select>
                </div>

                <div>
                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("shopUrl")}</label>
                    <input
                        value={form.shopUrl}
                        onChange={e => setForm({ ...form, shopUrl: e.target.value })}
                        placeholder={isShopify ? "mitienda.myshopify.com" : "https://mitienda.com"}
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                    />
                </div>

                {isShopify ? (
                    <div>
                        <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("accessToken")}</label>
                        <input
                            type="password"
                            value={form.accessToken || ""}
                            onChange={e => setForm({ ...form, accessToken: e.target.value })}
                            placeholder="shpat_..."
                            className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">{t("accessTokenHint")}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("apiKey")}</label>
                            <input
                                value={form.apiKey}
                                onChange={e => setForm({ ...form, apiKey: e.target.value })}
                                placeholder="ck_..."
                                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("apiSecret")}</label>
                            <input
                                type="password"
                                value={form.apiSecret}
                                onChange={e => setForm({ ...form, apiSecret: e.target.value })}
                                placeholder="cs_..."
                                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                            />
                        </div>
                    </div>
                )}

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                        type="checkbox"
                        checked={form.syncProducts}
                        onChange={e => setForm({ ...form, syncProducts: e.target.checked })}
                        className="cursor-pointer"
                    />
                    {t("syncProducts")}
                </label>

                <div className="flex items-center justify-between pt-2 border-t border-border">
                    {/* La cuenta de productos es la única prueba de que la conexión
                        sirve: sin productos, el agente no tiene qué mostrar por
                        más que la herramienta esté encendida. */}
                    <span className="text-xs text-muted-foreground">
                        {productCount === null ? t("neverSynced") : t("productsSynced", { count: productCount })}
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={handleSync}
                            disabled={syncing || !form.shopUrl}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-40 transition-colors cursor-pointer"
                        >
                            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            {t("syncNow")}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors cursor-pointer"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            {tc("save")}
                        </button>
                    </div>
                </div>
            </div>

            <p className="text-xs text-muted-foreground">{t("footnote")}</p>
        </div>
    );
}
