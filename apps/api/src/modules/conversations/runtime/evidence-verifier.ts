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
const EVIDENCE_MAX_CHARS = 4000;
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
    'NO marques: decir que algo no consta, no está registrado o está por confirmar; ofrecer averiguarlo o pasar con una persona; preguntas al cliente; descripciones generales de lo que el agente puede ayudar; datos respaldados por facts o evidence; cortesías.',
    'Responde SOLO JSON: {"violations": [{"sentence": "la frase exacta", "kind": "claim" | "denial", "requirementId": "ID del unknown o null"}]}. Sin violaciones: {"violations": []}.',
].join('\n');

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

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
    const notice = unknownNotice(contract, language);
    const question = kept.length && /[?？]\s*$/.test(kept[kept.length - 1]) ? kept.pop()! : null;
    const body = [...kept, notice, ...(question ? [question] : [])].join(' ');
    return { reply: body, removed, noticeAdded: true };
}
