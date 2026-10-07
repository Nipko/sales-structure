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
 * The opposite error is worse: a customer who was charged twice, whose parcel
 * never arrived or who wants a discount for themselves must still reach a
 * person, even when the sentence happens to be shaped like a question
 * ("¿hay reembolso? me cobraron dos veces").
 *
 * So the exemption is conservative. A message is a policy question only when
 * ALL hold:
 *  - it asks (shared `isInformationSeekingMessage`: question mark / wh-word);
 *  - it is framed as a question about the business ("la política de", "aceptan",
 *    "tienen", "do you have"…);
 *  - it is GENERAL: no grievance ("estafa", "queja"…), no personal request to a
 *    person ("me hace un descuento", "para mí"), and no first-person case (my
 *    order, I was charged, it never arrived, it does not work, "por qué no…").
 */

/** Words that only name a policy topic; the sole keywords/triggers this can neutralise. */
export const POLICY_TOPIC_KEYWORDS: ReadonlySet<string> = new Set([
    'devolucion', 'devoluciones', 'reembolso', 'reembolsos', 'remboursement', 'remboursements',
    'descuento', 'descuentos', 'rebaja', 'rebajas', 'desconto', 'descontos', 'remise', 'remises',
    'refund', 'refunds', 'return', 'returns',
]);

/**
 * Phrases that report a product that arrived damaged. They escalate on their
 * own, except in a hypothetical question ("¿qué hago si el producto llegó roto?").
 */
export const DEFECT_ON_ARRIVAL_KEYWORDS: readonly string[] = [
    'llego danado', 'llego roto', 'chegou danificado', 'chegou quebrado', 'est arrive endommage',
];
const DEFECT_ON_ARRIVAL_SET: ReadonlySet<string> = new Set(DEFECT_ON_ARRIVAL_KEYWORDS);

const POLICY_FRAME_BASE = /\b(?:politicas?|politique|policy|policies|aceptan|aceptais|acepta|hacen|ofrecen|ofrece|manejan|tienen|tiene|hay|existe|existen|plazo|condiciones|condicoes|como funciona|cuanto tiempo|cuantos dias|do you (?:have|offer|accept|do|give)|are there|is there|what is|what['’ ]?s|what are|how (?:long|does)|ha(?:ve|s) you|avez[ -]vous|offrez[ -]vous|acceptez[ -]vous|faites[ -]vous|y a[ -]t[ -]il|quelle est|quelles sont|votre politique|aceitam|fazem|oferecem|tem|qual e|quais sao|a politica)\b/;

/**
 * "How do I / can I / is it possible / how long does it take" asks about the
 * way something works, which is what a policy question is. Weak on their own,
 * so everything above (personal case, grievance, request for oneself) is
 * checked first: "¿puedo pedir un reembolso? me cobraron dos veces" still goes
 * to a person.
 */
const POLICY_FRAME_HOW = [
    // es
    'cuanto (?:tarda|tardan|demora|demoran|se tarda|se demora)',
    'como (?:solicito|solicitar|solicitan|pido|pedir|hago|tramito|tramitar|se solicita|se pide|se hace|puedo (?:solicitar|pedir|hacer|tramitar))',
    'se puede',
    'es posible',
    'puedo (?:pedir|solicitar|hacer|tramitar|obtener)',
    // pt
    'quanto tempo',
    'como (?:solicito|peco|pedir|solicitar|faco|fazer)',
    'e possivel',
    'posso (?:pedir|solicitar|fazer)',
    // fr
    'combien de temps',
    'comment (?:demander|puis[ -]je|faire|obtenir)',
    'est[ -]il possible',
    'puis[ -]je (?:demander|obtenir|faire)',
    // en
    'how (?:do|can|should) i (?:request|ask|get|return|claim|apply)',
    'can i (?:get|ask|request|return|have|apply)',
    'is it possible',
    'how much time',
].join('|');
const POLICY_FRAME_HOW_RE = new RegExp(`\\b(?:${POLICY_FRAME_HOW})\\b`);

/** The refund / return topic words (not discounts): where the agent also offers a person. */
const REFUND_RETURN_TOPIC = /\b(?:devolucion(?:es)?|devolucao|devolucoes|reembolsos?|remboursements?|refunds?|returns?)\b/;

/** A damaged / broken product: a grievance, unless asked about hypothetically. */
const GRIEVANCE_DEFECT = /\b(?:danad[oa]s?|roto|rota|rotos|rotas|defectuos[oa]s?|llego (?:mal|roto|danado|tarde)|damaged|broken|defective|faulty|casse|endommage|quebrado|chegou)\b/;

const GRIEVANCE_OTHER = /\b(?:no funciona|estafa|fraude|engano|enganaram|golpe|inaceptable|inacceptable|pesimo|pessimo|horrible|terrible|furios[oa]|molest[oa]|queja|reclamo|reclamacao|plainte|demanda|abogado|advogado|avocat|scam|fraud|unacceptable|awful|lawyer|arnaque|ne fonctionne pas|nao funciona)\b/;

const PERSONAL_REQUEST = /\b(?:me (?:lo |la |los |las )?(?:hace|hacen|haces|da|dan|das|deja|dejan|dejas|rebaja|rebajan|rebajas|regala|regalan|puede|pueden|podria|podrian|puedes|podrias|tienen|tiene|dar|fazer|faire|faz|fazem|dao)|(?:puede|pueden|podria|podrian|puedes|podrias) (?:hacerme|darme|rebajarme|dejarmelo|devolverme)|(?:can|could|will|would) you (?:give|do|make|offer|refund)(?: it)? (?:me|us)|pouvez[ -]vous me|vous me (?:faites|donnez)|(?:podem|pode|voce pode) (?:me )?(?:dar|fazer)|para mi|pra mim|para mim|pour moi|for me|exijo|exigimos|i demand|je veux (?:etre )?rembours|quiero (?:que me|mi dinero|un reembolso|devolver|devolucion)|necesito (?:un reembolso|devolver)|i want (?:a refund|my money|to return))\b/;

/**
 * The customer is talking about THEIR case, not about the policy. One clause is
 * enough; the sentence may still be shaped like a question. Matched against
 * `normalizeForIntent` output (lower case, accents removed).
 */
const PERSONAL_CASE_TERMS = [
    // "why isn't it done yet": a delay is a complaint
    'por que (?:(?:todavia|aun|ya) )?no',
    'por que (?:todavia|aun|ya) ',
    'por que (?:ainda )?nao',
    'pourquoi [^?]*\\bpas\\b',
    'why (?:is|are|do|does|did|have|has|can|was|were)(?:n[\'’ ]?t| not)',
    'why (?:no|not)\\b',
    '(?:todavia|aun|ainda|encore|toujours) (?:no|nao|pas)',
    'ya (?:van|llevo|llevamos|pasaron|han pasado)',
    // my order / my money / my refund
    '(?:mi|mis|my|meu|meus|minha|minhas|mon|ma|mes) (?:\\w+ )?(?:pedido|pedidos|compra|compras|reembolso|reembolsos|devolucion|dinero|plata|pago|cobro|cargo|tarjeta|factura|orden|paquete|encomienda|envio|dinheiro|pagamento|argent|commande|colis|remboursement|paiement|order|refund|money|purchase|package|parcel|payment|card|return|item)\\b',
    '(?:pedido|orden|order|commande|factura|invoice)s? (?:(?:numero|nro|no|n) ?)?#?\\d{2,}',
    // I bought / I was charged
    '(?:compre|compramos|adquiri|pedi|pague|comprei|paguei|encomendei)\\b',
    'me (?:cobr\\w+|factur\\w+|descont\\w+|debit\\w+|cargar\\w+)',
    'cobraram',
    'j[\'’ ]?ai (?:achete|paye|commande|ete debite|ete facture|recu)',
    'je n[\'’ ]?ai pas',
    'i (?:bought|purchased|paid|ordered)',
    '(?:you |they )?charged (?:me|us|twice)|i was charged|double[- ]charged',
    // it never arrived
    'no (?:me |nos |lo |la )?(?:ha |han )?(?:lleg(?:o|ado|aron|aba)|recibi|recibido|entregado|entregaron)',
    'nunca (?:me |nos )?(?:lleg|recib|entreg)',
    'se (?:me )?perdio',
    'pas (?:recu|livre|arrive)',
    'nao (?:recebi|recebemos|chegaram|foi entregue)',
    'never (?:arrived|came|got|received|showed)',
    '(?:has|have|did|was|were)(?:n[\'’ ]?t| not) (?:arrive|arrived|receive|received|get|got|delivered)',
    // it does not work / I did not like it
    'no (?:me )?(?:sirve|sirvio|sirven|gusto|gustaron|convencio)',
    'dejo de (?:funcionar|servir)',
    'se (?:me )?(?:rompio|dano|descompuso)',
    'defeito',
    'defectueu(?:x|se|ses)',
    'veio com',
    'it (?:broke|does not work|doesn[\'’ ]?t work|stopped working)',
    'not working',
    'ne (?:me )?plait pas',
    'nao (?:gostei|serve|funcionou)',
];
const PERSONAL_CASE = new RegExp(`\\b(?:${PERSONAL_CASE_TERMS.join('|')})`);

const ARRIVES = '(?:llego|llega|llegan|llegaron|llegue|viene|vino|chegou|chega|chegue|vem|veio|arrive|arrives|arrived|comes|came|est arrive)';
const DEFECT_WORD = '(?:danad[oa]s?|roto|rota|rotos|rotas|defectuos[oa]s?|mal|danificad[oa]s?|quebrad[oa]s?|endommage\\w*|damaged|broken|defective|faulty|casse\\w*)';
const DEFECT_TAIL = `\\s+(?:\\w+\\s+){0,2}?${DEFECT_WORD}\\b`;
/** "si el producto llegó roto": a conditional about the arrival, not a report. */
const CONDITIONAL_FREE = new RegExp(
    `\\b(si|what if|if|et si|e se|en caso de que|se (?:o|a|os|as|um|uma))\\s+(?:\\w+\\s+){0,4}?${ARRIVES}${DEFECT_TAIL}`, 'g',
);
/** Portuguese "caso o produto chegue quebrado"; the Spanish noun ("el caso es que…") never fits. */
const CONDITIONAL_CASO = new RegExp(`\\bcaso\\s+(?:(?:o|a|os|as|meu|minha)\\s+)?(?:\\w+\\s+)?${ARRIVES}${DEFECT_TAIL}`);
const ARRIVED_DEFECTIVE = new RegExp(`\\b${ARRIVES}${DEFECT_TAIL}`);
/** A first-person marker that turns a conditional into a story ("si me llegó roto"). */
const FIRST_PERSON = /\b(?:me|nos|mi|mis|nuestr[oa]s?|my|our|meu|meus|minha|minhas|mon|ma|mes|notre|j['’ ]?ai)\b/;

/**
 * The text the conditional is judged on. `normalizeForIntent` is not enough here:
 * it folds the affirmative «sí» into the conditional «si» and turns commas into
 * spaces, so "Sí, llegó roto, ¿qué hago?" read as "si llegó roto". This keeps
 * what tells them apart: an accented «sí» becomes a word of its own and the
 * commas and periods stay ("si, llegó roto" is a yes, not a condition).
 */
function conditionalText(raw: unknown): string {
    return String(raw ?? '').toLowerCase()
        .replace(/(?<![a-záéíóúüñ])sí(?![a-záéíóúüñ])/g, 'yes_')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[¿¡]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

/** Index of a real conditional ("si el producto llegó roto") in `ctext`, or -1. */
function conditionalIndex(ctext: string): number {
    for (const m of ctext.matchAll(CONDITIONAL_FREE)) {
        if (m[1] !== 'si') return m.index ?? -1;
        // An unaccented «si» that is really "yes": at the start of the message
        // straight before the verb ("si llegó roto"), or after a filler
        // ("hola si llegó roto", "pues si llegó roto").
        const before = ctext.slice(0, m.index).replace(/^[\s,;:.!?]+/, '');
        const directlyBeforeVerb = new RegExp(`^si\\s+${ARRIVES}`).test(m[0]);
        if (before === '' && directlyBeforeVerb) continue;
        if (/(?:^|\s)(?:pues|hola|que|bueno|ah|oh|buenas)[\s,;:.!]*$/.test(before)) continue;
        return m.index ?? -1;
    }
    const caso = CONDITIONAL_CASO.exec(ctext);
    return caso ? caso.index : -1;
}

/**
 * "¿Qué hago si el producto llegó roto?": asking what would happen. Answered,
 * not escalated; "me llegó roto" / "llegó roto el audífono que compré" /
 * "Sí, llegó roto, ¿qué hago?" are reports and still escalate.
 */
export function isHypotheticalDefectQuestion(raw: unknown): boolean {
    const text = normalizeForIntent(raw);
    if (!text || !isInformationSeekingMessage(raw)) return false;
    if (FIRST_PERSON.test(text) || PERSONAL_CASE.test(text)) return false;
    const ctext = conditionalText(raw);
    const at = conditionalIndex(ctext);
    if (at < 0) return false;
    // "llegó dañado, ¿qué pasa si llegó roto?": a defect already stated before the
    // conditional is a report, and the conditional does not cancel it.
    return !ARRIVED_DEFECTIVE.test(ctext.slice(0, at));
}

/** True when `keyword` only reports a defect on arrival (see {@link DEFECT_ON_ARRIVAL_KEYWORDS}). */
export function isDefectOnArrivalKeyword(keyword: string): boolean {
    return DEFECT_ON_ARRIVAL_SET.has(keyword);
}

export function isPolicyQuestion(raw: unknown): boolean {
    const text = normalizeForIntent(raw);
    if (!text) return false;
    if (!isInformationSeekingMessage(raw)) return false;
    if (GRIEVANCE_OTHER.test(text) || PERSONAL_REQUEST.test(text) || PERSONAL_CASE.test(text)) return false;
    if (GRIEVANCE_DEFECT.test(text) && !isHypotheticalDefectQuestion(raw)) return false;
    return POLICY_FRAME_BASE.test(text) || POLICY_FRAME_HOW_RE.test(text);
}

/**
 * A refund / return policy question the agent answers. The reply also offers a
 * person, so a customer who really wants the refund reaches one in a single "sí"
 * (the existing human-offer acceptance), instead of being escalated unasked.
 */
export function isRefundReturnPolicyQuestion(raw: unknown): boolean {
    return isPolicyQuestion(raw) && REFUND_RETURN_TOPIC.test(normalizeForIntent(raw));
}
