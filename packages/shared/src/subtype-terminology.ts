/**
 * Cómo llama cada perfil a las cosas con las que trabaja.
 *
 * La terminología existía a nivel **industria**: 18 juegos de sustantivos para
 * 76 negocios. Un hotel y un alquiler vacacional comparten "Turismo" y no
 * comparten casi nada más — el primero vende habitaciones-noche y el segundo
 * una casa entera; a los dos la aplicación les decía "Propiedades". Un taller
 * y un concesionario comparten "Automotriz": uno recibe órdenes de trabajo y
 * el otro vende autos. La palabra equivocada no es cosmética: es lo que el
 * agente le dice al cliente y lo que el dueño busca en el menú.
 *
 * Sólo entran los perfiles donde el sustantivo de la industria está **mal**.
 * Un subtipo que usa bien el término de su vertical no aparece acá, y esa
 * ausencia es la señal de que no hace falta — no un olvido.
 */

export type TerminologyLanguage = 'es' | 'en' | 'pt' | 'fr';

export const TERMINOLOGY_LANGUAGES: readonly TerminologyLanguage[] =
    Object.freeze(['es', 'en', 'pt', 'fr']);

/** Un término en los cuatro idiomas. Los cuatro son obligatorios. */
export type LocalizedTerm = Readonly<Record<TerminologyLanguage, string>>;

export interface SubtypeTerminology {
    /** Lo que el negocio vende o gestiona, en singular y plural. */
    primaryObject?: LocalizedTerm;
    primaryObjectPlural?: LocalizedTerm;
    /** El hecho comercial: una estadía, una salida, una orden de trabajo. */
    transactionNoun?: LocalizedTerm;
    /** Cómo se le dice a quien está del otro lado. */
    customerNoun?: LocalizedTerm;
    customerNounPlural?: LocalizedTerm;
    /**
     * Palabras que el agente NO debe usar con el cliente de este perfil.
     *
     * No es estilo: son términos que significan otra cosa en el rubro o que
     * prometen algo que el perfil no hace. Se comparan normalizados.
     */
    avoid?: readonly string[];
}

/**
 * Clave: `industry/subtype`, la misma que usa el registro de perfiles.
 *
 * Los `avoid` se escriben en el idioma del mercado principal porque es donde
 * la confusión ocurre; el contrato de idiomas se exige sobre los sustantivos,
 * que son los que la interfaz y el prompt muestran.
 */
const TERMINOLOGY: Readonly<Record<string, SubtypeTerminology>> = Object.freeze({
    // ── Turismo: tres negocios bajo un mismo sustantivo ────────────────
    'turismo/hotel': {
        primaryObject: { es: 'Habitación', en: 'Room', pt: 'Quarto', fr: 'Chambre' },
        primaryObjectPlural: { es: 'Habitaciones', en: 'Rooms', pt: 'Quartos', fr: 'Chambres' },
        transactionNoun: { es: 'reserva', en: 'booking', pt: 'reserva', fr: 'réservation' },
        customerNoun: { es: 'huésped', en: 'guest', pt: 'hóspede', fr: 'client' },
        customerNounPlural: { es: 'huéspedes', en: 'guests', pt: 'hóspedes', fr: 'clients' },
        // Un hotel no vende "propiedades": eso es una inmobiliaria.
        avoid: ['propiedad', 'propiedades', 'inmueble'],
    },
    'turismo/alquiler_vacacional': {
        primaryObject: { es: 'Alojamiento', en: 'Rental', pt: 'Acomodação', fr: 'Logement' },
        primaryObjectPlural: { es: 'Alojamientos', en: 'Rentals', pt: 'Acomodações', fr: 'Logements' },
        transactionNoun: { es: 'estadía', en: 'stay', pt: 'estadia', fr: 'séjour' },
        customerNoun: { es: 'huésped', en: 'guest', pt: 'hóspede', fr: 'voyageur' },
        customerNounPlural: { es: 'huéspedes', en: 'guests', pt: 'hóspedes', fr: 'voyageurs' },
        avoid: ['propiedad en venta', 'inmueble'],
    },
    'turismo/tours': {
        primaryObject: { es: 'Tour', en: 'Tour', pt: 'Tour', fr: 'Excursion' },
        primaryObjectPlural: { es: 'Tours', en: 'Tours', pt: 'Tours', fr: 'Excursions' },
        transactionNoun: { es: 'salida', en: 'departure', pt: 'saída', fr: 'départ' },
        customerNoun: { es: 'viajero', en: 'traveller', pt: 'viajante', fr: 'voyageur' },
        customerNounPlural: { es: 'viajeros', en: 'travellers', pt: 'viajantes', fr: 'voyageurs' },
    },
    'turismo/agencia_viajes': {
        primaryObject: { es: 'Paquete', en: 'Package', pt: 'Pacote', fr: 'Forfait' },
        primaryObjectPlural: { es: 'Paquetes', en: 'Packages', pt: 'Pacotes', fr: 'Forfaits' },
        transactionNoun: { es: 'reserva', en: 'booking', pt: 'reserva', fr: 'réservation' },
        customerNoun: { es: 'viajero', en: 'traveller', pt: 'viajante', fr: 'voyageur' },
        customerNounPlural: { es: 'viajeros', en: 'travellers', pt: 'viajantes', fr: 'voyageurs' },
    },

    // ── Automotriz: vender un auto no es repararlo ─────────────────────
    'automotriz/taller': {
        primaryObject: { es: 'Orden de trabajo', en: 'Work order', pt: 'Ordem de serviço', fr: 'Ordre de travail' },
        primaryObjectPlural: { es: 'Órdenes de trabajo', en: 'Work orders', pt: 'Ordens de serviço', fr: 'Ordres de travail' },
        transactionNoun: { es: 'servicio', en: 'service', pt: 'serviço', fr: 'intervention' },
        // Un taller no vende autos: los atiende.
        avoid: ['prueba de manejo', 'financiación del vehículo'],
    },
    'automotriz/alquiler': {
        primaryObject: { es: 'Vehículo', en: 'Vehicle', pt: 'Veículo', fr: 'Véhicule' },
        primaryObjectPlural: { es: 'Flota', en: 'Fleet', pt: 'Frota', fr: 'Flotte' },
        transactionNoun: { es: 'alquiler', en: 'rental', pt: 'aluguel', fr: 'location' },
        customerNoun: { es: 'conductor', en: 'driver', pt: 'condutor', fr: 'conducteur' },
        customerNounPlural: { es: 'conductores', en: 'drivers', pt: 'condutores', fr: 'conducteurs' },
        avoid: ['compra del vehículo', 'prueba de manejo'],
    },
    'automotriz/repuestos': {
        primaryObject: { es: 'Repuesto', en: 'Part', pt: 'Peça', fr: 'Pièce' },
        primaryObjectPlural: { es: 'Repuestos', en: 'Parts', pt: 'Peças', fr: 'Pièces' },
        transactionNoun: { es: 'pedido', en: 'order', pt: 'pedido', fr: 'commande' },
        avoid: ['prueba de manejo'],
    },

    // ── Pet services: hospedar no es curar ─────────────────────────────
    'pet_services/guarderia': {
        primaryObject: { es: 'Estadía', en: 'Stay', pt: 'Estadia', fr: 'Séjour' },
        primaryObjectPlural: { es: 'Estadías', en: 'Stays', pt: 'Estadias', fr: 'Séjours' },
        transactionNoun: { es: 'estadía', en: 'stay', pt: 'estadia', fr: 'séjour' },
        customerNoun: { es: 'dueño', en: 'owner', pt: 'tutor', fr: 'propriétaire' },
        customerNounPlural: { es: 'dueños', en: 'owners', pt: 'tutores', fr: 'propriétaires' },
        // No es una clínica: no hay paciente, ni consulta, ni diagnóstico.
        avoid: ['paciente', 'consulta', 'diagnóstico', 'tratamiento'],
    },
    'pet_services/hotel': {
        primaryObject: { es: 'Estadía', en: 'Stay', pt: 'Estadia', fr: 'Séjour' },
        primaryObjectPlural: { es: 'Estadías', en: 'Stays', pt: 'Estadias', fr: 'Séjours' },
        transactionNoun: { es: 'estadía', en: 'stay', pt: 'estadia', fr: 'séjour' },
        customerNoun: { es: 'dueño', en: 'owner', pt: 'tutor', fr: 'propriétaire' },
        customerNounPlural: { es: 'dueños', en: 'owners', pt: 'tutores', fr: 'propriétaires' },
        avoid: ['paciente', 'consulta', 'diagnóstico', 'tratamiento'],
    },
    'pet_services/peluqueria': {
        primaryObject: { es: 'Servicio', en: 'Service', pt: 'Serviço', fr: 'Prestation' },
        primaryObjectPlural: { es: 'Servicios', en: 'Services', pt: 'Serviços', fr: 'Prestations' },
        transactionNoun: { es: 'turno', en: 'appointment', pt: 'agendamento', fr: 'rendez-vous' },
        customerNoun: { es: 'dueño', en: 'owner', pt: 'tutor', fr: 'propriétaire' },
        customerNounPlural: { es: 'dueños', en: 'owners', pt: 'tutores', fr: 'propriétaires' },
        avoid: ['paciente', 'diagnóstico', 'tratamiento'],
    },

    // ── Salud: la farmacia no atiende pacientes ────────────────────────
    'salud/farmacia': {
        primaryObject: { es: 'Producto', en: 'Product', pt: 'Produto', fr: 'Produit' },
        primaryObjectPlural: { es: 'Productos', en: 'Products', pt: 'Produtos', fr: 'Produits' },
        transactionNoun: { es: 'pedido', en: 'order', pt: 'pedido', fr: 'commande' },
        customerNoun: { es: 'cliente', en: 'customer', pt: 'cliente', fr: 'client' },
        customerNounPlural: { es: 'clientes', en: 'customers', pt: 'clientes', fr: 'clients' },
        // Llamarle paciente al que compra jabón invita a una conversación
        // clínica que la farmacia no puede tener por chat.
        avoid: ['paciente', 'consulta médica', 'diagnóstico', 'dosis recomendada'],
    },

    // ── Restaurantes: una mesa no es un pedido ─────────────────────────
    'restaurantes/comida_rapida': {
        primaryObject: { es: 'Pedido', en: 'Order', pt: 'Pedido', fr: 'Commande' },
        primaryObjectPlural: { es: 'Pedidos', en: 'Orders', pt: 'Pedidos', fr: 'Commandes' },
        transactionNoun: { es: 'pedido', en: 'order', pt: 'pedido', fr: 'commande' },
        avoid: ['reserva de mesa'],
    },
    'restaurantes/dark_kitchen': {
        primaryObject: { es: 'Pedido', en: 'Order', pt: 'Pedido', fr: 'Commande' },
        primaryObjectPlural: { es: 'Pedidos', en: 'Orders', pt: 'Pedidos', fr: 'Commandes' },
        transactionNoun: { es: 'pedido', en: 'order', pt: 'pedido', fr: 'commande' },
        // No hay salón: prometer una mesa es prometer algo que no existe.
        avoid: ['reserva de mesa', 'salón', 'mesa para'],
    },

    // ── Inmobiliaria: vender y arrendar no se dicen igual ──────────────
    'inmobiliaria/arriendo': {
        primaryObject: { es: 'Inmueble', en: 'Property', pt: 'Imóvel', fr: 'Bien' },
        primaryObjectPlural: { es: 'Inmuebles', en: 'Properties', pt: 'Imóveis', fr: 'Biens' },
        transactionNoun: { es: 'arriendo', en: 'lease', pt: 'aluguel', fr: 'location' },
        customerNoun: { es: 'interesado', en: 'prospect', pt: 'interessado', fr: 'candidat' },
        customerNounPlural: { es: 'interesados', en: 'prospects', pt: 'interessados', fr: 'candidats' },
        avoid: ['financiación', 'crédito hipotecario'],
    },

    // ── Fotografía: el planner no fotografía ───────────────────────────
    'fotografia/bodas': {
        primaryObject: { es: 'Paquete', en: 'Package', pt: 'Pacote', fr: 'Forfait' },
        primaryObjectPlural: { es: 'Paquetes', en: 'Packages', pt: 'Pacotes', fr: 'Forfaits' },
        transactionNoun: { es: 'cobertura', en: 'coverage', pt: 'cobertura', fr: 'couverture' },
    },
});

export const SUBTYPE_TERMINOLOGY: Readonly<Record<string, SubtypeTerminology>> = TERMINOLOGY;

/** Perfiles con terminología propia, para pruebas de contrato y auditoría. */
export const SUBTYPE_TERMINOLOGY_IDS: readonly string[] = Object.freeze(Object.keys(TERMINOLOGY));

export function subtypeTerminologyFor(
    industry: unknown,
    subtype: unknown,
): SubtypeTerminology | null {
    if (typeof industry !== 'string' || !industry) return null;
    if (typeof subtype !== 'string' || !subtype) return null;
    return TERMINOLOGY[`${industry.trim()}/${subtype.trim()}`] || null;
}

/**
 * El término en un idioma, con caída explícita al español.
 *
 * El contrato exige los cuatro, y una prueba lo verifica; la caída existe para
 * un idioma futuro que todavía no se tradujo, no para tapar un olvido.
 */
export function localizedTerm(
    term: LocalizedTerm | undefined,
    language: unknown,
): string | null {
    if (!term) return null;
    const code = typeof language === 'string'
        ? language.trim().slice(0, 2).toLowerCase()
        : '';
    return term[code as TerminologyLanguage] || term.es || null;
}

/** Palabras que este perfil no usa con el cliente, normalizadas. */
export function avoidedTermsFor(industry: unknown, subtype: unknown): readonly string[] {
    return subtypeTerminologyFor(industry, subtype)?.avoid || [];
}
