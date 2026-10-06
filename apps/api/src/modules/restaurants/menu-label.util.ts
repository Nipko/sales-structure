/**
 * Matching of a menu label (allergen, dietary tag) typed by a customer against the labels the
 * kitchen stored. Safety first: when in doubt, MATCH (a dish excluded by mistake costs a sale,
 * a dish offered by mistake can cost a customer's health).
 *
 * A label is not reduced to ONE canonical form, because no single plural rule is right for
 * Spanish, Portuguese, French and English at once ("dulces" -> "dulz", "crustaces" -> "crustaz"
 * are wrong). Instead each label yields a SET of candidate forms: the text as typed (accents,
 * capitals and spacing folded) plus the result of each plural rule applied to every word, plus
 * the minimum synonyms of any candidate. Two labels match when their sets intersect.
 *
 * `menuLabelCandidates` (JS, for the customer's words) and `menuLabelCandidatesSql` (SQL, for
 * the stored labels) must produce the same set: `__fixtures__/menu-label.cases.ts` is the shared table that
 * proves it, in a unit test for JS and a Postgres test for SQL.
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
 * Minimum synonym map, applied to every candidate form (keys and values are accent-free,
 * lower-case, singular). It is deliberately small and errs on the side of excluding more dishes:
 * asking to avoid "trigo" also avoids "gluten". It is a floor, not a food-allergen ontology; the
 * kitchen still confirms every dish. Extend it here and both JS and SQL follow.
 */
export const ALLERGEN_SYNONYMS: Readonly<Record<string, string>> = {
    lacteo: 'leche', lactosa: 'leche', lactose: 'leche', milk: 'leche', dairy: 'leche',
    'fruto seco': 'nuez', 'fruta seca': 'nuez',
    ajonjoli: 'sesamo', sesame: 'sesamo',
    trigo: 'gluten', wheat: 'gluten',
};

/**
 * Plural rules. Each is applied to EVERY word of the label that it fits and gives one more
 * candidate. [js function on one word, SQL pattern, SQL replacement]; the SQL pattern uses
 * `\M` (end of a word) and must accept exactly the words the JS function changes.
 */
const PLURAL_RULES: Array<[(w: string) => string | null, string, string]> = [
    [w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : null), '(\\w{3,})s\\M', '\\1'],              // mariscos, arachides, crustaces
    [w => (w.length > 3 && w.endsWith('es') ? w.slice(0, -2) : null), '(\\w{2,})es\\M', '\\1'],           // camarones, manies, nozes
    [w => (w.length > 3 && w.endsWith('ces') ? `${w.slice(0, -3)}z` : null), '(\\w)ces\\M', '\\1z'],     // nueces, peces
    [w => (w.length > 4 && w.endsWith('ns') ? `${w.slice(0, -2)}m` : null), '(\\w{3,})ns\\M', '\\1m'],   // amendoins
    [w => (w.length > 3 && w.endsWith('oes') ? `${w.slice(0, -3)}ao` : null), '(\\w)oes\\M', '\\1ao'],   // camaroes (camarao)
    [w => (w.length > 3 && w.endsWith('aes') ? `${w.slice(0, -3)}ao` : null), '(\\w)aes\\M', '\\1ao'],   // paes (pao)
];

const WORD = /[\p{L}\p{N}_]+/gu;

/** Accents, capitals and whitespace folded; no plural handling. */
function foldLabel(value: unknown): string {
    const folded = String(value ?? '')
        .normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/[Øø]/g, 'o')
        .toLowerCase();
    return folded.replace(/\s+/g, ' ').trim();
}

/** Every candidate form of a label (sorted, no duplicates). Empty for a blank label. */
export function menuLabelCandidates(value: unknown): string[] {
    const base = foldLabel(value);
    if (!base) return [];
    const forms = new Set<string>([base]);
    for (const [rule] of PLURAL_RULES) forms.add(base.replace(WORD, w => rule(w) ?? w));
    for (const form of [...forms]) {
        const synonym = ALLERGEN_SYNONYMS[form];
        if (synonym) forms.add(synonym);
    }
    return [...forms].sort();
}

/**
 * SQL expression (text[]) equivalent to `menuLabelCandidates` for the column or expression `col`.
 * The column goes through `normalize(..., NFC)` first so a label stored decomposed (n + combining
 * tilde) folds like the composed one (PostgreSQL 13+; production and CI run 16/17).
 */
export function menuLabelCandidatesSql(col: string): string {
    const base = `regexp_replace(regexp_replace(lower(translate(normalize((${col})::text, NFC), '${FOLD_FROM}', '${FOLD_TO}')), '\\s+', ' ', 'g'), '^\\s+|\\s+$', '', 'g')`;
    const forms = ['t.b', ...PLURAL_RULES.map(([, pattern, replacement]) => `regexp_replace(t.b, '${pattern}', '${replacement}', 'g')`)];
    const synonyms = Object.entries(ALLERGEN_SYNONYMS).map(([from, to]) => `('${from}', '${to}')`).join(', ');
    return `(SELECT CASE WHEN t.b = '' THEN ARRAY[]::text[] ELSE ARRAY(SELECT DISTINCT q.v FROM (`
        + `SELECT unnest(ARRAY[${forms.join(', ')}]) AS v `
        + `UNION SELECT s.v FROM (VALUES ${synonyms}) AS s(k, v) WHERE s.k = ANY(ARRAY[${forms.join(', ')}])`
        + `) q ORDER BY q.v) END FROM (SELECT ${base} AS b) t)`;
}
