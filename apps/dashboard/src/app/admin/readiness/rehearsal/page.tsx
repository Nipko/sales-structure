"use client";

/**
 * Ensayo antes de salir (C0 §1.4 C4 y §1.6, rebanada R7, ADR 0013).
 *
 * Preguntas simuladas de clientes (las del perfil del negocio, con sus ítems reales) corridas contra el agente con lo
 * que el negocio sabe hoy, sin efectos. El informe agrupa por tema:
 * - **Responde bien**: dijo el dato confirmado;
 * - **No lo sabe porque falta un dato**: hizo lo correcto («no consta», «lo averiguo», «te paso con una persona») porque
 *   el dato no está; el botón abre el cajón del formulario de ese requisito (el mismo de R3c);
 * - **Respondió mal**: fallo del agente, no de los datos; va a la cola de la plataforma y no se le carga al dueño.
 * Es consultivo (C0 §6 pregunta 7): no habilita ni bloquea la salida. Mientras corre, la página consulta el progreso.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, FlaskConical, Loader2, Play, RotateCcw } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { gapAction, type ScreenAction } from "@/lib/readiness-panel";
import {
    fixesWithData, groupByIntent, isRunActive, percent, runErrorKey,
    type RehearsalOutcome, type RehearsalResult, type RehearsalRun, type RehearsalRunDetail,
} from "@/lib/rehearsal";
import { PageHeader } from "@/components/ui/page-header";
import { RequirementDrawer } from "@/components/readiness/RequirementDrawer";

const POLL_MS = 3_000;
const OUTCOME_STYLE: Record<RehearsalOutcome, string> = {
    answered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
    missing_data: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    wrong: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
    inconclusive: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    error: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

export default function RehearsalPage() {
    const t = useTranslations("readinessRehearsal");
    const locale = useLocale();
    const { activeTenantId, isLoading: tenantLoading } = useTenant();
    const { role, impersonating } = useRole();
    // Lanza el dueño (o la plataforma, para QA); el supervisor ve los informes.
    const canRun = role === "tenant_admin" || role === "super_admin";
    const canWrite = role === "tenant_admin" || (role === "super_admin" && impersonating);
    const [runs, setRuns] = useState<RehearsalRun[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [detail, setDetail] = useState<RehearsalRunDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [drawer, setDrawer] = useState<{ id: string; screen: ScreenAction | null } | null>(null);

    const describeError = useCallback((raw: string | null | undefined) => {
        const key = runErrorKey(raw);
        return key ? t(`errors.${key}`) : (raw || t("error"));
    }, [t]);

    const loadRuns = useCallback(async () => {
        if (!activeTenantId) return;
        const res = await api.getRehearsalRuns(activeTenantId);
        if (res.success && Array.isArray(res.data)) {
            setRuns(res.data);
            setSelected(s => s ?? res.data![0]?.id ?? null);
        } else setError(describeError(res.error));
        setLoading(false);
    }, [activeTenantId, describeError]);

    const loadDetail = useCallback(async (id: string) => {
        if (!activeTenantId) return;
        const res = await api.getRehearsalRun(activeTenantId, id);
        if (res.success && res.data) setDetail(res.data);
        else setError(describeError(res.error));
    }, [activeTenantId, describeError]);

    useEffect(() => { void loadRuns(); }, [loadRuns]);
    useEffect(() => { if (selected) void loadDetail(selected); else setDetail(null); }, [selected, loadDetail]);
    // progreso: mientras la ejecución elegida corre, se consulta cada pocos segundos
    useEffect(() => {
        if (!selected || !isRunActive(detail)) return;
        const timer = setInterval(() => { void loadDetail(selected); void loadRuns(); }, POLL_MS);
        return () => clearInterval(timer);
    }, [selected, detail, loadDetail, loadRuns]);

    const start = async (repeatOf?: string) => {
        if (!activeTenantId) return;
        setStarting(true);
        setError(null);
        const res = await api.startRehearsal(activeTenantId, repeatOf ? { repeatOf } : {});
        setStarting(false);
        if (!res.success || !res.data) { setError(describeError(res.error)); return; }
        setSelected(res.data.id);
        setDetail(null);
        await loadRuns();
    };

    const groups = useMemo(() => groupByIntent(detail?.results ?? []), [detail]);
    const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—");
    const anyRunning = runs.some(r => isRunActive(r));

    if (tenantLoading) return <p role="status">{t("loading")}</p>;
    if (!activeTenantId) return <p>{t("tenantRequired")}</p>;

    const summary = detail?.summary;
    const rate = percent(detail?.passRate ?? summary?.passRate);

    return (
        <div className="animate-in">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={FlaskConical}
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        <Link href="/admin/readiness" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"><ArrowLeft size={14} />{t("back")}</Link>
                        {canRun && (
                            <button type="button" onClick={() => void start()} disabled={starting || anyRunning}
                                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                                {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}{t("run")}
                            </button>
                        )}
                    </div>
                } />

            <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">{t("consultative")}</p>
            {!canRun && <p className="mb-3 text-sm text-neutral-500">{t("readOnly")}</p>}
            {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
            {loading && <p role="status" className="text-sm text-neutral-500">{t("loading")}</p>}
            {!loading && !runs.length && !error && <p className="text-sm text-neutral-500">{t("empty")}</p>}

            {runs.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <label htmlFor="rehearsal-run" className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("runs")}</label>
                    <select id="rehearsal-run" value={selected ?? ""} onChange={e => { setDetail(null); setSelected(e.target.value); }}
                        className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                        {runs.map(r => (
                            <option key={r.id} value={r.id}>{t("runLabel", { date: formatDate(r.startedAt), total: r.caseCount, status: t(`status.${r.status}`) })}</option>
                        ))}
                    </select>
                </div>
            )}

            {detail && (
                <section aria-labelledby="rehearsal-summary" className="mb-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <h2 id="rehearsal-summary" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                                {isRunActive(detail) ? t("running", { done: detail.completedCount, total: detail.caseCount })
                                    : rate !== null ? t("passRate", { rate }) : t("noRate")}
                            </h2>
                            {isRunActive(detail) && (
                                <div className="mt-2 h-2 w-full max-w-sm overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="progressbar"
                                    aria-valuemin={0} aria-valuemax={detail.caseCount} aria-valuenow={detail.completedCount} aria-label={t("progress")}>
                                    <div className="h-full bg-indigo-600" style={{ width: `${detail.caseCount ? Math.round((detail.completedCount / detail.caseCount) * 100) : 0}%` }} />
                                </div>
                            )}
                            {summary && (
                                <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                                    {t("counts", { answered: summary.answered, missing: summary.missingData, wrong: summary.wrong, inconclusive: summary.inconclusive + summary.errors })}
                                </p>
                            )}
                            {detail.passHatK?.rate !== null && detail.passHatK && (
                                <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{t("passHatK", { k: detail.passHatK.k, rate: percent(detail.passHatK.rate) ?? 0 })}</p>
                            )}
                            <p className="mt-1 text-xs text-neutral-500">
                                {t("cost", { models: detail.models.join(", ") || "—", tokens: detail.inputTokens + detail.outputTokens + detail.judgeTokens, cost: detail.costUsd.toFixed(4), judge: detail.judgeCalls })}
                            </p>
                            {detail.error && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{describeError(detail.error)}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t(`status.${detail.status}`)}</span>
                            {canRun && !isRunActive(detail) && (
                                <button type="button" onClick={() => void start(detail.id)} disabled={starting || anyRunning}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
                                    <RotateCcw size={14} />{t("repeat")}
                                </button>
                            )}
                        </div>
                    </div>
                </section>
            )}

            {groups.length > 0 && <h2 className="mb-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("byIntent")}</h2>}
            <ul className="space-y-3">
                {groups.map(g => (
                    <li key={g.intentId} className="rounded-lg border border-neutral-200 dark:border-neutral-800">
                        <details open={g.counts.wrong + g.counts.missing_data > 0}>
                            <summary className="cursor-pointer list-none p-3">
                                <span className="font-medium text-neutral-900 dark:text-neutral-100">{g.title}</span>
                                <span className="ml-2 text-xs text-neutral-500">{g.intentId}</span>
                                <span className="ml-3 text-xs text-neutral-600 dark:text-neutral-400">
                                    {(["wrong", "missing_data", "answered", "inconclusive", "error"] as RehearsalOutcome[]).filter(o => g.counts[o] > 0)
                                        .map(o => `${t(`outcome.${o}`)}: ${g.counts[o]}`).join(" · ")}
                                </span>
                            </summary>
                            <ul className="space-y-3 border-t border-neutral-200 p-3 dark:border-neutral-800">
                                {g.results.map(r => <ResultRow key={r.caseKey} r={r} t={t} onFix={() => setDrawer({ id: r.requirementIds[0], screen: gapAction(r.uiTarget, { role, impersonating }) })} />)}
                            </ul>
                        </details>
                    </li>
                ))}
            </ul>
            {detail && detail.pending > 0 && !isRunActive(detail) && <p className="mt-3 text-xs text-neutral-500">{t("notRun", { count: detail.pending })}</p>}

            <RequirementDrawer tenantId={activeTenantId} requirementId={drawer?.id ?? null} screen={drawer?.screen ?? null}
                viewer={{ role, impersonating }} canWrite={canWrite}
                onClose={() => setDrawer(null)} onSaved={() => undefined} />
        </div>
    );
}

function ResultRow({ r, t, onFix }: { r: RehearsalResult; t: ReturnType<typeof useTranslations>; onFix: () => void }) {
    return (
        <li className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLE[r.outcome]}`}>{t(`outcome.${r.outcome}`)}</span>
                <span className="text-xs text-neutral-500">{t("expected", { code: r.expected })}{r.itemName ? ` · ${r.itemName}` : ""} · {r.language.toUpperCase()}</span>
                {r.decidedBy === "judge" && <span className="text-xs text-neutral-500">· {t("judged")}</span>}
            </div>
            {r.turns.map((turn, i) => (
                <div key={i} className="mt-1 space-y-0.5">
                    <p className="break-words text-neutral-900 dark:text-neutral-100"><span className="font-medium">{t("customer")}:</span> {turn.customer}</p>
                    <p className="break-words text-neutral-700 dark:text-neutral-300"><span className="font-medium">{t("agent")}:</span> {turn.agent || "—"}</p>
                </div>
            ))}
            {r.reason && r.outcome !== "answered" && <p className="mt-1 break-words text-xs text-neutral-600 dark:text-neutral-400">{t("reason", { reason: r.reason })}</p>}
            {fixesWithData(r) && (
                <button type="button" onClick={onFix}
                    className="mt-2 rounded-lg border border-indigo-600 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
                    {t("fixData", { requirement: r.requirementTitle ?? r.requirementIds[0] })}
                </button>
            )}
            {r.outcome === "wrong" && <p className="mt-1 text-xs text-neutral-500">{t("productMiss")}</p>}
        </li>
    );
}
