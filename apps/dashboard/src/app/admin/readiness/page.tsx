"use client";

/**
 * Panel de preparación del negocio (C0 §1.6, rebanadas R2 y R3).
 *
 * Muestra lo que decidió el motor en la API: veredicto, huecos por nivel con su mensaje, cobertura por área e
 * historial. Cada hueco con formulario abre el cajón (R3) donde se completa y se guarda; los demás enlazan a la
 * pantalla del objeto (catálogos). `?open=ID` abre el cajón de ese requisito (lo usa la tarjeta de Inicio).
 * R4: debajo del veredicto, la atención a clientes reales (control de salida y reconocimiento de «limitado»).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ClipboardCheck, History, ListChecks, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { GoLiveCard } from "@/components/readiness/GoLiveCard";
import { RequirementDrawer } from "@/components/readiness/RequirementDrawer";
import {
    buildReadinessPanel,
    type GapAction,
    type PanelGap,
    type ReadinessCurrentResponse,
    type ReadinessHistoryEntry,
    type ReadinessVerdict,
    type ScreenAction,
} from "@/lib/readiness-panel";

const VERDICT_STYLE: Record<ReadinessVerdict, { box: string; icon: typeof CheckCircle2 }> = {
    no_listo: { box: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100", icon: XCircle },
    limitado: { box: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100", icon: AlertTriangle },
    listo: { box: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100", icon: CheckCircle2 },
};

/** Abre el cajón de un requisito (lo provee la página). */
type OpenForm = (requirementId: string, screen: ScreenAction) => void;

function ActionLink({ action, onOpen }: { action: GapAction; onOpen: OpenForm }) {
    const t = useTranslations("readinessPanel");
    if (action.kind === "form") {
        return (
            <button type="button" onClick={() => onOpen(action.requirementId, action.screen)}
                className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                {t("action.fix")}
            </button>
        );
    }
    if (action.kind === "link") {
        return <Link href={action.href} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t("action.fix")}</Link>;
    }
    if (action.kind === "ask_admin") return <span className="text-sm text-neutral-500 dark:text-neutral-400">{t("action.askAdmin")}</span>;
    return <span className="text-sm text-neutral-500 dark:text-neutral-400">{t("action.noAction")}</span>;
}

function GapRow({ gap, onOpen }: { gap: PanelGap; onOpen: OpenForm }) {
    const t = useTranslations("readinessPanel");
    const intents = gap.intents.slice(0, 4);
    return (
        <li className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{gap.title}</p>
                    <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{gap.message}</p>
                    {gap.ratio && (
                        <p className="mt-1 text-xs text-neutral-500">{t("ratio", { ok: gap.ratio.ok, total: gap.ratio.total })}</p>
                    )}
                    {intents.length > 0 && (
                        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                            {t("whyItMatters")}{" "}{intents.map(i => i.title).join(" · ")}{gap.intents.length > intents.length ? " …" : ""}
                        </p>
                    )}
                    {gap.alsoFixes.length > 0 && (
                        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                            {t("alsoFixes")}{" "}{gap.alsoFixes.map(f => f.title).join(" · ")}
                        </p>
                    )}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        {t.has(`cause.${gap.cause}`) ? t(`cause.${gap.cause}`) : gap.cause}
                    </span>
                    <ActionLink action={gap.action} onOpen={onOpen} />
                </div>
            </div>
        </li>
    );
}

function Section({ title, description, count, children, tone = "neutral" }: {
    title: string; description?: string; count: number; children: React.ReactNode; tone?: "red" | "amber" | "neutral";
}) {
    return (
        <section className="mb-6" aria-label={title}>
            <h2 className={cn("text-base font-semibold", tone === "red" ? "text-red-700 dark:text-red-300" : tone === "amber" ? "text-amber-700 dark:text-amber-300" : "text-neutral-900 dark:text-neutral-100")}>
                {title} <span className="text-sm font-normal text-neutral-500">({count})</span>
            </h2>
            {description && <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>}
            <div className="mt-3">{children}</div>
        </section>
    );
}

export default function ReadinessPage() {
    const t = useTranslations("readinessPanel");
    const locale = useLocale();
    const { activeTenantId, isLoading: tenantLoading } = useTenant();
    const { role, impersonating } = useRole();
    const [current, setCurrent] = useState<ReadinessCurrentResponse | null>(null);
    const [history, setHistory] = useState<ReadinessHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [drawer, setDrawer] = useState<{ id: string; screen: ScreenAction | null } | null>(null);
    // Escribe el dueño; el supervisor ve el formulario sin poder guardar (la API exige tenant_admin).
    const canWrite = role === "tenant_admin" || (role === "super_admin" && impersonating);
    const openForm = useCallback<OpenForm>((id, screen) => setDrawer({ id, screen }), []);

    // Al abrir se reevalúa: el dueño suele volver aquí después de arreglar algo en otra pantalla.
    const load = useCallback(async (refresh: boolean) => {
        if (!activeTenantId) return;
        setLoading(true);
        setError(null);
        const [res, hist] = await Promise.all([api.getReadiness(activeTenantId, refresh), api.getReadinessHistory(activeTenantId)]);
        if (res.success && res.data) setCurrent(res.data);
        else setError(res.error || t("error"));
        if (hist.success && Array.isArray(hist.data)) setHistory(hist.data);
        setLoading(false);
    }, [activeTenantId, t]);

    useEffect(() => { void load(true); }, [load]);

    // `?open=ID` (tarjeta de Inicio): abre el cajón al llegar. Se lee de window para no exigir Suspense en la página.
    useEffect(() => {
        const id = new URLSearchParams(window.location.search).get("open");
        if (id) setDrawer({ id, screen: null });
    }, []);

    const model = useMemo(() => (current ? buildReadinessPanel(current, { role, impersonating }) : null), [current, role, impersonating]);
    const formatDate = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

    if (tenantLoading) return <p role="status">{t("loading")}</p>;
    if (!activeTenantId) return <p>{t("tenantRequired")}</p>;

    const refreshButton = (
        <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin/readiness/defaults"
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
            <ListChecks size={14} />{t("defaultsLink")}
        </Link>
        <button type="button" onClick={() => void load(true)} disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t("refresh")}
        </button>
        </div>
    );

    return (
        <div className="animate-in">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={ClipboardCheck} action={refreshButton} />

            {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
            {!model && loading && <p role="status" className="text-sm text-neutral-500">{t("loading")}</p>}

            {model && (() => {
                const style = VERDICT_STYLE[model.verdict];
                const VerdictIcon = style.icon;
                return (
                    <>
                        <div className={cn("mb-6 flex items-start gap-3 rounded-xl border p-4", style.box)} role="status">
                            <VerdictIcon size={22} className="mt-0.5 shrink-0" />
                            <div>
                                <p className="text-lg font-semibold">{t(`verdict.${model.verdict}.title`)}</p>
                                <p className="text-sm">{t(`verdict.${model.verdict}.description`)}</p>
                                <p className="mt-1 text-xs opacity-80">
                                    {t("summary", { blocking: model.counts.blockingFailing, necessary: model.counts.necessaryFailing, coverage: model.recommendedPct })}
                                    {" · "}{t("evaluatedAt", { date: formatDate(model.evaluatedAt) })}
                                </p>
                            </div>
                        </div>

                        <GoLiveCard tenantId={activeTenantId} verdict={model.verdict} limitedIntents={model.limitedIntents}
                            canWrite={canWrite} reloadKey={model.evaluatedAt} />

                        <Section title={t("groups.blocking.title")} description={t("groups.blocking.description")} count={model.blocking.length} tone="red">
                            {model.blocking.length ? <ul className="space-y-3">{model.blocking.map(g => <GapRow key={g.id} gap={g} onOpen={openForm} />)}</ul>
                                : <p className="text-sm text-neutral-500">{t("groups.blocking.empty")}</p>}
                        </Section>

                        <Section title={t("groups.necessary.title")} description={t("groups.necessary.description")} count={model.necessary.length} tone="amber">
                            {model.necessary.length ? <ul className="space-y-3">{model.necessary.map(g => <GapRow key={g.id} gap={g} onOpen={openForm} />)}</ul>
                                : <p className="text-sm text-neutral-500">{t("groups.necessary.empty")}</p>}
                            {model.limitedIntents.length > 0 && (
                                <details className="mt-3 rounded-lg border border-amber-200 p-3 text-sm dark:border-amber-900/60">
                                    <summary className="cursor-pointer font-medium">{t("limitedIntents", { count: model.limitedIntents.length })}</summary>
                                    <ul className="mt-2 list-disc pl-5 text-neutral-700 dark:text-neutral-300">
                                        {model.limitedIntents.map(i => <li key={i.id}>{i.title}</li>)}
                                    </ul>
                                </details>
                            )}
                        </Section>

                        <Section title={t("groups.recommended.title")} description={t("groups.recommended.description", { pct: model.recommendedPct })} count={model.recommended.length}>
                            {model.recommended.length > 0 && (
                                <details className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                                    <summary className="cursor-pointer text-sm font-medium">{t("groups.recommended.show")}</summary>
                                    <ul className="mt-3 space-y-3">{model.recommended.map(g => <GapRow key={g.id} gap={g} onOpen={openForm} />)}</ul>
                                </details>
                            )}
                        </Section>

                        {model.quality.length > 0 && (
                            <Section title={t("groups.quality.title")} description={t("groups.quality.description")} count={model.quality.length}>
                                <ul className="space-y-2">
                                    {model.quality.map((w, i) => (
                                        <li key={`${w.id}:${i}`} className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-neutral-800">
                                            <span><span className="font-medium">{w.title}</span>: {w.message}</span>
                                            <ActionLink action={w.action} onOpen={openForm} />
                                        </li>
                                    ))}
                                </ul>
                            </Section>
                        )}

                        {model.platform.length > 0 && (
                            <Section title={t("groups.platform.title")} description={t("groups.platform.description")} count={model.platform.length}>
                                <ul className="space-y-2 text-sm">
                                    {model.platform.map(p => <li key={p.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><span className="font-medium">{p.title}</span>: {p.message}</li>)}
                                </ul>
                            </Section>
                        )}

                        <Section title={t("coverage.title")} count={model.coverage.length}>
                            <ul className="grid gap-2 sm:grid-cols-2">
                                {model.coverage.map(a => (
                                    <li key={a.area} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="font-mono text-xs">{a.area}</span>
                                            <span>{t("coverage.value", { ok: a.ok, total: a.total, pct: a.pct })}</span>
                                        </div>
                                        <div className="mt-2 h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800" aria-hidden="true">
                                            <div className={cn("h-1.5 rounded-full", a.pct === 100 ? "bg-emerald-500" : a.pct >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${a.pct}%` }} />
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </Section>
                    </>
                );
            })()}

            <Section title={t("history.title")} count={history.length}>
                {history.length ? (
                    <ol className="space-y-1 text-sm">
                        {history.map(h => (
                            <li key={h.id} className="flex flex-wrap items-center gap-2">
                                <History size={14} className="text-neutral-400" aria-hidden="true" />
                                <span>{formatDate(h.createdAt)}</span>
                                <span className="font-medium">{t(`verdict.${h.verdict}.title`)}</span>
                                <span className="text-neutral-500">{t("history.counts", { blocking: h.counts.blockingFailing, necessary: h.counts.necessaryFailing })}</span>
                            </li>
                        ))}
                    </ol>
                ) : <p className="text-sm text-neutral-500">{t("history.empty")}</p>}
            </Section>

            <RequirementDrawer tenantId={activeTenantId} requirementId={drawer?.id ?? null} screen={drawer?.screen ?? null}
                viewer={{ role, impersonating }} canWrite={canWrite}
                onClose={() => setDrawer(null)}
                // guardar reevalúa en la API; el panel recarga el veredicto y los huecos
                onSaved={() => { void load(false); }} />
        </div>
    );
}
