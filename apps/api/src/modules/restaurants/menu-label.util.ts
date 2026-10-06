/**
 * Canonical form of a menu label (allergen, dietary tag), computed in JavaScript for the
 * customer's words and in SQL (`menuLabelSql`) for the labels the kitchen stored. Both must
 * give the same result for the same text: `menu-label.cases.ts` is the shared table that
 * proves it (unit test for JS, Postgres test for SQL).
 *
 * Steps: accents and capitals out (a-tilde, o-tilde, cedilla, a-ring and o-slash included),
 * whitespace collapsed and trimmed, every word reduced to its singular, then a small synonym map.
 */

/** [accented, plain] pairs. SQL `translate` is built from these; JS handles every combining mark on top. */
const FOLD_PAIRS: Array<[string, string]> = [
    ['Á', 'A'], ['À', 'A'], ['Ä', 'A'], ['Â', 'A'], ['Ã', 'A'], ['Å', 'A'],
    ['É', 'E'], ['È', 'E'], ['Ë', 'E'], ['Ê', 'E'],
    ['Í', 'I'], ['Ì', 'I'], ['Ï', 'I'], ['Î', 'I'],
    ['Ó', 'O'], ['Ò', 'O'], ['Ö', 'O'], ['Ô', 'O'], ['Õ', 'O'], ['Ø', 'O'],
    ['Ú', 'U'], ['Ù', 'U'], ['Ü', 'U'], ['Û', 'U'],
    ['Ç', 'C'], ['Ñ', 'N'],
];
const FOLD_PAIRS_ALL = [...FOLD_PAIRS, ...FOLD_PAIRS.map(([a, b]): [string, string] => [a.toLowerCase(), b.toLowerCase()])];
const FOLD_FROM = FOLD_PAIRS_ALL.map(([a]) => a).join('');
const FOLD_TO = FOLD_PAIRS_ALL.map(([, b]) => b).join('');

/**
 * Minimum synonym map, applied AFTER normalisation (keys and values are already singular and
 * accent-free). It is deliberately small and errs on the side of excluding more dishes: asking
 * to avoid "trigo" also avoids "gluten". It is a floor, not a food-allergen ontology; the
 * kitchen still confirms every dish. Extend it here and both JS and SQL follow.
 */
export const ALLERGEN_SYNONYMS: Readonly<Record<string, string>> = {
    lacteo: 'leche', lactosa: 'leche', lactose: 'leche', milk: 'leche', dairy: 'leche',
    'fruto seco': 'nuez', 'fruta seca': 'nuez',
    ajonjoli: 'sesamo', sesame: 'sesamo',
    trigo: 'gluten', wheat: 'gluten',
};

/** Singular of one already accent-free, lower-case word. Same rules, same order, as `SINGULAR_SQL_RULES`. */
function singularWord(word: string): string {
    const n = word.length;
    if (n > 3 && word.endsWith('ces')) return `${word.slice(0, -3)}z`;       // nueces, peces -> nuez, pez
    if (n > 4 && word.endsWith('ns')) return `${word.slice(0, -2)}m`;        // amendoins -> amendoim
    if (n > 3 && /[nzdlri]es$/.test(word)) return word.slice(0, -2);         // camarones, manies, nozes
    if (n > 3 && word.endsWith('s')) return word.slice(0, -1);               // mariscos, leches
    return word;
}
// [pattern, replacement] applied in order with the 'g' flag; \M is the end of a word.
const SINGULAR_SQL_RULES: Array<[string, string]> = [
    ['(\\w)ces\\M', '\\1z'],
    ['(\\w{3,})ns\\M', '\\1m'],
    ['(\\w[nzdlri])es\\M', '\\1'],
    ['(\\w{3,})s\\M', '\\1'],
];

export function normalizeMenuLabel(value: unknown): string {
    const folded = String(value ?? '')
        .normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/[Øø]/g, 'o')
        .toLowerCase();
    const spaced = folded.replace(/\s+/g, ' ').trim();
    const singular = spaced.replace(/[\p{L}\p{N}_]+/gu, singularWord);
    return ALLERGEN_SYNONYMS[singular] ?? singular;
}

/** SQL expression (text) equivalent to `normalizeMenuLabel` for the column or expression `col`. */
export function menuLabelSql(col: string): string {
    let sql = `lower(translate(${col}, '${FOLD_FROM}', '${FOLD_TO}'))`;
    sql = `regexp_replace(regexp_replace(${sql}, '\\s+', ' ', 'g'), '^\\s+|\\s+$', '', 'g')`;
    for (const [pattern, replacement] of SINGULAR_SQL_RULES) {
        sql = `regexp_replace(${sql}, '${pattern}', '${replacement}', 'g')`;
    }
    const whens = Object.entries(ALLERGEN_SYNONYMS).map(([from, to]) => `WHEN '${from}' THEN '${to}'`).join(' ');
    return `(CASE ${sql} ${whens} ELSE ${sql} END)`;
}
