import { unconfirmedDefaultColumns, UNCONFIRMED_FIELDS_NOTE } from '../../common/utils/column-defaults.util';

/**
 * Opción B (dueño, 2026-11-06): lo que una lectura del catálogo le dice al modelo sobre datos que el negocio no confirmó.
 *
 * - Ítem sembrado o de ejemplo (`content_status` seeded/example con procedencia vigente, C0 §2.2: lo creó una plantilla
 *   del alta, no el negocio): `contentStatus` lo dice y su precio pasa a `example` (regla 22a: sin cifra, «por confirmar»).
 *   El modelo puede nombrar el ítem, nunca presentarlo como oferta confirmada.
 * - Campo con el default de columna sin confirmar (`unconfirmedDefaultColumns`): llega `null` y nombrado en
 *   `unconfirmedFields`, así no hay hecho citable ni cifra que respalde la frase (evidence-verifier, fact-renderer).
 *
 * Misma lectura que `realRowProvenance` de @parallext/business-spec (sin importarlo en tiempo de ejecución): el
 * `content_status` solo no cuenta (su default de columna es `confirmed`); lo prueban `origin` y la estampa
 * `source_ref.row_updated_at` igual al `updated_at` de la fila.
 */
export type CatalogContentStatus = 'confirmed' | 'seeded' | 'example';

const toMs = (v: unknown): number => {
    if (v instanceof Date) return v.getTime();
    if (v === null || v === undefined || v === '') return NaN;
    const t = String(v).replace(' ', 'T');
    return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
};

const asObject = (v: unknown): Record<string, unknown> | null => {
    const parsed = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
};

/** Estado del contenido de una fila de catálogo según su procedencia real; sin procedencia vigente, `confirmed`. */
export function catalogContentStatus(row: Record<string, any> | null | undefined): CatalogContentStatus {
    if (!row) return 'confirmed';
    const status = row.content_status;
    const origin = typeof row.origin === 'string' ? row.origin.trim() : '';
    if ((status !== 'seeded' && status !== 'example') || !origin) return 'confirmed';
    const ref = asObject(row.source_ref);
    if (!ref || !('row_updated_at' in ref)) return 'confirmed';
    const a = toMs(ref.row_updated_at);
    const b = toMs(row.updated_at);
    const same = Number.isFinite(a) ? Number.isFinite(b) && Math.abs(a - b) < 1 : !Number.isFinite(b);
    return same ? status : 'confirmed';
}

/** Lo que dice el modelo sobre un ítem sembrado o de ejemplo. */
export const SEEDED_ITEM_NOTE = 'contentStatus "seeded" or "example" marks an item that comes from a template, not confirmed by the business: you may mention it, but say it and its price are pending the business\'s confirmation and offer a person from the team; never present it as a confirmed offer.';

/**
 * Marcas de opción B para el registro proyectado de una fila: `fields` = campo del registro → columna con default.
 * Devuelve los campos que hay que poner en `null`, la marca del contenido y las notas.
 */
export function unconfirmedCatalogMarks(table: string, row: Record<string, any>, fields: Readonly<Record<string, string>>): {
    contentStatus: CatalogContentStatus;
    unconfirmedFields: string[];
} {
    const defaults = unconfirmedDefaultColumns(table, row);
    return {
        contentStatus: catalogContentStatus(row),
        unconfirmedFields: Object.entries(fields).filter(([, column]) => defaults.has(column)).map(([field]) => field),
    };
}

/**
 * Aplica las marcas a un registro ya proyectado: nulos en los campos sin confirmar, `unconfirmedFields`, y para un ítem
 * sembrado `contentStatus` + precio `example`.
 */
export function applyUnconfirmedMarks<T extends Record<string, any>>(record: T, marks: ReturnType<typeof unconfirmedCatalogMarks>): T {
    const out: Record<string, any> = { ...record };
    for (const field of marks.unconfirmedFields) out[field] = null;
    if (marks.unconfirmedFields.length) out.unconfirmedFields = marks.unconfirmedFields;
    if (marks.contentStatus !== 'confirmed') {
        out.contentStatus = marks.contentStatus;
        if ('priceStatus' in out) out.priceStatus = 'example';
    }
    return out as T;
}

/** Notas que acompañan a una lectura con registros marcados (una vez por resultado). */
export function unconfirmedNotes(records: ReadonlyArray<Record<string, any>>): Record<string, string> {
    return {
        ...(records.some(r => Array.isArray(r?.unconfirmedFields) && r.unconfirmedFields.length) ? { unconfirmedFieldsNote: UNCONFIRMED_FIELDS_NOTE } : {}),
        ...(records.some(r => r?.contentStatus === 'seeded' || r?.contentStatus === 'example') ? { seededItemNote: SEEDED_ITEM_NOTE } : {}),
    };
}
