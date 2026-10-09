import type { VerticalReadinessKey } from '@parallext/shared';
import { READINESS } from '../verticals/vertical-readiness.service';

/**
 * «The business has not published anything yet» is not «nothing matches these
 * filters».
 *
 * The catalogue readers stay published when their family has no rows
 * (`CATALOG_READ_TOOLS_WHEN_EMPTY`), so the agent can find out the catalogue is
 * empty by asking, instead of being told «search now» and «unavailable» in the
 * same prompt. This module is the other half: when one of those readers comes
 * back empty, the executor asks whether the SAME predicate readiness uses finds
 * even one row. No row at all → the result carries `catalog_empty: true` and a
 * message that tells the model what to say and what NOT to do. A row exists →
 * the empty result stays an ordinary «no matches for these filters».
 *
 * Reusing `READINESS` (not a second query) is deliberate: readiness and this
 * probe cannot disagree about what «has rows» means.
 */
export interface CatalogEmptyProbe {
    /** Readiness key whose predicate defines «the catalogue has rows». */
    readonly key: VerticalReadinessKey;
    /** Property of the tool result that holds the list. */
    readonly listKey: string;
    /** What the customer asked about, in the words the model should use. */
    readonly noun: string;
}

export const CATALOG_EMPTY_PROBES: Readonly<Record<string, CatalogEmptyProbe>> = Object.freeze({
    search_listings: { key: 'listings', listKey: 'listings', noun: 'inmuebles' },
    search_packages: { key: 'tour_packages', listKey: 'packages', noun: 'paquetes o tours' },
    search_vehicles: { key: 'vehicle_inventory', listKey: 'vehicles', noun: 'vehículos' },
    list_properties: { key: 'properties', listKey: 'properties', noun: 'alojamientos' },
    get_menu: { key: 'menu_items', listKey: 'items', noun: 'platos del menú' },
    search_products: { key: 'catalog_items', listKey: 'products', noun: 'productos' },
    get_membership_plans: { key: 'membership_plans', listKey: 'plans', noun: 'planes de membresía' },
    get_insurance_plans: { key: 'insurance_plans', listKey: 'plans', noun: 'planes de seguro' },
    list_home_services: { key: 'service_catalog', listKey: 'services', noun: 'servicios' },
    list_pet_services: { key: 'pets', listKey: 'services', noun: 'servicios' },
    list_photo_packages: { key: 'photo_sessions', listKey: 'services', noun: 'paquetes fotográficos' },
});

export function catalogEmptyMessage(noun: string): string {
    return `El negocio todavía no tiene ${noun} publicados: no es que la búsqueda no coincida con esos filtros, es que el catálogo está vacío. `
        + `Díselo al cliente con claridad y sin disculpas técnicas (nunca digas que no puedes buscar). `
        + `No inventes opciones, no pidas presupuesto, fechas ni datos personales para poder buscar. `
        + `Ofrece que alguien del equipo lo contacte cuando haya opciones (como pregunta, y pide nombre y teléfono solo si acepta).`;
}

/**
 * True when the catalogue has no row at all, false when it has one, null when
 * the lookup itself failed (an unknown is never reported as «empty»).
 */
export async function catalogHasNoRows(
    prisma: { executeInTenantSchema<T = any>(schemaName: string, sql: string, params?: unknown[]): Promise<T> },
    schemaName: string,
    key: VerticalReadinessKey,
): Promise<boolean | null> {
    const definition = READINESS[key];
    // Composite or actor-scoped predicates are not simple catalogue counts.
    if (!definition || typeof definition.from === 'function' || definition.actorScoped || definition.params) return null;
    const from = definition.from || definition.table;
    const where = definition.where ? ` WHERE ${definition.where}` : '';
    try {
        const rows = await prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT 1 AS present FROM ${from}${where} LIMIT 1`,
            [],
        );
        return !(Array.isArray(rows) && rows.length > 0);
    } catch (error: any) {
        // A table the tenant never provisioned is an empty catalogue, the same
        // reading readiness gives it.
        if (String(error?.code || '') === '42P01') return true;
        return null;
    }
}

/**
 * Marks an empty reader result as `catalog_empty` when the catalogue really is
 * empty. Anything that is not a clean, empty list is returned untouched, and so
 * is a result that already explains a date problem: «that departure already
 * passed» outranks «there is nothing yet».
 */
export async function markCatalogEmpty(
    prisma: Parameters<typeof catalogHasNoRows>[0],
    toolName: string,
    schemaName: string,
    result: any,
): Promise<any> {
    const probe = CATALOG_EMPTY_PROBES[toolName];
    if (!probe || !result || typeof result !== 'object' || Array.isArray(result)) return result;
    if (result.error || result.reason) return result;
    const list = result[probe.listKey];
    if (!Array.isArray(list) || list.length > 0) return result;
    const empty = await catalogHasNoRows(prisma, schemaName, probe.key);
    if (empty !== true) return result;
    return {
        ...result,
        catalog_empty: true,
        status: 'empty',
        message: catalogEmptyMessage(probe.noun),
    };
}
