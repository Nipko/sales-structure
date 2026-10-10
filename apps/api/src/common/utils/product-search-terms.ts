/**
 * How a customer's words find a product in the tenant's catalogue.
 *
 * The lookup used to be ONE `LIKE '%<whole text>%'` over the name: «audífonos aurora» (plural, lower case, without the «QA» in the
 * middle) is not a substring of «Audífono QA Aurora», so the agent answered «no hay audífonos Aurora disponibles en nuestro
 * catálogo» about a product on sale (production 2026-10-10, Tienda QA Electrónica). A customer writes the plural, the singular, the
 * accent or not, and never the whole name.
 *
 * Here the text becomes the significant words of the query, each reduced to a stem that is a substring of both its singular and its
 * plural spelling («audífonos» → «audifono», «cargadores» → «cargador»). A product answers when EVERY term is found in its name,
 * description or category (accent- and case-insensitive, folded in SQL by the callers), whatever the order and whatever is missing
 * between them. The terms are folded here too, so the same function serves a JavaScript comparison and a SQL pattern.
 */

/** Words that join a name without being part of it, in the four languages the agent speaks. */
const STOP_WORDS: ReadonlySet<string> = new Set([
    'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'e', 'o', 'u', 'con', 'para', 'por', 'en', 'al',
    'the', 'a', 'an', 'of', 'and', 'or', 'for', 'with', 'le', 'les', 'du', 'des', 'et', 'ou', 'um', 'uma', 'os', 'as', 'do', 'da', 'dos', 'das',
]);

const MAX_TERMS = 8;

/** Lower case, accents removed (the same folding the SQL side applies to the column). */
export function foldForSearch(value: unknown): string {
    return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * A stem that is contained in the singular AND the plural spelling. «es» is the plural of a word that ends in a consonant («azules»,
 * «cargadores», «pantalones»), so it is dropped when a consonant stands before it; any other plural just loses its «s» («mesas», «lentes»).
 */
export function stemForSearch(word: string): string {
    if (word.length >= 5 && word.endsWith('es') && !/[aeiou]/.test(word[word.length - 3])) return word.slice(0, -2);
    if (word.length >= 4 && word.endsWith('s')) return word.slice(0, -1);
    return word;
}

/** The significant, folded, stemmed words of a customer's text (no duplicates, at most eight). Empty when nothing significant is left. */
export function productSearchTerms(query: unknown): string[] {
    const words = foldForSearch(query).match(/[\p{L}\p{N}]+/gu) ?? [];
    const terms: string[] = [];
    for (const word of words) {
        if (word.length < 2 || STOP_WORDS.has(word)) continue;
        const stem = stemForSearch(word);
        if (!terms.includes(stem)) terms.push(stem);
        if (terms.length >= MAX_TERMS) break;
    }
    return terms;
}

/** `%term%` with the customer's `%`, `_` and `\` as text, not wildcards. */
export function likePatternForTerm(term: string): string {
    return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

/** Whether the text holds every term of the query (accent- and case-insensitive): the JavaScript twin of the SQL predicate. */
export function textMatchesTerms(text: unknown, terms: readonly string[]): boolean {
    const haystack = foldForSearch(text);
    return terms.length > 0 && terms.every(term => haystack.includes(term));
}
