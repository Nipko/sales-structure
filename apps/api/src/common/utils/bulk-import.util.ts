/**
 * Import masivo compartido: recorre las filas de un CSV/XLSX ya parseado y las
 * crea una por una reutilizando el `create` que ya existe en cada módulo.
 *
 * Por qué fila por fila y no un INSERT múltiple: cada módulo tiene su propia
 * validación, sus defaults y sus casts (`::jsonb`, `::uuid`), y duplicarlos acá
 * para ganar velocidad es exactamente cómo se termina con dos definiciones que
 * divergen. Un padrón de 200 miembros importa en segundos igual.
 *
 * Por qué NO aborta en el primer error: quien sube 200 filas casi siempre tiene
 * 3 mal. Cortar todo obliga a arreglar el archivo a ciegas y reintentar de
 * cero; devolver qué fila falló y por qué convierte el import en algo que se
 * corrige de a poco. Es la diferencia entre una herramienta usable y una que se
 * abandona en el primer intento — que es justo el punto de abandono que esto
 * viene a resolver.
 *
 * PgBouncer está en modo transaction, así que no hay transacción que abarque
 * las N filas: el resultado parcial es real y hay que reportarlo como tal, no
 * fingir atomicidad.
 */

export const BULK_IMPORT_MAX_ROWS = 500;

export interface BulkImportResult {
    created: number;
    failed: number;
    /** Fila (1-based, como la ve el usuario en su planilla) + motivo. */
    errors: Array<{ row: number; error: string }>;
}

export async function bulkImportRows<T>(
    rows: T[] | undefined,
    createOne: (row: T) => Promise<unknown>,
    opts?: { maxRows?: number; maxErrors?: number },
): Promise<BulkImportResult> {
    const max = opts?.maxRows ?? BULK_IMPORT_MAX_ROWS;
    // Tope de errores reportados: un archivo con las columnas mal mapeadas
    // falla en las 500 filas y devolver 500 mensajes idénticos no ayuda a
    // nadie — y es una respuesta enorme por un error de un solo click.
    const maxErrors = opts?.maxErrors ?? 20;

    if (!Array.isArray(rows) || rows.length === 0) {
        return { created: 0, failed: 0, errors: [] };
    }
    if (rows.length > max) {
        throw new Error(`Máximo ${max} filas por importación. El archivo trae ${rows.length}.`);
    }

    const result: BulkImportResult = { created: 0, failed: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
        try {
            await createOne(rows[i]);
            result.created++;
        } catch (e: any) {
            result.failed++;
            if (result.errors.length < maxErrors) {
                result.errors.push({
                    row: i + 1,
                    // El mensaje del driver puede traer el nombre del schema y
                    // fragmentos de SQL. Se recorta y se deja lo legible.
                    error: String(e?.message || 'error desconocido').slice(0, 200),
                });
            }
        }
    }

    return result;
}
