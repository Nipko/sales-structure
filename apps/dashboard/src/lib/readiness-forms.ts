/**
 * Formularios del panel de preparación (C0 §1.6, C6, rebanada R3): lo que pinta el cajón de un hueco.
 *
 * El descriptor lo arma `formFor()` de `@parallext/business-spec` en la API (`GET /readiness/:t/requirements/:id`):
 * el panel no sabe de requisitos, solo interpreta un descriptor de campos tipados. Aquí viven las tres piezas puras
 * que usa el cajón, sin React:
 * - `initialFormValue`: el valor del formulario a partir del que lee el motor (también uno heredado), quedándose
 *   solo con los campos que el formulario conoce (la API rechaza campos desconocidos);
 * - `formIssues`: la validación en el cliente con las restricciones del descriptor (las mismas que exige la API más
 *   las que el evaluador necesita para cumplir; readiness-forms.spec.ts lo cruza con `validateRequirementValue`);
 * - `submitValue`: el valor que se envía, sin campos vacíos ni ocultos.
 */

export type FormFieldKind =
    | "text" | "textarea" | "number" | "bool" | "enum" | "enum_list" | "string_list"
    | "duration" | "money" | "day_spans" | "address" | "url" | "email"
    | "object" | "list" | "ref_or_own" | "fixed" | "readonly" | "json";

export interface FormOption { value: string; label: string }
export interface FormCondition { field: string; in?: string[]; notIn?: string[] }

/** Espejo de `FormField` (packages/business-spec/src/forms/descriptor.ts). */
export interface FormField {
    key: string;
    label: string;
    kind: FormFieldKind;
    required: boolean;
    help?: string;
    options?: FormOption[];
    open?: boolean;
    fields?: FormField[];
    units?: string[];
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    ref?: string;
    fixed?: unknown;
    when?: FormCondition;
}

/** Espejo de `FormDescriptor`. */
export interface FormDescriptor {
    schema: "business-spec/form@1";
    requirementId: string;
    title: string;
    type: string;
    mode: "form" | "screen" | "none";
    reason?: "catalog" | "items" | "derived" | "platform" | "not_owner";
    screens: { object: string | null; uiTarget: string }[];
    root: "object" | "list" | "json";
    fields: FormField[];
    emptyAllowed: boolean;
    validation: string[];
    example: unknown;
    help: string;
    defaults: { acceptable: boolean; behavior: string } | null;
}

export interface StoredValueRecord {
    value: unknown;
    status: string;
    origin: string;
    confirmedAt?: string | null;
    confirmedBy?: string | null;
    storage?: string;
    legacyRule?: string | null;
}

/** Fila de `requirement_values` (BusinessFactView). */
export interface BusinessFact {
    id: string;
    requirementId: string;
    scopeKey: string;
    value: unknown;
    status: string;
    origin: string;
    confirmedBy: string | null;
    confirmedAt: string | null;
    specVersion: string;
    version: number;
    updatedAt: string;
}

/** Versión de un valor (`GET …/business-facts/:id/versions`). */
export interface BusinessFactVersion extends Omit<BusinessFact, "id" | "updatedAt"> {
    valueId: string;
    actor: { kind?: string; userId?: string | null; role?: string | null; name?: string; delegation?: unknown } | null;
    createdAt: string;
}

/** `GET /readiness/:tenantId/requirements/:requirementId`. */
export interface RequirementDetailResponse {
    specVersion: string;
    definition: {
        id: string; title: string; layer: string; kind: string; level: string; rule: string; predicate: string;
        whenMissing: { code: string; behavior: string; never: string[] };
        uiToday: string; uiTarget: string | null; platform: boolean;
        answers: { id: string; title: string }[];
    };
    evaluation: { id: string; result: string; valueState: string | null; detail?: string; gap?: { cause: string; message: string } } | null;
    evaluatedAt: string;
    form: FormDescriptor;
    current: { state: string; record: StoredValueRecord | null; conflicts: StoredValueRecord[] };
    fact: BusinessFact | null;
}

/** `PUT …/business-facts/:id`. */
export interface BusinessFactWriteResponse {
    fact: BusinessFact;
    readiness: { verdictBefore: string | null; verdictAfter: string; requirement: { id: string; result: string } | null } | null;
}

/** `GET …/business-facts/defaults`. */
export interface BusinessFactDefault {
    id: string;
    title: string;
    level: string;
    question: string;
    behavior: string;
    example: unknown;
    result: string | null;
    status: "accepted" | "configured" | "pending";
    fact: BusinessFact | null;
}

export interface FormIssue { path: string; code: "required" | "enum" | "type" | "pattern" | "length" | "items" | "hours"; message: string }

export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const HHMM = /^([01]\d|2[0-4]):[0-5]\d$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
export const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && !v.trim());

/** Elección «usar la política general» de un campo `ref_or_own` (la forma que lee el evaluador: un texto `ref <ID>`). */
export const refValue = (ref: string) => `ref ${ref}`;
export const isRefValue = (v: unknown): v is string => typeof v === "string" && v.startsWith("ref ");

/** ¿Se muestra el campo con los valores actuales de su objeto? */
export function isVisible(field: FormField, siblings: Obj): boolean {
    const w = field.when;
    if (!w) return true;
    const raw = siblings[w.field];
    const value = raw === undefined || raw === null ? "" : String(raw);
    if (w.in && !w.in.includes(value)) return false;
    if (w.notIn && w.notIn.includes(value)) return false;
    return true;
}

/** Valor vacío de un campo para el formulario. */
export function emptyFieldValue(field: FormField): unknown {
    switch (field.kind) {
        case "fixed": return field.fixed;
        case "enum_list": case "string_list": case "list": return [];
        case "day_spans": return Object.fromEntries(WEEK_DAYS.map(d => [d, []]));
        case "object": case "address": return emptyObject(field.fields ?? []);
        default: return undefined;
    }
}
const emptyObject = (fields: FormField[]): Obj => {
    const out: Obj = {};
    for (const f of fields) {
        const v = emptyFieldValue(f);
        if (v !== undefined) out[f.key] = v;
    }
    return out;
};

/** Se queda con lo que el formulario conoce (más los campos de solo lectura, que se conservan tal cual). */
function pickField(field: FormField, v: unknown): unknown {
    if (v === undefined || v === null) return emptyFieldValue(field);
    switch (field.kind) {
        case "object": case "address": return isObj(v) ? pickObject(field.fields ?? [], v) : emptyFieldValue(field);
        case "list": return Array.isArray(v) ? v.map(item => (isObj(item) ? pickObject(field.fields ?? [], item) : item)) : [];
        case "ref_or_own": return isRefValue(v) ? v : isObj(v) ? pickObject(field.fields ?? [], v) : undefined;
        case "enum_list": case "string_list": return Array.isArray(v) ? v.map(String) : [];
        case "day_spans": {
            const days = isObj(v) ? v : {};
            return Object.fromEntries(WEEK_DAYS.map(d => [d, Array.isArray(days[d])
                ? (days[d] as unknown[]).map(s => (Array.isArray(s) ? { open: String(s[0] ?? ""), close: String(s[1] ?? "") } : isObj(s) ? s : { open: "", close: "" }))
                : []]));
        }
        case "fixed": return field.fixed;
        default: return v;
    }
}
function pickObject(fields: FormField[], v: Obj): Obj {
    const out: Obj = {};
    for (const f of fields) {
        const picked = pickField(f, v[f.key]);
        if (picked !== undefined) out[f.key] = picked;
    }
    return out;
}

/**
 * Valor inicial del formulario. `current` es lo que lee el motor ahora (puede ser heredado de una pantalla vieja):
 * así confirmar un dato heredado es revisarlo y guardar.
 */
export function initialFormValue(form: FormDescriptor, current: unknown): unknown {
    if (form.root === "list") {
        return Array.isArray(current) ? current.map(item => (isObj(item) && form.fields.length ? pickObject(form.fields, item) : item)) : [];
    }
    if (form.root === "json") return current ?? {};
    return pickObject(form.fields, isObj(current) ? current : {});
}

// ─────────────────────────── validación ───────────────────────────

const hasItems = (v: unknown) => Array.isArray(v) && v.length > 0;
const join = (path: string, key: string | number) => (path ? `${path}.${key}` : String(key));

function checkField(field: FormField, v: unknown, path: string, issues: FormIssue[]): void {
    if (field.kind === "readonly" || field.kind === "fixed" || field.kind === "json") return;
    const listKind = field.kind === "enum_list" || field.kind === "string_list" || field.kind === "list";
    const missing = listKind ? !hasItems(v) && (field.required || (field.minItems ?? 0) > 0) : field.required && isBlankField(field, v);
    if (missing) {
        issues.push({ path, code: listKind && !field.required ? "items" : "required", message: `${field.label}: obligatorio` });
        return;
    }
    if (isBlank(v)) return;
    switch (field.kind) {
        case "enum":
            if (field.options && !field.options.some(o => o.value === String(v))) issues.push({ path, code: "enum", message: `${field.label}: opción inválida` });
            break;
        case "enum_list":
            if (!Array.isArray(v)) { issues.push({ path, code: "type", message: `${field.label}: debe ser una lista` }); break; }
            if (!field.open && field.options) {
                const bad = v.filter(x => !field.options!.some(o => o.value === String(x)));
                if (bad.length) issues.push({ path, code: "enum", message: `${field.label}: ${bad.join(", ")} no está en la lista` });
            }
            if (field.minItems && v.length < field.minItems) issues.push({ path, code: "items", message: `${field.label}: al menos ${field.minItems}` });
            break;
        case "string_list":
            if (!Array.isArray(v)) issues.push({ path, code: "type", message: `${field.label}: debe ser una lista` });
            else if (field.minItems && v.filter(x => !isBlank(x)).length < field.minItems) issues.push({ path, code: "items", message: `${field.label}: al menos ${field.minItems}` });
            break;
        case "bool":
            if (typeof v !== "boolean") issues.push({ path, code: "type", message: `${field.label}: sí o no` });
            break;
        case "number":
            if (typeof v !== "number" || !Number.isFinite(v)) issues.push({ path, code: "type", message: `${field.label}: número` });
            break;
        case "duration": {
            const d = isObj(v) ? v : {};
            if (typeof d.min !== "number" || !Number.isFinite(d.min) || d.min < 0) issues.push({ path: join(path, "min"), code: "type", message: `${field.label}: cantidad` });
            if (isBlank(d.unit) || (field.units && !field.units.includes(String(d.unit)))) issues.push({ path: join(path, "unit"), code: "enum", message: `${field.label}: unidad` });
            break;
        }
        case "money": {
            const m = isObj(v) ? v : {};
            if (typeof m.amount !== "number" || !Number.isFinite(m.amount) || m.amount < 0) issues.push({ path: join(path, "amount"), code: "type", message: `${field.label}: monto` });
            if (!/^[A-Z]{3}$/.test(String(m.currency ?? ""))) issues.push({ path: join(path, "currency"), code: "pattern", message: `${field.label}: moneda ISO-4217` });
            break;
        }
        case "day_spans": {
            const days = isObj(v) ? v : {};
            for (const d of WEEK_DAYS) {
                const spans = Array.isArray(days[d]) ? (days[d] as unknown[]).map(s => (isObj(s) ? s : {})) : [];
                const sorted = [...spans].sort((a, b) => String(a.open).localeCompare(String(b.open)));
                let lastClose = -1;
                sorted.forEach(s => {
                    if (!HHMM.test(String(s.open)) || !HHMM.test(String(s.close))) { issues.push({ path: join(path, d), code: "hours", message: `${d}: HH:MM` }); return; }
                    const o = toMin(String(s.open));
                    const c = toMin(String(s.close));
                    if (c <= o && s.crosses_midnight !== true) issues.push({ path: join(path, d), code: "hours", message: `${d}: el cierre es antes de la apertura` });
                    if (o < lastClose) issues.push({ path: join(path, d), code: "hours", message: `${d}: tramos solapados` });
                    lastClose = c;
                });
            }
            break;
        }
        case "url":
            if (!/^https?:\/\/\S+$/i.test(String(v))) issues.push({ path, code: "pattern", message: `${field.label}: URL (https://…)` });
            break;
        case "email":
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) issues.push({ path, code: "pattern", message: `${field.label}: correo` });
            break;
        case "object": case "address":
            checkObject(field.fields ?? [], isObj(v) ? v : {}, path, issues);
            break;
        case "list":
            if (Array.isArray(v)) v.forEach((item, i) => checkObject(field.fields ?? [], isObj(item) ? item : {}, join(path, i), issues));
            break;
        case "ref_or_own":
            if (!isRefValue(v)) checkObject(field.fields ?? [], isObj(v) ? v : {}, path, issues);
            break;
        default: {
            const s = String(v);
            if (field.minLength && s.trim().length < field.minLength) issues.push({ path, code: "length", message: `${field.label}: al menos ${field.minLength} caracteres` });
            if (field.maxLength && s.length > field.maxLength) issues.push({ path, code: "length", message: `${field.label}: máximo ${field.maxLength} caracteres` });
            if (field.pattern && !new RegExp(field.pattern).test(s)) issues.push({ path, code: "pattern", message: `${field.label}: formato inválido` });
        }
    }
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function isBlankField(field: FormField, v: unknown): boolean {
    if (field.kind === "object" || field.kind === "address") return !isObj(v) || Object.values(v).every(x => isBlank(x) || (Array.isArray(x) && !x.length));
    if (field.kind === "duration" || field.kind === "money") return !isObj(v);
    if (field.kind === "day_spans") return !isObj(v);
    return isBlank(v);
}

function checkObject(fields: FormField[], v: Obj, path: string, issues: FormIssue[]): void {
    for (const f of fields) if (isVisible(f, v)) checkField(f, v[f.key], join(path, f.key), issues);
}

/** Problemas del valor según el descriptor (lista vacía = se puede guardar). */
export function formIssues(form: FormDescriptor, value: unknown): FormIssue[] {
    const issues: FormIssue[] = [];
    if (form.root === "list") {
        if (!Array.isArray(value)) return [{ path: "", code: "type", message: "debe ser una lista" }];
        if (!value.length && !form.emptyAllowed) return [{ path: "", code: "items", message: "agrega al menos uno" }];
        if (form.fields.length) value.forEach((item, i) => checkObject(form.fields, isObj(item) ? item : {}, String(i), issues));
        return issues;
    }
    if (form.root === "json") return isObj(value) || Array.isArray(value) ? [] : [{ path: "", code: "type", message: "JSON inválido" }];
    checkObject(form.fields, isObj(value) ? value : {}, "", issues);
    return issues;
}

// ─────────────────────────── envío ───────────────────────────

function cleanField(field: FormField, v: unknown): unknown {
    if (field.kind === "readonly") return v;
    if (field.kind === "fixed") return field.fixed;
    switch (field.kind) {
        case "object": case "address": {
            const o = cleanObject(field.fields ?? [], isObj(v) ? v : {});
            return Object.keys(o).length ? o : undefined;
        }
        case "list": return Array.isArray(v) ? v.map(item => cleanObject(field.fields ?? [], isObj(item) ? item : {})) : undefined;
        case "ref_or_own": return isRefValue(v) ? v : isObj(v) ? cleanObject(field.fields ?? [], v) : undefined;
        case "string_list": return Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : undefined;
        case "duration": case "money": return isObj(v) && !isBlank(v.min ?? v.amount) ? v : undefined;
        default: return isBlank(v) ? undefined : v;
    }
}
function cleanObject(fields: FormField[], v: Obj): Obj {
    const out: Obj = {};
    for (const f of fields) {
        if (!isVisible(f, v)) continue;
        const c = cleanField(f, v[f.key]);
        if (c !== undefined) out[f.key] = c;
    }
    return out;
}

/** El valor que se envía a `PUT …/business-facts/:id`: sin vacíos ni campos ocultos. */
export function submitValue(form: FormDescriptor, value: unknown): unknown {
    if (form.root === "list") return Array.isArray(value) ? value.map(item => (isObj(item) && form.fields.length ? cleanObject(form.fields, item) : item)) : [];
    if (form.root === "json") return value;
    return cleanObject(form.fields, isObj(value) ? value : {});
}

/** Lee y escribe un campo dentro del valor del formulario por ruta (`cancel.deadline`, `locations.0.name`). */
export function setAt(root: unknown, path: (string | number)[], next: unknown): unknown {
    if (!path.length) return next;
    const [head, ...rest] = path;
    if (typeof head === "number") {
        const arr = Array.isArray(root) ? [...root] : [];
        arr[head] = setAt(arr[head], rest, next);
        return arr;
    }
    const obj = isObj(root) ? { ...root } : {};
    obj[head] = setAt(obj[head], rest, next);
    return obj;
}
