"use client";

/**
 * Componentes por tipo de campo del cajón de preparación (C0 §1.6, C6): uno por `kind` del descriptor que arma
 * `formFor()` en la API. Se generan por tipo, no por requisito; ningún componente sabe de un requisito concreto.
 */
import { useId } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    WEEK_DAYS, emptyFieldValue, isRefValue, isVisible, refValue,
    type FormField, type FormIssue, type FormOption,
} from "@/lib/readiness-forms";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);

const INPUT = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const SMALL_BUTTON = "inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";
/** Una clave de catálogo i18n solo si no rompe la ruta de next-intl (sin puntos, espacios ni barras). */
const SAFE_KEY = /^[\p{L}\p{N}_]+$/u;

export interface FieldContext {
    disabled: boolean;
    /** Problemas por ruta (`cancel.deadline`, `locations.0.name`). */
    issues: Map<string, FormIssue[]>;
}

function useLabels() {
    const t = useTranslations("readinessForms");
    return {
        t,
        label: (f: FormField) => (SAFE_KEY.test(f.key) && t.has(`fields.${f.key}`) ? t(`fields.${f.key}`) : f.label),
        option: (o: FormOption) => (SAFE_KEY.test(o.value) && t.has(`options.${o.value}`) ? t(`options.${o.value}`) : o.label),
    };
}

function Issues({ path, ctx }: { path: string; ctx: FieldContext }) {
    const list = ctx.issues.get(path);
    if (!list?.length) return null;
    return <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{list.map(i => i.message).join(" · ")}</p>;
}

/** Un campo con su etiqueta, ayuda y errores. */
export function FieldInput({ field, value, onChange, path, ctx }: {
    field: FormField; value: unknown; onChange: (next: unknown) => void; path: string; ctx: FieldContext;
}) {
    const id = useId();
    const { t, label, option } = useLabels();
    const name = label(field);
    const helpId = field.help ? `${id}-help` : undefined;
    const head = (
        <label htmlFor={id} className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {name}{field.required && <span className="text-red-600" aria-hidden="true"> *</span>}
        </label>
    );
    const help = field.help ? <p id={helpId} className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{field.help}</p> : null;
    const wrap = (control: React.ReactNode) => (
        <div className="space-y-1" data-field={path}>{head}{control}{help}<Issues path={path} ctx={ctx} /></div>
    );

    switch (field.kind) {
        case "readonly":
            return (
                <div className="rounded-lg bg-neutral-50 p-2 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400" data-field={path}>
                    <span className="font-medium">{name}:</span>{" "}
                    {value === undefined || value === null ? t("readonly.empty") : typeof value === "string" ? value : JSON.stringify(value)}
                    {" · "}{field.ref ? t("readonly.ref", { ref: field.ref }) : t("readonly.platform")}
                </div>
            );
        case "fixed":
            return <p className="text-xs text-neutral-500 dark:text-neutral-400" data-field={path}>{name}: {t("fixed")}</p>;
        case "text": case "url": case "email":
            return wrap(<input id={id} aria-describedby={helpId} type={field.kind === "text" ? "text" : field.kind} className={INPUT} disabled={ctx.disabled}
                value={typeof value === "string" ? value : ""} maxLength={field.maxLength} onChange={e => onChange(e.target.value)} />);
        case "textarea":
            return wrap(<textarea id={id} aria-describedby={helpId} rows={3} className={INPUT} disabled={ctx.disabled}
                value={typeof value === "string" ? value : ""} maxLength={field.maxLength} onChange={e => onChange(e.target.value)} />);
        case "number":
            return wrap(<input id={id} aria-describedby={helpId} type="number" className={INPUT} disabled={ctx.disabled}
                value={typeof value === "number" ? value : ""} onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />);
        case "bool":
            // tres estados: sin declarar no es «no» (un hecho sin declarar es un hueco distinto)
            return wrap(
                <select id={id} aria-describedby={helpId} className={INPUT} disabled={ctx.disabled}
                    value={value === true ? "true" : value === false ? "false" : ""}
                    onChange={e => onChange(e.target.value === "" ? undefined : e.target.value === "true")}>
                    <option value="">{t("bool.unset")}</option>
                    <option value="true">{t("bool.yes")}</option>
                    <option value="false">{t("bool.no")}</option>
                </select>,
            );
        case "enum":
            return wrap(
                <select id={id} aria-describedby={helpId} className={INPUT} disabled={ctx.disabled}
                    value={typeof value === "string" ? value : ""} onChange={e => onChange(e.target.value || undefined)}>
                    <option value="">{t("choose")}</option>
                    {(field.options ?? []).map(o => <option key={o.value} value={o.value}>{option(o)}</option>)}
                </select>,
            );
        case "enum_list": {
            const selected = Array.isArray(value) ? value.map(String) : [];
            const extra = selected.filter(v => !(field.options ?? []).some(o => o.value === v));
            const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
            return (
                <fieldset className="space-y-1" data-field={path} aria-describedby={helpId}>
                    <legend className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}{field.required && <span className="text-red-600" aria-hidden="true"> *</span>}</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {(field.options ?? []).map(o => (
                            <label key={o.value} className="inline-flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-300">
                                <input type="checkbox" disabled={ctx.disabled} checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                                {option(o)}
                            </label>
                        ))}
                    </div>
                    {/* lista cerrada (R4: WRITE_MODE.required_fields) con un valor guardado antes fuera de ella: se ve y se puede quitar */}
                    {!field.open && extra.length > 0 && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {extra.map(v => (
                                <label key={v} className="inline-flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-300">
                                    <input type="checkbox" disabled={ctx.disabled} checked onChange={() => toggle(v)} />
                                    {v} {t("notInList")}
                                </label>
                            ))}
                        </div>
                    )}
                    {field.open && (
                        <StringList label={t("other")} values={extra} disabled={ctx.disabled}
                            onChange={next => onChange([...selected.filter(v => (field.options ?? []).some(o => o.value === v)), ...next])} />
                    )}
                    {help}<Issues path={path} ctx={ctx} />
                </fieldset>
            );
        }
        case "string_list":
            return (
                <fieldset className="space-y-1" data-field={path} aria-describedby={helpId}>
                    <legend className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}{field.required && <span className="text-red-600" aria-hidden="true"> *</span>}</legend>
                    <StringList label={name} values={Array.isArray(value) ? value.map(String) : []} disabled={ctx.disabled} onChange={onChange} />
                    {help}<Issues path={path} ctx={ctx} />
                </fieldset>
            );
        case "duration": {
            const d = isObj(value) ? value : {};
            return (
                <fieldset className="space-y-1" data-field={path} aria-describedby={helpId}>
                    <legend className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}{field.required && <span className="text-red-600" aria-hidden="true"> *</span>}</legend>
                    <div className="flex gap-2">
                        <input aria-label={t("duration.amount", { field: name })} type="number" min={0} className={cn(INPUT, "w-28")} disabled={ctx.disabled}
                            value={typeof d.min === "number" ? d.min : ""}
                            onChange={e => onChange(e.target.value === "" && !d.unit ? undefined : { ...d, min: e.target.value === "" ? undefined : Number(e.target.value), unit: d.unit ?? field.units?.[0] })} />
                        <select aria-label={t("duration.unit", { field: name })} className={cn(INPUT, "w-36")} disabled={ctx.disabled}
                            value={typeof d.unit === "string" ? d.unit : ""} onChange={e => onChange({ ...d, unit: e.target.value || undefined })}>
                            <option value="">{t("choose")}</option>
                            {(field.units ?? []).map(u => <option key={u} value={u}>{t.has(`units.${u}`) ? t(`units.${u}`) : u}</option>)}
                        </select>
                    </div>
                    {help}<Issues path={path} ctx={ctx} /><Issues path={`${path}.min`} ctx={ctx} /><Issues path={`${path}.unit`} ctx={ctx} />
                </fieldset>
            );
        }
        case "money": {
            const m = isObj(value) ? value : {};
            return (
                <fieldset className="space-y-1" data-field={path} aria-describedby={helpId}>
                    <legend className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}{field.required && <span className="text-red-600" aria-hidden="true"> *</span>}</legend>
                    <div className="flex gap-2">
                        <input aria-label={t("money.amount", { field: name })} type="number" min={0} className={cn(INPUT, "w-36")} disabled={ctx.disabled}
                            value={typeof m.amount === "number" ? m.amount : ""} onChange={e => onChange({ ...m, amount: e.target.value === "" ? undefined : Number(e.target.value) })} />
                        <input aria-label={t("money.currency", { field: name })} className={cn(INPUT, "w-24 uppercase")} maxLength={3} disabled={ctx.disabled}
                            value={typeof m.currency === "string" ? m.currency : ""} onChange={e => onChange({ ...m, currency: e.target.value.toUpperCase() })} />
                    </div>
                    {help}<Issues path={path} ctx={ctx} /><Issues path={`${path}.amount`} ctx={ctx} /><Issues path={`${path}.currency`} ctx={ctx} />
                </fieldset>
            );
        }
        case "day_spans":
            return (
                <fieldset className="space-y-2" data-field={path} aria-describedby={helpId}>
                    <legend className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}{field.required && <span className="text-red-600" aria-hidden="true"> *</span>}</legend>
                    {help}
                    <DaySpans value={isObj(value) ? value : {}} disabled={ctx.disabled} onChange={onChange} path={path} ctx={ctx} />
                    <Issues path={path} ctx={ctx} />
                </fieldset>
            );
        case "object": case "address":
            return (
                <fieldset className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" data-field={path}>
                    <legend className="px-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}{field.required && <span className="text-red-600" aria-hidden="true"> *</span>}</legend>
                    {help}
                    <ObjectFields fields={field.fields ?? []} value={isObj(value) ? value : {}} onChange={onChange} path={path} ctx={ctx} />
                    <Issues path={path} ctx={ctx} />
                </fieldset>
            );
        case "list":
            return (
                <fieldset className="space-y-2" data-field={path}>
                    <legend className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}{field.required && <span className="text-red-600" aria-hidden="true"> *</span>}</legend>
                    {help}
                    <ItemList fields={field.fields ?? []} value={Array.isArray(value) ? value : []} onChange={onChange} path={path} ctx={ctx} />
                    <Issues path={path} ctx={ctx} />
                </fieldset>
            );
        case "ref_or_own": {
            const useRef = isRefValue(value);
            const own = isObj(value) ? value : {};
            return (
                <fieldset className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" data-field={path}>
                    <legend className="px-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}{field.required && <span className="text-red-600" aria-hidden="true"> *</span>}</legend>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name={`${id}-ref`} disabled={ctx.disabled} checked={useRef} onChange={() => onChange(refValue(String(field.ref)))} />
                        {t("refOrOwn.ref")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name={`${id}-ref`} disabled={ctx.disabled} checked={!useRef && isObj(value)} onChange={() => onChange({})} />
                        {t("refOrOwn.own")}
                    </label>
                    {!useRef && isObj(value) && <ObjectFields fields={field.fields ?? []} value={own} onChange={onChange} path={path} ctx={ctx} />}
                    {help}<Issues path={path} ctx={ctx} />
                </fieldset>
            );
        }
        case "json":
            return wrap(<JsonInput id={id} value={value} disabled={ctx.disabled} onChange={onChange} />);
        default:
            return null;
    }
}

/** Campos de un objeto, con su visibilidad condicional. */
export function ObjectFields({ fields, value, onChange, path, ctx }: {
    fields: FormField[]; value: Obj; onChange: (next: Obj) => void; path: string; ctx: FieldContext;
}) {
    return (
        <div className="space-y-3">
            {fields.filter(f => isVisible(f, value)).map(f => (
                <FieldInput key={f.key} field={f} value={value[f.key]} path={path ? `${path}.${f.key}` : f.key} ctx={ctx}
                    onChange={next => onChange({ ...value, [f.key]: next })} />
            ))}
        </div>
    );
}

/** Lista de elementos con los mismos campos (sedes, cargos, reglas…). */
export function ItemList({ fields, value, onChange, path, ctx }: {
    fields: FormField[]; value: unknown[]; onChange: (next: unknown[]) => void; path: string; ctx: FieldContext;
}) {
    const t = useTranslations("readinessForms");
    const fresh = () => Object.fromEntries(fields.map(f => [f.key, emptyFieldValue(f)]).filter(([, v]) => v !== undefined));
    return (
        <div className="space-y-2">
            {value.map((item, i) => (
                <div key={i} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                    <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
                        <span>{t("list.item", { n: i + 1 })}</span>
                        <button type="button" className={SMALL_BUTTON} disabled={ctx.disabled} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                            <Trash2 size={12} aria-hidden="true" />{t("list.remove")}
                        </button>
                    </div>
                    {fields.length
                        ? <ObjectFields fields={fields} value={isObj(item) ? item : {}} path={path ? `${path}.${i}` : String(i)} ctx={ctx}
                            onChange={next => onChange(value.map((x, j) => (j === i ? next : x)))} />
                        : <input aria-label={t("list.item", { n: i + 1 })} className={INPUT} disabled={ctx.disabled} value={typeof item === "string" ? item : ""}
                            onChange={e => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />}
                </div>
            ))}
            <button type="button" className={SMALL_BUTTON} disabled={ctx.disabled} onClick={() => onChange([...value, fields.length ? fresh() : ""])}>
                <Plus size={12} aria-hidden="true" />{t("list.add")}
            </button>
        </div>
    );
}

function StringList({ label, values, onChange, disabled }: { label: string; values: string[]; onChange: (next: string[]) => void; disabled: boolean }) {
    const t = useTranslations("readinessForms");
    return (
        <div className="space-y-1">
            {values.map((v, i) => (
                <div key={i} className="flex gap-2">
                    <input aria-label={`${label} ${i + 1}`} className={INPUT} disabled={disabled} value={v} onChange={e => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button type="button" className={SMALL_BUTTON} disabled={disabled} aria-label={t("list.removeItem", { n: i + 1 })} onClick={() => onChange(values.filter((_, j) => j !== i))}>
                        <Trash2 size={12} aria-hidden="true" />
                    </button>
                </div>
            ))}
            <button type="button" className={SMALL_BUTTON} disabled={disabled} onClick={() => onChange([...values, ""])}>
                <Plus size={12} aria-hidden="true" />{t("list.add")}
            </button>
        </div>
    );
}

/** Horario por día: tramos {open, close}; un día sin tramos es «cerrado» (también es un valor). */
function DaySpans({ value, onChange, disabled, path, ctx }: { value: Obj; onChange: (next: Obj) => void; disabled: boolean; path: string; ctx: FieldContext }) {
    const t = useTranslations("readinessForms");
    const spansOf = (d: string): Obj[] => (Array.isArray(value[d]) ? (value[d] as unknown[]).map(s => (isObj(s) ? s : {})) : []);
    const setDay = (d: string, spans: Obj[]) => onChange({ ...Object.fromEntries(WEEK_DAYS.map(k => [k, spansOf(k)])), [d]: spans });
    return (
        <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {WEEK_DAYS.map(d => {
                const spans = spansOf(d);
                return (
                    <div key={d} className="flex flex-col gap-1 p-2 sm:flex-row sm:items-start">
                        <span className="w-24 shrink-0 pt-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">{t(`days.${d}`)}</span>
                        <div className="flex-1 space-y-1">
                            {!spans.length && <p className="pt-1 text-xs text-neutral-500">{t("hours.closed")}</p>}
                            {spans.map((s, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <input type="time" aria-label={t("hours.open", { day: t(`days.${d}`), n: i + 1 })} className={cn(INPUT, "w-32")} disabled={disabled}
                                        value={typeof s.open === "string" ? s.open : ""} onChange={e => setDay(d, spans.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))} />
                                    <span aria-hidden="true">–</span>
                                    <input type="time" aria-label={t("hours.close", { day: t(`days.${d}`), n: i + 1 })} className={cn(INPUT, "w-32")} disabled={disabled}
                                        value={typeof s.close === "string" ? s.close : ""} onChange={e => setDay(d, spans.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))} />
                                    <button type="button" className={SMALL_BUTTON} disabled={disabled} aria-label={t("hours.removeSpan", { day: t(`days.${d}`), n: i + 1 })}
                                        onClick={() => setDay(d, spans.filter((_, j) => j !== i))}>
                                        <Trash2 size={12} aria-hidden="true" />
                                    </button>
                                </div>
                            ))}
                            <button type="button" className={SMALL_BUTTON} disabled={disabled} onClick={() => setDay(d, [...spans, { open: "", close: "" }])}>
                                <Plus size={12} aria-hidden="true" />{t("hours.addSpan")}
                            </button>
                            <Issues path={`${path}.${d}`} ctx={ctx} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function JsonInput({ id, value, onChange, disabled }: { id: string; value: unknown; onChange: (next: unknown) => void; disabled: boolean }) {
    const t = useTranslations("readinessForms");
    return (
        <>
            <textarea id={id} rows={8} className={cn(INPUT, "font-mono text-xs")} disabled={disabled} defaultValue={JSON.stringify(value ?? {}, null, 2)}
                onChange={e => { try { onChange(JSON.parse(e.target.value)); } catch { /* se valida al guardar */ } }} />
            <p className="text-xs text-neutral-500">{t("json")}</p>
        </>
    );
}
