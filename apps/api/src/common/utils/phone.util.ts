/**
 * Phone number normalization to E.164.
 *
 * The default country used to be a hardcoded `'57'` and NOT ONE of the thirteen
 * call sites ever overrode it. A bare ten-digit Mexican or Argentine number
 * therefore became `+57…`, and in the identity module a wrong E.164 is not a
 * cosmetic problem: contacts are matched on it, so two different people can be
 * merged into one — and no undo puts that back.
 *
 * `region` is an ISO 3166-1 country the caller resolves from the tenant's
 * operating identity, and it **no longer has a default**. A bare national
 * number with no region is not normalisable: there is no country to attach it
 * to, and inventing one is the bug this parameter exists to fix. It returns
 * `null` instead — every call site already keeps the raw value when the
 * normaliser declines, so nothing is lost except a false certainty.
 *
 * Examples:
 *   normalizePhoneE164('300 123 4567', 'CO')  → '+573001234567'
 *   normalizePhoneE164('55 1234 5678', 'MX')  → '+525512345678'
 *   normalizePhoneE164('+5491112345678')      → '+5491112345678'   (explícito)
 *   normalizePhoneE164('300 123 4567')        → null  (no hay país que asumir)
 *   normalizePhoneE164('invalid', 'CO')       → null
 */

const COUNTRY_LENGTHS: Record<string, number[]> = {
    '57': [10],       // Colombia
    '54': [10, 11],   // Argentina (mobile carries a 9 prefix)
    '52': [10],       // Mexico
    '55': [10, 11],   // Brazil
    '56': [9],        // Chile
    '51': [9],        // Peru
    '593': [9, 10],   // Ecuador
    '598': [8, 9],    // Uruguay
    '595': [9],       // Paraguay
    '591': [8],       // Bolivia
    '58': [10],       // Venezuela
    '506': [8],       // Costa Rica
    '507': [7, 8],    // Panama
    '502': [8],       // Guatemala
    '503': [8],       // El Salvador
    '504': [8],       // Honduras
    '505': [8],       // Nicaragua
    '34': [9],        // Spain
    '1': [10],        // US / Canada / Caribbean NANP
};

/** ISO 3166-1 alpha-2 → E.164 calling code. */
const REGION_CALLING_CODE: Readonly<Record<string, string>> = {
    CO: '57', AR: '54', MX: '52', BR: '55', CL: '56', PE: '51', EC: '593',
    UY: '598', PY: '595', BO: '591', VE: '58', CR: '506', PA: '507',
    GT: '502', SV: '503', HN: '504', NI: '505', ES: '34',
    // Every NANP territory shares `+1`, which is exactly why a prefix
    // comparison cannot identify the country and callers must not try.
    US: '1', CA: '1', DO: '1', PR: '1',
};

/**
 * Accepts an ISO region (`'MX'`) or a raw calling code (`'52'`).
 *
 * Both forms exist because the thirteen historical call sites pass neither —
 * they take the default — and migrating them is a separate, reviewable step
 * from making the function capable of being right.
 */
function toCallingCode(region: string | null | undefined): string | null {
    const raw = String(region || '').trim().toUpperCase();
    if (!raw) return null;
    if (/^[A-Z]{2}$/.test(raw)) return REGION_CALLING_CODE[raw] || null;
    if (/^\d{1,3}$/.test(raw)) return raw;
    return null;
}

export function normalizePhoneE164(
    raw: string | null | undefined,
    region?: string | null,
): string | null {
    if (!raw) return null;

    // Sin región resoluble NO hay país por defecto. El `'57'` que había acá lo
    // heredaban las trece llamadas —ninguna lo pasaba— y convertía en
    // colombiano cualquier número mexicano o argentino escrito sin prefijo. En
    // identidad eso no es cosmético: los contactos se cruzan por este valor,
    // así que dos personas distintas terminaban fusionadas en una y no hay
    // deshacer que las separe.
    const defaultCountryCode = toCallingCode(region);

    // Strip everything that isn't a digit or +
    let digits = raw.replace(/[^\d+]/g, '');

    // If starts with +, remove it but remember
    let hasPlus = false;
    if (digits.startsWith('+')) {
        hasPlus = true;
        digits = digits.slice(1);
    }

    // Remove leading zeros (common in some formats)
    if (!hasPlus && digits.startsWith('0')) {
        digits = digits.replace(/^0+/, '');
    }

    // If already has country code (starts with known code)
    let countryCode = '';
    let nationalNumber = digits;

    // The tenant's own calling code is tried FIRST. Otherwise a ten-digit
    // Mexican number starting with 57 (`5712345678`) is read as Colombian,
    // because the generic scan matches the longest known prefix regardless of
    // where the business actually operates.
    if (defaultCountryCode
        && digits.startsWith(defaultCountryCode)
        && COUNTRY_LENGTHS[defaultCountryCode]?.includes(digits.length - defaultCountryCode.length)) {
        countryCode = defaultCountryCode;
        nationalNumber = digits.slice(defaultCountryCode.length);
    } else if (defaultCountryCode && COUNTRY_LENGTHS[defaultCountryCode]?.includes(digits.length)) {
        // A bare national number of the right length for this tenant's country.
        countryCode = defaultCountryCode;
        nationalNumber = digits;
    } else {
        // El barrido genérico exige que el largo nacional sea VÁLIDO para ese
        // código, no sólo que el número empiece con él. Sin esa condición
        // `5512345678` se leía como Brasil (`55` + ocho dígitos, que Brasil no
        // usa) y salía un `+55…` inventado con la misma confianza que uno
        // real. Un prefijo no es una identificación: coincidir en los dos
        // primeros dígitos le pasa a cualquier número.
        for (const code of Object.keys(COUNTRY_LENGTHS).sort((a, b) => b.length - a.length)) {
            if (digits.startsWith(code)
                && COUNTRY_LENGTHS[code].includes(digits.length - code.length)) {
                countryCode = code;
                nationalNumber = digits.slice(code.length);
                break;
            }
        }
    }

    // If no country code detected, prepend the tenant's — y si no hay tenant
    // que aportar, no se inventa: el número queda sin normalizar.
    if (!countryCode) {
        if (!defaultCountryCode) return null;
        countryCode = defaultCountryCode;
        nationalNumber = digits;
    }

    // Validate length
    const validLengths = COUNTRY_LENGTHS[countryCode];
    if (validLengths && !validLengths.includes(nationalNumber.length)) {
        // Try without country code assumption — maybe the whole thing is a national number
        if (defaultCountryCode && COUNTRY_LENGTHS[defaultCountryCode]?.includes(digits.length)) {
            countryCode = defaultCountryCode;
            nationalNumber = digits;
        } else if (!defaultCountryCode) {
            // Sin país declarado no hay "mejor esfuerzo" posible: un largo que
            // no corresponde a ningún país conocido es un número que no
            // sabemos leer, y devolverlo con un prefijo es inventarlo.
            return null;
        } else {
            // Still invalid length — return best effort if reasonable. Acá sí:
            // el dueño DECLARÓ dónde opera, y un largo raro dentro de su
            // propio país es más probablemente un plan nuevo que un error.
            if (nationalNumber.length < 7 || nationalNumber.length > 15) return null;
        }
    }

    const result = `+${countryCode}${nationalNumber}`;

    // Final sanity: E.164 is max 15 digits total (including country code)
    if (result.length < 8 || result.length > 16) return null;

    return result;
}

/**
 * Whether a stored number was normalised under an assumption that no longer
 * matches the tenant's operating country.
 *
 * Used to BUILD A REVIEW QUEUE, never to rewrite. Re-normalising historical
 * numbers is the one migration that can silently merge two people's contacts,
 * so a human decides each case.
 */
export function phoneCountryMismatch(
    e164: string | null | undefined,
    expectedRegion: string | null | undefined,
): { mismatch: boolean; storedCode?: string; expectedCode?: string } {
    const expectedCode = toCallingCode(expectedRegion);
    if (!e164 || !expectedCode || !e164.startsWith('+')) return { mismatch: false };

    const digits = e164.slice(1);
    for (const code of Object.keys(COUNTRY_LENGTHS).sort((a, b) => b.length - a.length)) {
        if (digits.startsWith(code)) {
            return { mismatch: code !== expectedCode, storedCode: code, expectedCode };
        }
    }
    return { mismatch: false, expectedCode };
}
