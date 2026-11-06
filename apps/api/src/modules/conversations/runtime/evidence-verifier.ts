/**
 * EvidenceVerifier — fase D, rebanada D1b (ADR 0016): «verificar antes de enviar».
 *
 * La línea base calibrada de E1 (ADR 0015) mostró que tres de cada cuatro fallos del agente son afirmar o negar sin
 * evidencia: un horario sembrado dicho como hecho, «no hay disponibilidad» sin fuente, «no incluye» sin vacío
 * confirmado. Este paso corre después de los guardias del turno y antes de los traspasos:
 *
 * 1. Un clasificador barato (rol `classify`, temperatura 0, JSON) recibe la respuesta, el mensaje del cliente, los
 *    requisitos que NO constan del contrato de conocimiento del turno (con su estado, código y lista «nunca»), los
 *    hechos confirmados y la evidencia leída en el turno. Devuelve las frases que afirman o niegan algo sin respaldo.
 * 2. El código, no el modelo, repara: quita esas frases y, si hace falta, agrega el texto fijo del comportamiento «si
 *    falta» (no consta + lo averiguo / pasar con una persona), según las ofertas del contrato.
 *
 * Nunca bloquea el turno: si el clasificador no responde o no se puede leer, la respuesta sale como estaba. Detrás de la
 * bandera por tenant `agentRuntime.evidenceVerifier` (encendida por defecto desde E2h), sellada en la foto como las demás. Usa un
 * modelo distinto del juez del ensayo (`deepseek-chat`) para que el ensayo no mida su propio sesgo.
 */
import type { TurnKnowledgeContract } from '@parallext/business-spec';

export const EVIDENCE_VERIFIER_MODEL = 'gpt-4.1-mini';
export const EVIDENCE_VERIFIER_MAX_TOKENS = 400;
const EVIDENCE_MAX_CHARS = 9000;
const REPLY_MAX_CHARS = 3000;

export type EvidenceLanguage = 'es' | 'en' | 'pt' | 'fr';

export interface EvidenceViolation {
    /** La frase de la respuesta, tal cual. */
    readonly sentence: string;
    readonly kind: 'claim' | 'denial';
    /** El requisito que no consta y que la frase afirma o niega, si el clasificador lo identificó. */
    readonly requirementId: string | null;
    /** D1j: lo que queda de la frase sin la negación, si eso está respaldado; el reparador lo deja en su lugar. */
    readonly keep?: string;
}

export interface EvidenceVerdict { readonly violations: readonly EvidenceViolation[] }

export interface EvidenceVerifierRequest {
    readonly task: 'classify';
    readonly model: string;
    readonly systemPrompt: string;
    readonly messages: Array<{ role: 'user'; content: string }>;
    readonly temperature: 0;
    readonly jsonMode: true;
    readonly maxTokens: number;
}

export const EVIDENCE_VERIFIER_PROMPT = [
    'Revisas la respuesta de un agente de atención al cliente ANTES de que se envíe. Recibes el mensaje del cliente, la respuesta, los datos del negocio que NO constan (unknown: con su estado ejemplo/sembrado/ausente y su lista «never»), los hechos confirmados (facts) y la evidencia que el agente leyó en este turno (evidence).',
    'Marca SOLO las frases de la respuesta que:',
    '- AFIRMAN como hecho algo de un tema que no consta (un horario, precio, plazo, política, disponibilidad, medio de pago, cargo, servicio o condición) y que no está respaldado por facts ni por evidence; o',
    '- NIEGAN algo («no hay», «no incluye», «no tenemos», «no aceptamos», «no requiere») sin que facts o evidence lo respalden. Que un dato no conste NUNCA autoriza a negarlo.',
    'La evidencia trae el catálogo, los servicios, los hechos verificados y las lecturas que el agente tuvo en este turno: un dato que aparece ahí (un precio, una ficha, un horario, un stock) está respaldado aunque el tema esté en unknown, porque unknown describe el requisito del negocio en general, no cada ficha.',
    'Una pregunta frecuente (FAQ) o un artículo de la evidencia que habla de un tipo de producto o servicio sin nombrar uno concreto («el audífono», «el audífono QA de prueba», «los tours») respalda decir ese dato del producto concreto de ese tipo por el que pregunta el cliente («Audífono QA Aurora»). No lo respalda si nombra otro producto distinto («Faro Azul» no respalda «Faro Rojo»).',
    'Un 0 o false en la evidencia NO respalda una negación: suele ser el valor por defecto del campo, no un «no» del negocio. «Sin cargo por limpieza» con cleaningFee 0 es una violación.',
    'Excepción: una lectura de este turno que responde «available»: false con un motivo de falta («reason»: no_departure_on_date, not_enough_seats, party_size_too_small o party_size_too_large) SÍ respalda decir que no hay salida, cupo o disponibilidad en esa fecha. «party_size_required» NO es un «no»: solo falta saber cuántos viajan.',
    'NO marques: decir que algo no consta, no está registrado o está por confirmar; ofrecer averiguarlo o pasar con una persona; preguntas al cliente; descripciones generales de lo que el agente puede ayudar; datos respaldados por facts o evidence; cortesías.',
    'Responde SOLO JSON: {"violations": [{"sentence": "la frase exacta", "kind": "claim" | "denial", "requirementId": "ID del unknown o null"}]}. Sin violaciones: {"violations": []}.',
].join('\n');

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Un hecho verificado del turno (libro de hechos o catálogo proyectado), en la forma mínima que el verificador lee. */
export interface EvidenceFact {
    readonly subject: { readonly name?: string; readonly id: string };
    readonly field: string;
    readonly value: unknown;
    readonly currency?: string;
}

/**
 * D1c: la evidencia es todo lo que el agente vio como autoridad en el turno, no solo las herramientas que llamó. E2b
 * midió el verificador sin el catálogo del turno, las lecturas automáticas ni los hechos verificados: quitó precios
 * confirmados (AFIRMA cayó de 70% a 38% de pass^3). Va primero lo más denso y lo que más pesa: hechos, catálogo,
 * servicios; después lecturas y herramientas, conocimiento recuperado y la identidad del negocio.
 */
export function turnEvidence(input: {
    facts?: readonly EvidenceFact[];
    catalog?: readonly unknown[];
    services?: readonly unknown[];
    reads?: ReadonlyArray<{ name: string; result: unknown }>;
    knowledge?: readonly unknown[];
    business?: unknown;
}): string[] {
    const facts = (input.facts ?? []).map(f => `${f.subject.name ?? f.subject.id} · ${f.field} = ${JSON.stringify(f.value)}${f.currency ? ` ${f.currency}` : ''}`);
    return [
        ...(facts.length ? [`facts: ${clip(facts.join('; '), 2500)}`] : []),
        ...(input.catalog?.length ? [`catalog: ${clip(JSON.stringify(input.catalog), 2500)}`] : []),
        ...(input.services?.length ? [`services: ${clip(JSON.stringify(input.services), 1500)}`] : []),
        ...(input.reads ?? []).map(t => `${t.name}: ${clip(JSON.stringify(t.result ?? null), 1500)}`),
        ...(input.knowledge ?? []).map(k => `knowledge: ${clip(JSON.stringify(k), 800)}`),
        ...(input.business ? [`business: ${clip(JSON.stringify(input.business), 800)}`] : []),
    ];
}

/** La solicitud al clasificador. `evidence`: lecturas del turno ya serializadas (el llamador las elige y recorta). */
export function evidenceVerifierRequest(input: {
    customerMessage: string;
    reply: string;
    contract: TurnKnowledgeContract;
    evidence: readonly string[];
    model?: string;
}): EvidenceVerifierRequest {
    const payload = {
        customer: clip(input.customerMessage, 1000),
        reply: clip(input.reply, REPLY_MAX_CHARS),
        unknown: input.contract.unknown.map(u => ({ id: u.id, topic: u.topic, state: u.state, never: u.never })),
        facts: input.contract.facts.map(f => ({ id: f.id, topic: f.topic, value: f.value })),
        evidence: clip(input.evidence.join('\n'), EVIDENCE_MAX_CHARS),
    };
    return {
        task: 'classify', model: input.model ?? EVIDENCE_VERIFIER_MODEL, systemPrompt: EVIDENCE_VERIFIER_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(payload) }], temperature: 0, jsonMode: true, maxTokens: EVIDENCE_VERIFIER_MAX_TOKENS,
    };
}

/** Lee el JSON del clasificador; cualquier otra cosa es «sin veredicto» (la respuesta sale como estaba). */
export function parseEvidenceVerdict(content: unknown, reply: string): EvidenceVerdict | null {
    const text = typeof content === 'string' ? content.trim() : '';
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    try {
        const parsed = JSON.parse(json) as { violations?: unknown };
        if (!Array.isArray(parsed.violations)) return null;
        const violations: EvidenceViolation[] = [];
        for (const v of parsed.violations as Array<Record<string, unknown>>) {
            const sentence = typeof v?.sentence === 'string' ? v.sentence.trim() : '';
            // Solo frases que de verdad están en la respuesta: el clasificador no reescribe, señala.
            if (!sentence || !normalize(reply).includes(normalize(sentence))) continue;
            violations.push({ sentence, kind: v.kind === 'denial' ? 'denial' : 'claim',
                requirementId: typeof v.requirementId === 'string' && v.requirementId ? v.requirementId : null });
        }
        return { violations };
    } catch {
        return null;
    }
}

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Estados de precio que no respaldan una cifra: el negocio no la confirmó. */
const UNCONFIRMED_PRICE = new Set(['example', 'seeded', 'missing', 'estimated', 'placeholder']);
const MAX_MULTIPLE = 20;

/**
 * D1d: las cifras de las fuentes autoritativas del turno — lecturas, catálogo, servicios y hechos verificados. Nunca el
 * conocimiento recuperado ni la identidad: pueden ser texto sembrado. Un precio con estado de ejemplo o sembrado no
 * cuenta.
 */
export function authoritativeNumbers(input: {
    facts?: readonly EvidenceFact[];
    catalog?: readonly unknown[];
    services?: readonly unknown[];
    reads?: ReadonlyArray<{ result: unknown }>;
}): Set<number> {
    const out = new Set<number>();
    const walk = (value: unknown, depth: number): void => {
        if (depth > 8 || value === null || value === undefined) return;
        if (typeof value === 'number') { if (Number.isFinite(value)) out.add(value); return; }
        if (Array.isArray(value)) { for (const v of value) walk(v, depth + 1); return; }
        if (typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        const unconfirmedPrice = typeof record.priceStatus === 'string' && UNCONFIRMED_PRICE.has(record.priceStatus);
        // E2p (store warranty, 4 of 5 probes): «72 días» is only in the text of the FAQ the turn read. A FAQ read is written by
        // the business, so its answer's figures count; one marked as example or seeded does not.
        const status = record.contentStatus ?? record.content_status;
        if (typeof record.question === 'string' && typeof record.answer === 'string'
            && !(typeof status === 'string' && UNCONFIRMED_PRICE.has(status))) {
            for (const n of sentenceNumbers(record.answer)) out.add(n);
        }
        for (const [key, v] of Object.entries(record)) {
            if (unconfirmedPrice && /price/i.test(key)) continue;
            walk(v, depth + 1);
        }
    };
    for (const f of input.facts ?? []) if (typeof f.value === 'number') out.add(f.value);
    walk(input.catalog, 0);
    walk(input.services, 0);
    for (const r of input.reads ?? []) walk(r.result, 0);
    return out;
}

/**
 * Cifras de una frase: «250.000» y «250,000» son 250000; «13.5» es 13.5. Las horas (8:00) no se leen como cifras, ni
 * los dígitos pegados a letras: son parte de un nombre o código («Galaxy S24», «Plato 20261018T110518Z»).
 */
export function sentenceNumbers(sentence: string): number[] {
    const text = sentence.replace(/\b\d{1,2}:\d{2}\b/g, ' ');
    return [...text.matchAll(/(?<![\p{L}\d])(?:\d+(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)(?![\p{L}\d])/gu)].map(([m]) =>
        /^\d+(?:[.,]\d{3})+$/.test(m) ? Number(m.replace(/[.,]/g, '')) : Number(m.replace(',', '.')));
}

const HEDGE = /\b(no (tengo|tenemos (registrad|informaci|ese dato|esa informaci|datos)|consta|está registrad|esta registrad|puedo confirmar|cuento con (ese|esa|el|la) (dato|informaci))|no (hay|existe) informaci|no est[aá] registrad|por confirmar|sin confirmar|not confirmed|don'?t have (that|this)|não tenho|não consta|a confirmar)/i;

/** D1g: una frase de cupos o stock dice cifras chicas («quedan 10 cupos», «hay 2 unidades»): esas sí se comprueban. */
const AVAILABILITY = /\b(cupos?|plazas?|lugares|disponib\w*|unidades|stock|existencias|quedan?|spots?|seats?|available|units?|in stock|vagas?|dispon[ií]ve\w*)\b/i;

/**
 * D1q (E2o, viajes C08): una frase de tamaño de grupo («mínimo 1 y máximo 10 personas», «para 2 huéspedes») dice cifras
 * chicas que la ficha trae (minPartySize, maxCapacity, maxGuests): también se comprueban, igual que los cupos.
 */
const GROUP_SIZE = /\b(personas?|pax|viajeros?|hu[eé]spedes|pasajeros?|participantes|grupos?|capacidad|m[ií]nimo|m[aá]ximo|people|persons?|guests?|travell?ers?|participants|group|capacity|minimum|maximum|pessoas|viajantes|h[oó]spedes)\b/i;

const NEGATION = /\b(no|sin|ning[uú]n|without|sem|não)\b/i;

/** D1m: una frase sobre la salida, el cupo o la disponibilidad de una fecha. */
const DATE_AVAILABILITY = /\b(salidas?|departures?|sa[ií]das?|départs?|cupos?|plazas?|seats?|vagas?|disponib\w*|available|availability|dispon[ií]ve\w*)\b/i;

/**
 * D1m (E2i, C15): una lectura de este turno que contesta «available: false» con un motivo («no_departure_on_date») es un
 * «no» del negocio para esa fecha, no un valor por defecto: respalda «no hay salida ese día».
 */
const UNAVAILABLE_REASONS = new Set(['no_departure_on_date', 'not_enough_seats', 'party_size_too_small', 'party_size_too_large']);

/**
 * D1o (E2k, C15): solo los motivos de falta cuentan. «party_size_required» también llega con «available: false», pero dice
 * que falta el número de viajeros (a veces con cupo ilimitado): respaldarlo dejó pasar «no tiene disponibilidad el sábado».
 */
export function explicitUnavailable(reads: ReadonlyArray<{ result: unknown }> | undefined): boolean {
    return (reads ?? []).some(r => {
        const result = r.result as Record<string, unknown> | null;
        return !!result && typeof result === 'object' && result.available === false
            && typeof result.reason === 'string' && UNAVAILABLE_REASONS.has(result.reason);
    });
}

/** D1n: una salida que una lectura de este turno devolvió (fecha, hora y cupos). */
export interface ReadDeparture { readonly year: number; readonly month: number; readonly day: number; readonly time?: string; readonly seats?: number }

/** D1p (E2m): en el turno las lecturas llevan `Date` de Prisma, no el texto ISO del JSON que ve el modelo. */
const textOf = (value: unknown): string => value instanceof Date ? (isNaN(value.getTime()) ? '' : value.toISOString()) : typeof value === 'string' ? value : '';

/** D1n: las salidas de las lecturas del turno: objetos con `date` (AAAA-MM-DD…) y `seatsLeft` (upcomingDepartures, nextDepartures). */
export function readDepartures(reads: ReadonlyArray<{ result: unknown }> | undefined): ReadDeparture[] {
    const out: ReadDeparture[] = [];
    const walk = (value: unknown, depth: number): void => {
        if (depth > 8 || !value || typeof value !== 'object') return;
        if (Array.isArray(value)) { for (const v of value) walk(v, depth + 1); return; }
        if (value instanceof Date) return;
        const record = value as Record<string, unknown>;
        const date = textOf(record.date).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (date && 'seatsLeft' in record) {
            const clock = textOf(record.time ?? record.departureTime).match(/(?:^|T)(\d{2}):(\d{2})/);
            out.push({ year: Number(date[1]), month: Number(date[2]), day: Number(date[3]),
                ...(clock ? { time: `${Number(clock[1])}:${clock[2]}` } : {}),
                ...(typeof record.seatsLeft === 'number' ? { seats: record.seatsLeft } : {}) });
        }
        for (const v of Object.values(record)) walk(v, depth + 1);
    };
    for (const r of reads ?? []) walk(r.result, 0);
    return out;
}

const MONTHS: readonly (readonly string[])[] = [
    ['enero', 'january', 'janeiro', 'janvier'], ['febrero', 'february', 'fevereiro', 'fevrier'], ['marzo', 'march', 'marco', 'mars'],
    ['abril', 'april', 'avril'], ['mayo', 'may', 'maio', 'mai'], ['junio', 'june', 'junho', 'juin'], ['julio', 'july', 'julho', 'juillet'],
    ['agosto', 'august', 'aout'], ['septiembre', 'setiembre', 'september', 'setembro', 'septembre'], ['octubre', 'october', 'outubro', 'octobre'],
    ['noviembre', 'november', 'novembro', 'novembre'], ['diciembre', 'december', 'dezembro', 'decembre'],
];

/**
 * D1n (E2j, C15): «La próxima salida disponible es el 15 de diciembre de 2026 a las 9:00, con 10 cupos» fue quitada: las
 * fechas y horas no se comprueban como cifras y la disponibilidad del objeto estaba `[1/2]`. Una afirmación que nombra la
 * fecha de una salida leída en este turno, y cuyas horas y cupos son los de esa salida, está respaldada.
 */
export function departureBacked(text: string, departures: readonly ReadDeparture[]): boolean {
    const folded = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    let rest = folded;
    const named = departures.filter(d => {
        const months = MONTHS[d.month - 1].join('|');
        const date = new RegExp(`${d.year}-0?${d.month}-0?${d.day}(?!\\d)|(?<!\\d)0?${d.day}(?:\\s+(?:de|of))?\\s+(?:${months})\\b|\\b(?:${months})\\s+0?${d.day}(?!\\d)|(?<!\\d)0?${d.day}[/.-]0?${d.month}(?:[/.-]${d.year})?(?!\\d)`, 'g');
        const hit = date.test(rest);
        rest = rest.replace(date, ' ');
        return hit;
    });
    if (!named.length) return false;
    const times = [...rest.matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map(m => `${Number(m[1])}:${m[2]}`);
    if (!times.every(t => named.some(d => d.time === t))) return false;
    const allowed = new Set(named.flatMap(d => [d.year, ...(d.seats !== undefined ? [d.seats] : [])]));
    return sentenceNumbers(rest).every(n => allowed.has(n));
}

/** D1j: partes de una frase: comas, punto y coma, y la «y» que abre una negación («… 150.000 COP y no tiene …»). */
const CLAUSE = /\s*[,;]\s*|\s+(?:y|and|e)\s+(?=(?:no|sin|without|sem|não)\b)/i;

/**
 * D1d: el código descarta lo que el clasificador marcó mal y es comprobable sin modelo:
 * - una afirmación cuyas cifras (todas, o múltiplos chicos de una, como un total) están en las fuentes autoritativas;
 * - una frase que solo dice que algo no consta o está por confirmar (el prompt ya pide no marcarlas).
 * D1i: una cifra que el cliente escribió (la cantidad que pide, el código del ítem) no es un dato del negocio y no se
 * comprueba; si el clasificador marcó un trozo, las cifras se leen en la frase entera de la respuesta que lo contiene.
 * D1j: un 0 o false de los datos no respalda nada: suele ser el valor por defecto de la columna, no un «no» del negocio
 * (L4; retira el respaldo por ausencias de D1f). Si la frase mezcla cifras respaldadas con una negación sin respaldo
 * («150.000 COP por noche y no tiene costo de limpieza»), la violación sigue pero lleva `keep`: lo respaldado, sin la
 * negación. Una negación que solo repite cifras del cliente o de los datos («no sería posible pedir 3») no cuenta.
 * Una frase con horas nunca se respalda por cifras: los horarios sembrados son el error más común.
 */
export function dropBackedViolations(violations: readonly EvidenceViolation[], numbers: ReadonlySet<number>,
    turn: { reply?: string; customerMessage?: string; explicitUnavailable?: boolean; departures?: readonly ReadDeparture[] } = {},
): { kept: EvidenceViolation[]; dropped: EvidenceViolation[] } {
    const backed = (n: number): boolean => n !== 0 && (numbers.has(n)
        || [...numbers].some(a => a > 0 && n % a === 0 && n / a >= 2 && n / a <= MAX_MULTIPLE));
    const echoed = new Set(sentenceNumbers(turn.customerMessage ?? ''));
    const replySentences = splitSentences(turn.reply ?? '');
    /** `checked`: hay cifras del negocio que comprobar; `ok`: todas respaldadas y sin horas. */
    const figuresOf = (text: string): { any: boolean; checked: boolean; ok: boolean } => {
        const all = sentenceNumbers(text);
        const figures = all.filter(n => !echoed.has(n));
        const nums = figures.filter(n => n > MAX_MULTIPLE || !Number.isInteger(n));
        // D1g/D1q: en una frase de cupos, stock o tamaño de grupo, una cifra chica cuenta si está tal cual en los datos (no como múltiplo).
        const small = AVAILABILITY.test(text) || GROUP_SIZE.test(text) ?figures.filter(n => Number.isInteger(n) && n > 0 && n <= MAX_MULTIPLE) : [];
        return { any: all.length > 0, checked: nums.length + small.length > 0,
            ok: !figures.includes(0) && !/\b\d{1,2}:\d{2}\b/.test(text) && nums.every(backed) && small.every(n => backed(n) && numbers.has(n)) };
    };
    const kept: EvidenceViolation[] = [];
    const dropped: EvidenceViolation[] = [];
    for (const v of violations) {
        if (HEDGE.test(v.sentence)) { dropped.push(v); continue; }
        const whole = replySentences.find(s => s.includes(v.sentence)) ?? v.sentence;
        if (v.kind === 'denial' && turn.explicitUnavailable && DATE_AVAILABILITY.test(whole)) { dropped.push(v); continue; }
        if (v.kind === 'claim' && turn.departures?.length && !NEGATION.test(whole) && departureBacked(whole, turn.departures)) { dropped.push(v); continue; }
        const clauses = whole.split(CLAUSE).map(c => c.trim()).filter(Boolean);
        const negated = clauses.filter(c => NEGATION.test(c) && !(figuresOf(c).any && figuresOf(c).ok));
        const all = figuresOf(whole);
        if (!negated.length) {
            // E2o (store C10, 3 of 3): the classifier also labels «no es posible pedir 3 unidades, solo quedan 2» a denial. Its
            // only «no» repeats the customer's figure and the sentence's figures are in the data: backed, whatever the label.
            if (all.checked && all.ok) dropped.push(v); else kept.push(v);
            continue;
        }
        const positive = clauses.filter(c => !negated.includes(c));
        const rest = figuresOf(positive.join(', '));
        kept.push(positive.length && rest.checked && rest.ok ? { ...v, keep: `${positive.join(', ').replace(/[\s.,;:]+$/, '')}.` } : v);
    }
    return { kept, dropped };
}

/** Frases: corta tras . ! ? … (y sus cierres) seguidos de espacio o salto de línea. */
export function splitSentences(text: string): string[] {
    return text.split(/(?<=[.!?…][)"'»”]?)\s+/u).map(s => s.trim()).filter(Boolean);
}

const UNKNOWN_TEXT: Readonly<Record<EvidenceLanguage, { pending: string; handoff: string; plain: string }>> = {
    es: { pending: 'No tengo ese dato confirmado; si quiere, lo consulto con el equipo y le aviso.', handoff: 'No tengo ese dato confirmado; si quiere, le paso con una persona del equipo para confirmarlo.', plain: 'No tengo ese dato confirmado.' },
    en: { pending: "I don't have that confirmed; if you like, I'll check with the team and let you know.", handoff: "I don't have that confirmed; if you like, I can connect you with someone from the team to confirm it.", plain: "I don't have that confirmed." },
    pt: { pending: 'Não tenho essa informação confirmada; se quiser, consulto a equipe e aviso você.', handoff: 'Não tenho essa informação confirmada; se quiser, passo você para alguém da equipe confirmar.', plain: 'Não tenho essa informação confirmada.' },
    fr: { pending: "Je n'ai pas cette information confirmée ; si vous voulez, je vérifie avec l'équipe et je vous préviens.", handoff: "Je n'ai pas cette information confirmée ; si vous voulez, je vous mets en relation avec quelqu'un de l'équipe pour la confirmer.", plain: "Je n'ai pas cette information confirmée." },
};

/** El texto fijo del «si falta», según lo que el contrato ofrece (nunca promete lo que el negocio no tiene definido). */
export function unknownNotice(contract: TurnKnowledgeContract, language: string): string {
    const t = UNKNOWN_TEXT[(['es', 'en', 'pt', 'fr'] as const).find(l => language?.toLowerCase().startsWith(l)) ?? 'es'];
    if (contract.offers.pendingQuestion) return t.pending;
    if (contract.offers.handoff?.available) return t.handoff;
    return t.plain;
}

export interface EvidenceRepair {
    readonly reply: string;
    readonly removed: readonly string[];
    readonly noticeAdded: boolean;
}

/**
 * Quita las frases señaladas y agrega el aviso «no consta» una sola vez. Si la respuesta queda sin contenido, es solo el
 * aviso. Una pregunta final que sobrevive se deja al final (el cliente la ve como siguiente paso).
 */
export function repairReply(reply: string, violations: readonly EvidenceViolation[], contract: TurnKnowledgeContract, language: string): EvidenceRepair {
    if (!violations.length) return { reply, removed: [], noticeAdded: false };
    const sentences = splitSentences(reply);
    const kept: string[] = [];
    const removed: string[] = [];
    for (const s of sentences) {
        const n = normalize(s);
        const hits = violations.filter(v => { const f = normalize(v.sentence); return n.includes(f) || f.includes(n); });
        if (!hits.length) { kept.push(s); continue; }
        removed.push(s);
        if (hits.every(v => v.keep)) kept.push(hits[0].keep!);
    }
    if (!removed.length) return { reply, removed: [], noticeAdded: false };
    // Un encabezado de lista que se quedó sin ítems («Estos son nuestros servicios: 1.») tampoco se envía.
    for (let i = kept.length - 1; i >= 0; i--) {
        const bare = kept[i].replace(/(^|\n)\s*\d+[.)]$/, '').trim();
        if (!bare || bare.endsWith(':')) kept.splice(i, 1); else if (bare !== kept[i]) kept[i] = bare;
    }
    const notice = unknownNotice(contract, language);
    const question = kept.length && /[?？]\s*$/.test(kept[kept.length - 1]) ? kept.pop()! : null;
    const body = [...kept, notice, ...(question ? [question] : [])].join(' ');
    return { reply: body, removed, noticeAdded: true };
}
