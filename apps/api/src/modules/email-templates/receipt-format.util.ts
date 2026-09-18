/**
 * The two formatting jobs every operation receipt has, written once.
 *
 * Product names, pet names, driver names and a customer's own free text all
 * reach these templates, and all of them are tenant- or customer-controlled.
 * Six writers each doing their own escaping is five chances to forget.
 */

export function escapeReceiptHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Money, from the amount the writer already froze.
 *
 * An unrecognised currency code is not worth losing a receipt over, so the
 * fallback prints the number and the code rather than throwing.
 *
 * SIN moneda (D17) imprime el número desnudo. Las filas comerciales pueden
 * nacer con `currency` en NULL —el negocio todavía no declaró su país— y las
 * dos salidas alternativas son peores: `${amount} ` deja un espacio colgando al
 * final del renglón del recibo, y rellenar con 'COP' afirma una moneda que
 * nadie eligió en un documento que el cliente guarda.
 */
export function receiptMoney(amount: number, currency?: string | null): string {
    const code = String(currency ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
        return new Intl.NumberFormat('es-CO', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    }
    try {
        return new Intl.NumberFormat('es-CO', { style: 'currency', currency: code }).format(amount);
    } catch {
        return `${amount.toFixed(2)} ${code}`;
    }
}

/** `YYYY-MM-DD` from a `DATE`/`TIMESTAMP` the driver may hand back either way. */
export function receiptDate(value: unknown): string {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).replace(' ', 'T').slice(0, 10);
}
