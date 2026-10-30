"use client";

/**
 * Cajón de un hueco del panel de preparación (C0 §1.6, C6, rebanada R3).
 *
 * Carga el requisito (`GET /readiness/:t/requirements/:id`: descriptor de formulario, valor que lee el motor con su
 * procedencia y la fila guardada con su versión) y su historial de versiones; valida en el cliente con el descriptor;
 * guarda por `PUT /readiness/:t/business-facts/:id` (`origin=owner_form`) y avisa al panel para que recalcule.
 * Si el dato vive en una pantalla de objeto (catálogos), enlaza a ella.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, History, Loader2 } from "lucide-react";
import { api, type ApiEnvelope } from "@/lib/api";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { gapAction, type PanelViewer, type ScreenAction } from "@/lib/readiness-panel";
import {
    formIssues, initialFormValue, submitValue,
    type BusinessFactVersion, type BusinessFactWriteResponse, type FormIssue, type RequirementDetailResponse,
} from "@/lib/readiness-forms";
import { FieldInput, ItemList, ObjectFields, type FieldContext } from "./FormFields";

export interface DrawerSaved {
    requirementId: string;
    verdictBefore: string | null;
    verdictAfter: string | null;
}

export function RequirementDrawer({ tenantId, requirementId, viewer, canWrite, screen, onClose, onSaved, saveWith, initialValue, notice }: {
    tenantId: string;
    requirementId: string | null;
    viewer: PanelViewer;
    canWrite: boolean;
    /** Pantalla actual del dato (enlace secundario mientras el agente la siga leyendo, ADR 0008). */
    screen?: ScreenAction | null;
    onClose: () => void;
    onSaved: (saved: DrawerSaved) => void;
    /**
     * Otra puerta de guardado con la misma respuesta (R5): la bandeja de conocimiento pendiente guarda el valor por
     * `POST /readiness/:t/pending/:id/answer {mode: store}`, que escribe por BusinessFactsService y además resuelve las
     * consultas y avisa a los clientes. Sin ella, el `PUT` de siempre.
     */
    saveWith?: (body: { value: unknown; expectedVersion?: number }) => Promise<ApiEnvelope<BusinessFactWriteResponse>>;
    /**
     * Valor con el que abre el formulario en vez del guardado (R6): «editar y aprobar» una propuesta del copiloto abre
     * el valor propuesto. Debe ser una referencia estable (el estado de la página), no un objeto nuevo en cada render.
     */
    initialValue?: unknown;
    /** Contexto arriba del formulario (R6: la evidencia de la propuesta que se está aprobando). */
    notice?: ReactNode;
}) {
    const t = useTranslations("readinessForms");
    const tp = useTranslations("readinessPanel");
    const locale = useLocale();
    const [detail, setDetail] = useState<RequirementDetailResponse | null>(null);
    const [versions, setVersions] = useState<BusinessFactVersion[]>([]);
    const [value, setValue] = useState<unknown>(null);
    const [issues, setIssues] = useState<FormIssue[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<DrawerSaved | null>(null);

    const load = useCallback(async (id: string) => {
        setLoading(true);
        setError(null);
        const [res, hist] = await Promise.all([api.getReadinessRequirement(tenantId, id), api.getBusinessFactVersions(tenantId, id)]);
        if (res.success && res.data) {
            setDetail(res.data);
            // el valor guardado manda; si no hay, el que lee el motor (también heredado de una pantalla vieja)
            setValue(initialFormValue(res.data.form, initialValue !== undefined ? initialValue : res.data.fact?.value ?? res.data.current.record?.value ?? null));
        } else setError(res.error || t("loadError"));
        setVersions(hist.success && Array.isArray(hist.data) ? hist.data : []);
        setLoading(false);
    }, [tenantId, t, initialValue]);

    useEffect(() => {
        setDetail(null);
        setIssues([]);
        setSaved(null);
        if (requirementId) void load(requirementId);
    }, [requirementId, load]);

    const issueMap = useMemo(() => {
        const m = new Map<string, FormIssue[]>();
        for (const i of issues) m.set(i.path, [...(m.get(i.path) ?? []), i]);
        return m;
    }, [issues]);
    const ctx: FieldContext = { disabled: !canWrite || saving, issues: issueMap };
    const formatDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—");

    const save = async () => {
        if (!detail || !requirementId) return;
        const form = detail.form;
        const local = formIssues(form, value);
        setIssues(local);
        if (local.length) return;
        setSaving(true);
        setError(null);
        const body = { value: submitValue(form, value), expectedVersion: detail.fact?.version };
        const res = saveWith ? await saveWith(body) : await api.putBusinessFact(tenantId, requirementId, body);
        setSaving(false);
        if (!res.success || !res.data) {
            if (res.httpStatus === 409) setError(t("conflict"));
            else if (res.fields?.length) {
                setIssues(res.fields.map(f => ({ path: f.path, code: "type", message: f.message ?? f.path })));
                setError(t("rejected"));
            } else setError(res.error || t("saveError"));
            return;
        }
        const done = { requirementId, verdictBefore: res.data.readiness?.verdictBefore ?? null, verdictAfter: res.data.readiness?.verdictAfter ?? null };
        setSaved(done);
        onSaved(done);
        await load(requirementId);
    };

    const form = detail?.form;
    const record = detail?.current.record ?? null;
    const screens: { href: string; action: ScreenAction }[] = (form?.mode === "screen" ? form.screens : [])
        .map(s => ({ href: s.uiTarget, action: gapAction(s.uiTarget, viewer) }));

    return (
        <Sheet open={Boolean(requirementId)} onOpenChange={open => { if (!open) onClose(); }}>
            <SheetContent side="right" closeLabel={t("close")} className="w-full overflow-y-auto sm:max-w-xl">
                <SheetHeader className="border-b border-neutral-200 dark:border-neutral-800">
                    <SheetTitle>{detail?.definition.title ?? requirementId}</SheetTitle>
                    <SheetDescription>{form?.help ?? t("loading")}</SheetDescription>
                </SheetHeader>

                <div className="space-y-4 px-4 pb-4">
                    {notice}
                    {loading && !detail && <p role="status" className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 size={14} className="animate-spin" />{t("loading")}</p>}
                    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
                    {saved && (
                        <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">
                            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                            {saved.verdictAfter
                                ? t("saved", { before: saved.verdictBefore ? tp(`verdict.${saved.verdictBefore}.title`) : "—", after: tp(`verdict.${saved.verdictAfter}.title`) })
                                : t("savedNoVerdict")}
                        </p>
                    )}

                    {detail && form && (
                        <>
                            {/* estado y procedencia del valor que lee el motor */}
                            <section aria-label={t("provenance.title")} className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                                <p>
                                    <span className="font-medium">{t("provenance.state")}:</span>{" "}
                                    {tp.has(`cause.${detail.current.state}`) ? tp(`cause.${detail.current.state}`) : t.has(`states.${detail.current.state}`) ? t(`states.${detail.current.state}`) : detail.current.state}
                                    {detail.evaluation && <> · <span className="font-medium">{t("provenance.result")}:</span> {t.has(`results.${detail.evaluation.result.replace("/", "_")}`) ? t(`results.${detail.evaluation.result.replace("/", "_")}`) : detail.evaluation.result}</>}
                                </p>
                                {detail.evaluation?.detail && <p className="mt-1">{detail.evaluation.detail}</p>}
                                {record && (
                                    <p className="mt-1">
                                        <span className="font-medium">{t("provenance.origin")}:</span> {t.has(`origins.${record.origin}`) ? t(`origins.${record.origin}`) : record.origin}
                                        {record.storage && <> · {t("provenance.storage", { storage: record.storage })}</>}
                                        {record.confirmedAt && <> · {t("provenance.confirmedAt", { date: formatDate(record.confirmedAt) })}</>}
                                    </p>
                                )}
                                {detail.fact && <p className="mt-1">{t("provenance.version", { version: detail.fact.version, date: formatDate(detail.fact.updatedAt) })}</p>}
                                {detail.current.conflicts.length > 0 && <p className="mt-1 text-amber-700 dark:text-amber-300">{t("provenance.conflicts", { count: detail.current.conflicts.length })}</p>}
                            </section>

                            {form.mode === "form" && (
                                <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }} noValidate>
                                    {!canWrite && <p className="text-sm text-neutral-500">{t("readOnly")}</p>}
                                    {form.root === "object" && (
                                        <ObjectFields fields={form.fields} value={(value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>}
                                            onChange={setValue} path="" ctx={ctx} />
                                    )}
                                    {form.root === "list" && (
                                        <>
                                            <ItemList fields={form.fields} value={Array.isArray(value) ? value : []} onChange={setValue} path="" ctx={ctx} />
                                            {form.emptyAllowed && Array.isArray(value) && value.length === 0 && <p className="text-xs text-neutral-500">{t("emptyMeansNone")}</p>}
                                        </>
                                    )}
                                    {form.root === "json" && (
                                        <FieldInput field={{ key: "value", label: t("advanced"), kind: "json", required: true }} value={value} onChange={setValue} path="" ctx={ctx} />
                                    )}
                                    {issues.some(i => i.path === "") && <p role="alert" className="text-xs text-red-600">{issues.filter(i => i.path === "").map(i => i.message).join(" · ")}</p>}

                                    {(form.validation.length > 0 || form.example !== null) && (
                                        <details className="rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800">
                                            <summary className="cursor-pointer font-medium">{t("rules")}</summary>
                                            {form.validation.length > 0 && <ul className="mt-2 list-disc pl-5">{form.validation.map(v => <li key={v}>{v}</li>)}</ul>}
                                            {form.example !== null && <><p className="mt-2 font-medium">{t("example")}</p><pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(form.example, null, 2)}</pre></>}
                                        </details>
                                    )}

                                    {screen && screen.kind !== "none" && (
                                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                            {t("legacyScreen")}{" "}
                                            {screen.kind === "link" ? <Link href={screen.href} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t("openScreen")}</Link> : tp("action.askAdmin")}
                                        </p>
                                    )}

                                    <div className="flex gap-2">
                                        <button type="submit" disabled={!canWrite || saving}
                                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                                            {saving && <Loader2 size={14} className="animate-spin" />}{t("save")}
                                        </button>
                                        <button type="button" onClick={onClose} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
                                            {t("close")}
                                        </button>
                                    </div>
                                </form>
                            )}

                            {form.mode === "screen" && (
                                <div className="space-y-2 text-sm">
                                    <p>{t("screen")}</p>
                                    <ul className="space-y-1">
                                        {screens.map(s => (
                                            <li key={s.href}>
                                                {s.action.kind === "link"
                                                    ? <Link href={s.action.href} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">{s.href}</Link>
                                                    : <span>{s.href} — {tp("action.askAdmin")}</span>}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {form.mode === "none" && <p className="text-sm text-neutral-500">{t(`none.${form.reason ?? "derived"}`)}</p>}

                            {/* historial de versiones: quién y cuándo (aceptación R3 #2) */}
                            <section aria-label={t("versions.title")}>
                                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100"><History size={14} aria-hidden="true" />{t("versions.title")}</h3>
                                {versions.length ? (
                                    <ol className="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                                        {versions.map(v => (
                                            <li key={`${v.valueId}:${v.version}`}>
                                                {t("versions.entry", {
                                                    version: v.version, date: formatDate(v.createdAt),
                                                    origin: t.has(`origins.${v.origin}`) ? t(`origins.${v.origin}`) : v.origin,
                                                    actor: v.actor?.role ?? v.actor?.name ?? v.actor?.kind ?? "—",
                                                })}
                                            </li>
                                        ))}
                                    </ol>
                                ) : <p className="mt-1 text-xs text-neutral-500">{t("versions.empty")}</p>}
                            </section>
                        </>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
