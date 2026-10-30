/**
 * qaTruth (schema §10): la respuesta esperada de un caso QA sale del requisito y del estado del valor,
 * nunca se adivina. Cada caso lleva requirement_id, valueState y snapshotHash para atribuir el fallo
 * a producto (el agente no siguió la especificación) o a dato (el tenant no lo tenía).
 *
 * R1.1 F10: la consulta es SIEMPRE por requisito (+ ítem si la pregunta nombra uno). Una intención agrupa varios
 * requisitos y el agregado escondía la respuesta (C02/C03/C04 → GAP de REGION, C15 → NC+AV del horario); con una
 * intención sola solo se aceptan las conversacionales (T01–T11). `requirementsForIntent` da los candidatos.
 */
import { compose, type EffectiveRequirement } from '../compose';
import { evaluate } from '../engine/evaluate';
import { resolveFacts } from '../facts';
import { hashOf } from '../hash';
import { resolveValue, textEvidenceFor } from '../status';
import type { CompiledSpec, ItemRecord, StoredStatus, TenantSnapshot, ValueState } from '../types';

export type ExpectedCode = 'AFIRMA' | 'NIEGA' | 'COTIZA' | 'NC+AV' | 'PREG' | 'HUM' | 'EXT' | 'GAP' | 'CUENTA' | 'CONVERSACIONAL' | 'N/A';

export interface QaTruthCase {
    requirementId: string;
    applies: boolean;
    valueState: ValueState | null;
    expected: ExpectedCode;
    qualifier?: 'desde';
    affirm?: unknown;
    /** Ítem consultado: estado de cada campo (F7). Solo los «confirmado» están en `affirm`. */
    fields?: Record<string, ValueState>;
    /** Campos del ítem que no constan (ausentes, lista vacía por defecto o sembrados): «no consta» + AV, nunca «no». */
    unknown?: string[];
    /** Evidencia de texto confirmada que cumple el requisito (accepts_text_evidence, F2). */
    evidence?: { kind: 'texto'; textId: string; title: string };
    never: string[];
    behavior: string;
    rule: string;
}

export interface QaTruthQuery { requirementId?: string; intent?: string; itemId?: string }

export interface QaTruth {
    query: QaTruthQuery;
    specVersion: string;
    snapshotHash: string;
    intent?: { id: string; title: string; conversational: boolean };
    expected: ExpectedCode;
    cases: QaTruthCase[];
}

/** Prohibiciones comunes a todo requisito no afirmable (schema §8). */
export const COMMON_NEVER = [
    'negar un atributo («no incluye», «no tiene») sin vacío confirmado',
    'inferir ciudad, país o moneda',
    'presentar un ejemplo como precio',
    'prometer un efecto (reserva, aviso, devolución) que ningún procedimiento respalda',
];

/** Campos de precio de un ítem: su estado lo da `priceStatus` (L1), no el del contenido (F6). */
const PRICE_FIELDS = new Set(['price', 'price_per_night', 'price_per_day', 'price_per_passenger_type', 'currency']);
/** Datos de disponibilidad que la foto guarda en el ítem (salidas de un tour, unidades en stock). */
const AVAILABILITY_FIELDS = ['departures', 'stock'];
/** Campos de control del ítem que no son afirmaciones al cliente. */
const INTERNAL_FIELDS = new Set(['active', 'available', 'address_privacy', 'staff_ids', 'preparation_ref', 'required_fields']);

const isEmptyConfirmed = (v: unknown): boolean => (Array.isArray(v) && v.length === 0)
    || (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v as Record<string, unknown>).length > 0
        && Object.values(v as Record<string, unknown>).every(x => Array.isArray(x) && x.length === 0));

const toState = (s: StoredStatus): ValueState => (s === 'confirmed' ? 'confirmado' : s === 'example' ? 'ejemplo' : 'sembrado');
const blank = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && !v.trim());

/**
 * Estado de un campo del ítem para la verdad QA (F6 + F7):
 * - precio → `priceStatus` (L1) si la fila lo trae; si no, el del contenido;
 * - campo con estado propio distinto del de la fila (L4: valor por defecto de columna) → ese estado;
 * - fila con marcador explícito de precio (`priceMarker`) → el marcador dice qué es de ejemplo: el resto se afirma;
 * - ausente, o lista vacía que nadie confirmó (default `'[]'` de la columna) → ausente («no consta»).
 */
export function itemFieldState(item: ItemRecord, field: string): ValueState {
    const v = item.fields[field];
    if (blank(v)) return 'ausente';
    const own = item.fieldStatus?.[field];
    if (Array.isArray(v) && v.length === 0 && item.legacyRule != null && own !== 'confirmed') return 'ausente';
    if (PRICE_FIELDS.has(field)) {
        if (item.priceStatus === 'example') return 'ejemplo';
        if (item.priceStatus === 'confirmed' && item.priceMarker) return 'confirmado';
    }
    if (own && own !== item.contentStatus) return toState(own);
    return item.priceMarker ? 'confirmado' : toState(item.contentStatus);
}

function itemCase(e: EffectiveRequirement, item: ItemRecord): Omit<QaTruthCase, 'requirementId' | 'applies' | 'rule'> {
    const wm = e.req.whenMissing;
    const name = String(item.fields.name ?? item.fields.unit_name ?? item.id);
    const fields: Record<string, ValueState> = {};
    for (const f of Object.keys(item.fields)) if (!INTERNAL_FIELDS.has(f)) fields[f] = itemFieldState(item, f);
    const privacy = String(item.fields.address_privacy ?? 'publica');
    const withheld = fields.address === 'confirmado' && privacy !== 'publica' ? ['address'] : [];
    const affirm: Record<string, unknown> = {};
    for (const [f, st] of Object.entries(fields)) if (st === 'confirmado' && !withheld.includes(f)) affirm[f] = item.fields[f];
    const unknown = Object.entries(fields).filter(([, st]) => st === 'ausente' || st === 'sembrado').map(([f]) => f);
    const priceExample = Object.entries(fields).some(([f, st]) => PRICE_FIELDS.has(f) && st === 'ejemplo');
    const priceNever = priceExample ? [`el precio de ejemplo ${JSON.stringify(item.fields.price ?? item.fields.price_per_night ?? item.fields.price_per_passenger_type)} como hecho`] : [];
    const noConsta = unknown.length ? ` No constan (${unknown.join(', ')}): «no consta en la ficha» + AV, nunca «no».` : '';
    const privacyNote = withheld.length ? ` Dirección con address_privacy=${privacy}: da la zona y dice que la dirección se comparte al confirmar.` : '';
    const detail = { fields, ...(unknown.length ? { unknown } : {}) };

    const contentOk = item.priceMarker === true || item.contentStatus === 'confirmed';
    if (contentOk && item.priceType === 'a_cotizar') {
        return { valueState: 'confirmado', expected: 'COTIZA', affirm, ...detail, never: ['cualquier cifra'], behavior: `Sin cifra + procedimiento de cotización (PREG de sus campos).${noConsta}` };
    }
    if (!Object.keys(affirm).filter(f => f !== 'name' && f !== 'unit_name').length) {
        // nada afirmable más allá del nombre: la ficha entera está por confirmar
        const state: ValueState = priceExample ? 'ejemplo' : Object.values(fields).includes('sembrado') ? 'sembrado' : 'ausente';
        return {
            valueState: state, expected: wm.code as ExpectedCode, ...detail, never: [...wm.never, ...priceNever, ...COMMON_NEVER],
            behavior: `Reconoce «${name}»; el valor está «por confirmar». ${wm.behavior}`,
        };
    }
    const base = { valueState: 'confirmado' as const, expected: 'AFIRMA' as const, affirm, ...detail };
    if (priceExample) {
        return { ...base, never: [...priceNever, ...wm.never, ...COMMON_NEVER], behavior: `Afirma los campos confirmados de «${name}»; el precio es de ejemplo: «está por confirmar».${noConsta}${privacyNote}` };
    }
    if (item.priceType === 'desde') {
        return { ...base, qualifier: 'desde', never: ['el precio sin el calificador «desde»', ...wm.never], behavior: `Afirma con el calificador «desde».${noConsta}${privacyNote}` };
    }
    return { ...base, never: ['cualquier valor distinto', ...wm.never], behavior: `Afirma el valor normalizado.${noConsta}${privacyNote}` };
}

const isCatalog = (e: EffectiveRequirement) => e.req.templateId === 'OBJ.*.CATALOG' || e.req.id.endsWith('.CATALOG');

/** Requisitos aplicables al tenant que responden una intención: el generador elige uno y consulta por él (F10). */
export function requirementsForIntent(spec: CompiledSpec, snap: TenantSnapshot, intent: string, now?: Date): string[] {
    if (!spec.intents[intent]) throw new Error(`intención desconocida ${intent}`);
    const at = now ?? new Date(snap.capturedAt);
    return compose(spec, resolveFacts(spec, snap, at)).filter(e => e.applies && e.req.answers.includes(intent)).map(e => e.req.id);
}

export function qaTruth(spec: CompiledSpec, snap: TenantSnapshot, query: QaTruthQuery, now?: Date): QaTruth {
    const intent = query.intent ? spec.intents[query.intent] : undefined;
    if (query.intent && !intent) throw new Error(`intención desconocida ${query.intent}`);
    if (query.requirementId && !spec.requirements[query.requirementId]) throw new Error(`requisito desconocido ${query.requirementId}`);
    const meta = {
        query, specVersion: spec.specVersion, snapshotHash: hashOf(snap),
        ...(intent ? { intent: { id: intent.id, title: intent.title, conversational: intent.conversational } } : {}),
    };
    if (!query.requirementId) {
        // T01–T11: el comportamiento lo fija B1 §B.7 (cerrar, aplicar la preferencia…); no hay dato que consultar
        if (intent?.conversational) return { ...meta, expected: 'CONVERSACIONAL', cases: [] };
        throw new Error(`qaTruth se consulta por requisito (+ ítem), no solo por intención (R1.1 F10); candidatos de ${query.intent ?? '—'}: requirementsForIntent()`);
    }
    if (intent && !spec.requirements[query.requirementId].answers.includes(intent.id)) {
        throw new Error(`${query.requirementId} no responde la intención ${intent.id}`);
    }

    const at = now ?? new Date(snap.capturedAt);
    const facts = resolveFacts(spec, snap, at);
    const e = compose(spec, facts).find(x => x.req.id === query.requirementId);
    if (!e) {
        return { ...meta, expected: 'N/A', cases: [{ requirementId: query.requirementId, applies: false, valueState: null, expected: 'N/A', never: [], behavior: 'No aplica al tenant: no genera casos QA.', rule: spec.requirements[query.requirementId].qaTruth }] };
    }
    const item = query.itemId ? Object.values(snap.items).flat().find(i => i.id === query.itemId) : undefined;
    if (query.itemId && !item) throw new Error(`ítem desconocido ${query.itemId}`);

    const base = { requirementId: e.req.id, applies: e.applies, rule: e.req.qaTruth };
    const wm = e.req.whenMissing;
    const done = (c: QaTruthCase): QaTruth => ({ ...meta, expected: c.expected, cases: [c] });
    if (!e.applies) return done({ ...base, valueState: null, expected: 'N/A', never: [], behavior: 'No aplica al tenant: no genera casos QA.' });
    if (e.req.exposure === 'account_read') {
        return done({ ...base, valueState: null, expected: 'CUENTA', never: ['conteos o fechas tomados del historial del chat'], behavior: 'Lo que diga el registro del cliente leído en el turno con identidad suficiente; si no alcanza, el paso de verificación.' });
    }
    const ownItem = item && e.req.object && (snap.items[e.req.object] ?? []).includes(item);
    if (ownItem && isCatalog(e)) return done({ ...base, ...itemCase(e, item) });
    // C15 con ítem: lo que la fuente tiene cargado para ese ítem (salidas, stock) es la respuesta esperada (oráculo)
    if (ownItem && e.req.templateId === 'OBJ.*.AVAILABILITY_SOURCE') {
        const loaded = AVAILABILITY_FIELDS.filter(f => item.fields[f] !== undefined && itemFieldState(item, f) === 'confirmado');
        if (loaded.length) {
            return done({
                ...base, valueState: 'confirmado', expected: 'AFIRMA', affirm: Object.fromEntries(loaded.map(f => [f, item.fields[f]])), never: wm.never,
                behavior: 'Afirma lo que la fuente tiene cargado para este ítem (el oráculo la lee en el instante del caso); nunca «hay cupo» o «está lleno» sin leerla.',
            });
        }
    }

    // valor del alcance del ítem (p. ej. financiación o depósito por listado) y, si no hay, el global
    const scoped = item ? resolveValue(snap.values[e.req.id], at, `item:${item.id}`) : null;
    const rv = scoped && scoped.state !== 'ausente' ? scoped : resolveValue(snap.values[e.req.id], at);
    const ev = evaluate(spec, snap, at).requirements.find(r => r.id === e.req.id);
    const passes = scoped && scoped.state !== 'ausente' ? scoped.state === 'confirmado'
        : ev?.result === 'cumple' && Object.values(ev.levelResults ?? {}).every(r => r === 'cumple');
    const forbidden = [...wm.never, ...COMMON_NEVER];
    if (wm.code === 'EXT') {
        return done({ ...base, valueState: rv.state, expected: 'EXT', ...(passes && rv.record ? { affirm: rv.record.value } : {}), never: wm.never, behavior: 'Primero el contacto de emergencia u oficial, en una frase, sin preguntas comerciales antes; después, si aplica, HUM.' });
    }
    if (passes) {
        const value = rv.state === 'confirmado' ? rv.record?.value : undefined;
        if (value !== undefined && isEmptyConfirmed(value)) return done({ ...base, valueState: rv.state, expected: 'NIEGA', never: ['inventar un elemento'], behavior: 'Niega con el vacío confirmado.' });
        const text = value === undefined && e.req.sources.acceptsTextEvidence ? textEvidenceFor(snap.texts, e.req.id) : null;
        if (text) {
            return done({
                ...base, valueState: 'confirmado', expected: 'AFIRMA', affirm: { text: text.body }, evidence: { kind: 'texto', textId: text.id, title: text.title },
                never: ['cualquier valor distinto del texto confirmado', ...wm.never], behavior: `Afirma lo que dice el texto confirmado «${text.title}», sin añadir plazos ni condiciones.`,
            });
        }
        return done({ ...base, valueState: rv.state === 'ausente' ? 'confirmado' : rv.state, expected: 'AFIRMA', ...(value !== undefined ? { affirm: value } : {}), never: ['cualquier valor distinto'], behavior: 'Afirma el valor normalizado (moneda, unidad, día pedido).' });
    }
    // OBJ.*.CUSTOMER_REQUIREMENTS sin dato: «para datos de la reserva usa exactamente WRITE_MODE.required_fields» (F5)
    // Es el contrato del motor de reservas (lo que pedirá), no un dato del dueño: vale aunque sea el default de la columna (ADR 0006).
    if (ownItem && e.req.templateId === 'OBJ.*.CUSTOMER_REQUIREMENTS' && Array.isArray(item.fields.required_fields) && item.fields.required_fields.length) {
        return done({
            ...base, valueState: rv.state, expected: 'AFIRMA', affirm: { required_fields: item.fields.required_fields },
            never: ['pedir campos que no están en required_fields u omitir alguno', ...forbidden],
            behavior: `Para agendar «${String(item.fields.name ?? item.id)}» pide exactamente: ${(item.fields.required_fields as string[]).join(', ')}. Documentos o condiciones: «no consta» + AV.`,
        });
    }
    const extra = rv.state === 'contradictorio' ? rv.conflicts.map(c => `el valor en conflicto de ${c.storage ?? c.origin}`)
        : rv.state === 'ejemplo' || rv.state === 'sembrado'
            ? [`el valor de ejemplo o sembrado como hecho${rv.record ? ` (${rv.record.storage ?? rv.record.origin}: ${JSON.stringify(rv.record.value).slice(0, 160)})` : ''}`] : [];
    return done({ ...base, valueState: rv.state, expected: wm.code as ExpectedCode, never: [...forbidden, ...extra], behavior: wm.behavior });
}
