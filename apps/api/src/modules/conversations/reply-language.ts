/**
 * The language a reply is written in, judged by FUNCTION words (articles, prepositions, auxiliaries): a reply of a
 * dozen words always has several, unlike the marker words the customer-message detector relies on (a Spanish
 * reply about a refund policy has none of them). Words shared by two languages are left out, so a hit is evidence.
 *
 * Returns null unless one language is clearly ahead (at least 3 hits and at least twice the runner-up).
 */
const WORDS: Record<'es' | 'en' | 'pt' | 'fr', readonly string[]> = {
    es: ['el', 'los', 'las', 'del', 'al', 'una', 'unos', 'unas', 'y', 'pero', 'muy', 'tambien', 'sin', 'su', 'sus', 'lo', 'les', 'es', 'son',
        'estan', 'hay', 'tiene', 'tienen', 'puede', 'pueden', 'nuestro', 'nuestra', 'nuestros', 'nuestras', 'usted', 'ustedes', 'cuando', 'donde', 'hasta', 'esta'],
    en: ['the', 'and', 'of', 'to', 'in', 'is', 'are', 'you', 'your', 'for', 'with', 'this', 'that', 'it', 'we', 'our', 'can', 'will', 'if', 'not',
        'or', 'be', 'have', 'has', 'on', 'at', 'by', 'from', 'an', 'but', 'all', 'please'],
    pt: ['o', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'do', 'da', 'dos', 'das', 'em', 'na', 'nas', 'seu', 'sua', 'seus', 'suas', 'ele', 'ela',
        'nao', 'sao', 'estao', 'tem', 'podem', 'nosso', 'nossa', 'nossos', 'nossas', 'voce', 'voces', 'apos', 'pela', 'pelo', 'ao', 'aos', 'muito',
        'tambem', 'ate', 'mais', 'sem'],
    fr: ['le', 'les', 'des', 'du', 'et', 'est', 'sont', 'vous', 'votre', 'vos', 'nous', 'notre', 'nos', 'pour', 'dans', 'avec', 'ce', 'cette',
        'ces', 'pas', 'qui', 'au', 'aux', 'sur', 'par', 'plus', 'mais', 'ou', 'peut', 'pouvez', 'avez', 'il', 'elle', 'je', 'une'],
};

const SETS = Object.fromEntries(Object.entries(WORDS).map(([lang, words]) => [lang, new Set(words)])) as Record<keyof typeof WORDS, Set<string>>;

export function replyLanguageOf(text: string): 'es' | 'en' | 'pt' | 'fr' | null {
    const tokens = String(text || '')
        .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/<[^>]*>/g, ' ').replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean);
    const scores: Record<string, number> = { es: 0, en: 0, pt: 0, fr: 0 };
    for (const token of tokens) {
        for (const lang of Object.keys(SETS) as Array<keyof typeof WORDS>) if (SETS[lang].has(token)) scores[lang]++;
    }
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [best, bestScore] = ranked[0];
    return bestScore >= 3 && bestScore >= 2 * (ranked[1]?.[1] ?? 0) ? best as 'es' | 'en' | 'pt' | 'fr' : null;
}
