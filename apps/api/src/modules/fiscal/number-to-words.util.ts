/**
 * Number → Spanish words, for the invoice "valor en letras" (Colombia).
 * DIAN invoices are whole COP (no decimals), so we round to integer pesos and
 * append the legal suffix "PESOS M/CTE". Self-contained (no external dep).
 */

const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const ESPECIALES: Record<number, string> = {
    10: 'diez', 11: 'once', 12: 'doce', 13: 'trece', 14: 'catorce', 15: 'quince',
    16: 'dieciséis', 17: 'diecisiete', 18: 'dieciocho', 19: 'diecinueve',
    20: 'veinte', 21: 'veintiuno', 22: 'veintidós', 23: 'veintitrés', 24: 'veinticuatro',
    25: 'veinticinco', 26: 'veintiséis', 27: 'veintisiete', 28: 'veintiocho', 29: 'veintinueve',
};
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function twoDigits(n: number): string {
    if (n < 10) return UNIDADES[n];
    if (n <= 29) return ESPECIALES[n];
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${UNIDADES[u]}`;
}

function threeDigits(n: number): string {
    if (n === 100) return 'cien';
    const c = Math.floor(n / 100);
    const r = n % 100;
    return [c ? CENTENAS[c] : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

/** Apocope of a trailing "uno" → "un" ("veintiuno" → "veintiún") before a noun/"mil"/"millón". */
function apocope(w: string): string {
    if (w.endsWith('veintiuno')) return `${w.slice(0, -'veintiuno'.length)}veintiún`;
    if (w.endsWith('uno')) return `${w.slice(0, -'uno'.length)}un`;
    return w;
}

/** Non-negative integer → Spanish words (supports up to the billions range). */
export function numberToSpanishWords(value: number): string {
    let n = Math.floor(Math.abs(value));
    if (n === 0) return 'cero';

    const millones = Math.floor(n / 1_000_000);
    const miles = Math.floor((n % 1_000_000) / 1000);
    const resto = n % 1000;

    const parts: string[] = [];
    if (millones > 0) {
        parts.push(millones === 1 ? 'un millón' : `${apocope(threeDigits(millones))} millones`);
    }
    if (miles > 0) {
        parts.push(miles === 1 ? 'mil' : `${apocope(threeDigits(miles))} mil`);
    }
    if (resto > 0) {
        parts.push(threeDigits(resto));
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * COP amount (in cents) → uppercase "valor en letras" for the invoice, e.g.
 * 5_950_000 → "CINCUENTA Y NUEVE MIL QUINIENTOS PESOS M/CTE".
 */
export function copAmountInWords(cents: number): string {
    const pesos = Math.round((cents || 0) / 100);
    // Trailing "uno" apocopes before the masculine noun "PESOS" (un peso, veintiún pesos).
    const words = apocope(numberToSpanishWords(pesos));
    return `${words.toUpperCase()} PESOS M/CTE`;
}
