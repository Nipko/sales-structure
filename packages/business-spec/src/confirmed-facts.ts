/**
 * Datos confirmados por el negocio que el agente puede decir al cliente (C14, dental: «¿Aceptan tarjeta?» con
 * `CORE.PAYMENT.METHODS` confirmado y el agente respondía «no consta»).
 *
 * `RUNTIME_FACT_IDS` (horario, SLA, `not_offered`, identidad, políticas) llegan al agente por sus propias vías
 * (`BusinessFactsReader.hours/identity/policy`). Todo lo demás que el dueño confirmaba en el panel —medios de pago,
 * requisitos de la cita, reglas de cambio, idiomas, alcance clínico, anticipo, facturación…— no llegaba nunca.
 *
 * Decisión (documentada aquí y en la PR): la lista sale de la ESPECIFICACIÓN, no de una lista escrita a mano en la API.
 * Entra todo requisito que el agente ve en el turno (`exposure` `always_in_context` o `read_on_intent`) salvo:
 * - los de `RUNTIME_FACT_IDS` (ya llegan por su vía; repetirlos daría dos fuentes para el mismo dato);
 * - la configuración de comportamiento o seguridad que no es un dato para el cliente: `CORE.SAFETY.*`,
 *   `CORE.KNOWLEDGE.*` (incluye `AGENT_INSTRUCTIONS`), `CORE.HANDOFF.*`, `CORE.PRIVACY.CUSTOMER_MEMORY`,
 *   `DOM.*.SENSITIVE_DATA`, `OBJ.*.WRITE_MODE`, `OBJ.*.ACCOUNT_READ`, `OBJ.*.AVAILABILITY_SOURCE`;
 * - el catálogo (`CORE.OFFER.ITEMS/PRICE_MODEL/ITEM_DETAILS`, `OBJ.*.CATALOG`, tipos `item_list`): lo leen las
 *   herramientas, ficha por ficha.
 * Un requisito nuevo de la especificación con exposición al turno entra solo; uno de comportamiento debe quedar cubierto
 * por un patrón de exclusión (lo vigila la prueba de la lista).
 *
 * Solo cuenta un valor escrito en `requirement_values` (no una regla L sobre el almacenamiento viejo), `confirmed` y no
 * vencido (`valid_until`), con la misma resolución que el motor (`resolveValue`: contradicciones y vencidos fuera).
 * Opción B (dueño): un valor sembrado o de ejemplo no es un dato, es «no consta»; nunca se pinta.
 */
import { RUNTIME_FACT_IDS, factSnapshot, type FactSources } from './business-facts';
import { resolveValue } from './status';
import type { CompiledRequirement, CompiledSpec, TenantSnapshot, ValueRecord } from './types';

type Row = Record<string, any>;

/** Exposiciones que el agente ve en el turno. */
const TURN_EXPOSURES = new Set(['always_in_context', 'read_on_intent']);

/**
 * Requisitos que NO son un dato para el cliente aunque el agente los vea: configuración de comportamiento, seguridad,
 * traspasos, memoria o escritura, y el catálogo (lo leen las herramientas). `*` = un segmento del ID.
 */
export const CONFIRMED_FACT_EXCLUDED_PATTERNS: readonly string[] = [
    'CORE.SAFETY.*', 'CORE.KNOWLEDGE.*', 'CORE.HANDOFF.*', 'CORE.PRIVACY.CUSTOMER_MEMORY',
    'CORE.OFFER.ITEMS', 'CORE.OFFER.PRICE_MODEL', 'CORE.OFFER.ITEM_DETAILS',
    'DOM.*.SENSITIVE_DATA', 'OBJ.*.WRITE_MODE', 'OBJ.*.ACCOUNT_READ', 'OBJ.*.AVAILABILITY_SOURCE', 'OBJ.*.CATALOG',
];

const patternRegex = (pattern: string) => new RegExp(`^${pattern.split('.').map(p => (p === '*' ? '[^.]+' : p.replace(/[$()+?[\\\]^{|}]/g, '\\$&'))).join('\\.')}$`);
const EXCLUDED = CONFIRMED_FACT_EXCLUDED_PATTERNS.map(patternRegex);
const RUNTIME = new Set<string>(RUNTIME_FACT_IDS);

/** ¿Es un dato del negocio que el agente puede decir al cliente tal como el dueño lo confirmó? */
export function isConfirmedFactRequirement(req: CompiledRequirement): boolean {
    if (!TURN_EXPOSURES.has(req.exposure) || RUNTIME.has(req.id)) return false;
    if (EXCLUDED.some(re => re.test(req.id) || (req.templateId ? re.test(req.templateId) : false))) return false;
    return !String(req.data?.type ?? '').startsWith('item_list');
}

const idsCache = new WeakMap<CompiledSpec, string[]>();
/**
 * Los requisitos cuyos valores confirmados viajan al agente, en el orden de la especificación: primero los
 * `always_in_context`, después los `read_on_intent` (si el bloque se recorta, se recorta lo que solo se lee a pedido).
 */
export function confirmedFactIds(spec: CompiledSpec): string[] {
    const cached = idsCache.get(spec);
    if (cached) return cached;
    const reqs = spec.order.map(id => spec.requirements[id]).filter((r): r is CompiledRequirement => Boolean(r) && isConfirmedFactRequirement(r));
    const ids = [...reqs.filter(r => r.exposure === 'always_in_context'), ...reqs.filter(r => r.exposure !== 'always_in_context')].map(r => r.id);
    idsCache.set(spec, ids);
    return ids;
}

/** Un dato confirmado listo para el prompt: el tema (título de la especificación) y el valor en texto legible. */
export interface ConfirmedFactView {
    id: string;
    /** Título del requisito en la especificación. */
    title: string;
    /** Alcance del valor (`scope_key`), si no es el general. */
    scope?: string;
    /** El valor en texto legible (listas separadas por coma, enums sin guion bajo), ya recortado. */
    text: string;
}

export const CONFIRMED_FACT_MAX_CHARS = 360;
export const CONFIRMED_FACTS_MAX_TOTAL_CHARS = 2400;

/**
 * Los datos confirmados del tenant, en el orden de `confirmedFactIds`. Solo valores de `requirement_values`
 * confirmados, vigentes y sin contradicción; uno vacío (`[]`, `{}`) no dice nada y no se pinta.
 */
export function resolveConfirmedFacts(spec: CompiledSpec, src: FactSources, now: Date, snap: TenantSnapshot = factSnapshot(src)): ConfirmedFactView[] {
    const out: ConfirmedFactView[] = [];
    for (const id of confirmedFactIds(spec)) {
        // solo lo escrito en `requirement_values`: una regla L sobre el almacenamiento viejo no es el dueño confirmando
        const records = (snap.values[id] ?? []).filter((r: ValueRecord) => r.legacyRule == null && r.storage === 'requirement_values');
        if (!records.length) continue;
        for (const scope of [...new Set(records.map(r => r.scopeKey ?? ''))].sort()) {
            const resolved = resolveValue(records, now, scope);
            if (resolved.state !== 'confirmado' || !resolved.record) continue;
            const text = clipText(renderFactValue(resolved.record.value), CONFIRMED_FACT_MAX_CHARS);
            if (!text) continue;
            out.push({ id, title: spec.requirements[id].title, ...(scope ? { scope } : {}), text });
        }
    }
    return out;
}

// ─────────────────────────── texto legible ───────────────────────────

/** Nombres legibles de los campos más comunes de los valores (los demás: la clave sin guion bajo). */
const FIELD_LABELS: Readonly<Record<string, string>> = {
    notes: 'notas', by_channel: 'por canal', agent_languages: 'idiomas del agente', human_languages: 'idiomas del equipo',
    content_source_language: 'idioma del contenido', translate_content: 'traduce el contenido', when: 'cuándo', deposit: 'anticipo',
    amount: 'monto', refundable: 'reembolsable', deadline: 'plazo', scope: 'alcance', installments: 'cuotas', partners: 'entidades',
    insurers_accepted: 'aseguradoras o convenios', enabled: 'disponible', required_fields: 'datos requeridos', confirms: 'confirma',
    sla: 'tiempo', electronic_invoice: 'factura electrónica', no_invoice: 'no emite factura', disclaimer: 'descargo',
    requires_assessment: 'se define en valoración', human_only: 'solo con una persona', own_urgent_line: 'línea de urgencias propia',
    external: 'línea externa', urgent_slot: 'cita de urgencia', published_advice: 'indicaciones publicadas', red_flags: 'señales de alarma',
    operating_country: 'país', timezone: 'zona horaria', currency: 'moneda', default_locale: 'idioma base', agent_can_modify: 'cambios por el agente',
    agent_can_cancel: 'cancelación por el agente', terms: 'condiciones', explicit_confirmation: 'confirmación explícita', ask_reason: 'pregunta el motivo',
    documents: 'documentos', conditions: 'condiciones', cancel: 'cancelación', change: 'cambios', no_show: 'inasistencia',
    late_tolerance: 'tolerancia de llegada tarde', charge: 'cargo', refund: 'reembolso', summary: 'resumen', hours: 'horario', value: 'valor',
    kind: 'tipo', label: 'nombre', items: 'ítems', list: 'lista', date: 'fecha', dates: 'fechas', reason: 'motivo', mode: 'modo',
};

const LANGUAGE_KEYS = /^[a-z]{2}(?:-[A-Z]{2})?$/;
/** Un `text_i18n` ({es: '…', en: '…'}): todas sus claves son idiomas y sus valores texto. */
const isI18n = (o: Row) => {
    const entries = Object.entries(o);
    return entries.length > 0 && entries.every(([k, v]) => LANGUAGE_KEYS.test(k) && (typeof v === 'string' || v === null));
};

/** Un valor de enum (`tarjeta_débito`, `link_de_pago`) se dice con espacios: «tarjeta débito». */
const IDENT = /^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+$/u;
const humanize = (s: string) => (IDENT.test(s) ? s.replace(/_/g, ' ') : s);
const labelOf = (key: string) => FIELD_LABELS[key] ?? key.replace(/_/g, ' ');

const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)
    || (typeof v === 'object' && v !== null && !Array.isArray(v) && !Object.keys(v).length);

/**
 * Un valor confirmado como texto para el cliente, en español del panel: listas separadas por coma, `sí`/`no`, montos y
 * duraciones compactos, objetos como «campo: valor; campo: valor» (un objeto de una sola clave, solo su valor).
 */
export function renderFactValue(value: unknown, language = 'es', depth = 0): string {
    if (depth > 5 || value === null || value === undefined) return '';
    if (typeof value === 'string') return humanize(value.replace(/\s+/g, ' ').trim());
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (value === true) return 'sí';
    if (value === false) return 'no';
    if (Array.isArray(value)) {
        const parts = value.map(v => renderFactValue(v, language, depth + 1)).filter(Boolean);
        // ítems estructurados (requisitos por trámite, sedes) van separados por «|» para no mezclar sus comas
        const structured = value.some(v => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 1);
        return parts.join(structured ? ' | ' : ', ');
    }
    if (typeof value === 'object') {
        const o = value as Row;
        if (isI18n(o)) {
            const pick = o[language] ?? o.es ?? Object.values(o).find(v => typeof v === 'string' && v.trim());
            return typeof pick === 'string' ? pick.replace(/\s+/g, ' ').trim() : '';
        }
        if ('amount' in o && 'currency' in o && Object.keys(o).length <= 3) return `${renderFactValue(o.amount, language, depth + 1)} ${o.currency}`.trim();
        if ('min' in o && 'unit' in o) return `${o.min}${o.max !== undefined && o.max !== null ? `–${o.max}` : ''} ${humanize(String(o.unit))}`;
        const entries = Object.entries(o).filter(([, v]) => !empty(v));
        if (entries.length === 1 && depth === 0) return renderFactValue(entries[0][1], language, depth + 1);
        const parts = entries.map(([k, v]) => {
            const text = renderFactValue(v, language, depth + 1);
            return text ? `${labelOf(k)}: ${text}` : '';
        }).filter(Boolean);
        return depth === 0 ? parts.join('; ') : parts.join(', ');
    }
    return '';
}

const clipText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * El bloque «Datos confirmados por el negocio» para el prompt: una línea por dato («- Tema: valor»), en el orden dado,
 * con un tope total. Lo que no cabe se omite entero (nunca un dato a medias) y se dice cuántos quedaron fuera.
 */
export function renderConfirmedFacts(facts: readonly ConfirmedFactView[], options: { maxChars?: number } = {}): string[] {
    const max = options.maxChars ?? CONFIRMED_FACTS_MAX_TOTAL_CHARS;
    const lines: string[] = [];
    let used = 0;
    let omitted = 0;
    for (const f of facts) {
        const line = `${f.title}${f.scope ? ` (${f.scope})` : ''}: ${f.text}`;
        if (used + line.length > max) { omitted++; continue; }
        lines.push(line);
        used += line.length;
    }
    if (omitted) lines.push(`(${omitted} dato(s) más no caben aquí)`);
    return lines;
}
