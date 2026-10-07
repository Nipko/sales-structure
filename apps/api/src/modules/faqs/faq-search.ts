import type { FAQ } from '@parallext/shared';

// Common function words in the four supported languages carry little topic
// information. Keep business nouns, numbers and verbs; no generated synonyms.
const FUNCTION_WORDS = new Set((
    'a al algo ante con cual cuales cuando cuanto cuantos de del el ella ellas ellos en es esa ese eso esta estas este estos hay la las lo los me mi mis nos o para por que se si sin su sus te ti tu tus un una unas uno unos y ' +
    'an and are as at be can could do does for from how i in is it its me my of on or our that the their these this to was we what when where which who with would you your ' +
    'ao aos as com como da das de do dos e ela ele eles em essa esse ha isso meu minha na nas no nos o os ou para pela pelo por qual quais quanto que sao se sem sua suas tem um uma voce voces ' +
    'au aux avec ce ces cet cette dans de des du elle elles en est et eux il ils je la le les leur ma mes moi mon ne nos nous ou par pas pour quel quelle quels quelles qui quoi sa sans ses son sur ta tes toi ton tu un une vos votre vous'
).split(/\s+/));

const fold = (value: string) => value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
const tokens = (value: string) => fold(value).match(/[\p{L}\p{N}]+/gu) || [];
// An answer may express duration as "20 minutes" without repeating "how long".
// Only these specific follow-up words may be absent. A missing topic/name
// anywhere in the query (including a later question) must still reject it.
// "duracion" is the noun of "dura": the words that MEAN duration compare as one concept.
// "tiempo"/"time" do not: "what time" asks for a schedule and "cuanto tiempo antes" for a
// lead time. They are only filler ("cuanto tiempo dura") when the same question already
// holds a duration word, so they are dropped from the query in that case and stay ordinary
// words otherwise. "last"/"lasts" mean both "the final one" and "continues for", so they never
// take part in the comparison.
const DURATION_WORDS = new Set(['dura', 'duran', 'durar', 'duracion', 'long', 'duration', 'duracao', 'duree']);
const DURATION_FILLER = new Set(['tiempo', 'time', 'tempo', 'temps']);
const AMBIGUOUS_WORDS = new Set(['last', 'lasts']);
const DURATION = 'duration';
// Comparison form of a term: duration words collapse into one concept and a plural
// "s" is dropped ("visitas" = "visita"). Only for ranking; the SQL candidates keep raw terms.
const canon = (term: string): string => DURATION_WORDS.has(term) ? DURATION
    : term.length > 4 && term.endsWith('s') ? term.slice(0, -1) : term;
const canonTokens = (value: string): Set<string> => new Set(tokens(value).filter(t => !AMBIGUOUS_WORDS.has(t)).map(canon));
const canonTerms = (value: string): string[] => {
    const raw = faqSearchTerms(value).filter(t => !AMBIGUOUS_WORDS.has(t));
    const hasDuration = raw.some(t => DURATION_WORDS.has(t));
    return [...new Set(raw.filter(t => !(hasDuration && DURATION_FILLER.has(t))).map(canon))];
};

// Words that only introduce a code ("Prueba QA QA_C1_T01:", "Pedido ORD_123:"). Text before a
// label made only of these carries no topic, so it can be dropped with the label.
const GENERIC_MARKERS = ['prueba', 'qa', 'test', 'pedido', 'orden', 'ref', 'referencia', 'ticket', 'caso', 'reserva', 'order', 'booking'];
const GENERIC_SET = new Set(GENERIC_MARKERS);
const TRAILING_MARKERS = new RegExp(`(?:[\\s,.;:-]+(?:${GENERIC_MARKERS.join('|')}))+[\\s,.;:-]*$`, 'iu');

/** Drops what a customer pastes next to the real question and no FAQ ever contains:
 * the token of a label `XXX_YYY:`, any other token that carries an underscore, and numbers
 * of 6 or more digits. The text around a label stays (it may hold the topic: "Tour Faro
 * Rojo, reserva RES_77: ¿Cuánto dura?"); the part BEFORE the label is dropped only when it is
 * empty or made only of generic markers ("Prueba QA QA_C1_T01_1: ¿...?"), and the part AFTER
 * only when it is generic. Tokens mixing letters and digits (24h, 4x4, COVID19, mp3...) and
 * short numbers ("plan 2025") are real vocabulary and stay. */
export function stripFaqQueryNoise(query: string): string {
    const noiseTokens = (text: string) => text
        .replace(/[\p{L}\p{N}_-]+/gu, token => token.includes('_') || /^\p{N}{6,}$/u.test(token) ? '' : token);
    const generic = (text: string) => faqSearchTerms(noiseTokens(text)).every(term => GENERIC_SET.has(term));
    // Labels can be stacked ("Prueba QA QA_C1_1: Ref ABC_2: ¿…?"): each one is handled in turn.
    // "Ref 1234567:" anywhere: generic words, a long number and a colon are a label with no topic in it.
    const numberLabel = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:${GENERIC_MARKERS.join('|')})\\b[\\s,.;-]*)+\\p{N}{6,}\\s*:\\s*`, 'giu');
    let body = query.replace(numberLabel, ' ');
    for (let pass = 0; pass < 4; pass++) {
        const label = /[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+\s*:/u.exec(body);
        if (!label) break;
        const before = body.slice(0, label.index);
        const after = body.slice(label.index + label[0].length);
        if (generic(before)) body = after;
        else if (generic(after)) body = before;
        else body = `${before.replace(TRAILING_MARKERS, '')} ${after}`;
    }
    // "Ref 1234567:" (the number was dropped as noise): a label made only of generic words and a colon.
    const leadingLabel = new RegExp(`^[\\s:,;.-]*(?:(?:${GENERIC_MARKERS.join('|')})\\b[\\s,.;-]*)+:\\s*`, 'iu');
    let cleaned = noiseTokens(body).replace(/[ \t]{2,}/g, ' ');
    for (let pass = 0; pass < 4 && leadingLabel.test(cleaned); pass++) cleaned = cleaned.replace(leadingLabel, '');
    return cleaned
        .replace(/\s+([,.;:?!])/g, '$1')
        .replace(/^[\s:,;.-]+/, '')
        .trim();
}

export function faqSearchTerms(query: string): string[] {
    return [...new Set(tokens(query).filter(term => term.length > 1 && !FUNCTION_WORDS.has(term)))].slice(0, 32);
}

// Where a new question begins: «y qué garantía tiene», «and what warranty», «e qual a garantia», «et quelle garantie».
const QUESTION_STARTERS = 'cu[aá]nt[oa]s?|qu[eé]|c[oó]mo|d[oó]nde|cu[aá]ndo|cu[aá]l(?:es)?|qui[eé]n(?:es)?|what|how|when|where|which|who|why|quant[oa]s?|qual|quais|quem|onde|quando|combien|comment|quel(?:le)?s?|quand|o[uù]|pourquoi';
const COMPOUND_SPLIT = new RegExp(`[?？¿;,]+|\\b(?:y|and|e|et)\\s+(?=(?:${QUESTION_STARTERS})(?![\\p{L}]))`, 'iu');

/**
 * The questions of a message that asks several at once ("¿Cuánto cuesta X, cuántas unidades hay y qué garantía
 * tiene?" is three). Split on question marks, commas, semicolons and an "and" that opens a new question; parts
 * with no searchable word are dropped. A message with one question comes back as one part.
 */
export function splitCompoundQuery(query: string): string[] {
    return String(query || '').split(COMPOUND_SPLIT)
        .map(part => part.replace(/^[\s:.!-]+|[\s:.!-]+$/g, ''))
        .filter(part => faqSearchTerms(part).length > 0)
        .slice(0, 4);
}

// Words that only carry the question ("tiene", "hay", "cuesta", "have", "há"): a part is about what is left.
const QUESTION_FILLER = new Set([
    'tiene', 'tienen', 'tener', 'hay', 'cuesta', 'cuestan', 'vale', 'valen', 'dura', 'duran', 'incluye', 'incluyen', 'ofrece', 'ofrecen',
    'cobran', 'cobra', 'son', 'estan', 'hacen', 'hace', 'have', 'has', 'there', 'cost', 'costs', 'much', 'many', 'tem', 'custa', 'custam',
    'ha', 'coute', 'ont', 'combien', 'quantas', 'quantos', 'cuantas', 'cuantos',
]);

/** The topic words of ONE part of a message: what is left after the function words and the words that only ask. */
export function topicTermsOf(part: string): string[] {
    return faqSearchTerms(part).filter(term => !QUESTION_FILLER.has(term));
}

/**
 * The FAQ a one-word topic ("garantía") points to: its QUESTION holds the word, and among several the one that
 * shares most with the rest of the message ("Audífono QA") wins. Two equally good FAQs are a guess: none.
 */
export function pickTopicFaq(rows: FAQ[], topic: string, message: string): FAQ | null {
    const term = canon(topic);
    const own = rows.filter(row => canonTokens(row.question).has(term));
    if (!own.length) return null;
    const context = new Set(canonTerms(message).filter(t => t !== term && !QUESTION_FILLER.has(t)));
    const scored = own.map(row => {
        const doc = canonTokens(`${row.question} ${row.answer}`);
        return { row, score: [...context].filter(t => doc.has(t)).length };
    }).sort((a, b) => b.score - a.score);
    if (scored.length > 1 && scored[0].score === scored[1].score) return null;
    // A price FAQ that shares nothing else with the message is about something else ("¿qué precio tiene el
    // Audífono?" is not "¿Cuál es el precio de la instalación?"), and its figure would pass the price guardrail as
    // retrieved knowledge. Product prices come from the catalog tools, so a price topic needs real context.
    if (scored[0].score === 0 && PRICE_TOPICS.has(term)) return null;
    return scored[0].row;
}

const PRICE_TOPICS = new Set(['precio', 'costo', 'coste', 'valor', 'tarifa', 'price', 'pricing', 'fee', 'preco', 'custo', 'prix', 'tarif', 'cout']);

/** Conservative fallback for questions with added detail. A single shared
 * word such as "visita" cannot pull unrelated vertical seeds into a reply. */
export function rankPartialFaqMatches(rows: FAQ[], query: string, limit: number): FAQ[] {
    const allTerms = canonTerms(query);
    // The fallback may tolerate an ADDED question, never replace the topic of
    // the first one. Keep its full lexical anchor in the FAQ question itself.
    // This is deliberately stricter than fuzzy matching: "Faro Rojo" must not
    // become "Faro Azul" because their answers share "incluye/dura/visita".
    const firstQuestion = fold(query).split(/[?？;]|\b(?:y|and|e|et)\s+(?=(?:cuanto|cuanta|cuantos|cuantas|que|como|donde|what|how|when|where|quanto|qual|quais|quel|quelle|quels|quelles|combien|comment)\b)/u)[0];
    const anchor = canonTerms(firstQuestion);
    if (anchor.length < 2) return [];
    return rows.map((faq, index) => {
        const question = canonTokens(faq.question);
        const content = new Set([...question, ...canonTokens(faq.answer)]);
        // The duration concept is optional in the ANSWER only: when the FAQ never
        // mentions it, it is neither required nor counted.
        const terms = allTerms.filter(term => term !== DURATION || content.has(DURATION));
        const minimumMatches = Math.max(2, Math.ceil(terms.length * 0.75));
        const matched = terms.filter(term => content.has(term)).length;
        const questionMatches = terms.filter(term => question.has(term)).length;
        const topicPreserved = terms.every(term => content.has(term));
        return { faq, index, matched, minimumMatches, anchored: topicPreserved && anchor.every(term => question.has(term)), score: matched + questionMatches };
    }).filter(row => row.anchored && row.matched >= row.minimumMatches)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit).map(row => row.faq);
}
