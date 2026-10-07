/**
 * Amounts in a reply are written in the grouping of the reply's language.
 *
 * The model receives a price as a bare number (`price="119900"`) and writes the thousands separator itself, so the
 * same product came out as «119.900» one day and «119,900» the next. Only amounts that carry a currency marker
 * (COP, $, pesos…) are touched, and only their grouping: the figure never changes, so the price guardrail (which
 * reads any grouping) authorises exactly what it authorised before.
 */
const CURRENCY_CODE = 'COP|USD|MXN|ARS|CLP|PEN|EUR|BRL';
const CURRENCY_WORD = 'pesos?|d[oó]lares?|dollars?|euros?|reales|soles|reais';
const AMOUNT = '\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';

const PREFIXED = new RegExp(`(?<![\\p{L}\\d])(R\\$|S\\/|\\$|€|£|${CURRENCY_CODE})(\\s?)(${AMOUNT})(?![\\d])`, 'giu');
const SUFFIXED = new RegExp(`(?<![\\d.,])(${AMOUNT})(?![\\d])(\\s?)(${CURRENCY_CODE}|${CURRENCY_WORD})(?![\\p{L}])`, 'giu');

const DEFAULT_LOCALE: Record<string, string> = { es: 'es-CO', pt: 'pt-BR', en: 'en-US', fr: 'fr-FR' };

/** The business locale when it speaks the reply language ("es-MX" for a Spanish reply), else a sensible default. */
export function localeForReply(lang?: string, regionalLocale?: string | null): string {
    const code = String(lang || 'es').slice(0, 2).toLowerCase();
    const regional = String(regionalLocale || '').replace('_', '-');
    if (regional && regional.slice(0, 2).toLowerCase() === code) return regional;
    return DEFAULT_LOCALE[code] || DEFAULT_LOCALE.es;
}

const GROUPING = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;

function format(token: string, locale: string): string {
    let digits = token;
    let decimals = '';
    const tail = digits.match(/[.,](\d{1,2})$/);
    if (tail) { decimals = tail[1]; digits = digits.slice(0, -(decimals.length + 1)); }
    digits = digits.replace(/[.,]/g, '');
    const value = Number(decimals ? `${digits}.${decimals}` : digits);
    if (!Number.isFinite(value)) return token;
    try {
        return new Intl.NumberFormat(locale, { ...GROUPING, minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2 }).format(value);
    } catch {
        return token;
    }
}

export function normalizeReplyAmounts(text: string, locale: string): string {
    if (!text) return text;
    return text
        .replace(PREFIXED, (_all, marker: string, space: string, amount: string) => `${marker}${space}${format(amount, locale)}`)
        .replace(SUFFIXED, (_all, amount: string, space: string, marker: string) => `${format(amount, locale)}${space}${marker}`);
}
