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
 */
export function receiptMoney(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat('es-CO', { style: 'currency', currency }).format(amount);
    } catch {
        return `${amount.toFixed(2)} ${currency}`;
    }
}

/** `YYYY-MM-DD` from a `DATE`/`TIMESTAMP` the driver may hand back either way. */
export function receiptDate(value: unknown): string {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).replace(' ', 'T').slice(0, 10);
}
