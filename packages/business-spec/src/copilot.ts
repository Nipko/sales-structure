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
    | 'quote_too_short' | 'quote_not_verbatim' | 'figure_without_quote' | 'placeholder_value' | 'invalid_hours'
    | 'no_document_fact' | 'owner_decision' | 'country_without_quote';

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
    // ADR 0031 (recall): en los requisitos que mezclan hechos y decisiones, solo los campos de hecho (COPILOT_FACT_SHAPES).
    const normalized = normalizeCopilotValue(spec, id, proposal.value, { factsOnly: true });
    const value = normalized.value;
    const shape = copilotFactShape(spec, id);
    if (normalized.droppedPlaceholders.length && (shape ? !hasFactData(shape, value) : contactPointsOf(value).length === 0)) {
        return reject('placeholder_value', `sin datos reales: ${normalized.droppedPlaceholders.join(', ')}`);
    }
    if (shape && !hasFactData(shape, value)) {
        return reject('no_document_fact', `${id}: la propuesta no trae ninguno de estos datos: ${Object.keys(shape.fields).join(', ')}`);
    }
    issues = validateRequirementValue(spec, id, { value, status: 'confirmed', origin: 'copilot', scopeKey: '' });
    if (issues.length) return reject('invalid_value', issues.map(i => i.message).join('; '));
    const hours = copilotHoursProblems(spec, id, value);
    if (hours.length) return reject('invalid_hours', hours.join('; '));
    const decisions = copilotOwnerDecisions(spec, id, value);
    if (decisions.length) return reject('owner_decision', decisions.join('; '));
    const shapeProblems = copilotValueProblems(spec, id, value);
    if (shapeProblems.length) return reject('invalid_value', shapeProblems.join('; '));

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
    // «Nunca se infiere el país» (REGION.when_missing): el país propuesto aparece, por nombre o código, en alguna cita.
    const country = id === REGION && isObj(value) && typeof value.operating_country === 'string' ? value.operating_country : null;
    if (country && !countryAppearsIn(country, verified.map(e => e.quote))) {
        return reject('country_without_quote', `el país ${country} no aparece en las citas`);
    }
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
 * - región: país por código o nombre → ISO-3166 alfa-2, moneda → ISO-4217 en mayúsculas, zona → nombre IANA canónico,
 *   idioma → BCP-47 canónico; idiomas por nombre («español») → código. Lo que no se reconoce sale igual (y se rechaza
 *   en `copilotValueProblems`: nunca se adivina);
 * - línea de urgencias cuyo valor es el nombre del canal: se quita, como en contacto;
 * - `factsOnly` (la extracción, y aprobar sin editar): en los requisitos de `COPILOT_FACT_SHAPES` se quitan los campos
 *   que no son hechos del documento (decisiones del dueño o de la plataforma). Lo que el dueño edita no se recorta.
 * Puro e idempotente: un valor ya bien formado sale igual.
 */
export function normalizeCopilotValue(
    spec: CompiledSpec, requirementId: string, value: unknown, options: { factsOnly?: boolean } = {},
): { value: unknown; droppedPlaceholders: string[]; droppedFields: string[] } {
    let out = value;
    const hours = weeklyHoursPaths(spec, requirementId);
    if (hours.root) out = normalizeWeeklyHours(out);
    if (hours.fields.length && isObj(out)) {
        const copy: Obj = { ...out };
        for (const f of hours.fields) if (f in copy) copy[f] = normalizeWeeklyHours(copy[f]);
        out = copy;
    }
    const droppedPlaceholders: string[] = [];
    if (CONTACT_LIST_REQUIREMENTS.has(requirementId)) {
        const points = contactPointsOf(out);
        if (points.some(isPlaceholderContactPoint)) {
            droppedPlaceholders.push(...placeholderContactPoints(out));
            const kept = points.filter(p => !isPlaceholderContactPoint(p));
            out = Array.isArray(out) ? kept : { ...(out as Obj), points: kept };
        }
    }
    const lineField = CONTACT_POINT_FIELDS[requirementId];
    if (lineField && isObj(out) && isPlaceholderContactPoint(out[lineField])) {
        const point = out[lineField] as Obj;
        droppedPlaceholders.push(`${String(point.kind ?? lineField)}: «${String(point.value ?? '')}»`);
        const rest: Obj = { ...out };
        delete rest[lineField];
        out = rest;
    }
    if (requirementId === REGION && isObj(out)) out = normalizeRegion(out);
    if (requirementId === LANGUAGES && isObj(out)) out = normalizeLanguages(out);
    const droppedFields: string[] = [];
    const shape = options.factsOnly ? copilotFactShape(spec, requirementId) : undefined;
    if (shape && isObj(out)) {
        const kept: Obj = {};
        for (const [k, v] of Object.entries(out)) {
            if (k in shape.fields) kept[k] = v; else droppedFields.push(k);
        }
        out = kept;
    }
    return { value: out, droppedPlaceholders, droppedFields };
}

/** Tramos que el motor marcaría «tramo inválido» o «cierre antes de apertura» (los días sin declarar los completa el dueño). */
export function copilotHoursProblems(spec: CompiledSpec, requirementId: string, value: unknown): string[] {
    const hours = weeklyHoursPaths(spec, requirementId);
    const targets: unknown[] = [];
    if (hours.root) targets.push(value);
    if (isObj(value)) for (const f of hours.fields) if (value[f] !== undefined) targets.push(value[f]);
    return targets.filter(isObj).flatMap(t => weeklyHoursProblems(t as Record<string, any>)).filter(p => !/sin declarar$/.test(p));
}

// ─────────────────────── hechos del documento (ADR 0031, recall) ───────────────────────

const REGION = 'CORE.IDENTITY.REGION';
const LANGUAGES = 'CORE.LANGUAGES.SERVED';
/** Requisitos cuyo valor es una lista de puntos de contacto. */
const CONTACT_LIST_REQUIREMENTS = new Set(['CORE.CONTACT.CHANNELS', 'CORE.CONTACT.SPECIAL']);
/** Requisitos con un campo que es UN punto de contacto (la línea de urgencias). */
const CONTACT_POINT_FIELDS: Readonly<Record<string, string>> = {
    'DOM.HEALTH.EMERGENCY_PROTOCOL': 'own_urgent_line',
    'DOM.VETERINARY.EMERGENCY': 'line',
};

/** Los campos que el copiloto propone de un requisito, en palabras del dueño (es lo que ve el modelo), y un ejemplo. */
export interface CopilotFactShape {
    fields: Readonly<Record<string, string>>;
    example: unknown;
}

/**
 * Requisitos abiertos al copiloto cuyo valor mezcla hechos que un negocio escribe en sus documentos con decisiones del
 * dueño o de la plataforma (ADR 0031, recall). El copiloto solo propone los campos de esta tabla; el resto (el pack de
 * país, «directo», las señales de alarma de la plataforma, el descargo clínico…) lo decide el dueño en el formulario.
 * La clave es el ID del requisito o su plantilla (`OBJ.*.X`).
 */
export const COPILOT_FACT_SHAPES: Readonly<Record<string, CopilotFactShape>> = {
    [REGION]: {
        fields: {
            operating_country: 'país donde opera el negocio, como código ISO de 2 letras (CO, MX, BR, ES…); solo si una fuente nombra el país',
            timezone: 'zona horaria del negocio como nombre IANA (America/Bogota, America/Mexico_City…)',
            currency: 'moneda de sus precios como código ISO de 3 letras (COP, MXN, USD…)',
            default_locale: 'idioma principal del negocio como código BCP-47 (es-CO, pt-BR…)',
        },
        example: { operating_country: 'CO', timezone: 'America/Bogota', currency: 'COP' },
    },
    [LANGUAGES]: {
        fields: {
            human_languages: 'lista de idiomas en que atiende el equipo, como códigos (es, en, pt…)',
            content_source_language: 'idioma en que el negocio escribe su información, como código (es, en, pt…)',
        },
        example: { human_languages: ['es', 'en'], content_source_language: 'es' },
    },
    'CORE.HANDOFF.HOURS_SLA': {
        fields: {
            human_hours: 'horario en que responde una persona del equipo: {days: {mon: [{open: "08:00", close: "18:00"}], …}}',
            sla_in_hours: 'en cuánto tiempo responde una persona dentro de ese horario: {min: número, unit: min|h|d}',
            sla_out_of_hours: 'fuera de horario: "siguiente_apertura" (responden al abrir) o una duración como PT4H',
            out_of_hours_message: 'lo que el negocio le dice al cliente fuera de horario (texto)',
            callback_offered: 'sí/no: el negocio ofrece devolver la llamada',
        },
        example: { human_hours: { days: { mon: [{ open: '08:00', close: '18:00' }] } }, sla_in_hours: { min: 15, unit: 'min' }, sla_out_of_hours: 'siguiente_apertura' },
    },
    'CORE.PRIVACY.NOTICE': {
        fields: {
            controller: 'quién responde por los datos personales: {name, email?, phone?}',
            purposes: 'para qué usa el negocio los datos (texto)',
            url_or_text: 'enlace al aviso o política de privacidad, o su texto',
        },
        example: { controller: { name: 'Sonrisa SAS', email: 'datos@sonrisa.co' }, url_or_text: 'https://sonrisa.co/privacidad' },
    },
    'OBJ.*.CHANGE_RULES': {
        fields: {
            agent_can_modify: 'cómo cambia el cliente lo reservado o pedido: "solicitud" (lo pide y el equipo lo gestiona) o "no" (no se puede)',
            agent_can_cancel: 'cómo cancela el cliente: "solicitud" o "no"',
            terms: '"ref CORE.POLICY.CANCELLATION_CHANGES" si remite a la política general de cancelación, o {deadline, charge} propios',
        },
        example: { agent_can_modify: 'solicitud', agent_can_cancel: 'solicitud', terms: 'ref CORE.POLICY.CANCELLATION_CHANGES' },
    },
    'DOM.HEALTH.EMERGENCY_PROTOCOL': {
        fields: {
            own_urgent_line: 'línea de urgencias propia del negocio: {kind: phone|whatsapp, value: el número, hours?}',
            urgent_slot: 'sí/no: el negocio ofrece citas de urgencia',
            published_advice: 'consejos para urgencias que el negocio publica (copiados de la fuente)',
        },
        example: { own_urgent_line: { kind: 'phone', value: '+57 300 000 0000', hours: '24/7' }, urgent_slot: true },
    },
    'DOM.HEALTH.CLINICAL_SCOPE': {
        fields: { requires_assessment: 'lista de servicios cuyo precio o duración se define en una valoración' },
        example: { requires_assessment: ['Ortodoncia', 'Implantes'] },
    },
    'DOM.VETERINARY.EMERGENCY': {
        fields: {
            line: 'línea de urgencias veterinarias (propia o de referencia): {kind: phone|whatsapp, value: el número, label?, hours?}',
            published_first_aid: 'primeros auxilios que el negocio publica (copiados de la fuente)',
        },
        example: { line: { kind: 'phone', value: '+57 1 555 0000', label: 'Urgencias 24 h' } },
    },
};

/** La forma de hechos del requisito (por ID o por plantilla), o undefined si el copiloto propone el valor entero. */
export function copilotFactShape(spec: CompiledSpec, requirementId: string): CopilotFactShape | undefined {
    const req = spec.requirements[requirementId];
    if (!req) return undefined;
    return COPILOT_FACT_SHAPES[requirementId] ?? (req.templateId ? COPILOT_FACT_SHAPES[req.templateId] : undefined);
}

/** Lo que ve el modelo de un requisito: la forma de hechos (en palabras del dueño) o la estructura de la especificación. */
export function copilotPromptShape(spec: CompiledSpec, requirementId: string): { structure: unknown; example: unknown } {
    const shape = copilotFactShape(spec, requirementId);
    if (shape) return { structure: shape.fields, example: shape.example };
    const data = spec.requirements[requirementId]?.data;
    return { structure: data?.structure ?? null, example: data?.example ?? null };
}

const hasData = (v: unknown): boolean =>
    v !== null && v !== undefined && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && v.length === 0)
    && !(isObj(v) && Object.keys(v).length === 0);
const hasFactData = (shape: CopilotFactShape, value: unknown): boolean =>
    isObj(value) && Object.keys(shape.fields).some(k => hasData(value[k]));

/**
 * Aprobar sin editar una propuesta de hechos: el valor confirmado de hoy conserva lo que el copiloto no propone (el pack
 * de país, los idiomas del agente, las señales de alarma aceptadas…). Sin forma de hechos, la propuesta es el valor.
 */
export function mergeCopilotValue(spec: CompiledSpec, requirementId: string, current: unknown, proposed: unknown): unknown {
    return copilotFactShape(spec, requirementId) && isObj(current) && isObj(proposed) ? { ...current, ...proposed } : proposed;
}

/** ¿La propuesta dice lo mismo que el valor confirmado? Con forma de hechos, se comparan solo los campos propuestos. */
export function copilotValueAgrees(spec: CompiledSpec, requirementId: string, proposed: unknown, current: unknown): boolean {
    if (copilotFactShape(spec, requirementId) && isObj(proposed) && isObj(current)) {
        return Object.entries(proposed).every(([k, v]) => sameCopilotValue(v, current[k]));
    }
    return sameCopilotValue(proposed, current);
}

/** Puntos de contacto que solo repiten el nombre del canal, en cualquier requisito de contacto (para rechazar una aprobación). */
export function copilotPlaceholders(requirementId: string, value: unknown): string[] {
    if (CONTACT_LIST_REQUIREMENTS.has(requirementId)) return placeholderContactPoints(value);
    const field = CONTACT_POINT_FIELDS[requirementId];
    if (!field || !isObj(value) || !isPlaceholderContactPoint(value[field])) return [];
    const point = value[field] as Obj;
    return [`${String(point.kind ?? field)}: «${String(point.value ?? '')}»`];
}

/**
 * Decisiones del dueño que un documento no toma: «directo» en CHANGE_RULES le da al agente el poder de cambiar o cancelar
 * solo, y eso exige WRITE_MODE = direct_commit, que decide el dueño.
 */
export function copilotOwnerDecisions(spec: CompiledSpec, requirementId: string, value: unknown): string[] {
    if (spec.requirements[requirementId]?.templateId !== 'OBJ.*.CHANGE_RULES' || !isObj(value)) return [];
    return ['agent_can_modify', 'agent_can_cancel'].filter(f => value[f] === 'directo')
        .map(f => `${f} = «directo» (el agente lo hace solo) lo decide el dueño, no un documento`);
}

// región e idiomas: se validan contra los datos del runtime (Intl), nunca contra una lista propia que envejece

const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB']);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pairs = (): string[] => [...LETTERS].flatMap(a => [...LETTERS].map(b => a + b));
const displayName = (locale: string, type: 'region' | 'language', code: string): string | undefined => {
    try { return new Intl.DisplayNames([locale], { type, fallback: 'none' }).of(code) ?? undefined; } catch { return undefined; }
};

let countryNames: Map<string, string> | null = null;
/** Nombre del país (es/en, sin tildes ni mayúsculas) → código. */
function countryByName(): Map<string, string> {
    if (countryNames) return countryNames;
    countryNames = new Map();
    for (const code of pairs()) {
        if (NOT_COUNTRIES.has(code)) continue;
        for (const locale of ['es', 'en']) {
            const name = displayName(locale, 'region', code);
            if (name) countryNames.set(fold(name), code);
        }
    }
    return countryNames;
}

export const isCountryCode = (v: unknown): boolean =>
    typeof v === 'string' && /^[A-Z]{2}$/.test(v) && !NOT_COUNTRIES.has(v) && displayName('en', 'region', v) !== undefined;

function countryCode(raw: string): string | null {
    const t = raw.trim();
    if (/^[a-z]{2}$/i.test(t)) return isCountryCode(t.toUpperCase()) ? t.toUpperCase() : null;
    return countryByName().get(fold(t)) ?? null;
}

const supported = (key: 'currency' | 'timeZone'): string[] => {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    try { return fn ? fn(key) : []; } catch { return []; }
};

export const isCurrencyCode = (v: unknown): boolean => {
    if (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v)) return false;
    const list = supported('currency');
    return list.length ? list.includes(v) : true;
};

/** Zona IANA de un lugar («America/Bogota»): ni «UTC», ni «GMT-5», ni `Etc/…`, que no dicen dónde está el negocio. */
export const isIanaTimezone = (v: unknown): boolean => {
    if (typeof v !== 'string' || !v.includes('/') || /^etc\//i.test(v) || v.length > 64) return false;
    try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
};

function canonicalTimezone(raw: string): string {
    const t = raw.trim();
    return supported('timeZone').find(z => z.toLowerCase() === t.toLowerCase()) ?? t;
}

function canonicalLocale(raw: string): string | null {
    try { return Intl.getCanonicalLocales(raw.trim().replace(/_/g, '-'))[0] ?? null; } catch { return null; }
}

/** Código de idioma conocido (`es`, `pt-BR`): canónico y con un idioma base que el runtime nombra. */
export const isLanguageCode = (v: unknown): boolean => {
    if (typeof v !== 'string' || canonicalLocale(v) !== v) return false;
    const base = v.split('-')[0];
    return /^[a-z]{2,3}$/.test(base) && displayName('en', 'language', base) !== undefined;
};

let languageNames: Map<string, string> | null = null;
/** Nombre del idioma (es/en) → código: «español» → `es`. */
function languageByName(): Map<string, string> {
    if (languageNames) return languageNames;
    languageNames = new Map([['castellano', 'es']]);
    for (const code of pairs().map(c => c.toLowerCase())) {
        for (const locale of ['es', 'en']) {
            const name = displayName(locale, 'language', code);
            if (name && fold(name) !== code) languageNames.set(fold(name), code);
        }
    }
    return languageNames;
}

function languageCode(raw: unknown): unknown {
    if (typeof raw !== 'string') return raw;
    const byName = languageByName().get(fold(raw));
    if (byName) return byName;
    const canonical = /^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(raw.trim()) ? canonicalLocale(raw) : null;
    return canonical ?? raw.trim();
}

function normalizeRegion(v: Obj): Obj {
    const out: Obj = { ...v };
    if (typeof out.operating_country === 'string') out.operating_country = countryCode(out.operating_country) ?? out.operating_country.trim();
    if (typeof out.currency === 'string' && /^[a-z]{3}$/i.test(out.currency.trim())) out.currency = out.currency.trim().toUpperCase();
    if (typeof out.timezone === 'string') out.timezone = canonicalTimezone(out.timezone);
    if (typeof out.default_locale === 'string') out.default_locale = canonicalLocale(out.default_locale) ?? out.default_locale.trim();
    return out;
}

function normalizeLanguages(v: Obj): Obj {
    const out: Obj = { ...v };
    for (const f of ['human_languages', 'agent_languages']) if (Array.isArray(out[f])) out[f] = [...new Set((out[f] as unknown[]).map(languageCode))];
    if (out.content_source_language !== undefined) out.content_source_language = languageCode(out.content_source_language);
    return out;
}

/**
 * Lo que la escritura no revisa y el copiloto no puede dejar pasar (se rechaza; nunca se adivina): país ISO-3166, zona
 * IANA, moneda ISO-4217 e idioma BCP-47 en la región, y códigos de idioma reales en los idiomas de atención.
 */
export function copilotValueProblems(spec: CompiledSpec, requirementId: string, value: unknown): string[] {
    if (!spec.requirements[requirementId] || !isObj(value)) return [];
    const problems: string[] = [];
    const show = (v: unknown) => JSON.stringify(v);
    if (requirementId === REGION) {
        if (hasData(value.operating_country) && !isCountryCode(value.operating_country)) problems.push(`operating_country ${show(value.operating_country)} no es un país (código ISO de 2 letras)`);
        if (hasData(value.timezone) && !isIanaTimezone(value.timezone)) problems.push(`timezone ${show(value.timezone)} no es una zona horaria IANA (p. ej. America/Bogota)`);
        if (hasData(value.currency) && !isCurrencyCode(value.currency)) problems.push(`currency ${show(value.currency)} no es una moneda ISO-4217 (p. ej. COP)`);
        if (hasData(value.default_locale) && !isLanguageCode(value.default_locale)) problems.push(`default_locale ${show(value.default_locale)} no es un idioma BCP-47 (p. ej. es-CO)`);
    }
    if (requirementId === LANGUAGES) {
        for (const f of ['human_languages', 'agent_languages']) {
            if (value[f] === undefined) continue;
            const list = value[f];
            if (!Array.isArray(list)) { problems.push(`${f} debe ser una lista de idiomas`); continue; }
            const bad = list.filter(x => !isLanguageCode(x));
            if (bad.length) problems.push(`${f}: idiomas no reconocidos (${bad.map(show).join(', ')})`);
        }
        if (hasData(value.content_source_language) && !isLanguageCode(value.content_source_language)) {
            problems.push(`content_source_language ${show(value.content_source_language)} no es un idioma reconocido`);
        }
    }
    return problems;
}

/** ¿El país aparece en alguna cita, por nombre (es/en) o por su código en mayúsculas? */
export function countryAppearsIn(code: string, quotes: readonly string[]): boolean {
    const names = ['es', 'en'].map(l => displayName(l, 'region', code)).filter((n): n is string => Boolean(n)).map(fold);
    const word = new RegExp(`(^|[^A-Za-z])${code}([^A-Za-z]|$)`);
    return quotes.some(q => word.test(q) || names.some(n => fold(q).includes(n)));
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
