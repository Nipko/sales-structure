"use client";

/**
 * Conocimiento pendiente (C0 §1.5 y §1.6, rebanada R5, ADR 0011): la bandeja de lo que el agente no supo responder.
 *
 * Cada consulta muestra la pregunta, la demanda («N clientes preguntaron»), cuántos esperan la respuesta y el plazo
 * (SLA de `CORE.PENDING.ROUTING`). El dueño puede:
 * - **Responder solo esta vez**: texto puntual, no es dato y no cambia la preparación;
 * - **Guardar como dato**: abre el cajón del formulario de ese requisito (el mismo de R3c) y guarda por
 *   `POST /readiness/:t/pending/:id/answer {mode: store}`, que escribe por BusinessFactsService, reevalúa la preparación
 *   y resuelve todas las consultas abiertas del requisito; el texto de arriba, si lo hay, es lo que recibe el cliente;
 * - **Descartar** (no aplica o spam), sin aviso.
 * Tras responder, la API avisa a cada cliente que esperaba (salida durable, su idioma, ventana de 24 h) y aquí se
 * muestra el resultado del aviso.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Clock, Inbox, Loader2, Users } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { RequirementDrawer } from "@/components/readiness/RequirementDrawer";
import {
    hoursToSla, pendingActions,
    type NotifySummary, type PendingFilter, type PendingList, type PendingQuestion,
} from "@/lib/pending-knowledge";

const FILTERS: PendingFilter[] = ["active", "answered", "stored", "dismissed", "all"];
const NOTIFY_KEYS = ["sent", "template_required", "opted_out", "skipped_human", "skipped_closed", "no_channel", "sandbox", "failed", "waiting", "unavailable"];

export default function PendingKnowledgePage() {
    const t = useTranslations("readinessPending");
    const { activeTenantId, isLoading: tenantLoading } = useTenant();
    const { role, impersonating } = useRole();
    // Responde el dueño (la API exige tenant_admin); el supervisor ve la bandeja.
    const canWrite = role === "tenant_admin" || (role === "super_admin" && impersonating);
    const [filter, setFilter] = useState<PendingFilter>("active");
    const [list, setList] = useState<PendingList | null>(null);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [storing, setStoring] = useState<PendingQuestion | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        setError(null);
        const res = await api.getPendingQuestions(activeTenantId, filter);
        if (res.success && res.data) setList(res.data);
        else setError(res.error || t("error"));
        setLoading(false);
    }, [activeTenantId, filter, t]);

    useEffect(() => { void load(); }, [load]);

    const describeNotice = (summary: NotifySummary | undefined) => {
        const parts = NOTIFY_KEYS.filter(k => Number(summary?.[k] ?? 0) > 0).map(k => t(`notify.${k}`, { count: Number(summary?.[k]) }));
        return parts.length ? t("notified", { summary: parts.join(" · ") }) : t("notifiedNone");
    };

    const run = async (id: string, action: () => Promise<{ success: boolean; error?: string; data?: any }>, summaryOf?: (data: any) => NotifySummary | undefined) => {
        setBusy(id);
        setError(null);
        setNotice(null);
        const res = await action();
        setBusy(null);
        if (!res.success) { setError(res.error || t("error")); return; }
        setNotice(summaryOf ? describeNotice(summaryOf(res.data)) : t("done"));
        await load();
    };

    const answerOnce = (q: PendingQuestion) => {
        const text = (drafts[q.id] ?? "").trim();
        if (!text) { setError(t("answerRequired")); return; }
        void run(q.id, () => api.answerPendingOnce(activeTenantId!, q.id, text), data => data?.notified);
    };

    if (tenantLoading) return <p role="status">{t("loading")}</p>;
    if (!activeTenantId) return <p>{t("tenantRequired")}</p>;

    const counts = list?.counts;
    const items = list?.items ?? [];

    return (
        <div className="animate-in">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={Inbox}
                action={<Link href="/admin/readiness" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"><ArrowLeft size={14} />{t("back")}</Link>} />

            {counts && (
                <p className="mb-4 text-sm text-neutral-700 dark:text-neutral-300">
                    {t("summary", { open: counts.open ?? 0, gap: counts.gap ?? 0, overdue: counts.overdue ?? 0 })}
                </p>
            )}

            <div role="tablist" aria-label={t("title")} className="mb-4 flex flex-wrap gap-2">
                {FILTERS.map(f => (
                    <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${filter === f
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-neutral-200 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"}`}>
                        {t(`filters.${f}`)}
                    </button>
                ))}
            </div>

            {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
            {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">{notice}</p>}
            {loading && !items.length && <p role="status" className="text-sm text-neutral-500">{t("loading")}</p>}
            {!loading && !items.length && !error && <p className="text-sm text-neutral-500">{t("empty")}</p>}
            {!canWrite && items.length > 0 && <p className="mb-3 text-sm text-neutral-500">{t("readOnly")}</p>}

            <ul className="space-y-3">
                {items.map(q => {
                    const actions = pendingActions(q);
                    const hours = hoursToSla(q.slaDueAt);
                    const disabled = !canWrite || busy === q.id;
                    return (
                        <li key={q.id} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <p className="break-words font-medium text-neutral-900 dark:text-neutral-100">{q.sampleQuestion}</p>
                                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
                                        <span>{t("demand", { count: q.occurrences })}</span>
                                        <span className="inline-flex items-center gap-1"><Users size={12} aria-hidden="true" />{t("waiters", { count: q.waitersCount })}</span>
                                        {hours !== null && q.status === "open" && (
                                            <span className={`inline-flex items-center gap-1 ${hours < 0 ? "font-medium text-red-700 dark:text-red-300" : ""}`}>
                                                <Clock size={12} aria-hidden="true" />{hours < 0 ? t("slaOverdue", { hours: -hours }) : t("slaIn", { hours })}
                                            </span>
                                        )}
                                    </p>
                                    <p className="mt-1 text-xs text-neutral-500">
                                        {q.requirementId ? t("requirement", { id: q.itemRef ? `${q.requirementId} · ${q.itemRef}` : q.requirementId }) : t("noRequirement")}
                                        {q.source === "retrieval" && <> · {t("fromRetrieval")}</>}
                                    </p>
                                    {q.answerText && <p className="mt-2 break-words text-sm text-neutral-700 dark:text-neutral-300">{t("answerText", { text: q.answerText })}</p>}
                                </div>
                                <span className="shrink-0 self-start rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t(`status.${q.status}`)}</span>
                            </div>

                            {(actions.answer || actions.store) && canWrite && (
                                <div className="mt-3">
                                    <label className="block text-sm font-medium text-neutral-800 dark:text-neutral-200" htmlFor={`answer-${q.id}`}>{t("answerLabel")}</label>
                                    <textarea id={`answer-${q.id}`} rows={2} maxLength={2000} value={drafts[q.id] ?? ""} disabled={disabled}
                                        placeholder={t("answerPlaceholder")} aria-describedby={`answer-hint-${q.id}`}
                                        onChange={e => setDrafts(d => ({ ...d, [q.id]: e.target.value }))}
                                        className="mt-1 w-full rounded-lg border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                                    {actions.store && <p id={`answer-hint-${q.id}`} className="mt-1 text-xs text-neutral-500">{t("answerHint")}</p>}
                                </div>
                            )}

                            {canWrite && (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    {actions.answer && (
                                        <button type="button" disabled={disabled} onClick={() => answerOnce(q)}
                                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                                            {busy === q.id && <Loader2 size={14} className="animate-spin" />}{t("answerOnce")}
                                        </button>
                                    )}
                                    {actions.store && (
                                        <button type="button" disabled={disabled} onClick={() => setStoring(q)}
                                            className="rounded-lg border border-indigo-600 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
                                            {t("storeAsData")}
                                        </button>
                                    )}
                                    {actions.dismiss && (
                                        <button type="button" disabled={disabled} onClick={() => void run(q.id, () => api.dismissPendingQuestion(activeTenantId, q.id))}
                                            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
                                            {t("dismiss")}
                                        </button>
                                    )}
                                    {actions.renotify && (
                                        <button type="button" disabled={disabled} onClick={() => void run(q.id, () => api.renotifyPendingQuestion(activeTenantId, q.id), data => data)}
                                            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
                                            {t("renotify")}
                                        </button>
                                    )}
                                    {actions.close && (
                                        <button type="button" disabled={disabled} onClick={() => void run(q.id, () => api.closePendingQuestion(activeTenantId, q.id))}
                                            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
                                            {t("close")}
                                        </button>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            <RequirementDrawer tenantId={activeTenantId} requirementId={storing?.requirementId ?? null}
                viewer={{ role, impersonating }} canWrite={canWrite}
                onClose={() => setStoring(null)}
                saveWith={async body => {
                    const q = storing!;
                    const text = (drafts[q.id] ?? "").trim();
                    const res = await api.storePendingAnswer(activeTenantId, q.id, { ...body, ...(text ? { text } : {}) });
                    if (res.success && res.data) setNotice(describeNotice(res.data.notified));
                    return res;
                }}
                onSaved={() => { setStoring(null); void load(); }} />
        </div>
    );
}
