/**
 * Copiloto de onboarding (C0 §1.3, rebanada R6, ADR 0012): los guardarraíles deterministas de una propuesta.
 *
 * Puro. El LLM propone y este código decide (C0 §0.6): una propuesta solo se guarda si
 * 1. el requisito existe, se guarda como valor del negocio y admite `copilot_approved` entre sus fuentes;
 * 2. el valor cumple `data.structure` (la misma `validateRequirementValue` que usa BusinessFactsService al escribir);
 * 3. trae al menos una cita, y CADA cita aparece tal cual (comparación normalizada) en el texto de la fuente que nombra;
 * 4. toda cifra, hora, fecha o monto del valor aparece en alguna de sus citas (extractor de §7.3), lo que elimina el
 *    precio o el horario inventado.
 * Si algo falla, la propuesta se descarta entera. Guardada, una propuesta no cuenta para la preparación: el motor no lee
 * propuestas, y el requisito sigue ausente hasta que una persona la aprueba.
 */
import { canonicalJson } from './hash';
import { extractFigures, isTextWithoutData } from './status';
import type { CompiledSpec } from './types';
import { weeklyHoursProblems } from './engine/evaluators/core';
import { isIsoDuration, isValueRequirement, validateRequirementValue, type ValueIssue } from './validate-value';

/** Una cita que respalda una propuesta: la referencia de la fuente y el texto copiado de ella. */
export interface CopilotEvidence {
    source_ref: string;
    quote: string;
}

/** Una fuente ya ingerida, tal como se le mostró al LLM (el texto recortado es el que se verifica). */
export interface CopilotSource {
    ref: string;
    kind: 'web' | 'document' | 'faq';
    label: string;
    url?: string | null;
    /** `knowledge_documents:<id>` o `faqs:<id>`: de dónde salió, para la procedencia. */
    origin: string;
    text: string;
}

export type CopilotRejectionCode =
    | 'unknown_requirement' | 'not_copilot_source' | 'invalid_value' | 'no_evidence' | 'unknown_source'
    | 'quote_too_short' | 'quote_not_verbatim' | 'figure_without_quote' | 'placeholder_value' | 'invalid_hours';

export interface CopilotRejection {
    code: CopilotRejectionCode;
    message: string;
}

export interface CopilotCheck {
    ok: boolean;
    rejections: CopilotRejection[];
    issues: ValueIssue[];
    /** Las citas verificadas, con la fuente resuelta (vacío si la propuesta se descarta). */
    evidence: (CopilotEvidence & { origin: string; url: string | null; label: string })[];
    /** El valor llevado a la forma del requisito (`normalizeCopilotValue`): es el que se guarda como propuesta. */
    value?: unknown;
}

/** Límites de una cita: corta no prueba nada («sí»), larga es copiar la página. */
export const MIN_QUOTE_CHARS = 8;
export const MAX_QUOTE_CHARS = 500;
export const MAX_EVIDENCE = 5;

/**
 * Texto comparable: Unicode NFKC, minúsculas, comillas y guiones tipográficos unificados y espacios colapsados. Así una
 * cita que el modelo copió de una página con saltos de línea o comillas curvas sigue siendo literal.
 */
export function normalizeQuoteText(text: string): string {
    return String(text ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[‘’‚‛′]/g, "'")
        .replace(/[“”„‟″«»]/g, '"')
        .replace(/[‐-―−]/g, '-')
        .replace(/…/g, '...')
        .replace(/\s+/g, ' ')
        .trim();
}

/** ¿La cita aparece tal cual en la fuente? (normalizada, nunca por parecido). */
export function quoteAppearsIn(sourceText: string, quote: string): boolean {
    const q = normalizeQuoteText(quote);
    return q.length > 0 && normalizeQuoteText(sourceText).includes(q);
}

/** Formas equivalentes de una cifra: `09:00` = `9:00` = `9` (en punto) = `9 pm` si son las 21; `50.000` = `50000`. */
function figureForms(raw: string): string[] {
    const t = raw.trim().toLowerCase();
    const time = t.match(/^(\d{1,2}):(\d{2})$/);
    if (time) {
        const h = Number(time[1]);
        const mm = time[2];
        const forms = [`${h}:${mm}`];
        if (mm === '00') forms.push(String(h));
        if (h > 12) forms.push(`${h - 12}:${mm}`, ...(mm === '00' ? [String(h - 12)] : []));
        if (h === 0) forms.push(`12:${mm}`, ...(mm === '00' ? ['12'] : []));
        return forms;
    }
    const digits = t.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return digits ? [digits] : [];
}

/** Cifras de un texto, en su forma comparable. */
function figureSet(text: string): Set<string> {
    const out = new Set<string>();
    for (const f of extractFigures(text)) for (const form of figureForms(f)) out.add(form);
    return out;
}

/** Cifras de un valor propuesto: las de cada texto y cada número (las claves no cuentan). */
export function valueFigures(value: unknown): string[] {
    const out: string[] = [];
    const walk = (v: unknown) => {
        if (v === null || v === undefined || typeof v === 'boolean') return;
        if (typeof v === 'number') { if (Number.isFinite(v)) out.push(String(v)); return; }
        if (typeof v === 'string') {
            // una duración ISO (`PT4H`) es una cifra; un código con dígitos entre letras (`B2C`, `4x4`) no lo es
            out.push(...extractFigures(isIsoDuration(v) ? v : v.replace(/\p{L}+\d+\p{L}+/gu, ' ')));
            return;
        }
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
    };
    walk(value);
    return out;
}

/** Cifras del valor que no aparecen en ninguna cita (vacío = todas respaldadas). */
export function figuresWithoutQuote(value: unknown, quotes: readonly string[]): string[] {
    const quoted = new Set<string>();
    for (const q of quotes) for (const f of figureSet(q)) quoted.add(f);
    return [...new Set(valueFigures(value))].filter(f => !figureForms(f).some(form => quoted.has(form)));
}

/** ¿El requisito lo puede proponer el copiloto? (valor del negocio con `copilot_approved` entre sus fuentes). */
export function isCopilotRequirement(spec: CompiledSpec, requirementId: string): boolean {
    const req = spec.requirements[requirementId];
    return Boolean(req) && isValueRequirement(req) && req.sources.allowed.includes('copilot_approved');
}

/**
 * Los guardarraíles de C0 §1.3 sobre una propuesta de valor. `sources` son las fuentes tal como se le mostraron al LLM:
 * una cita se busca en la fuente que nombra, no en cualquiera.
 */
export function checkCopilotProposal(
    spec: CompiledSpec,
    proposal: { requirementId: string; value: unknown; evidence: unknown },
    sources: ReadonlyMap<string, CopilotSource>,
): CopilotCheck {
    const rejections: CopilotRejection[] = [];
    let issues: ValueIssue[] = [];
    const reject = (code: CopilotRejectionCode, message: string): CopilotCheck => {
        rejections.push({ code, message });
        return { ok: false, rejections, issues, evidence: [] };
    };
    const id = String(proposal.requirementId ?? '');
    if (!spec.requirements[id]) return reject('unknown_requirement', `requisito desconocido: ${id}`);
    if (!isCopilotRequirement(spec, id)) return reject('not_copilot_source', `${id} no admite propuestas del copiloto`);

    // ADR 0031 fricción 2: el valor se lleva a la forma del requisito ANTES de validar (horario en tuplas, días con otro
    // nombre…), y un punto de contacto cuyo valor es el nombre del canal («WhatsApp») no es un dato: se descarta.
    const normalized = normalizeCopilotValue(spec, id, proposal.value);
    const value = normalized.value;
    if (normalized.droppedPlaceholders.length && contactPointsOf(value).length === 0) {
        return reject('placeholder_value', `sin datos reales: ${normalized.droppedPlaceholders.join(', ')}`);
    }
    issues = validateRequirementValue(spec, id, { value, status: 'confirmed', origin: 'copilot', scopeKey: '' });
    if (issues.length) return reject('invalid_value', issues.map(i => i.message).join('; '));
    const hours = copilotHoursProblems(spec, id, value);
    if (hours.length) return reject('invalid_hours', hours.join('; '));

    const evidence = Array.isArray(proposal.evidence) ? proposal.evidence : [];
    if (!evidence.length) return reject('no_evidence', 'sin cita no hay propuesta');
    const verified: CopilotCheck['evidence'] = [];
    for (const raw of evidence.slice(0, MAX_EVIDENCE)) {
        const ref = String((raw as Record<string, unknown>)?.source_ref ?? '');
        const quote = String((raw as Record<string, unknown>)?.quote ?? '').trim();
        const source = sources.get(ref);
        if (!source) return reject('unknown_source', `fuente desconocida: ${ref || '(vacía)'}`);
        const length = normalizeQuoteText(quote).length;
        if (length < MIN_QUOTE_CHARS || length > MAX_QUOTE_CHARS) {
            return reject('quote_too_short', `la cita debe tener entre ${MIN_QUOTE_CHARS} y ${MAX_QUOTE_CHARS} caracteres`);
        }
        if (!quoteAppearsIn(source.text, quote)) return reject('quote_not_verbatim', `la cita no aparece tal cual en ${ref}`);
        verified.push({ source_ref: ref, quote, origin: source.origin, url: source.url ?? null, label: source.label });
    }
    const missing = figuresWithoutQuote(value, verified.map(e => e.quote));
    if (missing.length) return reject('figure_without_quote', `cifras sin cita: ${missing.join(', ')}`);
    return { ok: true, rejections, issues, evidence: verified, value };
}

// ─────────────────────── forma del valor (ADR 0031, fricción 2) ───────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_ALIASES: Record<string, string> = {
    monday: 'mon', lunes: 'mon', tuesday: 'tue', martes: 'tue', wednesday: 'wed', miercoles: 'wed',
    thursday: 'thu', jueves: 'thu', friday: 'fri', viernes: 'fri', saturday: 'sat', sabado: 'sat', sunday: 'sun', domingo: 'sun',
};
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const dayKey = (k: string): string | null => {
    const f = fold(k);
    if ((WEEK_DAYS as readonly string[]).includes(f)) return f;
    return DAY_ALIASES[f] ?? null;
};
/** `8:00` → `08:00`, `9` → `09:00`; lo que no parece una hora sale igual (y el motor lo marcará). */
const hhmm = (raw: unknown): unknown => {
    const m = typeof raw === 'string' ? raw.trim().match(/^(\d{1,2})(?:[:.h](\d{2}))?$/i) : null;
    if (!m) return raw;
    const h = Number(m[1]);
    return h <= 24 ? `${String(h).padStart(2, '0')}:${m[2] ?? '00'}` : raw;
};
const isPair = (v: unknown): v is [string, string] => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'string');

/** Un tramo en la forma `{open, close}`: acepta `["08:00","18:00"]`, `"08:00-18:00"` y `{from, to}`. */
function normalizeSpan(span: unknown): unknown {
    if (isPair(span)) return { open: hhmm(span[0]), close: hhmm(span[1]) };
    if (typeof span === 'string') {
        const parts = span.split(/\s*(?:-|–|—|\ba\b|\bto\b)\s*/i).filter(Boolean);
        return parts.length === 2 ? { open: hhmm(parts[0]), close: hhmm(parts[1]) } : span;
    }
    if (isObj(span)) {
        const { from, to, start, end, ...rest } = span;
        return { ...rest, open: hhmm(rest.open ?? from ?? start), close: hhmm(rest.close ?? to ?? end) };
    }
    return span;
}

/** `weekly_hours` en la forma del requisito: `{always_open?, days: {mon: [{open, close}]…}}`. */
export function normalizeWeeklyHours(value: unknown): unknown {
    if (!isObj(value)) return value;
    const out: Obj = {};
    const rawDays: Obj = isObj(value.days) ? { ...value.days } : {};
    for (const [k, v] of Object.entries(value)) {
        if (k === 'days') continue;
        if (dayKey(k)) rawDays[k] = v; else out[k] = v;
    }
    const days: Obj = {};
    for (const [k, spans] of Object.entries(rawDays)) {
        const closed = spans === null || spans === false || (typeof spans === 'string' && /^(cerrado|closed)$/i.test(spans.trim()));
        const list = closed ? [] : Array.isArray(spans) && !isPair(spans) ? spans : [spans];
        days[dayKey(k) ?? k] = list.map(normalizeSpan);
    }
    if (Object.keys(days).length || 'days' in value) out.days = days;
    return out;
}

/** Dónde hay `weekly_hours` en el requisito: la raíz (`data.type`) o campos del objeto (`human_hours: weekly_hours …`). */
function weeklyHoursPaths(spec: CompiledSpec, requirementId: string): { root: boolean; fields: string[] } {
    const data = spec.requirements[requirementId]?.data;
    const structure = data?.structure;
    const fields = isObj(structure)
        ? Object.entries(structure).filter(([, d]) => /^weekly_hours\b/.test(String(d ?? '').trim())).map(([k]) => k.replace(/\?$/, ''))
        : [];
    return { root: String(data?.type ?? '') === 'weekly_hours', fields };
}

const CHANNEL_WORDS = new Set([
    'phone', 'telefono', 'tel', 'celular', 'movil', 'whatsapp', 'whats app', 'wa', 'email', 'e-mail', 'correo', 'correo electronico', 'mail',
    'web', 'website', 'sitio web', 'pagina web', 'social', 'redes', 'redes sociales', 'instagram', 'facebook', 'tiktok', 'twitter', 'linkedin',
]);

const contactPointsOf = (v: unknown): Obj[] => {
    const list = Array.isArray(v) ? v : isObj(v) && Array.isArray(v.points) ? v.points : [];
    return (list as unknown[]).filter(isObj);
};

/** Un punto de contacto cuyo valor está vacío o es el nombre del canal o su etiqueta («WhatsApp»): no es un dato. */
export function isPlaceholderContactPoint(point: unknown): boolean {
    if (!isObj(point)) return false;
    const value = fold(String(point.value ?? ''));
    if (!value) return true;
    return CHANNEL_WORDS.has(value) || value === fold(String(point.kind ?? '')) || (point.label != null && value === fold(String(point.label)));
}

/** Los puntos de contacto del valor que solo repiten el nombre del canal (para rechazar una aprobación). */
export function placeholderContactPoints(value: unknown): string[] {
    return contactPointsOf(value).filter(isPlaceholderContactPoint).map(p => `${String(p.kind ?? 'contacto')}: «${String(p.value ?? '')}»`);
}

/**
 * Lleva una propuesta del copiloto a la forma que valida el requisito (ADR 0031, fricción 2):
 * - horarios (`weekly_hours`, en la raíz o en un campo): tramos `["08:00","18:00"]` o `"8:00-18:00"` → `{open, close}`,
 *   días en inglés o en español → `mon…sun`, días sueltos en la raíz → `days`;
 * - contacto: se quitan los puntos cuyo valor es el nombre del canal («WhatsApp») y se informan en `droppedPlaceholders`.
 * Puro e idempotente: un valor ya bien formado sale igual.
 */
export function normalizeCopilotValue(spec: CompiledSpec, requirementId: string, value: unknown): { value: unknown; droppedPlaceholders: string[] } {
    let out = value;
    const hours = weeklyHoursPaths(spec, requirementId);
    if (hours.root) out = normalizeWeeklyHours(out);
    if (hours.fields.length && isObj(out)) {
        const copy: Obj = { ...out };
        for (const f of hours.fields) if (f in copy) copy[f] = normalizeWeeklyHours(copy[f]);
        out = copy;
    }
    const droppedPlaceholders: string[] = [];
    if (requirementId === 'CORE.CONTACT.CHANNELS') {
        const points = contactPointsOf(out);
        if (points.some(isPlaceholderContactPoint)) {
            droppedPlaceholders.push(...placeholderContactPoints(out));
            const kept = points.filter(p => !isPlaceholderContactPoint(p));
            out = Array.isArray(out) ? kept : { ...(out as Obj), points: kept };
        }
    }
    return { value: out, droppedPlaceholders };
}

/** Tramos que el motor marcaría «tramo inválido» o «cierre antes de apertura» (los días sin declarar los completa el dueño). */
export function copilotHoursProblems(spec: CompiledSpec, requirementId: string, value: unknown): string[] {
    const hours = weeklyHoursPaths(spec, requirementId);
    const targets: unknown[] = [];
    if (hours.root) targets.push(value);
    if (isObj(value)) for (const f of hours.fields) if (value[f] !== undefined) targets.push(value[f]);
    return targets.filter(isObj).flatMap(t => weeklyHoursProblems(t as Record<string, any>)).filter(p => !/sin declarar$/.test(p));
}

/** Dos valores iguales (sin importar el orden de las claves). */
export const sameCopilotValue = (a: unknown, b: unknown): boolean => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/**
 * Contenido genérico (C3): textos publicados que no dicen nada (patrón de desvío sin cifras, o demasiado cortos) o que
 * son de plantilla (`seeded`/`example`). El copiloto los convierte en preguntas al dueño; nunca los edita ni los borra.
 */
export function genericTextReason(text: { body: string; contentStatus?: string | null }): 'seeded' | 'example' | 'without_data' | null {
    if (text.contentStatus === 'seeded') return 'seeded';
    if (text.contentStatus === 'example') return 'example';
    return isTextWithoutData(text.body) ? 'without_data' : null;
}
