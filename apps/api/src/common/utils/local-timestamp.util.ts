/**
 * PostgreSQL `TIMESTAMP WITHOUT TIME ZONE` values are wall-clock values, not
 * instants. Production queries provide a `to_char(... ) AS <field>_text`
 * alongside Prisma's Date value; that text is authoritative and independent
 * of the Node process timezone. Date support remains a fallback for callers
 * and follows pg's local-time parsing semantics.
 */
export function serializeLocalTimestamp(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return [
            value.getFullYear().toString().padStart(4, '0'),
            String(value.getMonth() + 1).padStart(2, '0'),
            String(value.getDate()).padStart(2, '0'),
        ].join('-') + 'T' + [
            String(value.getHours()).padStart(2, '0'),
            String(value.getMinutes()).padStart(2, '0'),
            String(value.getSeconds()).padStart(2, '0'),
        ].join(':');
    }

    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
    if (!match) return null;
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}`;
}

export function serializeLocalTimestampFields<T extends Record<string, any>>(
    row: T | null | undefined,
    fields: readonly string[],
): T | null {
    if (!row) return null;
    const result = { ...row };
    const writable = result as Record<string, any>;
    for (const field of fields) {
        const textAlias = `${field}_text`;
        const source = writable[textAlias] ?? writable[field];
        if (source !== null && source !== undefined) {
            writable[field] = serializeLocalTimestamp(source);
        }
        delete writable[textAlias];
    }
    return result;
}

export function serializeLocalTimestampRows<T extends Record<string, any>>(
    rows: readonly T[] | null | undefined,
    fields: readonly string[],
): T[] {
    return (rows || []).map((row) => serializeLocalTimestampFields(row, fields) as T);
}
