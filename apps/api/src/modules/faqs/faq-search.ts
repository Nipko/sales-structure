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
const OPTIONAL_DURATION_WORDS = new Set(['dura', 'duracion', 'long', 'duration', 'duracao', 'duree']);

export function faqSearchTerms(query: string): string[] {
    return [...new Set(tokens(query).filter(term => term.length > 1 && !FUNCTION_WORDS.has(term)))].slice(0, 32);
}

/** Conservative fallback for questions with added detail. A single shared
 * word such as "visita" cannot pull unrelated vertical seeds into a reply. */
export function rankPartialFaqMatches(rows: FAQ[], query: string, limit: number): FAQ[] {
    const terms = faqSearchTerms(query);
    const minimumMatches = Math.max(2, Math.ceil(terms.length * 0.75));
    // The fallback may tolerate an ADDED question, never replace the topic of
    // the first one. Keep its full lexical anchor in the FAQ question itself.
    // This is deliberately stricter than fuzzy matching: "Faro Rojo" must not
    // become "Faro Azul" because their answers share "incluye/dura/visita".
    const firstQuestion = fold(query).split(/[?？;]|\b(?:y|and|e|et)\s+(?=(?:cuanto|cuanta|cuantos|cuantas|que|como|donde|what|how|when|where|quanto|qual|quais|quel|quelle|quels|quelles|combien|comment)\b)/u)[0];
    const anchor = faqSearchTerms(firstQuestion);
    if (anchor.length < 2) return [];
    return rows.map((faq, index) => {
        const question = new Set(tokens(faq.question));
        const content = new Set([...question, ...tokens(faq.answer)]);
        const matched = terms.filter(term => content.has(term)).length;
        const questionMatches = terms.filter(term => question.has(term)).length;
        const topicPreserved = terms.every(term => content.has(term) || OPTIONAL_DURATION_WORDS.has(term));
        return { faq, index, matched, anchored: topicPreserved && anchor.every(term => question.has(term)), score: matched + questionMatches };
    }).filter(row => row.anchored && row.matched >= minimumMatches)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit).map(row => row.faq);
}
