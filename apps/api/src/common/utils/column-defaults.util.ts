/**
 * Opción B (dueño, 2026-11-06): un valor que la base pone sola cuando el campo nunca se llenó (default de columna) no es
 * dato del negocio hasta que el negocio lo confirma.
 *
 * - El agente no lo afirma: las lecturas del catálogo lo devuelven como `null` y lo nombran en `unconfirmedFields`, así
 *   no hay hecho citable ni cifra que respalde «grupos de 1 a 10 personas» o «sin cargo de limpieza». El motor de reservas
 *   sigue aplicando el límite al reservar (lee la fila, no esta proyección).
 * - Guardar el formulario con el campo lo confirma aunque el valor sea el mismo: el escritor estampa
 *   `metadata.confirmed_fields.<columna> = <ISO>`.
 *
 * Es la misma tabla que `COLUMN_DEFAULTS` de @parallext/business-spec (legacy-status.ts, L4 por campo), que decide qué
 * pregunta la preparación. Se repite aquí sin importar el paquete en tiempo de ejecución (ver business-readiness.port.ts);
 * column-defaults.util.spec.ts comprueba que no diverjan.
 */

/** Default de columna: un número, un booleano o la lista vacía (`[]` de una columna JSONB). */
export type ColumnDefault = number | boolean | readonly never[];

export const CATALOG_COLUMN_DEFAULTS: Readonly<Record<string, Readonly<Record<string, ColumnDefault>>>> = {
    tour_packages: { min_party_size: 1, max_capacity: 10 },
    properties: { cleaning_fee: 0 },
    // E2ah (inmobiliaria): «Parqueaderos: 0», «no cuenta con financiación», «no tiene amenidades» salían del default.
    real_estate_listings: { parking_spots: 0, financing_available: false, amenities: [] },
};

/** ¿El valor guardado es el default de su columna? */
export function isColumnDefault(raw: unknown, def: ColumnDefault): boolean {
    if (Array.isArray(def)) {
        const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
        return raw === null || raw === undefined || (Array.isArray(parsed) && parsed.length === 0);
    }
    if (typeof def === 'boolean') return raw === null || raw === undefined ? def === false : raw === def || String(raw) === String(def) || (def === false && raw === 'f');
    const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    return n === def;
}

export const CONFIRMED_FIELDS_KEY = 'confirmed_fields';

/** Lo que la lectura le dice al modelo junto a `unconfirmedFields`. */
export const UNCONFIRMED_FIELDS_NOTE = 'unconfirmedFields lists fields the business has not confirmed (the value shown before was a platform default, now null): never state, estimate or deny them (no group size, no "no cleaning fee", no "0 parking spots", no "no financing", no "no amenities"); say that detail is not confirmed and offer a person from the team to confirm it. Booking still checks the real limits.';

const asObject = (v: unknown): Record<string, unknown> | null => {
    const parsed = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
};

/** Columnas que el negocio confirmó (de `metadata.confirmed_fields`). */
export function confirmedColumns(row: Record<string, any>): Set<string> {
    const confirmed = asObject(asObject(row?.metadata)?.[CONFIRMED_FIELDS_KEY]);
    return new Set(confirmed ? Object.keys(confirmed) : []);
}

/** Columnas de la fila con el valor por defecto de su columna que el negocio no confirmó. */
export function unconfirmedDefaultColumns(table: string, row: Record<string, any>): Set<string> {
    const defaults = CATALOG_COLUMN_DEFAULTS[table];
    if (!defaults || !row) return new Set();
    const confirmed = confirmedColumns(row);
    const out = new Set<string>();
    for (const [column, value] of Object.entries(defaults)) {
        if (column in row && isColumnDefault(row[column], value) && !confirmed.has(column)) out.add(column);
    }
    return out;
}

/**
 * Las columnas con default que el formulario trae en `data` (campo presente, aunque sea el mismo valor): las que guardar
 * confirma. `fields` = campo del cuerpo → columna.
 */
export function confirmedFieldsStamp(table: string, data: Record<string, any>, fields: Readonly<Record<string, string>>, at: Date = new Date()): Record<string, string> {
    const defaults = CATALOG_COLUMN_DEFAULTS[table] ?? {};
    const stamp: Record<string, string> = {};
    for (const [key, column] of Object.entries(fields)) {
        if (!(column in defaults)) continue;
        const v = data?.[key];
        if (v === undefined || v === null || v === '') continue;
        stamp[column] = at.toISOString();
    }
    return stamp;
}

/**
 * SQL de `UPDATE … SET metadata = <esto>` que conserva y amplía `metadata.confirmed_fields`. `replacementParam` es el
 * placeholder del `metadata` nuevo cuando el cuerpo lo reemplaza (o null para partir del actual); `stampParam`, el de las
 * columnas confirmadas ahora (o null).
 */
export function metadataWithConfirmedFieldsSql(replacementParam: string | null, stampParam: string | null): string {
    const base = replacementParam ? `${replacementParam}::jsonb` : `COALESCE(metadata, '{}'::jsonb)`;
    const kept = `COALESCE(metadata->'${CONFIRMED_FIELDS_KEY}', '{}'::jsonb)`;
    const merged = stampParam ? `${kept} || ${stampParam}::jsonb` : kept;
    if (!stampParam) {
        return `${base} || CASE WHEN metadata ? '${CONFIRMED_FIELDS_KEY}' THEN jsonb_build_object('${CONFIRMED_FIELDS_KEY}', metadata->'${CONFIRMED_FIELDS_KEY}') ELSE '{}'::jsonb END`;
    }
    return `${base} || jsonb_build_object('${CONFIRMED_FIELDS_KEY}', ${merged})`;
}
