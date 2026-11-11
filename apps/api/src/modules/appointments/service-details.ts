/**
 * Ficha del servicio (ADR 0031, fricción 10): descripción, qué incluye, qué no
 * incluye y preparación. El dueño la escribe en «Citas › Servicios
 * disponibles»; el agente la lee en `list_services`.
 */

/** JSONB list as stored (array, or JSON text from a raw driver); anything else is empty. */
export function serviceTextList(value: unknown): string[] {
    let list: unknown = value;
    if (typeof value === 'string') {
        try { list = JSON.parse(value); } catch { list = []; }
    }
    return Array.isArray(list)
        ? list.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
        : [];
}

export interface ServiceDetailsForAgent {
    includes?: string[];
    excludes?: string[];
    preparation?: string;
    preparationRequired?: false;
}

/**
 * Lo que el agente puede afirmar de la ficha. Solo viaja lo que el dueño
 * escribió: una lista vacía no se manda, porque «no consta» no es «no
 * incluye» (OBJ.*.CATALOG: excluir solo desde `excludes`).
 */
export function serviceDetailsForAgent(row: Record<string, any>): ServiceDetailsForAgent {
    const details: ServiceDetailsForAgent = {};
    const includes = serviceTextList(row.includes);
    const excludes = serviceTextList(row.excludes);
    if (includes.length) details.includes = includes;
    if (excludes.length) details.excludes = excludes;
    const preparation = typeof row.preparation === 'string' ? row.preparation.trim() : '';
    if (row.preparation_required === false) details.preparationRequired = false;
    else if (preparation) details.preparation = preparation;
    return details;
}
