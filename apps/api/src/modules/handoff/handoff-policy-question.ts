import { normalizeForIntent } from '@parallext/shared';
import { isInformationSeekingMessage } from '../../common/conversation/intent-normalizer';

/**
 * A question ABOUT a policy is not a complaint.
 *
 * `shouldHandoff` listens for words such as `devolucion`, `reembolso`,
 * `remboursement`, `descuento` or `desconto`, but those are also the nouns of
 * perfectly ordinary questions ("¿cuál es la política de devoluciones?",
 * "¿hacen reembolsos?", "¿tienen descuentos?"). Escalating them silenced the
 * bot on a customer who only wanted to read the policy, which the agent can
 * answer from its knowledge base.
 *
 * Conservative on purpose. A message is a policy question only when ALL hold:
 *  - it asks (shared `isInformationSeekingMessage`: question mark / wh-word);
 *  - it is framed as a question about the business ("la política de", "aceptan",
 *    "tienen", "do you have"…), not about the customer's own case;
 *  - it carries no grievance ("llegó dañado", "estafa"…) and no personal request
 *    to a person ("me hace un descuento", "me lo deja más barato").
 */

/** Words that only name a policy topic; the sole keywords this can neutralise. */
export const POLICY_TOPIC_KEYWORDS: ReadonlySet<string> = new Set([
    'devolucion', 'reembolso', 'remboursement',
    'descuento', 'rebaja', 'desconto', 'remise',
]);

const POLICY_FRAME = /\b(?:politicas?|politique|policy|policies|aceptan|aceptais|acepta|hacen|ofrecen|ofrece|manejan|tienen|tiene|hay|existe|existen|plazo|condiciones|condicoes|como funciona|cuanto tiempo|cuantos dias|do you (?:have|offer|accept|do|give)|are there|is there|what is|what s|what are|how (?:long|does)|ha(?:ve|s) you|avez[ -]vous|offrez[ -]vous|acceptez[ -]vous|faites[ -]vous|y a[ -]t[ -]il|quelle est|quelles sont|votre politique|aceitam|fazem|oferecem|tem|existe|qual e|quais sao|a politica)\b/;

const GRIEVANCE = /\b(?:danad[oa]s?|roto|rota|rotos|rotas|defectuos[oa]s?|no funciona|llego (?:mal|roto|danado|tarde)|estafa|fraude|engano|enganaram|golpe|inaceptable|inacceptable|pesimo|pessimo|horrible|terrible|furios[oa]|molest[oa]|queja|reclamo|reclamacao|plainte|demanda|abogado|advogado|avocat|damaged|broken|defective|faulty|scam|fraud|unacceptable|terrible|awful|lawyer|casse|endommage|arnaque|ne fonctionne pas|nao funciona|quebrado|chegou)\b/;

const PERSONAL_REQUEST = /\b(?:me (?:lo |la |los |las )?(?:hace|hacen|haces|da|dan|das|deja|dejan|dejas|rebaja|rebajan|rebajas|regala|regalan|puede|pueden|podria|podrian|puedes|podrias)|(?:puede|pueden|podria|podrian|puedes|podrias) (?:hacerme|darme|rebajarme|dejarmelo|devolverme)|me (?:lo |la )?(?:dejan|dejas)|(?:can|could|will|would) you (?:give|do|make|offer|refund)(?: it)? (?:me|us)|pouvez[ -]vous me|vous me (?:faites|donnez)|(?:podem|pode|voce pode) (?:me )?(?:dar|fazer)|me (?:da|faz|fazem|dao)|exijo|exigimos|i demand|je veux (?:etre )?rembours|quiero (?:que me|mi dinero|un reembolso|devolver|devolucion)|necesito (?:un reembolso|devolver)|i want (?:a refund|my money|to return))\b/;

export function isPolicyQuestion(raw: unknown): boolean {
    const text = normalizeForIntent(raw);
    if (!text) return false;
    if (!isInformationSeekingMessage(raw)) return false;
    if (GRIEVANCE.test(text) || PERSONAL_REQUEST.test(text)) return false;
    return POLICY_FRAME.test(text);
}
