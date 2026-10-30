"use client";

/**
 * Atención a clientes reales (C0 §1.2 y §1.6, rebanada R4): estado de publicación, modo del control (sombra o
 * aplicado), la decisión de hoy y la última registrada, y la acción del dueño: publicar, publicar en modo limitado
 * reconociendo cada tema que quedará en «no consta», o despublicar. Probar agente funciona siempre.
 */
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Radio } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ackComplete, goLiveAction, type GoLiveIntent, type GoLiveStatus } from "@/lib/go-live";
import type { ReadinessVerdict } from "@/lib/readiness-panel";

const BUTTON = "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60";

export function GoLiveCard({ tenantId, verdict, limitedIntents, canWrite, reloadKey }: {
    tenantId: string;
    verdict: ReadinessVerdict;
    limitedIntents: GoLiveIntent[];
    canWrite: boolean;
    /** Cambia cuando el panel reevalúa: el veredicto pudo cambiar. */
    reloadKey: string;
}) {
    const t = useTranslations("readinessPanel.goLive");
    const locale = useLocale();
    const [status, setStatus] = useState<GoLiveStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [confirmOff, setConfirmOff] = useState(false);

    useEffect(() => {
        let alive = true;
        void api.getGoLive(tenantId).then(res => {
            if (!alive) return;
            if (res.success && res.data) setStatus(res.data);
            else setError(res.error || t("error"));
        });
        return () => { alive = false; };
    }, [tenantId, reloadKey, t]);

    if (!status) return error ? <p role="alert" className="mb-6 text-sm text-red-700 dark:text-red-300">{error}</p> : null;

    const formatDate = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
    const action = goLiveAction(status, verdict, limitedIntents, canWrite);
    const run = async (call: () => ReturnType<typeof api.publishGoLive>) => {
        setBusy(true);
        setError(null);
        const res = await call();
        if (res.success && res.data) { setStatus(res.data); setConfirmOff(false); setChecked(new Set()); }
        else setError(res.error || t("error"));
        setBusy(false);
    };
    const toggle = (id: string) => setChecked(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const last = status.lastDecision;

    return (
        <section aria-label={t("title")} className="mb-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
                        <Radio size={16} aria-hidden="true" />{t("title")}
                    </h2>
                    <p className={cn("mt-1 text-sm font-medium", status.state === "on" ? "text-emerald-700 dark:text-emerald-300" : "text-neutral-700 dark:text-neutral-300")}>
                        {t(`state.${status.state}`)}{status.at ? ` · ${t("since", { date: formatDate(status.at) })}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t(`mode.${status.mode}`)}</p>
                    <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
                        {status.decision.serve ? t("today.serve") : t("today.block", { reason: t(`reason.${status.decision.reason}`) })}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                        {last ? t("last", {
                            date: formatDate(last.createdAt), channel: last.channelType,
                            result: last.serve ? t("lastServe") : t("lastBlock"), reason: t(`reason.${last.reason}`),
                        }) : t("noDecisions")}
                        {status.summary.total > 0 && ` · ${t("summary", { total: status.summary.total, days: status.summary.days, blocked: status.summary.wouldBlock })}`}
                    </p>
                    {status.ack && (
                        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("acknowledged", { count: status.ack.intents.length, date: formatDate(status.ack.acknowledgedAt) })}</p>
                    )}
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("agentTest")}</p>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                    {action.kind === "publish" && (
                        <button type="button" disabled={busy} onClick={() => void run(() => api.publishGoLive(tenantId, []))}
                            className={cn(BUTTON, "bg-indigo-600 text-white hover:bg-indigo-700")}>
                            {busy && <Loader2 size={14} className="animate-spin" />}{t("publish")}
                        </button>
                    )}
                    {action.kind === "unpublish" && (confirmOff ? (
                        <button type="button" disabled={busy} onClick={() => void run(() => api.unpublishGoLive(tenantId))}
                            className={cn(BUTTON, "bg-red-600 text-white hover:bg-red-700")}>
                            {busy && <Loader2 size={14} className="animate-spin" />}{t("confirmUnpublish")}
                        </button>
                    ) : (
                        <button type="button" onClick={() => setConfirmOff(true)}
                            className={cn(BUTTON, "border border-neutral-200 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800")}>
                            {t("unpublish")}
                        </button>
                    ))}
                    {action.kind === "blocked" && <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("blockedHint")}</p>}
                    {action.kind === "read_only" && <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("readOnly")}</p>}
                </div>
            </div>

            {action.kind === "publish_limited" && (
                <fieldset className="mt-4 rounded-lg border border-amber-200 p-3 dark:border-amber-900/60">
                    <legend className="px-1 text-sm font-medium text-amber-800 dark:text-amber-200">{t("ackTitle")}</legend>
                    <ul className="mt-1 space-y-1">
                        {action.intents.map(i => (
                            <li key={i.id}>
                                <label className="inline-flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                                    <input type="checkbox" className="mt-0.5" checked={checked.has(i.id)} onChange={() => toggle(i.id)} disabled={busy} />
                                    {i.title}
                                </label>
                            </li>
                        ))}
                    </ul>
                    <button type="button" disabled={busy || !ackComplete(action.intents, checked)}
                        onClick={() => void run(() => api.publishGoLive(tenantId, action.intents.map(i => i.id)))}
                        className={cn(BUTTON, "mt-3 bg-amber-600 text-white hover:bg-amber-700")}>
                        {busy && <Loader2 size={14} className="animate-spin" />}{t("publishLimited")}
                    </button>
                </fieldset>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
        </section>
    );
}
