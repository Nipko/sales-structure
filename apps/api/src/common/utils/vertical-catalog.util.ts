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
}

export const VERTICAL_CATALOG: Record<string, VerticalCatalog> = {
    restaurantes: { table: 'menu_items', missingKey: 'menu_items', activeFilter: 'is_active = true' },
    gimnasios: { table: 'membership_plans', missingKey: 'membership_plans', activeFilter: 'is_active = true' },
    education: { table: 'courses', missingKey: 'courses', activeFilter: 'is_active = true' },
    seguros: { table: 'insurance_plans', missingKey: 'insurance_plans', activeFilter: 'is_active = true' },
    inmobiliaria: { table: 'real_estate_listings', missingKey: 'listings', activeFilter: 'is_active = true' },
    // Antes decía missingKey 'properties' contando tour_packages. Turismo tiene
    // DOS objetos según el sub-tipo (tours y alojamiento); el catálogo base que
    // decide si el tenant está activado son los paquetes.
    turismo: { table: 'tour_packages', missingKey: 'tour_packages', activeFilter: 'is_active = true' },
    servicios_hogar: { table: 'services', missingKey: 'services', activeFilter: 'is_active = true' },
    veterinaria: { table: 'pets', missingKey: 'pets', activeFilter: 'is_active = true' },
    pet_services: { table: 'pets', missingKey: 'pets', activeFilter: 'is_active = true' },
    fotografia: { table: 'photo_sessions', missingKey: 'photo_sessions' },
    // Faltaban las tres. Automotriz y retail son las que más pesa: su vertical
    // entera es el catálogo, y el detector no las miraba.
    automotriz: { table: 'vehicles', missingKey: 'vehicles' },
    retail: { table: 'products', missingKey: 'products', activeFilter: 'is_active = true' },
    otro: { table: 'products', missingKey: 'products', activeFilter: 'is_active = true' },
};

/** La tabla de catálogo de una industria, o null si esa vertical no tiene una propia. */
export function getVerticalCatalog(industry?: string | null): VerticalCatalog | null {
    if (!industry) return null;
    return VERTICAL_CATALOG[industry.toLowerCase()] || null;
}
