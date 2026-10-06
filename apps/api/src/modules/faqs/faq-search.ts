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

/** Drops what a customer pastes next to the real question and no FAQ ever contains.
 * Only three things go: a label prefix `XXX_YYY:` together with everything before it
 * ("Prueba QA QA_C2026_T01_1: ¿...?"), any token that carries an underscore, and numbers
 * of 6 or more digits. Tokens mixing letters and digits (24h, 4x4, COVID19, mp3...) and
 * short numbers ("plan 2025") are real vocabulary and stay. */
export function stripFaqQueryNoise(query: string): string {
    const label = /[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+\s*:/u.exec(query);
    const body = label ? query.slice(label.index + label[0].length) : query;
    return body
        .replace(/[\p{L}\p{N}_-]+/gu, token => token.includes('_') || /^\p{N}{6,}$/u.test(token) ? '' : token)
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([,.;:?!])/g, '$1')
        .replace(/^[\s:,;.-]+/, '')
        .trim();
}

export function faqSearchTerms(query: string): string[] {
    return [...new Set(tokens(query).filter(term => term.length > 1 && !FUNCTION_WORDS.has(term)))].slice(0, 32);
}

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
