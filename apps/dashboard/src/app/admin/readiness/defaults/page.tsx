"use client";

/**
 * Valores por defecto de la plataforma (C0 §1.6 y §2.5, D7, rebanada R3): una sola pantalla para aceptarlos.
 *
 * Lista los requisitos del tenant que se cumplen aceptando el default (`predicate_kind: default_accepted`), con lo
 * que hace el agente con ese default (`when_missing.behavior`). Aceptar escribe una fila `origin=default_accepted` con
 * la `spec_version` vigente (`POST /readiness/:t/business-facts/defaults/accept`); un valor que el dueño ya configuró
 * no se pisa. Para cambiar un default, el requisito se abre en el cajón del panel.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, CheckCircle2, ListChecks, Loader2 } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { panelFormHref } from "@/lib/readiness-panel";
import type { BusinessFactDefault } from "@/lib/readiness-forms";

export default function ReadinessDefaultsPage() {
    const t = useTranslations("readinessDefaults");
    const { activeTenantId, isLoading: tenantLoading } = useTenant();
    const { role, impersonating } = useRole();
    const canWrite = role === "tenant_admin" || (role === "super_admin" && impersonating);
    const [items, setItems] = useState<BusinessFactDefault[]>([]);
    const [specVersion, setSpecVersion] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        setError(null);
        const res = await api.getBusinessFactDefaults(activeTenantId);
        if (res.success && res.data) {
            setItems(res.data.items);
            setSpecVersion(res.data.specVersion);
            setSelected(new Set(res.data.items.filter(i => i.status === "pending").map(i => i.id)));
        } else setError(res.error || t("error"));
        setLoading(false);
    }, [activeTenantId, t]);

    useEffect(() => { void load(); }, [load]);

    const accept = async (ids: string[]) => {
        if (!activeTenantId || !specVersion || !ids.length) return;
        setSaving(true);
        setError(null);
        setNotice(null);
        const res = await api.acceptBusinessFactDefaults(activeTenantId, ids, specVersion);
        setSaving(false);
        if (!res.success || !res.data) {
            setError(res.httpStatus === 409 ? t("specChanged") : res.error || t("error"));
            if (res.httpStatus === 409) void load();
            return;
        }
        setNotice(t("accepted", { count: res.data.accepted.length, skipped: res.data.skipped.length }));
        await load();
    };

    if (tenantLoading) return <p role="status">{t("loading")}</p>;
    if (!activeTenantId) return <p>{t("tenantRequired")}</p>;

    const pending = items.filter(i => i.status === "pending");
    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    return (
        <div className="animate-in">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={ListChecks}
                action={<Link href="/admin/readiness" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"><ArrowLeft size={14} />{t("back")}</Link>} />

            {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
            {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">{notice}</p>}
            {loading && !items.length && <p role="status" className="text-sm text-neutral-500">{t("loading")}</p>}
            {!loading && !items.length && !error && <p className="text-sm text-neutral-500">{t("empty")}</p>}

            {items.length > 0 && (
                <>
                    <ul className="space-y-3">
                        {items.map(item => (
                            <li key={item.id} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <label className="flex min-w-0 items-start gap-3">
                                        {item.status === "pending"
                                            ? <input type="checkbox" className="mt-1" disabled={!canWrite || saving} checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                                            : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />}
                                        <span className="min-w-0">
                                            <span className="block font-medium text-neutral-900 dark:text-neutral-100">{item.title}</span>
                                            <span className="mt-1 block text-sm text-neutral-700 dark:text-neutral-300">{item.question}</span>
                                            <span className="mt-2 block text-sm text-neutral-600 dark:text-neutral-400">
                                                <span className="font-medium">{t("defaultIs")}</span> {item.behavior}
                                            </span>
                                        </span>
                                    </label>
                                    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t(`status.${item.status}`)}</span>
                                        <Link href={panelFormHref(item.id)} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t("configure")}</Link>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button type="button" disabled={!canWrite || saving || !selected.size} onClick={() => void accept([...selected])}
                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                            {saving && <Loader2 size={14} className="animate-spin" />}{t("acceptSelected", { count: selected.size })}
                        </button>
                        {!canWrite && <span className="text-sm text-neutral-500">{t("readOnly")}</span>}
                        {canWrite && pending.length === 0 && <span className="text-sm text-neutral-500">{t("allDecided")}</span>}
                    </div>
                </>
            )}
        </div>
    );
}
