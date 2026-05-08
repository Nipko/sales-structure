/**
 * Hand-rolled CSV serialization. Avoids a dependency since our data shapes
 * are flat (numbers, strings, dates) and small. Quotes any field containing
 * comma, quote, or newline; doubles internal quotes per RFC 4180.
 */

function escapeField(v: unknown): string {
    if (v === null || v === undefined) return '';
    let s: string;
    if (v instanceof Date) {
        s = v.toISOString();
    } else if (typeof v === 'object') {
        s = JSON.stringify(v);
    } else {
        s = String(v);
    }
    if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export function rowsToCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
    if (rows.length === 0) {
        return columns ? columns.join(',') + '\n' : '';
    }
    const cols = columns ?? Object.keys(rows[0]);
    const header = cols.map(escapeField).join(',');
    const body = rows.map((row) => cols.map((c) => escapeField(row[c])).join(',')).join('\n');
    return `${header}\n${body}\n`;
}
