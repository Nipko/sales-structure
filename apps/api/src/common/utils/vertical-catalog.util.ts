/**
 * El CATÁLOGO de cada vertical: la tabla donde vive el objeto que el negocio
 * vende, y sin la cual sus herramientas de IA responden vacío.
 *
 * Estaba definido DOS veces y con distinto contenido: en
 * `persona.controller.ts` (para el checklist del tenant) y en
 * `vertical-analytics.service.ts` (para el detector de activación del super
 * admin). Dos listas para el mismo hecho divergen sin que nadie se entere — y
 * ya habían divergido: la segunda contaba `tour_packages` en turismo y
 * reportaba `missing: 'properties'`, así que el super admin leía que al tenant
 * le faltaban propiedades cuando lo que estaba mirando eran tours.
 *
 * `missingKey` es la clave i18n del dashboard (`gaps.missingKeys.*`) y no
 * siempre coincide con el nombre de la tabla; por eso va explícita.
 */
export interface VerticalCatalog {
    /** Tabla del schema del tenant. */
    table: string;
    /** Clave i18n para nombrar lo que falta. */
    missingKey: string;
    /** Filtro de "vivo", cuando la tabla tiene borrado lógico. */
    activeFilter?: string;
    /** Dashboard route that manages the same canonical object. */
    route: string;
}

export const VERTICAL_CATALOG: Record<string, VerticalCatalog> = {
    restaurantes: { table: 'menu_items', missingKey: 'menu_items', activeFilter: 'is_active = true', route: '/admin/menu' },
    gimnasios: { table: 'membership_plans', missingKey: 'membership_plans', activeFilter: 'is_active = true', route: '/admin/memberships' },
    education: { table: 'courses', missingKey: 'courses', activeFilter: 'is_active = true', route: '/admin/courses' },
    seguros: { table: 'insurance_plans', missingKey: 'insurance_plans', activeFilter: 'is_active = true', route: '/admin/insurance' },
    inmobiliaria: { table: 'real_estate_listings', missingKey: 'listings', activeFilter: 'is_active = true', route: '/admin/listings' },
    // Antes decía missingKey 'properties' contando tour_packages. Turismo tiene
    // DOS objetos según el sub-tipo (tours y alojamiento); el catálogo base que
    // decide si el tenant está activado son los paquetes.
    turismo: { table: 'tour_packages', missingKey: 'tour_packages', activeFilter: 'is_active = true', route: '/admin/tours' },
    servicios_hogar: { table: 'services', missingKey: 'services', activeFilter: 'is_active = true', route: '/admin/appointments' },
    veterinaria: { table: 'pets', missingKey: 'pets', activeFilter: 'is_active = true', route: '/admin/pets' },
    pet_services: { table: 'pets', missingKey: 'pets', activeFilter: 'is_active = true', route: '/admin/pets' },
    fotografia: { table: 'photo_sessions', missingKey: 'photo_sessions', route: '/admin/photo-sessions' },
    // Faltaban las tres. Automotriz y retail son las que más pesa: su vertical
    // entera es el catálogo, y el detector no las miraba.
    automotriz: { table: 'vehicles', missingKey: 'vehicles', route: '/admin/vehicles' },
    retail: { table: 'products', missingKey: 'products', activeFilter: 'is_active = true', route: '/admin/inventory' },
    otro: { table: 'products', missingKey: 'products', activeFilter: 'is_active = true', route: '/admin/inventory' },
};

const SUBTYPE_CATALOG: Record<string, VerticalCatalog | null> = {
    'turismo/hotel': { table: 'properties', missingKey: 'properties', activeFilter: 'is_active = true', route: '/admin/properties' },
    'turismo/alquiler_vacacional': { table: 'properties', missingKey: 'properties', activeFilter: 'is_active = true', route: '/admin/properties' },
    'salud/farmacia': { table: 'products', missingKey: 'products', activeFilter: 'is_active = true', route: '/admin/inventory' },
    // Read-only compatibility for tenants provisioned before boutique moved out
    // of the selectable beauty subtypes.
    'moda_belleza/boutique': { table: 'products', missingKey: 'products', activeFilter: 'is_active = true', route: '/admin/inventory' },
    // A workshop creates its operational register during intake. Requiring a
    // dealership vehicle catalogue first would block the exact first order
    // that activates the module.
    'automotriz/taller': null,
    'automotriz/repuestos': { table: 'products', missingKey: 'products', activeFilter: 'is_active = true', route: '/admin/inventory' },
};

/** La tabla de catálogo efectiva de una industria/subtipo, o null si no aplica. */
export function getVerticalCatalog(
    industry?: string | null,
    subType?: string | null,
): VerticalCatalog | null {
    if (!industry) return null;
    const canonicalIndustry = industry.toLowerCase();
    const canonicalSubtype = subType?.toLowerCase() || null;
    if (canonicalSubtype) {
        const subtypeKey = `${canonicalIndustry}/${canonicalSubtype}`;
        if (Object.prototype.hasOwnProperty.call(SUBTYPE_CATALOG, subtypeKey)) {
            return SUBTYPE_CATALOG[subtypeKey];
        }
    }
    return VERTICAL_CATALOG[canonicalIndustry] || null;
}
