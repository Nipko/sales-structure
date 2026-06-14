/**
 * Compute the DIAN verification digit (DV) for a Colombian NIT using the
 * official módulo 11 algorithm: each digit (right to left) is multiplied by the
 * weight sequence below, the products summed, and the result taken mod 11.
 * remainder 0|1 → DV = remainder; otherwise DV = 11 - remainder.
 *
 * Returns null if the input is not a valid numeric NIT.
 */
const WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export function computeNitDv(nit: string): number | null {
    const digits = (nit || '').replace(/\D/g, '');
    if (digits.length === 0 || digits.length > WEIGHTS.length) return null;

    let sum = 0;
    const reversed = digits.split('').reverse();
    for (let i = 0; i < reversed.length; i++) {
        sum += parseInt(reversed[i], 10) * WEIGHTS[i];
    }
    const remainder = sum % 11;
    return remainder > 1 ? 11 - remainder : remainder;
}
