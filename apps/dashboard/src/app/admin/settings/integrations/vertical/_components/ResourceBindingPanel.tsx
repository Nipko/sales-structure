"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";

const inputClass = "w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground";

export function ResourceBindingPanel({ tenantId, provider, connectionId }: {
    tenantId: string;
    provider: string;
    connectionId: string;
}) {
    const t = useTranslations("verticalIntegrations.bindings");
    const [bindings, setBindings] = useState<any[]>([]);
    const [form, setForm] = useState({ resourceType: "location", resourceId: "", externalId: "", scopeType: "", scopeId: "" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        const response: any = await api.listProviderResourceBindings(tenantId, provider);
        if (response?.success) setBindings((response.data || []).filter((binding: any) => binding.state !== "tombstoned"));
    }, [tenantId, provider]);

    useEffect(() => { load().catch(() => setError(t("loadFailed"))); }, [load, t]);

    const save = async () => {
        if (!form.resourceType || !form.resourceId || !form.externalId) return;
        setBusy(true);
        setError("");
        try {
            await api.upsertProviderResourceBinding(tenantId, {
                provider, connectionId,
                resourceType: form.resourceType,
                resourceId: form.resourceId,
                externalId: form.externalId,
                scopeType: form.scopeType || undefined,
                scopeId: form.scopeId || undefined,
            });
            setForm((current) => ({ ...current, resourceId: "", externalId: "", scopeType: "", scopeId: "" }));
            await load();
        } catch (e: any) {
            setError(e?.message || t("saveFailed"));
        }
        setBusy(false);
    };

    const remove = async (id: string) => {
        setBusy(true);
        try {
            await api.deleteProviderResourceBinding(tenantId, id);
            await load();
        } catch (e: any) {
            setError(e?.message || t("deleteFailed"));
        }
        setBusy(false);
    };

    return (
        <div className="mt-4 rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-start gap-2">
                <Link2 size={14} className="mt-0.5 text-indigo-500" />
                <div>
                    <p className="text-xs font-semibold text-foreground">{t("title")}</p>
                    <p className="text-[11px] text-muted-foreground">{t("description")}</p>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input className={inputClass} value={form.resourceType} onChange={(e) => setForm({ ...form, resourceType: e.target.value })} placeholder={t("resourceType")} />
                <input className={inputClass} value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })} placeholder={t("localResourceId")} />
                <input className={inputClass} value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} placeholder={t("externalId")} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                <input className={inputClass} value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value })} placeholder={t("scopeType")} />
                <input className={inputClass} value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })} placeholder={t("scopeId")} />
                <button onClick={save} disabled={busy || !form.resourceId || !form.externalId}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {t("map")}
                </button>
            </div>
            {error && <p className="text-[11px] text-red-500">{error}</p>}
            {bindings.length > 0 && (
                <div className="divide-y divide-border border-t border-border">
                    {bindings.map((binding) => (
                        <div key={binding.id} className="flex items-center gap-2 py-2 text-[11px]">
                            {binding.state === "conflict" && <AlertTriangle size={13} className="text-amber-500 shrink-0" />}
                            <span className="font-medium text-foreground">{binding.resourceType}:{binding.resourceId}</span>
                            <span className="text-muted-foreground">→ {binding.externalId}</span>
                            <span className="text-muted-foreground">v{binding.generation}</span>
                            {binding.state === "conflict" && <span className="text-amber-600">{t("conflict")}</span>}
                            <button onClick={() => remove(binding.id)} disabled={busy} aria-label={t("remove")}
                                className="ml-auto text-muted-foreground hover:text-red-500"><Trash2 size={13} /></button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
