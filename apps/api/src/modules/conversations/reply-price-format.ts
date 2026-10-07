/**
 * Amounts in a reply are written in the grouping of the reply's language.
 *
 * The model receives a price as a bare number (`price="119900"`) and writes the thousands separator itself, so the
 * same product came out as «119.900» one day and «119,900» the next. Only amounts that carry a currency marker
 * (COP, $, pesos, €…) are touched, and only their grouping: the figure never changes, so the price guardrail
 * (which reads any grouping) authorises exactly what it authorised before.
 *
 * ONE pass over the ORIGINAL text: a single pattern consumes the optional prefix marker, the number and the
 * optional suffix marker together. Two passes would read the output of the first (grouped with spaces in
 * fr/pt-PT) as a new number: «$80.000 COP» became «$80 0 COP».
 */
const CURRENCY_CODE = 'COP|USD|MXN|ARS|CLP|PEN|EUR|BRL';
const CURRENCY_WORD = 'pesos?|d[oó]lares?|dollars?|euros?|reales|soles|reais';
const AMOUNT = '\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
/** "1,5 millones", "50k", "2 mil": a magnitude word makes the number a quantity of its own, never regrouped. */
const MAGNITUDE = '(?:mill[oó]n(?:es)?|milh[aã]o|milh[oõ]es|millions?|mil|thousand|k|mm|m|bn)(?![\\p{L}])';
const SPACES = '\\s\\u00a0\\u202f';

const AMOUNT_IN_TEXT = new RegExp(
    `(?<![\\p{L}\\d])(?:(R\\$|S\\/|\\$|€|£|${CURRENCY_CODE})([${SPACES}]?))?`
    + `(?<![\\d.,])(?<!\\d[${SPACES}])(${AMOUNT})(?![\\d])(?![.,]\\d)(?![${SPACES}]\\d{3}(?!\\d))(?![${SPACES}]?${MAGNITUDE})`
    + `(?:([${SPACES}]?)(${CURRENCY_CODE}|${CURRENCY_WORD}|€)(?![\\p{L}]))?`,
    'giu',
);

const DEFAULT_LOCALE: Record<string, string> = { es: 'es-CO', pt: 'pt-BR', en: 'en-US', fr: 'fr-FR' };

/** The business locale when it speaks the reply language ("es-MX" for a Spanish reply), else a sensible default. */
export function localeForReply(lang?: string, regionalLocale?: string | null): string {
    const code = String(lang || 'es').slice(0, 2).toLowerCase();
    const regional = String(regionalLocale || '').replace('_', '-');
    if (regional && regional.slice(0, 2).toLowerCase() === code) return regional;
    return DEFAULT_LOCALE[code] || DEFAULT_LOCALE.es;
}

const GROUPING = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;

/** The number a grouped string says, whatever separators its locale used (only a trailing 1-2 digit group is decimal). */
export function readAmount(text: string): number {
    const compact = text.replace(new RegExp(`[${SPACES}]`, 'g'), '');
    const tail = compact.match(/[.,](\d{1,2})$/);
    const whole = (tail ? compact.slice(0, -(tail[1].length + 1)) : compact).replace(/[.,]/g, '');
    return Number(tail ? `${whole}.${tail[1]}` : whole);
}

function format(token: string, locale: string): string {
    const value = readAmount(token);
    if (!Number.isFinite(value)) return token;
    const decimals = /[.,]\d{1,2}$/.test(token);
    try {
        const grouped = new Intl.NumberFormat(locale, { ...GROUPING, minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2 }).format(value);
        // The figure is the contract: if the regrouped text does not read back as the same number, keep the original.
        return readAmount(grouped) === value ? grouped : token;
    } catch {
        return token;
    }
}

export function normalizeReplyAmounts(text: string, locale: string): string {
    if (!text) return text;
    return text.replace(AMOUNT_IN_TEXT, (all: string, prefix: string | undefined, prefixSpace: string | undefined, amount: string, suffixSpace: string | undefined, suffix: string | undefined) => {
        // Not an amount unless a currency marker is attached to it.
        if (!prefix && !suffix) return all;
        // A bare year-like number next to a currency CODE ("el año 2026 COP") has no price cue of its own.
        if (/^(?:19|20)\d{2}$/.test(amount) && !(prefix && /[$€£]|S\//.test(prefix))) return all;
        return `${prefix ?? ''}${prefixSpace ?? ''}${format(amount, locale)}${suffixSpace ?? ''}${suffix ?? ''}`;
    });
}
