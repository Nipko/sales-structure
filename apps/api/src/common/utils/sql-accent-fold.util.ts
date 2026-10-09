/**
 * Accent- and case-insensitive text comparison for catalogue lookups.
 *
 * A customer on a phone types "Audifono", "coracao de cafe" or "coeur"; the
 * catalogue the owner typed says "Audífono", "Coração de Café", "Cœur". A
 * literal comparison told the customer the product does not exist.
 *
 * Why `translate()` and not `unaccent`: no migration in this repository creates
 * the `unaccent` extension (only `uuid-ossp` and `vector`), so relying on it
 * would add a `CREATE EXTENSION` to production and to every tenant bootstrap
 * for one comparison. `translate()` is built in, IMMUTABLE and already the
 * precedent in `faqs.service.ts`. It folds exactly the characters listed here,
 * which is the point: Spanish, Portuguese and French, no more.
 *
 * Why not normalise in JS on both sides: the catalogue column is not in JS. The
 * query text IS normalised to NFC in JS (`foldQueryText`), because a keyboard or
 * a pasted message can deliver "í" as "i" + U+0301, which `translate()` would
 * not see; the column is folded in SQL.
 *
 * `translate()` is one-to-one, so the ligatures that fold to TWO letters
 * (œ -> oe, æ -> ae) are handled with `replace()`. Case is folded last, with
 * `lower()` over ASCII only, so the result does not depend on the database
 * locale (a `C` locale does not lower-case "É").
 */
const FOLD_GROUPS: ReadonlyArray<readonly [string, string]> = [
    ['áàâãäå', 'a'],
    ['éèêë', 'e'],
    ['íìîï', 'i'],
    ['óòôõö', 'o'],
    ['úùûü', 'u'],
    ['ç', 'c'],
    ['ñ', 'n'],
    ['ýÿ', 'y'],
];

const expand = (letters: string, target: string): { from: string; to: string } => {
    const chars = [...letters, ...letters.toUpperCase()];
    return { from: chars.join(''), to: chars.map(() => target).join('') };
};

export const ACCENT_FOLD_FROM = FOLD_GROUPS.map(([letters, target]) => expand(letters, target).from).join('');
export const ACCENT_FOLD_TO = FOLD_GROUPS.map(([letters, target]) => expand(letters, target).to).join('');

/** SQL expression that folds `expression` (already a text expression). */
export function foldedSql(expression: string): string {
    return `lower(replace(replace(replace(replace(translate(${expression}, '${ACCENT_FOLD_FROM}', '${ACCENT_FOLD_TO}'),`
        + ` 'œ', 'oe'), 'Œ', 'oe'), 'æ', 'ae'), 'Æ', 'ae'))`;
}

/** The customer's text, composed so that every accent is a single code point. */
export function foldQueryText(text: unknown): string {
    return String(text ?? '').normalize('NFC').trim();
}

/**
 * `%text%` for an accent-insensitive «contains». The customer's `%`, `_` and
 * `\` are text, not wildcards (backslash is PostgreSQL's default LIKE escape).
 * Compare with `foldedContainsSql(column, '$n')`, which folds BOTH sides in SQL.
 */
export function foldedLikePattern(text: unknown): string {
    return `%${foldQueryText(text).replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * `column` contains the text bound to `placeholder` (e.g. `$3`), ignoring case
 * and accents on both sides: «Usaquén» finds «Usaquen» and the other way round.
 * Bind `foldedLikePattern(text)` to the placeholder.
 */
export function foldedContainsSql(column: string, placeholder: string): string {
    return `${foldedSql(column)} LIKE ${foldedSql(`${placeholder}::text`)}`;
}
