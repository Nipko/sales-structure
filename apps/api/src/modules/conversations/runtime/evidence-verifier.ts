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
 * bandera por tenant `agentRuntime.evidenceVerifier` (apagada por defecto), sellada en la foto como las demás. Usa un
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

/** Cifras de una frase: «250.000» y «250,000» son 250000; «13.5» es 13.5. Las horas (8:00) no se leen como cifras. */
export function sentenceNumbers(sentence: string): number[] {
    const text = sentence.replace(/\b\d{1,2}:\d{2}\b/g, ' ');
    return [...text.matchAll(/\d+(?:[.,]\d{3})+(?!\d)|\d+(?:[.,]\d+)?/g)].map(([m]) =>
        /^\d+(?:[.,]\d{3})+$/.test(m) ? Number(m.replace(/[.,]/g, '')) : Number(m.replace(',', '.')));
}

const HEDGE = /\b(no (tengo|consta|está registrad|esta registrad|puedo confirmar|cuento con (ese|esa|el|la) (dato|informaci))|por confirmar|sin confirmar|not confirmed|don'?t have (that|this)|não tenho|não consta|a confirmar)/i;

/**
 * D1d: el código descarta lo que el clasificador marcó mal y es comprobable sin modelo:
 * - una afirmación cuyas cifras (todas, o múltiplos chicos de una, como un total) están en las fuentes autoritativas;
 * - una frase que solo dice que algo no consta o está por confirmar (el prompt ya pide no marcarlas).
 * Una frase con horas nunca se respalda por cifras: los horarios sembrados son el error más común.
 */
export function dropBackedViolations(violations: readonly EvidenceViolation[], numbers: ReadonlySet<number>): { kept: EvidenceViolation[]; dropped: EvidenceViolation[] } {
    const backed = (n: number): boolean => numbers.has(n)
        || [...numbers].some(a => a > 0 && n % a === 0 && n / a >= 2 && n / a <= MAX_MULTIPLE);
    const kept: EvidenceViolation[] = [];
    const dropped: EvidenceViolation[] = [];
    for (const v of violations) {
        const hasTime = /\b\d{1,2}:\d{2}\b/.test(v.sentence);
        const nums = sentenceNumbers(v.sentence).filter(n => n > MAX_MULTIPLE || !Number.isInteger(n));
        const figuresBacked = v.kind === 'claim' && !hasTime && nums.length > 0 && nums.every(backed);
        if (figuresBacked || HEDGE.test(v.sentence)) dropped.push(v); else kept.push(v);
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
    const flagged = violations.map(v => normalize(v.sentence));
    const sentences = splitSentences(reply);
    const kept: string[] = [];
    const removed: string[] = [];
    for (const s of sentences) {
        const n = normalize(s);
        if (flagged.some(f => n.includes(f) || f.includes(n))) removed.push(s); else kept.push(s);
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
