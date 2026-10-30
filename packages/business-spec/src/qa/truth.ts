/**
 * qaTruth (schema §10): la respuesta esperada de un caso QA sale del requisito y del estado del valor,
 * nunca se adivina. Cada caso lleva requirement_id, valueState y snapshotHash para atribuir el fallo
 * a producto (el agente no siguió la especificación) o a dato (el tenant no lo tenía).
 */
import { compose, type EffectiveRequirement } from '../compose';
import { evaluate } from '../engine/evaluate';
import { resolveFacts } from '../facts';
import { hashOf } from '../hash';
import { resolveValue } from '../status';
import { LEVEL_RANK, type CompiledSpec, type ItemRecord, type TenantSnapshot, type ValueState } from '../types';

export type ExpectedCode = 'AFIRMA' | 'NIEGA' | 'COTIZA' | 'NC+AV' | 'PREG' | 'HUM' | 'EXT' | 'GAP' | 'CUENTA' | 'CONVERSACIONAL' | 'N/A';

export interface QaTruthCase {
    requirementId: string;
    applies: boolean;
    valueState: ValueState | null;
    expected: ExpectedCode;
    qualifier?: 'desde';
    affirm?: unknown;
    never: string[];
    behavior: string;
    rule: string;
}

export interface QaTruth {
    query: { requirementId?: string; intent?: string; itemId?: string };
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

const LAYER_RANK = (layer: string) => (layer.startsWith('domain') ? 4 : layer.startsWith('profile') ? 3 : layer.startsWith('object') ? 2 : 1);
const isEmptyConfirmed = (v: unknown): boolean => (Array.isArray(v) && v.length === 0)
    || (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v as Record<string, unknown>).length > 0
        && Object.values(v as Record<string, unknown>).every(x => Array.isArray(x) && x.length === 0));

function itemCase(e: EffectiveRequirement, item: ItemRecord): Omit<QaTruthCase, 'requirementId' | 'applies' | 'rule'> {
    const wm = e.req.whenMissing;
    const priceNever = item.priceStatus === 'example' && item.fields.price ? [`el precio de ejemplo ${item.fields.price} como hecho`] : [];
    if (item.contentStatus !== 'confirmed') {
        return { valueState: item.contentStatus === 'example' ? 'ejemplo' : 'sembrado', expected: wm.code as ExpectedCode, never: [...wm.never, ...priceNever, ...COMMON_NEVER], behavior: `Reconoce «${String(item.fields.name ?? item.id)}»; el valor está «por confirmar». ${wm.behavior}` };
    }
    if (item.priceType === 'a_cotizar') return { valueState: 'confirmado', expected: 'COTIZA', never: ['cualquier cifra'], behavior: 'Sin cifra + procedimiento de cotización (PREG de sus campos).' };
    if (item.priceStatus === 'example') return { valueState: 'ejemplo', expected: wm.code as ExpectedCode, never: [...priceNever, ...COMMON_NEVER], behavior: wm.behavior };
    if (item.priceType === 'desde') return { valueState: 'confirmado', expected: 'AFIRMA', qualifier: 'desde', affirm: item.fields, never: ['el precio sin el calificador «desde»'], behavior: 'Afirma con el calificador «desde».' };
    return { valueState: 'confirmado', expected: 'AFIRMA', affirm: item.fields, never: ['cualquier valor distinto'], behavior: 'Afirma el valor normalizado.' };
}

export function qaTruth(spec: CompiledSpec, snap: TenantSnapshot, query: { requirementId?: string; intent?: string; itemId?: string }, now?: Date): QaTruth {
    const at = now ?? new Date(snap.capturedAt);
    const facts = resolveFacts(spec, snap, at);
    const effective = compose(spec, facts);
    const result = evaluate(spec, snap, at);
    const evalById = new Map(result.requirements.map(r => [r.id, r]));
    const intent = query.intent ? spec.intents[query.intent] : undefined;
    if (query.intent && !intent) throw new Error(`intención desconocida ${query.intent}`);
    if (query.requirementId && !spec.requirements[query.requirementId]) throw new Error(`requisito desconocido ${query.requirementId}`);

    const selected = effective.filter(e => (query.requirementId ? e.req.id === query.requirementId : true)
        && (query.intent ? e.req.answers.includes(query.intent) : true));
    const item = query.itemId ? Object.values(snap.items).flat().find(i => i.id === query.itemId) : undefined;

    const cases: QaTruthCase[] = selected.map(e => {
        const base = { requirementId: e.req.id, applies: e.applies, rule: e.req.qaTruth };
        const wm = e.req.whenMissing;
        if (!e.applies) return { ...base, valueState: null, expected: 'N/A', never: [], behavior: 'No aplica al tenant: no genera casos QA.' };
        if (e.req.exposure === 'account_read') {
            return { ...base, valueState: null, expected: 'CUENTA', never: ['conteos o fechas tomados del historial del chat'], behavior: 'Lo que diga el registro del cliente leído en el turno con identidad suficiente; si no alcanza, el paso de verificación.' };
        }
        if (item && e.req.object && (snap.items[e.req.object] ?? []).includes(item)) return { ...base, ...itemCase(e, item) };
        const rv = resolveValue(snap.values[e.req.id], at);
        const ev = evalById.get(e.req.id);
        const passes = ev?.result === 'cumple' && Object.values(ev.levelResults ?? {}).every(r => r === 'cumple');
        const forbidden = [...wm.never, ...COMMON_NEVER];
        if (wm.code === 'EXT') {
            return { ...base, valueState: rv.state, expected: 'EXT', ...(passes && rv.record ? { affirm: rv.record.value } : {}), never: wm.never, behavior: 'Primero el contacto de emergencia u oficial, en una frase, sin preguntas comerciales antes; después, si aplica, HUM.' };
        }
        if (passes) {
            const value = rv.state === 'confirmado' ? rv.record?.value : undefined;
            if (value !== undefined && isEmptyConfirmed(value)) return { ...base, valueState: rv.state, expected: 'NIEGA', never: ['inventar un elemento'], behavior: 'Niega con el vacío confirmado.' };
            return { ...base, valueState: rv.state === 'ausente' ? 'confirmado' : rv.state, expected: 'AFIRMA', ...(value !== undefined ? { affirm: value } : {}), never: ['cualquier valor distinto'], behavior: 'Afirma el valor normalizado (moneda, unidad, día pedido).' };
        }
        const extra = rv.state === 'contradictorio' ? rv.conflicts.map(c => `el valor en conflicto de ${c.storage ?? c.origin}`)
            : rv.state === 'ejemplo' || rv.state === 'sembrado' ? ['el valor de ejemplo o sembrado como hecho'] : [];
        return { ...base, valueState: rv.state, expected: wm.code as ExpectedCode, never: [...forbidden, ...extra], behavior: wm.behavior };
    });

    let expected: ExpectedCode;
    const live = cases.filter(c => c.applies);
    // T01–T11: el comportamiento lo fija B1 §B.7 (cerrar, aplicar la preferencia…); los casos quedan como detalle
    if (intent?.conversational) expected = 'CONVERSACIONAL';
    else if (!live.length) expected = 'N/A';
    else if (live.some(c => c.expected === 'EXT')) expected = 'EXT';
    else {
        const order = (id: string) => { const e = effective.find(x => x.req.id === id) as EffectiveRequirement; return [LEVEL_RANK[e.level], LAYER_RANK(e.req.layer)]; };
        const sorted = [...live].sort((a, b) => { const [la, sa] = order(a.requirementId); const [lb, sb] = order(b.requirementId); return lb - la || sb - sa; });
        expected = sorted[0].expected;
    }
    return {
        query, specVersion: spec.specVersion, snapshotHash: hashOf(snap),
        ...(intent ? { intent: { id: intent.id, title: intent.title, conversational: intent.conversational } } : {}),
        expected, cases,
    };
}
