/**
 * Phone number normalization to E.164 format.
 * Optimized for Latin American numbers (CO, AR, MX, BR, CL, PE, EC).
 *
 * Examples:
 *   "300 123 4567"       → "+573001234567"  (default CO)
 *   "+573001234567"      → "+573001234567"
 *   "573001234567"       → "+573001234567"
 *   "03001234567"        → "+573001234567"  (strips leading 0)
 *   "+5491112345678"     → "+5491112345678" (AR mobile)
 *   "invalid"            → null
 */

const COUNTRY_LENGTHS: Record<string, number[]> = {
    '57': [10],       // Colombia: 10 digits after code
    '54': [10, 11],   // Argentina: 10-11 digits (mobile has 9 prefix)
    '52': [10],       // Mexico
    '55': [10, 11],   // Brazil
    '56': [9],        // Chile
    '51': [9],        // Peru
    '593': [9, 10],   // Ecuador
    '1': [10],        // US/Canada
};

export function normalizePhoneE164(raw: string | null | undefined, defaultCountryCode = '57'): string | null {
    if (!raw) return null;

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

    for (const code of Object.keys(COUNTRY_LENGTHS).sort((a, b) => b.length - a.length)) {
        if (digits.startsWith(code)) {
            countryCode = code;
            nationalNumber = digits.slice(code.length);
            break;
        }
    }

    // If no country code detected, prepend default
    if (!countryCode) {
        countryCode = defaultCountryCode;
        nationalNumber = digits;
    }

    // Validate length
    const validLengths = COUNTRY_LENGTHS[countryCode];
    if (validLengths && !validLengths.includes(nationalNumber.length)) {
        // Try without country code assumption — maybe the whole thing is a national number
        if (COUNTRY_LENGTHS[defaultCountryCode]?.includes(digits.length)) {
            countryCode = defaultCountryCode;
            nationalNumber = digits;
        } else {
            // Still invalid length — return best effort if reasonable
            if (nationalNumber.length < 7 || nationalNumber.length > 15) return null;
        }
    }

    const result = `+${countryCode}${nationalNumber}`;

    // Final sanity: E.164 is max 15 digits total (including country code)
    if (result.length < 8 || result.length > 16) return null;

    return result;
}
