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
import { qaTruth, type ExpectedCode, type QaTruthCase } from '../qa/truth';
import { resolveValue } from '../status';
import type { CompiledSpec, IntentDef, ItemRecord, TenantSnapshot, ValueState } from '../types';
import { figuresOfValue } from './figures';

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
    expectation: RehearsalExpectation;
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

function paraphraseOf(truth: QaTruthCase): string {
    const never = truth.never.length ? ` Nunca: ${truth.never.join('; ')}.` : '';
    const affirm = truth.affirm !== undefined ? ` Dato confirmado: ${JSON.stringify(truth.affirm).slice(0, 600)}.` : '';
    return `[${truth.expected}] ${truth.behavior}${affirm}${never}`;
}

export function generateRehearsal(spec: CompiledSpec, snap: TenantSnapshot, options: RehearsalOptions = {}): RehearsalBank {
    const at = options.now ?? new Date(snap.capturedAt);
    const seed = options.seed ?? 'default';
    const maxCases = Math.max(1, Math.min(options.maxCases ?? REHEARSAL_MAX_CASES, REHEARSAL_MAX_CASES));
    const snapshotHash = hashOf(snap);
    const rnd = seededRandom(`${seed}|${spec.specVersion}|${snapshotHash}`);
    const facts = resolveFacts(spec, snap, at);
    const profileId = facts.profile?.profile ?? null;
    const languages = (options.languages?.length ? options.languages : servedLanguages(snap, at))
        .map(l => l.slice(0, 2).toLowerCase()).filter(l => (REHEARSAL_LANGUAGES as readonly string[]).includes(l));
    const langs = languages.length ? [...new Set(languages)] : ['es'];
    const effective = compose(spec, facts).filter(e => e.applies);
    const result = evaluate(spec, snap, at);
    const offers = buildTurnContract(spec, snap, result, { now: at }).offers;

    const intents = Object.values(spec.intents)
        .filter(i => !i.conversational && (i.layer === 'core' || (profileId !== null && i.layer === `profile:${profileId}`)))
        .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    const skipped: RehearsalSkip[] = [];
    const pools: Candidate[][] = [];
    for (const intent of intents) {
        const reqs = effective.filter(e => e.req.answers.includes(intent.id)).sort((a, b) => a.req.id.localeCompare(b.req.id));
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
            const { anyOf, priceUnknown } = figuresAnyOf(c.intent.id, tc);
            // «lo averiguo»: si el contrato lo ofrece, el cliente acepta en el segundo turno y debe quedar registrado (T01, ADR 0011)
            const pending = tc.expected === 'NC+AV' && offers.pendingQuestion;
            const turns = pending ? [c.phrase, pick(rnd, T01[c.language] ?? T01.es ?? ['Sí, por favor'])] : [c.phrase];
            keys.add(key);
            cases.push({
                key, intentId: c.intent.id, intentTitle: c.intent.title, layer: c.intent.layer,
                requirementIds: [c.req.req.id], requirementTitle: c.req.req.title, uiTarget: c.req.req.uiTarget ?? null,
                itemId: c.item && c.ownItem ? c.item.id : null, itemName: c.item ? itemName(c.item) : null, language: c.language, turns,
                expected: tc.expected, valueState: tc.valueState, truth: tc,
                expectation: {
                    figuresAnyOf: anyOf,
                    forbiddenFigures: forbiddenFigures(spec, snap, at, tc, c.item && c.ownItem ? c.item : null, new Set(anyOf)),
                    noMoney: tc.expected === 'COTIZA',
                    qualifier: tc.qualifier ?? null,
                    event: pending ? { turn: 2, kind: 'pending_question' } : null,
                    unknownMarker: tc.expected === 'NC+AV' || tc.expected === 'GAP' || priceUnknown,
                    answerable: tc.valueState === 'confirmado' && ['AFIRMA', 'NIEGA', 'COTIZA', 'EXT'].includes(tc.expected) && !priceUnknown,
                    paraphrase: paraphraseOf(tc),
                },
            });
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

/**
 * Una intención agrupa varios requisitos (R1.1 F10); la primera pregunta usa el más directo: el catálogo del ítem nombrado,
 * luego otro requisito de ese objeto, luego los del núcleo y por último los de perfil o dominio. Dentro de cada grupo,
 * barajado con la semilla. Las rondas siguientes toman el resto en ese orden.
 */
function byDirectness(list: readonly Candidate[], rnd: () => number): Candidate[] {
    const rank = (c: Candidate) => (c.ownItem && String(c.req.req.templateId ?? c.req.req.id).endsWith('.CATALOG') ? 0 : c.ownItem ? 1 : c.req.req.layer === 'core' ? 2 : 3);
    const groups = [0, 1, 2, 3].map(r => shuffle(list.filter(c => rank(c) === r), rnd));
    return groups.flat();
}

function shuffle<T>(xs: readonly T[], rnd: () => number): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
