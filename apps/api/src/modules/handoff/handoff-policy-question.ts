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
/**
 * "No funciona" is a defect, not a strong grievance: said hypothetically ("¿aceptan
 * devoluciones si no funciona?") it is a policy question. Without a refund / return /
 * discount word it still escalates as always; with one, the classifier reads it.
 */
export const SOFT_DEFECT_KEYWORDS: ReadonlySet<string> = new Set(['no funciona', 'nao funciona', 'ne fonctionne pas']);

export const DEFECT_ON_ARRIVAL_KEYWORDS: readonly string[] = [
    'llego danado', 'llego roto', 'chegou danificado', 'chegou quebrado', 'est arrive endommage',
];
const DEFECT_ON_ARRIVAL_SET: ReadonlySet<string> = new Set(DEFECT_ON_ARRIVAL_KEYWORDS);

const POLICY_FRAME_BASE = /\b(?:politicas?|politique|policy|policies|aceptan|aceptais|acepta|hacen|ofrecen|ofrece|manejan|tienen|tiene|hay|existe|existen|plazo|condiciones|condicoes|como funciona|cuanto tiempo|cuantos dias|do you (?:have|offer|accept|do|give)|are there|is there|what is|what['’ ]?s|what are|how (?:long|does)|ha(?:ve|s) you|avez[ -]vous|offrez[ -]vous|acceptez[ -]vous|faites[ -]vous|y a[ -]t[ -]il|quelle est|quelles sont|votre politique|aceitam|fazem|oferecem|tem|qual e|quais sao|a politica|proceso|procedimiento|requisitos|como es|como funcionan|que necesito|informacion (?:sobre|de))\b/;

/**
 * "How do I / can I / is it possible / how long does it take" asks about the
 * way something works. Weak on their own, so everything above (personal case,
 * grievance, request for oneself) is checked first: "¿puedo pedir un reembolso?
 * me cobraron dos veces" still goes to a person.
 *
 * These frames neutralise ONLY the refund / return words. "¿Se puede hacer un
 * descuento?" asks to negotiate a price and stays with a person; a discount
 * word is neutralised only by the plain policy frames ("¿tienen descuentos?").
 */
const POLICY_FRAME_HOW = [
    // es
    'cuanto (?:tiempo )?(?:tarda|tardan|demora|demoran|se tarda|se demora|toma|lleva)',
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
    'how (?:do|can|should) i (?:request|ask|get|return|claim|apply|make)',
    'can i (?:get|ask|request|return|have|apply)',
    'is it possible',
    'how much time',
].join('|');
const POLICY_FRAME_HOW_RE = new RegExp(`\\b(?:${POLICY_FRAME_HOW})\\b`);

/** The refund words, in the languages the keyword list and the seeded triggers use. */
const REFUND_KEYWORDS: ReadonlySet<string> = new Set([
    'devolucion', 'devoluciones', 'reembolso', 'reembolsos', 'remboursement', 'remboursements',
    'refund', 'refunds', 'return', 'returns',
]);

/**
 * English "return" is also a shuttle, a flight and a library book, so on its own
 * (or with a weak "what is") it is not a refund question. It counts only as the
 * policy or the act of returning goods.
 */
const ENGLISH_RETURN_TOPIC = /\b(?:returns? policy|(?:accept|accepts|allow|offer|take) returns|return (?:an? |the |my )?(?:item|product|order)s?|make a return)\b/;

/** The refund / return topic (not discounts): where the agent may also offer a person. */
const REFUND_RETURN_TOPIC = new RegExp(
    '\\b(?:devolucion(?:es)?|devolucao|devolucoes|reembolsos?|remboursements?|refunds?)\\b|' + ENGLISH_RETURN_TOPIC.source,
);

/** A damaged / broken product: a grievance, unless asked about hypothetically. */
const GRIEVANCE_DEFECT = /\b(?:danad[oa]s?|roto|rota|rotos|rotas|defectuos[oa]s?|llego (?:mal|roto|danado|tarde)|damaged|broken|defective|faulty|casse|endommage|quebrado|chegou)\b/;

const GRIEVANCE_OTHER = /\b(?:no funciona|estafa|fraude|engano|enganaram|golpe|inaceptable|inacceptable|pesimo|pessimo|horrible|terrible|furios[oa]|molest[oa]|queja|reclamo|reclamacao|plainte|demanda|abogado|advogado|avocat|scam|fraud|unacceptable|awful|lawyer|arnaque|ne fonctionne pas|nao funciona)\b/;

const PERSONAL_REQUEST = /\b(?:me (?:lo |la |los |las )?(?:hace|hacen|haces|da|dan|das|deja|dejan|dejas|rebaja|rebajan|rebajas|regala|regalan|puede|pueden|podria|podrian|puedes|podrias|puedan|hagan|den|dejen|tienen|tiene|dar|fazer|faire|faz|fazem|dao)|(?:puede|pueden|podria|podrian|puedes|podrias) (?:hacerme|darme|rebajarme|dejarmelo|devolverme)|(?:can|could|will|would) you (?:give|do|make|offer|refund)(?: it)? (?:me|us)|pouvez[ -]vous me|vous me (?:faites|donnez)|(?:podem|pode|voce pode) (?:me )?(?:dar|fazer)|pra mim|para mim|pour moi|for me|exijo|exigimos|i demand|je veux (?:etre )?rembours\w*|quiero que me|quiero mi dinero|(?:quiero|quisiera|necesito|queremos|necesitamos) (?:(?:pedir|hacer|solicitar|tramitar|realizar) )?(?:(?:un|una|el|la|mi|algun|alguna) )?(?:reembolso|devolucion|devolver|remboursement|descuento|rebaja)|i want (?:a refund|my money|to return))\b/;

/**
 * The customer is talking about THEIR case, not about the policy. One clause is
 * enough; the sentence may still be shaped like a question. Matched against
 * `normalizeForIntent` output (lower case, accents removed).
 */
/** "No me gustó / no sirve": a soft signal. As a fact it is a personal case; inside "si…" it is a condition. */
const SOFT_DISLIKE_TERM = 'no (?:me )?(?:sirve|sirvio|sirven|gusto|gustaron|convencio)';
/** A bare defect adjective may only name a kind of product ("com defeito", "produits défectueux"): the model decides. */
const SOFT_DEFECT_ADJECTIVE_TERMS = ['defeito', 'defectueu(?:x|se|ses)'];

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
    SOFT_DISLIKE_TERM,
    'dejo de (?:funcionar|servir)',
    'se (?:me )?(?:rompio|dano|descompuso)',
    'defeito',
    'defectueu(?:x|se|ses)',
    'veio com',
    'it (?:broke|does not work|doesn[\'’ ]?t work|stopped working)',
    'not working',
    'ne (?:me )?plait pas',
    'nao (?:gostei|serve|funcionou)',
    // what the customer already did or received
    '(?:devolvi(?:mos)?|ya hice la devolucion|la compra que hice|recibi(?:mos)?|me arrepenti|no me queda (?:bien|chic[oa]|grande|pequen[oa]|apretad[oa])|me quedo (?:chic[oa]|grande|pequen[oa]))\\b',
    'me (?:enviaron|llego|mandaron|entregaron|vendieron)',
];
const PERSONAL_CASE = new RegExp(`\\b(?:${PERSONAL_CASE_TERMS.join('|')})`);

const ARRIVES = '(?:llego|llega|llegan|llegaron|llegue|viene|vino|chegou|chega|chegue|vem|veio|arrive|arrives|arrived|comes|came|est arrive)';
const DEFECT_WORD = '(?:danad[oa]s?|roto|rota|rotos|rotas|defectuos[oa]s?|mal|danificad[oa]s?|quebrad[oa]s?|defeituos[oa]s?|defeito|defectueu\\w*|endommage\\w*|damaged|broken|defective|faulty|casse\\w*)';
/** The same adjectives without the arrival-only "mal" (llegó mal), for "está roto". */
const DEFECT_ADJECTIVE = '(?:danad[oa]s?|roto|rota|rotos|rotas|defectuos[oa]s?|danificad[oa]s?|quebrad[oa]s?|defeituos[oa]s?|defectueu\\w*|endommage\\w*|damaged|broken|defective|faulty|casse\\w*)';
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
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[¿¡]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

/** Index of a real conditional ("si el producto llegó roto") in `ctext`, or -1. */
const QUESTION_WORD = /(?:^|\s)(?:que|como|cual|cuales|cuando|donde|y|e|what|how|which|when|comment|quand|pourquoi|qual|quando|onde|por que|porque)(?:\s|$)/;

function conditionalIndex(ctext: string): number {
    for (const m of ctext.matchAll(CONDITIONAL_FREE)) {
        if (m[1] !== 'si') return m.index ?? -1;
        // An unaccented «si» that is really "yes": at the start of the message
        // straight before the verb ("si llegó roto"), or after a filler
        // ("hola si llegó roto", "pues si llegó roto").
        const before = ctext.slice(0, m.index).replace(/^[\s,;:.!?]+/, '');
        const directlyBeforeVerb = new RegExp(`^si\\s+${ARRIVES}`).test(m[0]);
        if (before === '' && directlyBeforeVerb) continue;
        // After a plain subject with no question word before it, «si» is emphatic
        // ("el pedido si llegó roto", "oiga si llegó roto"); after one it is a condition
        // ("¿qué pasa si llegó roto?", "¿y si llegó roto?").
        if (before !== '' && directlyBeforeVerb && !QUESTION_WORD.test(before)) continue;
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

/**
 * What a question about a policy may cancel:
 *  - `all`: the plain policy frames ("¿cuál es la política…?", "¿tienen descuentos?"),
 *    so every policy-topic word is answered;
 *  - `refund_return`: only a how-do-I / can-I frame ("¿puedo pedir…?", "¿se puede…?"),
 *    so refund and return words are answered and a discount word still escalates.
 */
export type PolicyScope = 'all' | 'refund_return';

/**
 * «para mí» asks for oneself only when it ends the clause ("¿hacen descuento para mí?").
 * "para mi papá" or "para mi negocio" is about someone or something else.
 */
const FOR_ME_AT_CLAUSE_END = /\bpara m[ií]\s*(?:[?.!,;:]|$)/i;

/**
 * WhatsApp style: a policy question without a question mark ("aceptan devoluciones",
 * "politica de devoluciones", "hay descuento por pago en efectivo") when it opens with
 * a policy frame. A statement that merely contains a frame word is not one.
 */
const POLICY_QUESTION_OPENING = /^(?:(?:hola|buenas?(?: dias| tardes| noches)?|buen dia)[ ]+)?(?:politicas? de|politica|aceptan|aceptais|hacen|tienen|manejan|ofrecen|hay|existe|informacion (?:sobre|de)|puedo (?:pedir|solicitar)|cuanto (?:tiempo )?(?:tarda|demora)|do you (?:have|offer|accept))\b/;

/** "quería saber cuál es la política…": a question without a question mark, anywhere in the message. */
const ASKING_TO_KNOW = /\b(?:queria|quiero|quisiera|me gustaria|necesito) (?:saber|conocer|preguntar|consultar)\b/;

export function policyQuestionScope(raw: unknown): PolicyScope | null {
    const text = normalizeForIntent(raw);
    if (!text) return null;
    if (FOR_ME_AT_CLAUSE_END.test(String(raw ?? ''))) return null;
    if (!isInformationSeekingMessage(raw) && !POLICY_QUESTION_OPENING.test(text) && !ASKING_TO_KNOW.test(text)) return null;
    if (GRIEVANCE_OTHER.test(text) || PERSONAL_REQUEST.test(text) || PERSONAL_CASE.test(text)) return null;
    if (GRIEVANCE_DEFECT.test(text) && !isHypotheticalDefectQuestion(raw)) return null;
    if (POLICY_FRAME_BASE.test(text)) return 'all';
    return POLICY_FRAME_HOW_RE.test(text) ? 'refund_return' : null;
}

export function isPolicyQuestion(raw: unknown): boolean {
    return policyQuestionScope(raw) !== null;
}

/** True when the policy-topic word `word` is answered (not escalated) under `scope`. */
export function isAnswerableTopicWord(scope: PolicyScope | null, word: string): boolean {
    if (!scope || !POLICY_TOPIC_KEYWORDS.has(word)) return false;
    return scope === 'all' || REFUND_KEYWORDS.has(word);
}

/**
 * A custom trigger that is only a policy-topic word. The bare English "return" /
 * "returns" is further limited to the refund / return topic itself, so a tenant's
 * "return" trigger still fires on "what is the return time for the shuttle?".
 */
export function isAnswerableCustomTrigger(scope: PolicyScope | null, needle: string, raw: unknown): boolean {
    return isAnswerableTopicWord(scope, needle) && isPolicyTopicTrigger(needle, raw);
}

/**
 * Whether a tenant trigger is ONLY a policy-topic word in this message (so it is the
 * classifier's to judge, not a rule that always fires). The bare English "return" /
 * "returns" counts only as the refund / return topic itself.
 */
export function isPolicyTopicTrigger(needle: string, raw: unknown): boolean {
    if (!POLICY_TOPIC_KEYWORDS.has(needle)) return false;
    if (needle === 'return' || needle === 'returns') return ENGLISH_RETURN_TOPIC.test(normalizeForIntent(raw));
    return true;
}

/**
 * An action-oriented refund / return question ("¿puedo pedir un reembolso?",
 * "¿cómo solicito una devolución?", "¿cuánto tarda un reembolso?") that the agent
 * answers. Its reply also offers a person, so a customer who really wants the
 * refund reaches one with a single "sí" instead of being escalated unasked. A
 * plain "¿cuál es la política de devoluciones?" gets the policy only, and so does
 * "¿se puede pagar con tarjeta? ¿y hay devoluciones?": the frame and the topic
 * must sit in the same sentence.
 */
export function isActionOrientedRefundQuestion(raw: unknown): boolean {
    if (!policyQuestionScope(raw)) return false;
    return normalizeForIntent(raw).split(/[?!.]+/)
        .some(sentence => POLICY_FRAME_HOW_RE.test(sentence) && REFUND_RETURN_TOPIC.test(sentence));
}

// ---------------------------------------------------------------------------
// High-precision signals the model can never clear
//
// The classifier reads the soft cases (a bare topic word, a hypothetical, a
// plan). What a customer says about THEIR OWN case is not a judgement call:
// "me cobraron dos veces", "QUIERO MI REEMBOLSO", "llegó roto", "¿me hace un
// descuento?". Those escalate whatever the model answers, on the full text.
// Everything here was measured on the evaluation fixture: zero hits on a
// message that should be answered.
// ---------------------------------------------------------------------------

/** Everything in the personal-case list except the soft "no me gustó / no sirve". */
const PERSONAL_CASE_HARD = new RegExp(`\\b(?:${PERSONAL_CASE_TERMS.filter((t) => t !== SOFT_DISLIKE_TERM && !SOFT_DEFECT_ADJECTIVE_TERMS.includes(t)).join('|')})`);

const SOFT_DEFECT_RE = /\b(?:no funciona|nao funciona|ne fonctionne pas)\b/g;
const DISLIKE_RE = new RegExp(`\\b${SOFT_DISLIKE_TERM}\\b`, 'g');
/**
 * A defect counts as REPORTED only in a report shape: an arrival verb and the defect
 * ("llegó roto", "chegou quebrado"), "está / quedó / salió roto", or the customer's own
 * thing ("mi audífono dañado"). A bare adjective ("productos defectuosos", "damaged
 * items", "com defeito") and a bare "chegou" ("¿ya llegó el descuento?") name a kind of
 * product or something else: the model decides those.
 */
/** Past arrival only: a present "llega roto" is how a policy is written ("si llega roto"), not a report. */
const ARRIVED_PAST = '(?:llego|llegaron|vino|vinieron|chegou|chegaram|veio|vieram|arrived|came|est arrive|sont arrives)';
const DEFECT_REPORT_SHAPES = [
    new RegExp(`\\b${ARRIVED_PAST}${DEFECT_TAIL}`, 'g'),
    /\b(?:llego|llegaron|chegou|chegaram|arrived)\s+(?:muy\s+|muito\s+|very\s+)?(?:tarde|atrasad[oa]s?|late)\b/g,
    new RegExp(`\\b(?<!que\\s)(?:esta|estan|estaba|estaban|quedo|quedaron|salio|salieron)\\s+(?:\\w+\\s+){0,1}?${DEFECT_ADJECTIVE}\\b`, 'g'),
    new RegExp(`\\b(?:mi|mis|my|meu|meus|minha|minhas|mon|ma|mes)\\s+(?:\\w+\\s+){1,2}?${DEFECT_ADJECTIVE}\\b`, 'g'),
];

/** A conditional marker inside the clause: "si no funciona", "if it breaks", "se chegou quebrado". */
const CONDITIONAL_MARK = /(?:^|\s)(?:si|if|se (?:o|a|os|as|um|uma|meu|minha|eu|ele|ela|chegou)|caso|quand|quando|cuando|when|whenever|in case|por si|et si|e se|what if|should|cada vez que|siempre que)(?:\s|$)/;

function clauseBefore(ctext: string, index: number): string {
    const head = ctext.slice(0, index);
    const cut = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf('.'),
        head.lastIndexOf('?'), head.lastIndexOf('!'), head.lastIndexOf(':'));
    return head.slice(cut + 1);
}

/** True when the pattern occurs at least once OUTSIDE a conditional clause: reported as fact. */
function reportedAsFact(raw: unknown, re: RegExp): boolean {
    const ctext = conditionalText(raw);
    for (const m of ctext.matchAll(re)) {
        if (!CONDITIONAL_MARK.test(clauseBefore(ctext, m.index ?? 0))) return true;
    }
    return false;
}

/** "no funciona" said as a fact ("La app no funciona"), not as a condition ("si no funciona"). */
export function softDefectAsFact(raw: unknown): boolean {
    return reportedAsFact(raw, SOFT_DEFECT_RE);
}

/**
 * A request for something for oneself. Narrower than `PERSONAL_REQUEST` (the rules
 * fallback): "quiero/necesito pedir…" must take a refund/discount noun, "quiero devolver"
 * must take an object that is not a call or a key, and a bare "me puede(n)" does not count.
 */
const PERSONAL_REQUEST_HIGH = /\b(?:me (?:lo |la |los |las )?(?:hace|hacen|haces|deja|dejan|dejas|rebaja|rebajan|rebajas|regala|regalan|puedan|hagan|den|dejen|tienen|tiene|dar|fazer|faire|faz|fazem|dao)|me (?:lo |la )?(?:da|dan|das) (?:un|una|algun|alguna|mi|el|la)|me (?:puede|pueden|puedes|podria|podrian|podrias) (?:hacer|dar|rebajar|dejar|regalar)|(?:puede|pueden|podria|podrian|puedes|podrias) (?:hacerme|darme|rebajarme|dejarmelo|devolverme)|(?:can|could|will|would) you (?:give|do|make|offer|refund)(?: it)? (?:me|us)|pouvez[ -]vous me|vous me (?:faites|donnez)|(?:podem|pode|voce pode) (?:me )?(?:dar|fazer)|pra mim|para mim|pour moi|for me|exijo|exigimos|i demand|je veux (?:etre )?rembours\w*|quiero que me|quiero mi dinero|(?:quiero|quisiera|necesito|queremos|necesitamos|quero|preciso) (?:(?:pedir|hacer|solicitar|tramitar|realizar) )?(?:(?:un|una|el|la|mi|algun|alguna|um|uma|meu) )?(?:reembolso|devolucion|descuento|rebaja|desconto|remboursement)|(?:quiero|quisiera|necesito|queremos|necesitamos|quero|preciso) devolver (?:el|la|los|las|mi|mis|un|una|o|a) (?!llamad|llave|ligacao|chave|carro|auto\b|coche|vehicul|moto\b|bicicleta|habitacion|apartament|cabana|casa\b|mesa\b|cancha|sala\b|salon)\w+|i want (?:a refund|my money|to return))\b/;

/** A favour asked about a price: diminutives, "hay posibilidad de descuento", "se puede un descuento". */
const NEGOTIATION_SIGNAL = new RegExp(
    '\\b(?:descuent(?:ito|ico|azo)|rebajit[ao]|desconto(?:zinho|zito)|(?:posibilidad|chance|possibilidade|possibilite|possibility) (?:de|d|of) (?:un |uma? )?(?:descuento|desconto|rebaja|remise|discount)|'
    + '(?:se puede|es posible|puedo (?:pedir|solicitar|obtener)|como (?:pido|solicito|consigo)|e possivel|posso (?:pedir|solicitar)|est[ -]il possible|puis[ -]je (?:demander|obtenir)|is it possible|can i (?:get|ask for|have)|hay (?:alguna )?(?:posibilidad|chance))\\b'
    // only an indefinite noun phrase, or nothing, may stand between the frame and the discount:
    // "se puede hacer un descuento" asks for one; "can I get THE student discount" names an existing one
    + '(?:\\s+(?:hacer|hacerme|dar|darme|conseguir|obtener|pedir|solicitar|tener|to|get|have|ask|for|make|give|fazer|ter|faire|avoir|obtenir|demander|de|un|una|algun|alguna|algunos|a|an|any|some|um|uma|algum|alguma|des|reembolso|devolucion|refund|remboursement|y|o|e|ou|and|or|et))*'
    + '\\s+(?:descuent\\w*|rebaj\\w*|descont\\w*|remise\\w*|discount\\w*)'
    + '|(?:cuanto|cuanta|que) (?:descuent\\w*|rebaj\\w*|descont\\w*) me (?:da|dan|das)|quanto (?:de )?desconto me dao)',
);
const REFUND_NOW = /\b(?:devolucion|devolucao|reembolso|remboursement)s? (?:ya|ahora|hoy|ja|agora|maintenant|now|urgente)\b|\b(?:que|para que) me (?:devuelv\w+|reembols\w+|devolv\w+|rembours\w+)\b/;

export type OverrideLabel = 'personal_case' | 'negotiation';

/**
 * The label a message gets from the rules that never need the model, or null.
 * `discountOnly` (the message's only built-in topic is a discount) turns a request
 * for oneself into a negotiation; any other topic is a personal refund / return case.
 */
export function policyOverrideLabel(raw: unknown, topics: { refund: boolean; discount: boolean }): OverrideLabel | null {
    const text = normalizeForIntent(raw);
    if (!text) return null;
    const forOneself: OverrideLabel = topics.discount && !topics.refund ? 'negotiation' : 'personal_case';
    if (NEGOTIATION_SIGNAL.test(text)) return 'negotiation';
    if (FOR_ME_AT_CLAUSE_END.test(String(raw ?? '')) || PERSONAL_REQUEST_HIGH.test(text)) return forOneself;
    if (PERSONAL_CASE_HARD.test(text) || REFUND_NOW.test(text)) return 'personal_case';
    if (DEFECT_REPORT_SHAPES.some((shape) => reportedAsFact(raw, shape))
        || reportedAsFact(raw, SOFT_DEFECT_RE) || reportedAsFact(raw, DISLIKE_RE)) return 'personal_case';
    return null;
}

// ---------------------------------------------------------------------------
// A product complaint is answered, and a person is OFFERED
//
// Production 2026-10-10 (Tienda QA Electrónica): «quiero pedir perdón, el Audífono QA Aurora llegó roto» was transferred at once and
// the customer got «Le estoy transfiriendo…», then silence, and the warranty was answered ten minutes later. A report of a defective
// product is something the business can answer from its own warranty / returns policy; the customer did not ask for a person (#80: no
// unrequested handoffs). The reply states what is known and ends by OFFERING one; only the customer's «sí» opens the handoff.
// What stays automatic: a request for a person (its own reason), a refund / return / discount for oneself, a grievance (a scam, a
// lawyer, a formal complaint, insults), anything that puts someone at risk, and a trigger the owner wrote that this message hits.
// ---------------------------------------------------------------------------

/** A defect, said about a product: broken, damaged, defective, «no funciona». */
const PRODUCT_DEFECT = /\b(?:roto|rota|rotos|rotas|danad[oa]s?|defectuos[oa]s?|quebrad[oa]s?|danificad[oa]s?|defeituos[oa]s?|defectueu(?:x|se|ses)|endommage\w*|casse\w*|broken|damaged|defective|faulty|no funciona|nao funciona|ne fonctionne pas|dejo de funcionar|se (?:me )?(?:rompio|dano|descompuso)|stopped working|does not work|doesn[' ]?t work)\b/;

/** Anger, a scam, a legal threat or a formal complaint: a person hears it at once. «no funciona» is a defect, not one of these. */
const STRONG_GRIEVANCE = /\b(?:estafa\w*|fraude|engano|enganaram|golpe|inaceptable|inacceptable|pesimo|pessimo|horrible|terrible|furios[oa]|molest[oa]|queja\w*|reclamo|reclamacao|plainte|demanda\w*|abogado|advogado|avocat|scam|fraud|unacceptable|awful|lawyer|arnaque|indignad[oa]|vergonza|verguenza|robo|robaron)\b/;

/** Something that can hurt someone: smoke, fire, a shock, a burn, an injury, poison, an emergency. */
const SAFETY_RISK = /\b(?:incendio|humo|quemo|quemado|quemadura\w*|quema|chispa\w*|explot\w*|explosion|descarga\w*|electrocut\w*|corto ?circuito|lesion\w*|herid\w*|sangr\w*|intoxic\w*|veneno\w*|peligro\w*|peligros\w*|emergencia|ambulancia|alergi\w*|fire|smoke|burn\w*|spark\w*|explod\w*|shock|electric shock|injur\w*|hurt|poison\w*|danger\w*|emergency|incendie|fumee|brul\w*|blesse\w*|queimou|fuma\w*|ferid\w*|perigo\w*)\b/;

/** Refund, return, exchange or discount words: what the customer wants done about it is a person's to handle. */
const MONEY_BACK = /\b(?:reembols\w*|devol\w*|refund\w*|return\w*|remboursement\w*|rembours\w*|descuent\w*|rebaj\w*|desconto\w*|compens\w*|indemniz\w*|cambio|cambiar|cambiarlo|exchange|troca\w*|echange\w*)\b/;

/** «llegó roto», «no funciona», «dañado»: the customer reports a product defect, and nothing in the message asks for more than an answer. */
export function isProductDefectReport(raw: unknown): boolean {
    const text = normalizeForIntent(raw);
    if (!text || !PRODUCT_DEFECT.test(text)) return false;
    if (isHypotheticalDefectQuestion(raw)) return false;
    if (STRONG_GRIEVANCE.test(text) || SAFETY_RISK.test(text) || MONEY_BACK.test(text)) return false;
    return !PERSONAL_REQUEST.test(text) && !PERSONAL_REQUEST_HIGH.test(text);
}

/**
 * Whether the reason a turn would escalate for («complaint») is only a product defect report that the agent answers, offering a person
 * instead of opening the handoff. `triggers` are the owner's own handoff triggers: one that this message hits is the owner's rule and
 * escalates as always.
 */
export function complaintIsOfferOnly(reason: string | null | undefined, raw: unknown, triggers: readonly string[] = []): boolean {
    if (reason !== 'complaint' || !isProductDefectReport(raw)) return false;
    const text = normalizeForIntent(raw);
    return !triggers.some(trigger => {
        const needle = normalizeForIntent(trigger);
        return !!needle && !POLICY_TOPIC_KEYWORDS.has(needle) && text.includes(needle);
    });
}
