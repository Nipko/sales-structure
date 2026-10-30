"use client";

/**
 * Propuestas del copiloto de onboarding (C0 §1.3 y §1.6, rebanada R6, ADR 0012).
 *
 * «Analizar mis fuentes» lee lo que el negocio ya subió (su web y sus documentos, sus FAQs) y propone datos para los
 * requisitos que faltan, cada uno con la cita que lo respalda. Nada se guarda sin el dueño:
 * - **Aprobar**: el dato queda confirmado con procedencia «copiloto» y el dueño como quien lo confirmó;
 * - **Editar y aprobar**: abre el cajón del requisito (el mismo de R3c) con el valor propuesto y la evidencia;
 * - **Rechazar**: la propuesta queda rechazada, sin tocar el dato.
 * Las contradicciones (una fuente dice otra cosa que el dato confirmado, o dos fuentes no coinciden) se resuelven igual,
 * eligiendo una versión. Las preguntas del copiloto se responden con el formulario del requisito.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Quote, Sparkles } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { RequirementDrawer } from "@/components/readiness/RequirementDrawer";
import {
    COPILOT_FILTERS, copilotActions, formatProposalValue,
    type CopilotEvidence, type CopilotFilter, type CopilotProposal, type CopilotProposalList, type CopilotRunSummary,
} from "@/lib/onboarding-copilot";

/** Lo que abre el cajón: responder una pregunta, o editar (y aprobar) una propuesta partiendo de un valor. */
type DrawerState = { proposal: CopilotProposal; mode: "answer" } | { proposal: CopilotProposal; mode: "edit"; value: unknown };

function EvidenceList({ items, label }: { items: CopilotEvidence[]; label: string }) {
    if (!items.length) return null;
    return (
        <ul aria-label={label} className="mt-2 space-y-1.5">
            {items.map((e, i) => (
                <li key={`${e.sourceRef}:${i}`} className="flex gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                    <Quote size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                    <span className="min-w-0 break-words">
                        <q className="italic text-neutral-800 dark:text-neutral-200">{e.quote}</q>{" — "}
                        {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">{e.label}</a> : e.label}
                    </span>
                </li>
            ))}
        </ul>
    );
}

function ValueLines({ value }: { value: unknown }) {
    const lines = formatProposalValue(value);
    return (
        <ul className="mt-1 space-y-0.5 text-sm text-neutral-900 dark:text-neutral-100">
            {lines.map((line, i) => <li key={i} className="break-words">{line}</li>)}
        </ul>
    );
}

export default function OnboardingCopilotPage() {
    const t = useTranslations("readinessCopilot");
    const locale = useLocale();
    const { activeTenantId, isLoading: tenantLoading } = useTenant();
    const { role, impersonating } = useRole();
    // Decide el dueño (la API exige tenant_admin); el supervisor ve las propuestas.
    const canWrite = role === "tenant_admin" || (role === "super_admin" && impersonating);
    const [filter, setFilter] = useState<CopilotFilter>("open");
    const [list, setList] = useState<CopilotProposalList | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [drawer, setDrawer] = useState<DrawerState | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        setError(null);
        const res = await api.getCopilotProposals(activeTenantId, filter);
        if (res.success && res.data) setList(res.data);
        else setError(res.error || t("error"));
        setLoading(false);
    }, [activeTenantId, filter, t]);

    useEffect(() => { void load(); }, [load]);

    const describeRun = (s: CopilotRunSummary) => s.note && s.note !== "malformed_response" && s.proposed + s.contradictions + s.questions === 0
        ? t(`runNote.${s.note}`)
        : t("runDone", { proposed: s.proposed, contradictions: s.contradictions, questions: s.questions, discarded: s.discarded.length });

    const analyze = async () => {
        if (!activeTenantId) return;
        setRunning(true);
        setError(null);
        setNotice(null);
        const res = await api.runCopilotExtraction(activeTenantId);
        setRunning(false);
        if (!res.success || !res.data) { setError(res.httpStatus === 429 ? t("dailyCap") : res.error || t("error")); return; }
        setNotice(describeRun(res.data));
        setFilter("open");
        await load();
    };

    const decide = async (id: string, action: () => Promise<{ success: boolean; error?: string; httpStatus?: number }>, done: string) => {
        setBusy(id);
        setError(null);
        setNotice(null);
        const res = await action();
        setBusy(null);
        if (!res.success) { setError(res.httpStatus === 409 ? t("notOpen") : res.error || t("error")); await load(); return; }
        setNotice(done);
        await load();
    };

    if (tenantLoading) return <p role="status">{t("loading")}</p>;
    if (!activeTenantId) return <p>{t("tenantRequired")}</p>;

    const items = list?.items ?? [];
    const formatDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });
    const buttonPrimary = "inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60";
    const buttonSecondary = "rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";

    const header = (
        <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/readiness" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"><ArrowLeft size={14} />{t("back")}</Link>
            {canWrite && (
                <button type="button" onClick={() => void analyze()} disabled={running} className={buttonPrimary}>
                    {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{running ? t("running") : t("run")}
                </button>
            )}
        </div>
    );

    return (
        <div className="animate-in">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={Sparkles} action={header} />
            <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">{t("promise")}</p>

            <div role="tablist" aria-label={t("title")} className="mb-4 flex flex-wrap gap-2">
                {COPILOT_FILTERS.map(f => (
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
                {items.map(p => {
                    const actions = copilotActions(p);
                    const disabled = !canWrite || busy === p.id;
                    const title = p.requirementTitle ?? p.requirementId;
                    return (
                        <li key={p.id} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t(`kind.${p.kind}`)}</p>
                                    <p className="break-words font-medium text-neutral-900 dark:text-neutral-100">{title}</p>
                                </div>
                                <span className="shrink-0 self-start rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                                    {t(`status.${p.status}`)}{p.decisionNote === "edited" ? ` · ${t("edited")}` : ""}
                                </span>
                            </div>

                            {p.kind === "question" && p.question?.code === "owner_question" && <p className="mt-2 break-words text-sm text-neutral-800 dark:text-neutral-200">{p.question.text}</p>}
                            {p.kind === "question" && p.question?.code === "generic_faq" && p.question.faq && (
                                <p className="mt-2 break-words text-sm text-neutral-800 dark:text-neutral-200">{t("genericFaq", { question: p.question.faq.question, reason: p.question.faq.reason })}</p>
                            )}

                            {p.kind !== "question" && p.value !== null && p.value !== undefined && (
                                <div className="mt-2">
                                    <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("proposed")}</p>
                                    <ValueLines value={p.value} />
                                </div>
                            )}
                            {p.kind === "contradiction" && p.current !== null && p.current !== undefined && (
                                <div className="mt-2 rounded-md bg-amber-50 p-2 dark:bg-amber-950/30">
                                    <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{t("current")}</p>
                                    <ValueLines value={p.current} />
                                </div>
                            )}
                            {p.alternatives.length > 0 && (
                                <ol className="mt-2 space-y-2">
                                    {p.alternatives.map((alt, i) => (
                                        <li key={i} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                                            <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("alternative", { n: i + 1 })}</p>
                                            <ValueLines value={alt.value} />
                                            <EvidenceList items={alt.evidence} label={t("evidence")} />
                                            {actions.choose && canWrite && (
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    <button type="button" disabled={disabled} className={buttonSecondary}
                                                        onClick={() => void decide(p.id, () => api.approveCopilotProposal(activeTenantId, p.id, { value: alt.value }), t("approved"))}>
                                                        {t("useThis")}
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ol>
                            )}
                            {p.alternatives.length === 0 && <EvidenceList items={p.evidence} label={t("evidence")} />}

                            <p className="mt-2 text-xs text-neutral-500">
                                {p.status === "proposed" ? t("expires", { date: formatDate(p.expiresAt) }) : p.decidedAt ? t("decided", { date: formatDate(p.decidedAt) }) : null}
                            </p>

                            {canWrite && (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    {actions.approve && (
                                        <button type="button" disabled={disabled} className={buttonPrimary}
                                            onClick={() => void decide(p.id, () => api.approveCopilotProposal(activeTenantId, p.id), t("approved"))}>
                                            {busy === p.id && <Loader2 size={14} className="animate-spin" />}{t("approve")}
                                        </button>
                                    )}
                                    {actions.edit && (
                                        <button type="button" disabled={disabled} className={buttonSecondary}
                                            onClick={() => setDrawer({ proposal: p, mode: "edit", value: p.value ?? p.alternatives[0]?.value ?? null })}>
                                            {t("editApprove")}
                                        </button>
                                    )}
                                    {actions.answer && (
                                        <button type="button" disabled={disabled} className={buttonSecondary} onClick={() => setDrawer({ proposal: p, mode: "answer" })}>
                                            {t("answer")}
                                        </button>
                                    )}
                                    {actions.openFaqs && <Link href="/admin/knowledge/faqs" className={buttonSecondary}>{t("openFaqs")}</Link>}
                                    {actions.reject && (
                                        <button type="button" disabled={disabled} className={buttonSecondary}
                                            onClick={() => void decide(p.id, () => api.rejectCopilotProposal(activeTenantId, p.id), t("rejected"))}>
                                            {p.kind === "question" ? t("dismiss") : t("reject")}
                                        </button>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            <RequirementDrawer tenantId={activeTenantId} requirementId={drawer?.proposal.requirementId ?? null}
                viewer={{ role, impersonating }} canWrite={canWrite}
                onClose={() => setDrawer(null)}
                initialValue={drawer?.mode === "edit" ? drawer.value : undefined}
                notice={drawer?.mode === "edit" ? (
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-100">
                        <p>{t("drawerNotice")}</p>
                        <EvidenceList items={drawer.proposal.evidence} label={t("evidence")} />
                    </div>
                ) : undefined}
                saveWith={drawer?.mode === "edit" ? (body => api.approveCopilotProposal(activeTenantId, drawer.proposal.id, body)) : undefined}
                onSaved={() => { setDrawer(null); setNotice(t("approved")); void load(); }} />
        </div>
    );
}
