/**
 * Ensayo antes de salir (C0 §1.4 C4, rebanada R7, ADR 0013): generación determinista de los casos de un tenant.
 *
 * Para las intenciones del perfil efectivo del tenant (núcleo + `profile:Pnn`), ponderadas por la demanda de B1 §D,
 * elige un requisito que la responde y, si la frase nombra un ítem (`{item}`), un ítem real del tenant; la frase sale
 * de `intents.yaml` en uno de sus idiomas atendidos. **La respuesta esperada la da `qaTruth()`**, nunca el generador:
 * AFIRMA, NIEGA, COTIZA, NC+AV, PREG, HUM, EXT o GAP, con su lista `never`. De ahí se derivan los chequeos
 * deterministas (cifras que debe decir, cifras que nunca debe decir, evento esperado), que aplica `gradeCase`.
 *
 * Reproducible: la misma especificación, la misma foto y la misma semilla dan el mismo banco (`bankHash`). Para medir
 * pass^k (fase E) se repite el MISMO banco k veces; cada caso tiene una clave estable (`key`).
 *
 * Fuera del ensayo: las intenciones conversacionales (T01–T11; T01/T02 solo como segundo turno), las de cuenta del
 * cliente (`account_read`: el ensayo no tiene un cliente con identidad) y los requisitos que no aplican.
 */
import { compose, type EffectiveRequirement } from '../compose';
import { buildTurnContract } from '../contract/turn';
import { evaluate } from '../engine/evaluate';
import { resolveFacts } from '../facts';
import { hashOf } from '../hash';
import { itemFieldState, qaTruth, type ExpectedCode, type QaTruthCase } from '../qa/truth';
import { resolveValue } from '../status';
import type { CompiledSpec, IntentDef, ItemRecord, TenantSnapshot, ValueState } from '../types';
import { figuresOfValue } from './figures';
import { answerRank } from './sources';

export const REHEARSAL_SCHEMA = 'business-spec/rehearsal-bank@1';
/** Tope del ensayo del dueño (C0 §1.4 paso 6): ≤ 40 casos con k = 1. */
export const REHEARSAL_MAX_CASES = 40;
export const REHEARSAL_LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;

/** Intenciones cuya pregunta es el precio: en un ítem solo se exigen sus cifras de precio (no la duración ni el stock). */
const PRICE_INTENTS = new Set(['C09', 'C10', 'C12', 'P02-1', 'P02-9', 'P05-1', 'P06-4', 'P07-3', 'P08-2', 'P11-1', 'P10-3', 'P13-1', 'P14-3', 'P18-1', 'P19-1', 'P22-2', 'P28-1']);
/**
 * Intenciones cuya respuesta es una cifra (hora, teléfono, cantidad, duración): allí exigir al menos una cifra del dato
 * es la evidencia determinista de que lo dijo. En las demás («¿tienen X?», «qué incluye») la respuesta correcta puede no
 * llevar cifras: decide el juez de paráfrasis (las cifras prohibidas se chequean siempre).
 */
const NUMERIC_INTENTS = new Set([...PRICE_INTENTS, 'C03', 'C04', 'C05', 'C15', 'P03-1', 'P05-2', 'P05-3', 'P06-2', 'P06-5', 'P07-4', 'P08-3', 'P11-2', 'P13-3', 'P14-2']);
const PRICE_FIELDS = ['price', 'price_per_night', 'price_per_day', 'price_per_passenger_type'];
/** Códigos que el ensayo no califica: no aplican, cuenta del cliente o conversacionales. */
const NOT_REHEARSED = new Set<ExpectedCode>(['N/A', 'CUENTA', 'CONVERSACIONAL']);
/** E1.1: preguntas de sí o no sobre un ítem («¿tienen X?»): un «sí, tenemos X» es evidencia determinista de AFIRMA. */
const YES_NO_INTENTS = new Set(['C07']);
/** E1.1: requisitos cuya AFIRMA es «nombra ítems activos del catálogo» (C06): nombrar uno es evidencia determinista. */
const LISTING_REQUIREMENTS = new Set(['CORE.OFFER.ITEMS']);
/** Tope de ítems y de caracteres por valor en los hechos que ve el juez (el banco queda congelado en la base). */
const FACTS_MAX_ITEMS = 25;
const FACTS_MAX_VALUE = 400;
/** Cifras pequeñas (1–9) no se prohíben: «2 personas» o «1 noche» aparecen en cualquier respuesta. */
const MIN_FORBIDDEN = 10;

/** Evento que el agente debe producir en un turno: hoy solo «lo averiguo» (herramienta `register_pending_question`). */
export interface RehearsalEvent { turn: number; kind: 'pending_question' }

/** Lo que el calificador comprueba de forma determinista (todo derivado de `qaTruth`, nada inventado). */
export interface RehearsalExpectation {
    /** Basta con que aparezca una (cifras canónicas de `figures.ts`): señal de que dijo el dato. Vacío = sin cifras que exigir. */
    figuresAnyOf: string[];
    /** Ninguna puede aparecer: el precio de ejemplo, el valor sembrado o el que está en conflicto. */
    forbiddenFigures: string[];
    /** COTIZA: ninguna cifra de dinero. */
    noMoney: boolean;
    /** AFIRMA con calificador «desde». */
    qualifier: 'desde' | null;
    /** Evento esperado (con su turno, 1-based); null = ninguno. */
    event: RehearsalEvent | null;
    /** Lo correcto es «no consta / por confirmar» (NC+AV, GAP, o el precio preguntado no es afirmable). */
    unknownMarker: boolean;
    /** El dato preguntado es afirmable: si lo dice bien, «responde bien»; si no, hacer lo correcto es «falta X». */
    answerable: boolean;
    /** Qué debe comprobar el juez de paráfrasis si los chequeos deterministas no alcanzan (lo dice `qaTruth`). */
    paraphrase: string;
    /** E1.1: nombres de ítems activos; AFIRMA de un listado (C06) con al menos uno nombrado = dijo el dato. */
    namesAnyOf: string[];
    /** E1.1: pregunta de sí o no sobre un ítem confirmado (C07): un «sí» sin negación = dijo el dato. */
    affirmYes: boolean;
}

/**
 * E1.1: los hechos del caso tal como los ve la verdad QA, para que el juez califique con datos y no los invente: el
 * estado y el valor del requisito, su regla «si falta» y, si el caso nombra un ítem, la ficha con el estado de cada campo.
 */
export interface RehearsalFacts {
    requirement: {
        id: string; title: string; valueState: ValueState | null;
        /** Valor guardado (recortado), cualquiera sea su estado: el juez debe saber qué es de ejemplo o sembrado. */
        value?: unknown;
        rule: string;
        whenMissing: { code: string; behavior: string; never: string[] };
    };
    item?: { id: string; name: string; fields: Record<string, { state: ValueState; value: unknown }> };
    /**
     * Ítems activos del catálogo: nombre, estado del contenido y del precio y, desde E1.1b, en todos los casos (el
     * cliente puede nombrar un ítem en una pregunta general) los campos de precio y ubicación con su estado y valor.
     */
    catalog?: { name: string; content: ValueState; price: ValueState | null; fields?: Record<string, { state: ValueState; value: unknown }> }[];
    /**
     * E1.1b: identidad y contacto del negocio (nombre, qué hace, región, sedes, canales) con su estado. Sin esto el juez
     * castigaba al agente por usar datos confirmados de otro requisito («afirmó un nombre no confirmado»).
     */
    business?: Record<string, { state: ValueState | null; value?: unknown }>;
}

export interface RehearsalCase {
    /** Clave estable dentro del banco: intención~requisito[~ítem]~idioma. Une los intentos de pass^k. */
    key: string;
    intentId: string;
    intentTitle: string;
    layer: string;
    /** Siempre al menos uno (aceptación R7 #4: ningún caso sin requisito). */
    requirementIds: string[];
    requirementTitle: string;
    /** Pantalla o formulario del dato (para enlazar el «falta X»). */
    uiTarget: string | null;
    itemId: string | null;
    itemName: string | null;
    language: string;
    /** Mensajes del cliente, en orden (1 o 2: el segundo es la aceptación T01 de «lo averiguo»). */
    turns: string[];
    expected: ExpectedCode;
    valueState: ValueState | null;
    /** El caso de `qaTruth` tal cual (respuesta esperada, `never`, comportamiento y regla). */
    truth: QaTruthCase;
    /**
     * E1.1: la intención pregunta por unos campos de la ficha (`answer_fields`, p. ej. C08 «¿qué incluye?»): la respuesta
     * esperada se acota a ellos. `expected`/`valueState` salen de aquí y no de la ficha entera; `truth` queda intacta.
     */
    focus?: RehearsalFocus;
    /** E1.1: lo que el juez de paráfrasis recibe como verdad (nunca la adivina). */
    facts: RehearsalFacts;
    expectation: RehearsalExpectation;
}

export interface RehearsalFocus {
    /** Campos preguntados que el objeto declara o que la ficha trae. */
    fields: string[];
    /** Los confirmados, con su valor (lo único afirmable). */
    affirm: Record<string, unknown>;
    /** Los que no constan: «no consta en la ficha» + AV, nunca «no incluye». */
    unknown: string[];
}

export interface RehearsalSkip { intentId: string; reason: 'sin_requisito' | 'sin_frases' | 'cuenta' | 'no_aplica' | 'requiere_item' | 'tope' }

export interface RehearsalCoverage {
    profile: string | null;
    languages: string[];
    /** Intenciones del perfil efectivo (núcleo + perfil, sin las conversacionales). */
    intentsApplicable: string[];
    intentsCovered: string[];
    skipped: RehearsalSkip[];
    byExpected: Record<string, number>;
}

export interface RehearsalBank {
    schema: typeof REHEARSAL_SCHEMA;
    specVersion: string;
    snapshotHash: string;
    seed: string;
    maxCases: number;
    /** Hash de los casos: el mismo banco da el mismo hash (determinismo y banco congelado para pass^k). */
    bankHash: string;
    cases: RehearsalCase[];
    coverage: RehearsalCoverage;
}

export interface RehearsalOptions {
    seed?: string;
    maxCases?: number;
    /** Idiomas del ensayo; por defecto los atendidos por el agente (`CORE.LANGUAGES.SERVED`), y si no constan, `es`. */
    languages?: string[];
    now?: Date;
}

// ─────────────────────────── azar con semilla ───────────────────────────

/** mulberry32 sembrado por un hash de texto: el mismo texto da la misma secuencia en cualquier máquina. */
export function seededRandom(seed: string): () => number {
    let a = parseInt(hashOf(seed).slice(0, 8), 16) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pick = <T>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length) % xs.length];

/** Peso de una intención: más demanda (B1 §D.2), más probable; las del perfil reciben el peso de una intención núcleo media. */
const weightOf = (intent: IntentDef): number => 1 + Math.log10(1 + (intent.demand || (intent.layer.startsWith('profile:') ? 150 : 10)));

// ─────────────────────────── idiomas ───────────────────────────

/** Idiomas atendidos del tenant, de `CORE.LANGUAGES.SERVED` (cualquier estado: el ensayo prueba lo que el agente atiende). */
export function servedLanguages(snap: TenantSnapshot, at: Date): string[] {
    const rv = resolveValue(snap.values['CORE.LANGUAGES.SERVED'], at);
    const v = (rv.record?.value ?? {}) as { agent_languages?: unknown; content_source_language?: unknown };
    const raw = Array.isArray(v.agent_languages) && v.agent_languages.length ? v.agent_languages : [v.content_source_language];
    const langs = raw.map(l => String(l ?? '').slice(0, 2).toLowerCase()).filter(l => (REHEARSAL_LANGUAGES as readonly string[]).includes(l));
    return langs.length ? [...new Set(langs)] : ['es'];
}

// ─────────────────────────── generación ───────────────────────────

interface Candidate {
    intent: IntentDef; req: EffectiveRequirement;
    /** Ítem nombrado por la frase (`{item}`); `ownItem` = es del objeto del requisito y la verdad se consulta por él. */
    item: ItemRecord | null; ownItem: boolean;
    language: string; phrase: string;
}

/** Nombre con el que el cliente nombra un ítem; un inmueble sin nombre se nombra por tipo y zona. */
const itemName = (item: ItemRecord): string => {
    const f = item.fields;
    const named = f.name ?? f.unit_name ?? f.title ?? f.model;
    if (named) return String(named);
    if (f.property_type) return [f.property_type, f.zone ?? f.city].filter(Boolean).join(' en ');
    return String(item.id);
};
/** Ítems por intención y requisito: los primeros de un barajado sembrado (un catálogo grande no infla el banco). */
const MAX_ITEMS_PER_REQUIREMENT = 8;

/** Los candidatos de una intención, en orden estable; el azar sembrado elige entre ellos. */
function candidatesFor(intent: IntentDef, reqs: EffectiveRequirement[], snap: TenantSnapshot, languages: string[], rnd: () => number): { list: Candidate[]; skip?: RehearsalSkip['reason'] } {
    const langs = languages.filter(l => intent.phrases[l]?.length);
    const language = langs.length ? pick(rnd, langs) : intent.phrases.es?.length ? 'es' : null;
    if (!language) return { list: [], skip: 'sin_frases' };
    const phrases = intent.phrases[language];
    const withSlot = phrases.filter(p => p.includes('{item}'));
    const plain = phrases.filter(p => !p.includes('{item}'));
    // sin ítem propio, la frase nombra un ítem real de otro objeto del tenant (solo para nombrarlo; la verdad es la global)
    const anyItems = Object.keys(snap.items).sort().flatMap(o => (snap.items[o] ?? []).filter(i => i.active));
    const list: Candidate[] = [];
    let needsItem = false;
    for (const req of reqs) {
        if (req.req.exposure === 'account_read') continue;
        const own = req.req.object ? (snap.items[req.req.object] ?? []).filter(i => i.active) : [];
        const items = shuffle(own.length ? own : anyItems, rnd).slice(0, own.length ? MAX_ITEMS_PER_REQUIREMENT : 1);
        if (items.length && withSlot.length) {
            for (const item of items) list.push({ intent, req, item, ownItem: own.length > 0, language, phrase: pick(rnd, withSlot).replace(/\{item\}/g, itemName(item)) });
        } else if (plain.length) {
            list.push({ intent, req, item: null, ownItem: false, language, phrase: pick(rnd, plain) });
        } else {
            needsItem = true;
        }
    }
    if (!list.length) return { list, skip: reqs.every(r => r.req.exposure === 'account_read') ? 'cuenta' : needsItem ? 'requiere_item' : 'sin_requisito' };
    return { list };
}

/**
 * Cifras exigidas: en una pregunta de precio, solo las de precio; si no, cualquiera del valor afirmado.
 * `priceUnknown`: se pregunta el precio de un ítem y no es afirmable (de ejemplo o ausente): lo correcto es «por confirmar».
 */
function figuresAnyOf(intentId: string, truth: QaTruthCase): { anyOf: string[]; priceUnknown: boolean } {
    if (truth.expected !== 'AFIRMA' && truth.expected !== 'EXT') return { anyOf: [], priceUnknown: false };
    if (truth.expected === 'AFIRMA' && !NUMERIC_INTENTS.has(intentId)) return { anyOf: [], priceUnknown: false };
    const affirm = truth.affirm;
    if (affirm === undefined || affirm === null) return { anyOf: [], priceUnknown: false };
    if (typeof affirm === 'object' && !Array.isArray(affirm)) {
        const a = affirm as Record<string, unknown>;
        if (PRICE_INTENTS.has(intentId) && truth.fields) {
            const price = PRICE_FIELDS.filter(f => a[f] !== undefined).flatMap(f => figuresOfValue(a[f], f));
            return price.length ? { anyOf: price, priceUnknown: false } : { anyOf: [], priceUnknown: true };
        }
        // el nombre no es el dato pedido; la evidencia de texto se juzga por paráfrasis
        if ('text' in a && Object.keys(a).length === 1) return { anyOf: [], priceUnknown: false };
        return { anyOf: figuresOfValue(Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'name' && k !== 'unit_name'))), priceUnknown: false };
    }
    return { anyOf: figuresOfValue(affirm), priceUnknown: false };
}

/** Cifras prohibidas: lo que es de ejemplo, sembrado o está en conflicto (nunca se afirma como hecho). */
function forbiddenFigures(spec: CompiledSpec, snap: TenantSnapshot, at: Date, truth: QaTruthCase, item: ItemRecord | null, allowed: Set<string>): string[] {
    const out: string[] = [];
    if (item && truth.fields) {
        for (const [f, st] of Object.entries(truth.fields)) if (st === 'ejemplo' || st === 'sembrado') out.push(...figuresOfValue(item.fields[f], f));
    }
    if (!item || !spec.requirements[truth.requirementId]?.object) {
        const rv = resolveValue(snap.values[truth.requirementId], at);
        if (rv.state === 'ejemplo' || rv.state === 'sembrado') out.push(...figuresOfValue(rv.record?.value));
        if (rv.state === 'contradictorio') for (const c of rv.conflicts) out.push(...figuresOfValue(c.value));
    }
    return [...new Set(out)].filter(f => !allowed.has(f) && !(f.startsWith('n:') && Number(f.slice(2)) < MIN_FORBIDDEN));
}

function paraphraseOf(truth: QaTruthCase, focus?: RehearsalFocus, expected?: ExpectedCode, behavior?: string): string {
    const never = truth.never.length ? ` Nunca: ${truth.never.join('; ')}.` : '';
    const shown = focus ? (Object.keys(focus.affirm).length ? focus.affirm : undefined) : truth.affirm;
    const affirm = shown !== undefined ? ` Dato confirmado: ${JSON.stringify(shown).slice(0, 600)}.` : '';
    const unknown = focus?.unknown.length ? ` No constan: ${focus.unknown.join(', ')}.` : '';
    return `[${expected ?? truth.expected}] ${behavior ?? truth.behavior}${affirm}${unknown}${never}`;
}

/** Campos que el objeto declara en su ficha (obligatorios y opcionales). */
const objectFields = (spec: CompiledSpec, object: string | undefined): Set<string> => {
    const o = object ? spec.objects[object] : undefined;
    return new Set(o ? [...o.catalogFields.required, ...o.catalogFields.optional] : []);
};

/**
 * E1.1: acota la verdad de una ficha a los campos que pregunta la intención (`answer_fields`). Si ninguno consta, lo
 * correcto es «no consta» + AV (dato faltante), aunque la ficha tenga otros campos confirmados.
 */
function focusOf(spec: CompiledSpec, intent: IntentDef, req: EffectiveRequirement, item: ItemRecord | null, tc: QaTruthCase): RehearsalFocus | undefined {
    if (!intent.answerFields.length || !item || !tc.fields || tc.expected !== 'AFIRMA') return undefined;
    const declared = objectFields(spec, req.req.object);
    const fields = intent.answerFields.filter(f => declared.has(f) || f in item.fields);
    const affirm: Record<string, unknown> = {};
    for (const f of fields) if (tc.fields[f] === 'confirmado' && item.fields[f] !== undefined) affirm[f] = item.fields[f];
    return { fields, affirm, unknown: fields.filter(f => !(f in affirm)) };
}

const clip = (v: unknown): unknown => {
    const text = JSON.stringify(v);
    return text !== undefined && text.length > FACTS_MAX_VALUE ? `${text.slice(0, FACTS_MAX_VALUE)}…` : v;
};
const activeItems = (snap: TenantSnapshot): ItemRecord[] => Object.keys(snap.items).sort().flatMap(o => (snap.items[o] ?? []).filter(i => i.active));
const toValueState = (s: string): ValueState => (s === 'confirmed' ? 'confirmado' : s === 'example' ? 'ejemplo' : 'sembrado');

/** E1.1b: campos de cada ítem del catálogo que el juez recibe con su valor (precio y ubicación). */
const CATALOG_FACT_FIELDS = ['price', 'price_per_night', 'price_per_passenger_type', 'currency', 'address', 'city', 'zone'];

/** E1.1b: requisitos de identidad y contacto que el juez recibe siempre como contexto del negocio. */
const BUSINESS_FACTS = ['CORE.IDENTITY.NAME', 'CORE.IDENTITY.DESCRIPTION', 'CORE.IDENTITY.REGION', 'CORE.LOCATIONS.LIST', 'CORE.CONTACT.CHANNELS'];

/**
 * Lo que el juez recibe como verdad. `valueState` del requisito es el del caso (`qaTruth`), no el del valor guardado:
 * en los requisitos de catálogo la verdad sale de la ficha del ítem y el valor general suele estar «ausente», y el juez
 * leía esa contradicción como «precio no confirmado» (E1.1b). La ficha va siempre que el cliente nombra un ítem.
 */
function factsOf(snap: TenantSnapshot, at: Date, intent: IntentDef, req: EffectiveRequirement, item: ItemRecord | null, caseState: ValueState | null): RehearsalFacts {
    const rv = resolveValue(snap.values[req.req.id], at, item ? `item:${item.id}` : undefined);
    const global = rv.state === 'ausente' && item ? resolveValue(snap.values[req.req.id], at) : rv;
    const wm = req.req.whenMissing;
    const facts: RehearsalFacts = {
        requirement: {
            id: req.req.id, title: req.req.title, valueState: caseState ?? global.state,
            ...(global.record ? { value: clip(global.record.value) } : {}),
            rule: req.req.qaTruth, whenMissing: { code: wm.code, behavior: wm.behavior, never: wm.never },
        },
    };
    if (item) {
        const fields: Record<string, { state: ValueState; value: unknown }> = {};
        for (const [f, v] of Object.entries(item.fields)) fields[f] = { state: itemFieldState(item, f), value: clip(v) };
        facts.item = { id: item.id, name: itemName(item), fields };
    }
    facts.catalog = activeItems(snap).slice(0, FACTS_MAX_ITEMS).map(i => {
        const fields: Record<string, { state: ValueState; value: unknown }> = {};
        for (const f of CATALOG_FACT_FIELDS) if (i.fields[f] !== undefined && i.fields[f] !== null) fields[f] = { state: itemFieldState(i, f), value: clip(i.fields[f]) };
        return {
            name: itemName(i), content: toValueState(i.contentStatus),
            price: i.priceStatus === 'example' ? 'ejemplo' : i.priceStatus === 'confirmed' ? 'confirmado' : null,
            ...(Object.keys(fields).length ? { fields } : {}),
        };
    });
    const business: NonNullable<RehearsalFacts['business']> = {};
    for (const id of BUSINESS_FACTS) {
        if (id === req.req.id) continue;
        const v = resolveValue(snap.values[id], at);
        business[id] = { state: v.state, ...(v.record && v.state !== 'ausente' ? { value: clip(v.record.value) } : {}) };
    }
    facts.business = business;
    return facts;
}

/** Una pregunta candidata, ya con su requisito (y su ítem si lo nombra). */
interface CaseInput { intent: IntentDef; req: EffectiveRequirement; item: ItemRecord | null; ownItem: boolean; language: string; turns: string[]; pending: boolean }

/** Arma el caso: la verdad la da `qaTruth`; aquí solo se derivan los chequeos (y el foco de `answer_fields`). */
function buildCase(spec: CompiledSpec, snap: TenantSnapshot, at: Date, input: CaseInput, tc: QaTruthCase): RehearsalCase {
    const { intent, req, item, ownItem, language, turns, pending } = input;
    const key = `${intent.id}~${req.req.id}${item ? `~${item.id}` : ''}~${language}`;
    const focus = focusOf(spec, intent, req, item && ownItem ? item : null, tc);
    const focusMissing = !!focus && !Object.keys(focus.affirm).length;
    const expected: ExpectedCode = focusMissing ? 'NC+AV' : tc.expected;
    const valueState: ValueState | null = focusMissing ? 'ausente' : tc.valueState;
    const name = item ? itemName(item) : '';
    const behavior = !focus ? tc.behavior : focusMissing
        ? `Lo que pregunta (${focus.fields.join(', ')}) no consta en la ficha de «${name}»: «no consta» + AV. Puede dar lo que sí consta; nunca «no incluye» sin vacío confirmado.`
        : `Afirma lo confirmado de lo que pregunta (${Object.keys(focus.affirm).join(', ')})${focus.unknown.length ? `; lo demás (${focus.unknown.join(', ')}) «no consta»` : ''}.`;
    const { anyOf, priceUnknown } = figuresAnyOf(intent.id, tc);
    return {
        key, intentId: intent.id, intentTitle: intent.title, layer: intent.layer,
        requirementIds: [req.req.id], requirementTitle: req.req.title, uiTarget: req.req.uiTarget ?? null,
        itemId: item && ownItem ? item.id : null, itemName: item ? name : null, language, turns,
        expected, valueState, truth: tc, ...(focus ? { focus } : {}), facts: factsOf(snap, at, intent, req, item, valueState),
        expectation: {
            figuresAnyOf: anyOf,
            forbiddenFigures: forbiddenFigures(spec, snap, at, tc, item && ownItem ? item : null, new Set(anyOf)),
            noMoney: expected === 'COTIZA',
            qualifier: tc.qualifier ?? null,
            event: pending ? { turn: 2, kind: 'pending_question' } : null,
            unknownMarker: expected === 'NC+AV' || expected === 'GAP' || priceUnknown,
            answerable: valueState === 'confirmado' && ['AFIRMA', 'NIEGA', 'COTIZA', 'EXT'].includes(expected) && !priceUnknown,
            paraphrase: paraphraseOf(tc, focus, expected, behavior),
            namesAnyOf: expected === 'AFIRMA' && LISTING_REQUIREMENTS.has(req.req.id) ? activeItems(snap).map(itemName).slice(0, FACTS_MAX_ITEMS) : [],
            affirmYes: expected === 'AFIRMA' && YES_NO_INTENTS.has(intent.id) && !!item && ownItem,
        },
    };
}

/** Lo que el generador necesita de la foto una sola vez (perfil, requisitos efectivos, ofertas del contrato). */
function context(spec: CompiledSpec, snap: TenantSnapshot, at: Date) {
    const facts = resolveFacts(spec, snap, at);
    const effective = compose(spec, facts).filter(e => e.applies);
    const offers = buildTurnContract(spec, snap, evaluate(spec, snap, at), { now: at }).offers;
    return { profileId: facts.profile?.profile ?? null, effective, offers };
}

/** Requisitos aplicables que RESPONDEN la intención (E1.1): `answered_by` o, sin él, `answers` sin higiene. */
const answerSourcesOf = (intent: IntentDef, effective: EffectiveRequirement[]): EffectiveRequirement[] =>
    effective.filter(e => e.req.answers.includes(intent.id) && answerRank(intent, e.req) !== null).sort((a, b) => a.req.id.localeCompare(b.req.id));

export function generateRehearsal(spec: CompiledSpec, snap: TenantSnapshot, options: RehearsalOptions = {}): RehearsalBank {
    const at = options.now ?? new Date(snap.capturedAt);
    const seed = options.seed ?? 'default';
    const maxCases = Math.max(1, Math.min(options.maxCases ?? REHEARSAL_MAX_CASES, REHEARSAL_MAX_CASES));
    const snapshotHash = hashOf(snap);
    const rnd = seededRandom(`${seed}|${spec.specVersion}|${snapshotHash}`);
    const { profileId, effective, offers } = context(spec, snap, at);
    const languages = (options.languages?.length ? options.languages : servedLanguages(snap, at))
        .map(l => l.slice(0, 2).toLowerCase()).filter(l => (REHEARSAL_LANGUAGES as readonly string[]).includes(l));
    const langs = languages.length ? [...new Set(languages)] : ['es'];

    const intents = Object.values(spec.intents)
        .filter(i => !i.conversational && (i.layer === 'core' || (profileId !== null && i.layer === `profile:${profileId}`)))
        .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    const skipped: RehearsalSkip[] = [];
    const pools: Candidate[][] = [];
    for (const intent of intents) {
        const reqs = answerSourcesOf(intent, effective);
        if (!reqs.length) { skipped.push({ intentId: intent.id, reason: 'sin_requisito' }); continue; }
        const { list, skip } = candidatesFor(intent, reqs, snap, langs, rnd);
        if (skip) { skipped.push({ intentId: intent.id, reason: skip }); continue; }
        pools.push(list);
    }
    // orden ponderado por demanda (Efraimidis–Spirakis: clave u^(1/w), la mayor primero); dentro de cada intención, barajado
    const order = pools.map(list => ({ list: byDirectness(list, rnd), key: Math.pow(rnd(), 1 / weightOf(list[0].intent)) }))
        .sort((a, b) => b.key - a.key || a.list[0].intent.id.localeCompare(b.list[0].intent.id));

    const cases: RehearsalCase[] = [];
    const keys = new Set<string>();
    const tried = new Set<string>();
    const T01 = spec.intents.T01?.phrases ?? {};
    // ronda 1: una pregunta por intención; rondas siguientes: otro requisito u otro ítem de la misma intención
    for (let round = 0; cases.length < maxCases && order.some(o => o.list.length > round); round++) {
        for (const { list } of order) {
            if (cases.length >= maxCases) break;
            const c = list[round];
            if (!c) continue;
            const key = `${c.intent.id}~${c.req.req.id}${c.item ? `~${c.item.id}` : ''}~${c.language}`;
            if (keys.has(key)) continue;
            tried.add(c.intent.id);
            const truth = qaTruth(spec, snap, { requirementId: c.req.req.id, intent: c.intent.id, ...(c.item && c.ownItem ? { itemId: c.item.id } : {}) }, at);
            const tc = truth.cases[0];
            if (!tc || NOT_REHEARSED.has(tc.expected)) continue;
            // «lo averiguo»: si el contrato lo ofrece, el cliente acepta en el segundo turno y debe quedar registrado (T01, ADR 0011)
            const single = buildCase(spec, snap, at, { ...c, turns: [c.phrase], pending: false }, tc);
            const pending = single.expected === 'NC+AV' && offers.pendingQuestion;
            const turns = pending ? [c.phrase, pick(rnd, T01[c.language] ?? T01.es ?? ['Sí, por favor'])] : [c.phrase];
            keys.add(key);
            cases.push(pending ? buildCase(spec, snap, at, { ...c, turns, pending }, tc) : single);
        }
    }
    const covered = new Set(cases.map(c => c.intentId));
    for (const o of order) {
        const id = o.list[0].intent.id;
        if (!covered.has(id)) skipped.push({ intentId: id, reason: tried.has(id) ? 'no_aplica' : 'tope' });
    }
    const byExpected: Record<string, number> = {};
    for (const c of cases) byExpected[c.expected] = (byExpected[c.expected] ?? 0) + 1;
    return {
        schema: REHEARSAL_SCHEMA, specVersion: spec.specVersion, snapshotHash, seed, maxCases,
        bankHash: hashOf(cases), cases,
        coverage: {
            profile: profileId, languages: langs,
            intentsApplicable: intents.map(i => i.id), intentsCovered: [...covered].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
            skipped: skipped.sort((a, b) => a.intentId.localeCompare(b.intentId, 'en', { numeric: true })), byExpected,
        },
    };
}

/** Pregunta ya hecha (p. ej. un intento guardado de E1) que se quiere recalificar con el generador actual. */
export interface RehearsalCaseQuery {
    intentId: string;
    /** Requisito con el que se generó; si ya no responde la intención, se elige el más directo que sí. */
    requirementId?: string | null;
    itemId?: string | null;
    language: string;
    turns: string[];
}

export type RehearsalCaseResult =
    | { case: RehearsalCase; skip?: undefined }
    | { case?: undefined; skip: 'intencion_desconocida' | 'sin_requisito' | 'item_desconocido' | 'no_aplica' };

/**
 * E1.1 (recalificación sin agente): la expectativa que el generador ACTUAL da a una pregunta ya hecha, contra una foto.
 * Determinista y sin azar: el mismo requisito si aún responde la intención; si no, el primero de `answered_by`
 * (prefiriendo el del objeto del ítem nombrado). Mismas reglas que `generateRehearsal` (verdad de `qaTruth`, foco, chequeos).
 */
export function rehearsalCaseFor(spec: CompiledSpec, snap: TenantSnapshot, q: RehearsalCaseQuery, options: { now?: Date } = {}): RehearsalCaseResult {
    const at = options.now ?? new Date(snap.capturedAt);
    const intent = spec.intents[q.intentId];
    if (!intent || intent.conversational) return { skip: 'intencion_desconocida' };
    const { effective, offers } = context(spec, snap, at);
    const item = q.itemId ? Object.values(snap.items).flat().find(i => i.id === q.itemId) ?? null : null;
    if (q.itemId && !item) return { skip: 'item_desconocido' };
    const sources = answerSourcesOf(intent, effective).filter(e => e.req.exposure !== 'account_read');
    if (!sources.length) return { skip: 'sin_requisito' };
    const owns = (e: EffectiveRequirement) => !!item && !!e.req.object && (snap.items[e.req.object] ?? []).includes(item);
    const rank = (e: EffectiveRequirement) => (answerRank(intent, e.req) ?? 99) * 2 + (owns(e) || !item ? 0 : 1);
    const same = q.requirementId ? sources.find(e => e.req.id === q.requirementId) : undefined;
    const req = same ?? [...sources].sort((a, b) => rank(a) - rank(b) || a.req.id.localeCompare(b.req.id))[0];
    const ownItem = owns(req);
    const tc = qaTruth(spec, snap, { requirementId: req.req.id, intent: intent.id, ...(item && ownItem ? { itemId: item.id } : {}) }, at).cases[0];
    if (!tc || NOT_REHEARSED.has(tc.expected)) return { skip: 'no_aplica' };
    const single = buildCase(spec, snap, at, { intent, req, item, ownItem, language: q.language, turns: q.turns, pending: false }, tc);
    const pending = q.turns.length > 1 && single.expected === 'NC+AV' && offers.pendingQuestion;
    return { case: pending ? buildCase(spec, snap, at, { intent, req, item, ownItem, language: q.language, turns: q.turns, pending }, tc) : single };
}

/**
 * Una intención agrupa varios requisitos (R1.1 F10); la primera pregunta usa el más directo. E1.1: primero el orden de
 * `answered_by` (lo que contesta la pregunta); dentro de cada posición, el catálogo del ítem nombrado, luego otro
 * requisito de ese objeto, luego los del núcleo y por último los de perfil o dominio. Dentro de cada grupo, barajado con
 * la semilla. Las rondas siguientes toman el resto en ese orden.
 */
function byDirectness(list: readonly Candidate[], rnd: () => number): Candidate[] {
    const direct = (c: Candidate) => (c.ownItem && String(c.req.req.templateId ?? c.req.req.id).endsWith('.CATALOG') ? 0 : c.ownItem ? 1 : c.req.req.layer === 'core' ? 2 : 3);
    const rank = (c: Candidate) => (answerRank(c.intent, c.req.req) ?? 99) * 4 + direct(c);
    const ranks = [...new Set(list.map(rank))].sort((a, b) => a - b);
    return ranks.flatMap(r => shuffle(list.filter(c => rank(c) === r), rnd));
}

function shuffle<T>(xs: readonly T[], rnd: () => number): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
