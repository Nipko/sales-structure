"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Building2, CheckCircle2, Loader2, RefreshCw, Save } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";

type Config = {
    provider: "hostaway" | "direct";
    accountId: string;
    apiSecret: string;
    syncInterval: number;
    autoBlock: boolean;
};

type Mapping = {
    listing_id: string;
    listing_name: string;
    external_id: string;
    provider: string;
    property_id: string | null;
    property_name: string | null;
    last_synced_at?: string | null;
};

const EMPTY: Config = {
    provider: "hostaway",
    accountId: "",
    apiSecret: "",
    syncInterval: 60,
    autoBlock: true,
};

export default function ChannelManagerPage() {
    const t = useTranslations("channelManager");
    const { activeTenantId } = useTenant();
    const [form, setForm] = useState<Config>(EMPTY);
    const [hasSecret, setHasSecret] = useState(false);
    const [mappings, setMappings] = useState<Mapping[]>([]);
    const [properties, setProperties] = useState<Array<{ id: string; name: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<"save" | "sync" | string>("");
    const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const [cfg, map, props]: any[] = await Promise.all([
                api.getChannelManagerConfig(),
                api.listChannelManagerMappings(),
                api.listProperties(activeTenantId),
            ]);
            if (cfg?.data) {
                setForm({
                    ...EMPTY,
                    ...cfg.data,
                    provider: cfg.data.provider === "direct" ? "direct" : "hostaway",
                    apiSecret: "",
                });
                setHasSecret(!!cfg.data.apiSecret);
            }
            setMappings(Array.isArray(map?.data) ? map.data : []);
            setProperties(Array.isArray(props?.data) ? props.data : []);
        } catch (error: any) {
            setFeedback({ ok: false, text: error?.message || t("loadFailed") });
        } finally {
            setLoading(false);
        }
    }, [activeTenantId, t]);

    useEffect(() => { void load(); }, [load]);

    const unmapped = useMemo(() => mappings.filter((row) => !row.property_id), [mappings]);

    async function save() {
        setBusy("save");
        setFeedback(null);
        try {
            const payload: Record<string, unknown> = {
                provider: form.provider,
                accountId: form.accountId.trim(),
                syncInterval: Number(form.syncInterval),
                autoBlock: form.autoBlock,
            };
            if (form.apiSecret.trim()) payload.apiSecret = form.apiSecret.trim();
            const result: any = await api.updateChannelManagerConfig(payload);
            if (!result?.success) throw new Error(t("saveFailed"));
            setFeedback({ ok: true, text: t("saved") });
            await load();
        } catch (error: any) {
            setFeedback({ ok: false, text: error?.message || t("saveFailed") });
        } finally {
            setBusy("");
        }
    }

    async function sync() {
        setBusy("sync");
        setFeedback(null);
        try {
            const result: any = await api.syncHostaway();
            if (!result?.success) throw new Error(t("syncFailed"));
            setFeedback({
                ok: true,
                text: t("synced", {
                    listings: result.data?.listings ?? 0,
                    reservations: result.data?.reservations ?? 0,
                }),
            });
            await load();
        } catch (error: any) {
            setFeedback({ ok: false, text: error?.message || t("syncFailed") });
        } finally {
            setBusy("");
        }
    }

    async function testConnection() {
        setBusy("test");
        setFeedback(null);
        try {
            const result: any = await api.testHostaway();
            if (!result?.success || !result?.data?.ok) throw new Error(t("testFailed"));
            setFeedback({ ok: true, text: t("testOk") });
        } catch (error: any) {
            setFeedback({ ok: false, text: error?.message || t("testFailed") });
        } finally {
            setBusy("");
        }
    }

    async function mapListing(listingId: string, propertyId: string | null) {
        setBusy(`map:${listingId}`);
        setFeedback(null);
        try {
            const result: any = await api.mapChannelManagerListing(listingId, propertyId);
            if (!result?.success) throw new Error(t("mappingFailed"));
            setFeedback({ ok: true, text: t("mappingSaved") });
            await load();
        } catch (error: any) {
            setFeedback({ ok: false, text: error?.message || t("mappingFailed") });
        } finally {
            setBusy("");
        }
    }

    if (!activeTenantId || loading) {
        return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <div className="max-w-4xl space-y-6">
            <PageHeader icon={Building2} title={t("title")} subtitle={t("subtitle")} />

            <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t("writeWarning")}</span>
            </div>

            {feedback && (
                <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${feedback.ok
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"}`}>
                    {feedback.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertTriangle className="mt-0.5 h-4 w-4" />}
                    <span>{feedback.text}</span>
                </div>
            )}

            <section className="space-y-4 rounded-xl border border-border bg-card p-5">
                <h2 className="font-semibold">{t("connection")}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5 text-sm">
                        <span className="text-muted-foreground">{t("provider")}</span>
                        <select className="h-10 w-full rounded-lg border border-border bg-background px-3"
                            value={form.provider}
                            onChange={(event) => setForm({ ...form, provider: event.target.value as Config["provider"] })}>
                            <option value="hostaway">Hostaway</option>
                            <option value="direct">{t("direct")}</option>
                        </select>
                    </label>
                    <label className="space-y-1.5 text-sm">
                        <span className="text-muted-foreground">{t("syncInterval")}</span>
                        <input className="h-10 w-full rounded-lg border border-border bg-background px-3"
                            type="number" min={15} max={1440} value={form.syncInterval}
                            onChange={(event) => setForm({ ...form, syncInterval: Number(event.target.value) })} />
                    </label>
                    {form.provider === "hostaway" && <>
                        <label className="space-y-1.5 text-sm">
                            <span className="text-muted-foreground">{t("accountId")}</span>
                            <input className="h-10 w-full rounded-lg border border-border bg-background px-3"
                                value={form.accountId}
                                onChange={(event) => setForm({ ...form, accountId: event.target.value })} />
                        </label>
                        <label className="space-y-1.5 text-sm">
                            <span className="text-muted-foreground">{t("apiSecret")}</span>
                            <input className="h-10 w-full rounded-lg border border-border bg-background px-3"
                                type="password" value={form.apiSecret}
                                placeholder={hasSecret ? "••••••••" : ""}
                                onChange={(event) => setForm({ ...form, apiSecret: event.target.value })} />
                        </label>
                    </>}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                    <button onClick={save} disabled={!!busy}
                        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                        {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {t("save")}
                    </button>
                    {form.provider === "hostaway" && (
                        <button onClick={testConnection} disabled={!!busy || !hasSecret}
                            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">
                            {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {t("test")}
                        </button>
                    )}
                    {form.provider === "hostaway" && (
                        <button onClick={sync} disabled={!!busy || !form.accountId || (!hasSecret && !form.apiSecret)}
                            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">
                            {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            {t("sync")}
                        </button>
                    )}
                </div>
            </section>

            <section className="space-y-4 rounded-xl border border-border bg-card p-5">
                <div>
                    <h2 className="font-semibold">{t("mappings")}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{t("mappingsHelp")}</p>
                </div>
                {unmapped.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{t("unmappedWarning", { count: unmapped.length })}</span>
                    </div>
                )}
                {mappings.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t("noListings")}</p>
                ) : (
                    <div className="divide-y divide-border rounded-lg border border-border">
                        {mappings.map((row) => (
                            <div key={row.listing_id} className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr] sm:items-center">
                                <div>
                                    <p className="text-sm font-medium">{row.listing_name}</p>
                                    <p className="text-xs text-muted-foreground">{row.external_id}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <select className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
                                        value={row.property_id || ""}
                                        disabled={!!busy}
                                        onChange={(event) => void mapListing(row.listing_id, event.target.value || null)}>
                                        <option value="">{t("unmapped")}</option>
                                        {properties.map((property) => (
                                            <option key={property.id} value={property.id}>{property.name}</option>
                                        ))}
                                    </select>
                                    {busy === `map:${row.listing_id}` && <Loader2 className="h-4 w-4 animate-spin" />}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
