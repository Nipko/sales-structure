/**
 * Lo que un perfil promete, con qué datos y hasta dónde.
 *
 * Hasta acá cada pieza de la verdad de un subtipo vivía en su propio registro:
 * el manifiesto sabe qué capacidades y rutas tiene, la terminología sabe cómo
 * llama a las cosas, el perfil comercial sabe hasta dónde se puede vender, el
 * eval pack sabe qué medirle. Ninguno sabía **qué conversaciones tiene que
 * saber sostener** — qué intenciones reconoce, qué datos necesita para cada
 * una, cuáles de esos datos son sensibles, cuáles se guardan y cuáles se
 * olvidan al terminar el turno, qué confirma antes de comprometerse, y qué hace
 * cuando no puede.
 *
 * Eso no estaba en ningún lado, y por eso cada vertical lo resolvía en el
 * prompt: texto libre, distinto en cada perfil, imposible de verificar.
 *
 * ── Por qué se DERIVA en vez de escribirse ──────────────────────────────
 *
 * Un contrato inventado a mano para 76 perfiles es 76 oportunidades de escribir
 * una promesa que el runtime no cumple. Todo lo que este módulo puede deducir
 * de un registro existente, lo deduce; lo que no se puede deducir queda
 * marcado como hueco explícito (`unresolved`) en vez de rellenarse con algo
 * plausible. Un hueco visible se cierra; uno relleno se olvida.
 *
 * Por eso todos nacen en `draft`: un contrato derivado describe lo que el
 * sistema **hace hoy**, no lo que se certificó que hace. Promoverlo exige
 * evidencia, y de eso se ocupa `CertificationEvidenceV2`.
 */

import {
    resolveVerticalCapabilityManifest,
    type ResolvedVerticalCapabilityManifest,
    type VerticalToolGroup,
} from './vertical-capability-manifest';
import {
    listSubtypeExperienceProfileIds,
    resolveSubtypeExperienceProfile,
    type ResolvedSubtypeExperienceProfile,
} from './subtype-experience-profile';
import {
    subtypeTerminologyFor,
    TERMINOLOGY_LANGUAGES,
    type TerminologyLanguage,
} from './subtype-terminology';

export const VERTICAL_DOMAIN_CONTRACT_VERSION = 2 as const;

// ── SlotSchema ───────────────────────────────────────────────────────────

export type SlotType =
    | 'text' | 'number' | 'boolean'
    | 'date' | 'time' | 'datetime'
    | 'money' | 'phone' | 'email'
    | 'enum' | 'reference';

/**
 * Qué tan delicado es el dato. Decide si puede quedar en el historial, si
 * viaja al proveedor de LLM y si hace falta verificar identidad para leerlo.
 */
export type SlotSensitivity =
    /** Se puede decir en voz alta: un servicio, una fecha. */
    | 'public'
    /** Identifica a una persona: nombre, teléfono, correo. */
    | 'personal'
    /** Su filtración daña: dirección, documento, datos de pago. */
    | 'sensitive'
    /** Lo regula una norma: salud, seguros, financiero. */
    | 'regulated';

/** De dónde sale el valor. `derived` nunca se le pregunta al cliente. */
export type SlotSource = 'customer' | 'tool' | 'derived' | 'tenant_config';

/**
 * Cuánto vive.
 *
 * `turn` es lo que se usa y se descarta; `conversation` sobrevive el hilo;
 * `record` queda en una tabla; `never` no se guarda en ningún lado —el caso de
 * un dato que hace falta para decidir y no para archivar—.
 */
export type SlotPersistence = 'turn' | 'conversation' | 'record' | 'never';

export interface SlotValidator {
    /** Expresión regular, como texto: el contrato viaja en JSON. */
    pattern?: string;
    min?: number;
    max?: number;
    /** Valores admitidos cuando el tipo es `enum`. */
    values?: readonly string[];
}

export interface SlotSchema {
    key: string;
    type: SlotType;
    required: boolean;
    sensitivity: SlotSensitivity;
    source: SlotSource;
    persistence: SlotPersistence;
    validator?: SlotValidator;
    /** Se le repite al cliente antes de usarlo. Para lo que no se puede deshacer. */
    confirm?: boolean;
}

// ── IntentContract ───────────────────────────────────────────────────────

/** Qué se hace cuando la intención no se puede completar. */
export type IntentFallback =
    /** Contestar con lo que se sabe y cerrar. */
    | 'answer'
    /** Pedir el dato que falta. */
    | 'ask'
    /** Pasar a una persona. */
    | 'handoff';

export type IntentConfirmation = 'none' | 'summary' | 'explicit';

export interface IntentContract {
    key: string;
    /** Qué quiere el cliente, en una línea. */
    description: string;
    slots: readonly SlotSchema[];
    /** Las tools que esta intención puede necesitar, en orden. */
    toolPlan: readonly string[];
    confirmation: IntentConfirmation;
    fallback: IntentFallback;
    /** Cómo puede terminar. El último estado es siempre observable. */
    states: readonly string[];
    /** True cuando completarla compromete al negocio. */
    commits: boolean;
}

// ── NavigationPolicy ─────────────────────────────────────────────────────

export interface NavigationPolicy {
    /** Rutas del panel que este perfil usa. Salen del manifiesto. */
    surfaces: readonly string[];
    /**
     * A dónde puede llevar un objeto mencionado en la conversación.
     *
     * Un deep link a una ruta que el perfil no tiene es un callejón sin
     * salida con permisos: el agente manda al dueño a una pantalla que su
     * propio menú no muestra.
     */
    deepLinks: readonly { kind: string; route: string }[];
}

// ── VerticalPromptContractV2 ─────────────────────────────────────────────

export interface VerticalPromptContractV2 {
    /** Hasta dónde llega este perfil hoy. Sale del perfil comercial. */
    scope: string;
    /** Qué tiene que decir de sí mismo, siempre. */
    disclosure: readonly string[];
    /** Lo que SÍ puede afirmar. Nada fuera de esta lista es afirmable. */
    claims: readonly string[];
    /** Lo que este negocio NO hace. Sale de las exclusiones del perfil. */
    notOffered: readonly string[];
    /** Los sustantivos del rubro y las palabras prohibidas. */
    terminology: {
        primaryObject?: Readonly<Record<TerminologyLanguage, string>>;
        customerNoun?: Readonly<Record<TerminologyLanguage, string>>;
        transactionNoun?: Readonly<Record<TerminologyLanguage, string>>;
        avoid: readonly string[];
    };
    languages: readonly TerminologyLanguage[];
}

// ── CertificationEvidenceV2 ──────────────────────────────────────────────

export type CertificationStatus = 'draft' | 'in_review' | 'certified' | 'blocked';

export interface CertificationRequirement {
    key: string;
    /** Qué hay que demostrar, en una línea que se pueda verificar. */
    statement: string;
    satisfied: boolean;
    /** Dónde está la evidencia, cuando existe. */
    evidence?: string;
}

export interface CertificationEvidenceV2 {
    status: CertificationStatus;
    requirements: readonly CertificationRequirement[];
    /** Por qué no está certificado. Vacío sólo cuando `status === 'certified'`. */
    blockers: readonly string[];
}

// ── El contrato completo ─────────────────────────────────────────────────

export interface VerticalDomainContractV2 {
    contractVersion: typeof VERTICAL_DOMAIN_CONTRACT_VERSION;
    profileId: string;
    industry: string;
    subtype: string;
    status: CertificationStatus;
    prompt: VerticalPromptContractV2;
    intents: readonly IntentContract[];
    navigation: NavigationPolicy;
    certification: CertificationEvidenceV2;
    /** Lo que no se pudo derivar. Un hueco visible se cierra; uno relleno se olvida. */
    unresolved: readonly string[];
}

// ── Derivación ───────────────────────────────────────────────────────────

/** Slots que aparecen en cualquier operación con una persona del otro lado. */
const CONTACT_SLOTS: readonly SlotSchema[] = Object.freeze([
    Object.freeze<SlotSchema>({
        key: 'customer_name', type: 'text', required: true,
        sensitivity: 'personal', source: 'customer', persistence: 'record',
        validator: { min: 2, max: 120 },
    }),
    Object.freeze<SlotSchema>({
        key: 'customer_phone', type: 'phone', required: false,
        sensitivity: 'personal', source: 'customer', persistence: 'record',
    }),
]);

const DATETIME_SLOT: SlotSchema = Object.freeze({
    key: 'starts_at', type: 'datetime', required: true,
    sensitivity: 'public', source: 'customer', persistence: 'record',
    confirm: true,
});

/**
 * Las intenciones que concede cada familia de tools.
 *
 * Se derivan del manifiesto y no de una lista por subtipo: la familia de tools
 * ES la evidencia de que el runtime puede sostener esa conversación. Declarar
 * una intención sin la familia que la ejecuta sería prometer por escrito lo que
 * el runtime no puede hacer — el defecto que este contrato viene a cerrar.
 */
const INTENTS_BY_TOOL_GROUP: Readonly<Record<string, readonly IntentContract[]>> = Object.freeze({
    faqs: Object.freeze([Object.freeze<IntentContract>({
        key: 'ask_question',
        description: 'El cliente pregunta algo que el negocio ya respondió antes.',
        slots: Object.freeze([Object.freeze<SlotSchema>({
            key: 'question', type: 'text', required: true,
            sensitivity: 'public', source: 'customer', persistence: 'turn',
        })]),
        toolPlan: Object.freeze(['search_faqs', 'search_knowledge_base']),
        confirmation: 'none',
        fallback: 'handoff',
        states: Object.freeze(['answered', 'not_found', 'handed_off']),
        commits: false,
    })]),
    appointments: Object.freeze([
        Object.freeze<IntentContract>({
            key: 'book_appointment',
            description: 'El cliente quiere reservar un turno.',
            slots: Object.freeze([
                Object.freeze<SlotSchema>({
                    key: 'service_id', type: 'reference', required: true,
                    sensitivity: 'public', source: 'tool', persistence: 'record',
                }),
                DATETIME_SLOT,
                ...CONTACT_SLOTS,
            ]),
            toolPlan: Object.freeze(['list_services', 'check_availability', 'create_appointment']),
            confirmation: 'explicit',
            fallback: 'handoff',
            states: Object.freeze(['collecting', 'confirming', 'booked', 'handed_off']),
            commits: true,
        }),
        Object.freeze<IntentContract>({
            key: 'cancel_appointment',
            description: 'El cliente quiere cancelar un turno que ya tiene.',
            slots: Object.freeze([Object.freeze<SlotSchema>({
                key: 'appointment_id', type: 'reference', required: true,
                sensitivity: 'personal', source: 'tool', persistence: 'record',
                confirm: true,
            })]),
            // `list_my_appointments` no existe: la tool se llama
            // `list_customer_appointments`. Segundo plan que nombraba una tool
            // inexistente — el plan describe y no ejecuta, así que el error no
            // rompía nada visible.
            toolPlan: Object.freeze(['list_customer_appointments', 'cancel_appointment']),
            confirmation: 'explicit',
            fallback: 'handoff',
            states: Object.freeze(['identifying', 'confirming', 'cancelled', 'handed_off']),
            commits: true,
        }),
    ]),
    catalog: Object.freeze([
        Object.freeze<IntentContract>({
            key: 'browse_catalog',
            description: 'El cliente pregunta qué hay y a qué precio.',
            slots: Object.freeze([Object.freeze<SlotSchema>({
                key: 'query', type: 'text', required: false,
                sensitivity: 'public', source: 'customer', persistence: 'turn',
            })]),
            // `get_product_details` no existe: la tool se llama `get_product`.
            // Un plan que nombra una tool inexistente es una promesa que nadie
            // puede cumplir, y no lo veía nadie porque el plan no se ejecuta —
            // describe. `domain-contract-tool-plan.spec.ts` cierra esa puerta.
            toolPlan: Object.freeze(['search_products', 'get_product', 'check_stock']),
            confirmation: 'none',
            fallback: 'answer',
            states: Object.freeze(['listed', 'empty', 'handed_off']),
            commits: false,
        }),
        // ═══ EL CATÁLOGO SE PODÍA MIRAR Y NO COMPRAR ═══
        //
        // `catalog` sólo declaraba una intención de navegación. Los seis
        // perfiles de retail y repuestos —cuyo alcance comercial dice que
        // operan— quedaban marcados `scope_without_committing_intent`: el
        // perfil promete cerrar y ninguna intención se compromete a nada.
        //
        // Y la tool que cierra **ya existía**: `place_catalog_order`. Era el
        // paso de cierre del rubro, construido y sin ninguna intención que lo
        // nombrara.
        Object.freeze<IntentContract>({
            key: 'place_catalog_order',
            description: 'El cliente quiere comprar lo que vio en el catálogo.',
            slots: Object.freeze([
                Object.freeze<SlotSchema>({
                    key: 'items', type: 'reference', required: true,
                    sensitivity: 'public', source: 'customer', persistence: 'record',
                }),
                Object.freeze<SlotSchema>({
                    key: 'delivery_address', type: 'text', required: false,
                    sensitivity: 'personal', source: 'customer', persistence: 'record',
                    confirm: true,
                }),
                ...CONTACT_SLOTS,
            ]),
            // El stock se consulta ANTES de comprometer: vender lo que no hay
            // es la forma más cara de cerrar una venta.
            toolPlan: Object.freeze(['get_product', 'check_stock', 'place_catalog_order']),
            confirmation: 'explicit',
            fallback: 'handoff',
            states: Object.freeze(['collecting', 'confirming', 'ordered', 'handed_off']),
            commits: true,
        }),
    ]),
    // ═══ LOS QUINCE GRUPOS QUE NO DECLARABAN NINGUNA INTENCIÓN ═══
    //
    // El registro tenía cuatro entradas: `faqs`, `appointments`, `catalog` y
    // `payments`. Los otros quince grupos verticales —los que definen lo que
    // cada industria realmente hace— derivaban un contrato **sin ninguna
    // intención propia**, así que un hotel, una clínica, una aseguradora o un
    // gimnasio se describían con el vocabulario de "preguntar algo" y nada más.
    //
    // La consecuencia medible: 28 de los 76 perfiles quedaban marcados
    // `scope_without_committing_intent` — su alcance comercial dice que
    // reservan u operan, y ninguna intención declarada se compromete a nada. El
    // perfil prometía más de lo que su contrato podía sostener.
    //
    // Cada grupo declara aquí lo mismo: qué quiere el cliente, qué datos hacen
    // falta, **qué tools se usan y en qué orden**, cómo se confirma, cómo puede
    // terminar y si compromete al negocio. El plan de tools nombra tools que
    // existen de verdad: `domain-contract-tool-plan.spec.ts` lo verifica contra
    // el registro de políticas, porque un plan que nombra una tool inexistente
    // es una promesa que nadie puede cumplir.

    // ── Alojamiento: estadías ────────────────────────────────────────────
    properties: Object.freeze([
        Object.freeze<IntentContract>({
            key: 'book_stay',
            description: 'El huésped quiere reservar una estadía.',
            slots: Object.freeze([
                Object.freeze<SlotSchema>({
                    key: 'property_id', type: 'reference', required: true,
                    sensitivity: 'public', source: 'tool', persistence: 'record',
                }),
                Object.freeze<SlotSchema>({
                    key: 'check_in', type: 'date', required: true,
                    sensitivity: 'public', source: 'customer', persistence: 'record',
                }),
                Object.freeze<SlotSchema>({
                    key: 'check_out', type: 'date', required: true,
                    sensitivity: 'public', source: 'customer', persistence: 'record',
                }),
                Object.freeze<SlotSchema>({
                    key: 'guests', type: 'number', required: true,
                    sensitivity: 'public', source: 'customer', persistence: 'record',
                }),
                ...CONTACT_SLOTS,
            ]),
            toolPlan: Object.freeze([
                'list_properties', 'check_property_availability', 'create_property_booking',
            ]),
            confirmation: 'explicit',
            fallback: 'handoff',
            states: Object.freeze(['collecting', 'confirming', 'booked', 'handed_off']),
            commits: true,
        }),
        Object.freeze<IntentContract>({
            key: 'stay_logistics',
            description: 'El huésped pregunta cómo entrar, dónde queda o qué incluye.',
            slots: Object.freeze([Object.freeze<SlotSchema>({
                key: 'booking_id', type: 'reference', required: false,
                sensitivity: 'personal', source: 'tool', persistence: 'record',
            })]),
            toolPlan: Object.freeze([
                'get_property_details', 'list_my_property_bookings', 'get_check_in_instructions',
            ]),
            confirmation: 'none',
            fallback: 'handoff',
            states: Object.freeze(['answered', 'not_found', 'handed_off']),
            commits: false,
        }),
    ]),

    // ── Turismo: paquetes y salidas ──────────────────────────────────────
    tours: Object.freeze([Object.freeze<IntentContract>({
        key: 'book_tour',
        description: 'El cliente quiere reservar una salida o paquete.',
        slots: Object.freeze([
            Object.freeze<SlotSchema>({
                key: 'package_id', type: 'reference', required: true,
                sensitivity: 'public', source: 'tool', persistence: 'record',
            }),
            DATETIME_SLOT,
            Object.freeze<SlotSchema>({
                key: 'travellers', type: 'number', required: true,
                sensitivity: 'public', source: 'customer', persistence: 'record',
            }),
            ...CONTACT_SLOTS,
        ]),
        toolPlan: Object.freeze([
            'search_packages', 'check_package_availability', 'create_tour_booking',
        ]),
        confirmation: 'explicit',
        fallback: 'handoff',
        states: Object.freeze(['collecting', 'confirming', 'booked', 'handed_off']),
        commits: true,
    })]),

    // ── Salud: planes de tratamiento ─────────────────────────────────────
    //
    // No compromete: el plan lo define un profesional. El agente informa en qué
    // punto está, y proponerlo o cambiarlo NO es algo que pueda hacer por chat.
    treatments: Object.freeze([Object.freeze<IntentContract>({
        key: 'treatment_status',
        description: 'El paciente pregunta en qué punto está su tratamiento.',
        slots: Object.freeze([Object.freeze<SlotSchema>({
            key: 'patient_reference', type: 'reference', required: true,
            sensitivity: 'sensitive', source: 'derived', persistence: 'record',
            confirm: true,
        })]),
        toolPlan: Object.freeze(['get_treatment_plan', 'list_upcoming_sessions']),
        confirmation: 'none',
        fallback: 'handoff',
        states: Object.freeze(['answered', 'not_found', 'handed_off']),
        commits: false,
    })]),

    // ── Inmobiliaria: propiedades en venta o alquiler ────────────────────
    //
    // Tampoco compromete: mostrar una propiedad no la reserva, y el cierre
    // inmobiliario pasa por una persona en todos los casos.
    realEstate: Object.freeze([Object.freeze<IntentContract>({
        key: 'find_listing',
        description: 'El cliente busca una propiedad con ciertas características.',
        slots: Object.freeze([
            Object.freeze<SlotSchema>({
                key: 'operation', type: 'enum', required: true,
                sensitivity: 'public', source: 'customer', persistence: 'turn',
            }),
            Object.freeze<SlotSchema>({
                key: 'zone', type: 'text', required: false,
                sensitivity: 'public', source: 'customer', persistence: 'turn',
            }),
            Object.freeze<SlotSchema>({
                key: 'budget', type: 'number', required: false,
                sensitivity: 'personal', source: 'customer', persistence: 'record',
            }),
        ]),
        toolPlan: Object.freeze(['search_listings', 'get_listing_details', 'send_listing_image']),
        confirmation: 'none',
        fallback: 'handoff',
        states: Object.freeze(['listed', 'empty', 'handed_off']),
        commits: false,
    })]),

    // ── Restaurantes: pedidos ────────────────────────────────────────────
    restaurants: Object.freeze([
        Object.freeze<IntentContract>({
            key: 'place_food_order',
            description: 'El cliente quiere pedir comida.',
            slots: Object.freeze([
                Object.freeze<SlotSchema>({
                    key: 'items', type: 'reference', required: true,
                    sensitivity: 'public', source: 'customer', persistence: 'record',
                }),
                Object.freeze<SlotSchema>({
                    key: 'delivery_address', type: 'text', required: false,
                    sensitivity: 'personal', source: 'customer', persistence: 'record',
                    confirm: true,
                }),
                ...CONTACT_SLOTS,
            ]),
            toolPlan: Object.freeze(['get_menu', 'get_promotions', 'place_order']),
            confirmation: 'explicit',
            fallback: 'handoff',
            states: Object.freeze(['collecting', 'confirming', 'placed', 'handed_off']),
            commits: true,
        }),
        Object.freeze<IntentContract>({
            key: 'track_food_order',
            description: 'El cliente pregunta por un pedido que ya hizo.',
            slots: Object.freeze([Object.freeze<SlotSchema>({
                key: 'order_id', type: 'reference', required: true,
                sensitivity: 'personal', source: 'tool', persistence: 'record',
            })]),
            toolPlan: Object.freeze(['list_my_orders', 'check_order_status']),
            confirmation: 'none',
            fallback: 'handoff',
            states: Object.freeze(['answered', 'not_found', 'handed_off']),
            commits: false,
        }),
    ]),

    // ── Automotriz: vehículos y pruebas de manejo ────────────────────────
    vehicles: Object.freeze([Object.freeze<IntentContract>({
        key: 'schedule_test_drive',
        description: 'El cliente quiere probar un vehículo.',
        slots: Object.freeze([
            Object.freeze<SlotSchema>({
                key: 'vehicle_id', type: 'reference', required: true,
                sensitivity: 'public', source: 'tool', persistence: 'record',
            }),
            DATETIME_SLOT,
            ...CONTACT_SLOTS,
        ]),
        toolPlan: Object.freeze([
            'search_vehicles', 'get_vehicle_details', 'schedule_test_drive',
        ]),
        confirmation: 'explicit',
        fallback: 'handoff',
        states: Object.freeze(['collecting', 'confirming', 'scheduled', 'handed_off']),
        commits: true,
    })]),

    // ── Educación: cursos e inscripciones ────────────────────────────────
    education: Object.freeze([Object.freeze<IntentContract>({
        key: 'enrol_student',
        description: 'El interesado quiere inscribirse en un curso.',
        slots: Object.freeze([
            Object.freeze<SlotSchema>({
                key: 'course_id', type: 'reference', required: true,
                sensitivity: 'public', source: 'tool', persistence: 'record',
            }),
            Object.freeze<SlotSchema>({
                key: 'student_name', type: 'text', required: true,
                sensitivity: 'personal', source: 'customer', persistence: 'record',
            }),
            ...CONTACT_SLOTS,
        ]),
        toolPlan: Object.freeze(['get_courses', 'get_course_schedule', 'enroll_student']),
        confirmation: 'explicit',
        fallback: 'handoff',
        states: Object.freeze(['collecting', 'confirming', 'enrolled', 'handed_off']),
        commits: true,
    })]),

    // ── Servicios profesionales: estado de un caso ───────────────────────
    //
    // Un estudio no cierra un caso por chat: informa. El scope de estos
    // perfiles es de captación o calificación, y su intención lo refleja.
    professionalServices: Object.freeze([Object.freeze<IntentContract>({
        key: 'case_status',
        description: 'El cliente pregunta cómo va su caso o expediente.',
        slots: Object.freeze([Object.freeze<SlotSchema>({
            key: 'case_reference', type: 'reference', required: true,
            sensitivity: 'sensitive', source: 'derived', persistence: 'record',
            confirm: true,
        })]),
        toolPlan: Object.freeze(['get_case_status']),
        confirmation: 'none',
        fallback: 'handoff',
        states: Object.freeze(['answered', 'not_found', 'handed_off']),
        commits: false,
    })]),

    // ── Veterinaria: la ficha del animal ─────────────────────────────────
    pets: Object.freeze([
        Object.freeze<IntentContract>({
            key: 'register_pet',
            description: 'El dueño registra a su animal o actualiza su ficha.',
            slots: Object.freeze([
                Object.freeze<SlotSchema>({
                    key: 'pet_name', type: 'text', required: true,
                    sensitivity: 'personal', source: 'customer', persistence: 'record',
                }),
                Object.freeze<SlotSchema>({
                    key: 'species', type: 'enum', required: true,
                    sensitivity: 'public', source: 'customer', persistence: 'record',
                }),
            ]),
            toolPlan: Object.freeze(['list_pets_for_contact', 'register_pet', 'update_pet']),
            confirmation: 'explicit',
            fallback: 'handoff',
            states: Object.freeze(['collecting', 'registered', 'handed_off']),
            commits: true,
        }),
        Object.freeze<IntentContract>({
            key: 'pet_emergency',
            description: 'El dueño describe una urgencia con su animal.',
            slots: Object.freeze([Object.freeze<SlotSchema>({
                key: 'symptoms', type: 'text', required: true,
                sensitivity: 'sensitive', source: 'customer', persistence: 'record',
                confirm: true,
            })]),
            // Termina SIEMPRE en una persona: el triage ordena la urgencia, no
            // la resuelve, y decir lo contrario en una urgencia cuesta caro.
            toolPlan: Object.freeze(['triage_pet_emergency']),
            confirmation: 'none',
            fallback: 'handoff',
            states: Object.freeze(['triaged', 'handed_off']),
            commits: false,
        }),
    ]),

    // ── Gimnasios: clases y membresías ───────────────────────────────────
    gyms: Object.freeze([Object.freeze<IntentContract>({
        key: 'book_class',
        description: 'El socio quiere anotarse a una clase.',
        slots: Object.freeze([
            Object.freeze<SlotSchema>({
                key: 'class_id', type: 'reference', required: true,
                sensitivity: 'public', source: 'tool', persistence: 'record',
            }),
            Object.freeze<SlotSchema>({
                key: 'membership_reference', type: 'reference', required: false,
                sensitivity: 'personal', source: 'derived', persistence: 'record',
            }),
        ]),
        toolPlan: Object.freeze(['get_class_schedule', 'get_my_membership', 'book_class']),
        confirmation: 'explicit',
        fallback: 'handoff',
        states: Object.freeze(['collecting', 'confirming', 'booked', 'handed_off']),
        commits: true,
    })]),

    // ── Seguros: cotización y siniestros ─────────────────────────────────
    insurance: Object.freeze([
        Object.freeze<IntentContract>({
            key: 'quote_policy',
            description: 'El interesado quiere saber cuánto le sale una póliza.',
            slots: Object.freeze([
                Object.freeze<SlotSchema>({
                    key: 'plan_id', type: 'reference', required: true,
                    sensitivity: 'public', source: 'tool', persistence: 'record',
                }),
                Object.freeze<SlotSchema>({
                    key: 'risk_profile', type: 'text', required: true,
                    sensitivity: 'sensitive', source: 'customer', persistence: 'record',
                    confirm: true,
                }),
                ...CONTACT_SLOTS,
            ]),
            toolPlan: Object.freeze(['get_insurance_plans', 'calculate_quote']),
            confirmation: 'explicit',
            fallback: 'handoff',
            states: Object.freeze(['collecting', 'quoted', 'handed_off']),
            commits: true,
        }),
        Object.freeze<IntentContract>({
            key: 'file_claim',
            description: 'El asegurado reporta un siniestro.',
            slots: Object.freeze([
                Object.freeze<SlotSchema>({
                    key: 'policy_number', type: 'reference', required: true,
                    sensitivity: 'sensitive', source: 'derived', persistence: 'record',
                    confirm: true,
                }),
                Object.freeze<SlotSchema>({
                    key: 'incident_description', type: 'text', required: true,
                    sensitivity: 'sensitive', source: 'customer', persistence: 'record',
                    confirm: true,
                }),
            ]),
            // La llave de identidad va primero: lo que sigue son datos del
            // asegurado y no se leen sin verificar quién pregunta.
            toolPlan: Object.freeze([
                'request_identity_code', 'verify_identity_code',
                'check_policy_status', 'file_claim',
            ]),
            confirmation: 'explicit',
            fallback: 'handoff',
            states: Object.freeze(['identifying', 'collecting', 'filed', 'handed_off']),
            commits: true,
        }),
    ]),

    // ── Servicios a domicilio: pedidos de visita ─────────────────────────
    homeServices: Object.freeze([Object.freeze<IntentContract>({
        key: 'request_service',
        description: 'El cliente pide que vayan a su casa a resolver algo.',
        slots: Object.freeze([
            Object.freeze<SlotSchema>({
                key: 'problem_description', type: 'text', required: true,
                sensitivity: 'public', source: 'customer', persistence: 'record',
            }),
            Object.freeze<SlotSchema>({
                key: 'address', type: 'text', required: true,
                sensitivity: 'personal', source: 'customer', persistence: 'record',
                confirm: true,
            }),
            DATETIME_SLOT,
            ...CONTACT_SLOTS,
        ]),
        toolPlan: Object.freeze(['create_service_request', 'check_request_status']),
        confirmation: 'explicit',
        fallback: 'handoff',
        states: Object.freeze(['collecting', 'confirming', 'requested', 'handed_off']),
        commits: true,
    })]),

    // ── Servicios para mascotas: guardería y peluquería ──────────────────
    petServices: Object.freeze([Object.freeze<IntentContract>({
        key: 'ask_pet_service',
        description: 'El dueño pregunta qué servicios hay y si tienen lugar.',
        slots: Object.freeze([
            Object.freeze<SlotSchema>({
                key: 'service_id', type: 'reference', required: false,
                sensitivity: 'public', source: 'tool', persistence: 'turn',
            }),
            Object.freeze<SlotSchema>({
                key: 'date', type: 'date', required: false,
                sensitivity: 'public', source: 'customer', persistence: 'turn',
            }),
        ]),
        toolPlan: Object.freeze(['list_pet_services', 'check_daycare_availability']),
        confirmation: 'none',
        fallback: 'handoff',
        states: Object.freeze(['answered', 'unavailable', 'handed_off']),
        commits: false,
    })]),

    // ── Alquiler de vehículos ────────────────────────────────────────────
    vehicleRentals: Object.freeze([Object.freeze<IntentContract>({
        key: 'rent_vehicle',
        description: 'El cliente quiere alquilar un vehículo por unos días.',
        slots: Object.freeze([
            Object.freeze<SlotSchema>({
                key: 'pickup_at', type: 'datetime', required: true,
                sensitivity: 'public', source: 'customer', persistence: 'record',
            }),
            Object.freeze<SlotSchema>({
                key: 'return_at', type: 'datetime', required: true,
                sensitivity: 'public', source: 'customer', persistence: 'record',
            }),
            ...CONTACT_SLOTS,
        ]),
        toolPlan: Object.freeze([
            'check_vehicle_rental_availability', 'create_vehicle_rental',
        ]),
        confirmation: 'explicit',
        fallback: 'handoff',
        states: Object.freeze(['collecting', 'confirming', 'reserved', 'handed_off']),
        commits: true,
    })]),

    // ── Hospedaje de mascotas ────────────────────────────────────────────
    petBoarding: Object.freeze([Object.freeze<IntentContract>({
        key: 'board_pet',
        description: 'El dueño quiere dejar a su animal unos días.',
        slots: Object.freeze([
            Object.freeze<SlotSchema>({
                key: 'pet_reference', type: 'reference', required: true,
                sensitivity: 'personal', source: 'derived', persistence: 'record',
            }),
            Object.freeze<SlotSchema>({
                key: 'check_in', type: 'date', required: true,
                sensitivity: 'public', source: 'customer', persistence: 'record',
            }),
            Object.freeze<SlotSchema>({
                key: 'check_out', type: 'date', required: true,
                sensitivity: 'public', source: 'customer', persistence: 'record',
            }),
            ...CONTACT_SLOTS,
        ]),
        toolPlan: Object.freeze(['create_pet_boarding', 'list_my_pet_boardings']),
        confirmation: 'explicit',
        fallback: 'handoff',
        states: Object.freeze(['collecting', 'confirming', 'reserved', 'handed_off']),
        commits: true,
    })]),

    // ── Fotografía: presupuesto de una sesión ────────────────────────────
    photography: Object.freeze([Object.freeze<IntentContract>({
        key: 'request_photo_quote',
        description: 'El cliente quiere presupuesto para una sesión.',
        slots: Object.freeze([
            Object.freeze<SlotSchema>({
                key: 'package_id', type: 'reference', required: false,
                sensitivity: 'public', source: 'tool', persistence: 'record',
            }),
            Object.freeze<SlotSchema>({
                key: 'event_date', type: 'date', required: true,
                sensitivity: 'public', source: 'customer', persistence: 'record',
            }),
            ...CONTACT_SLOTS,
        ]),
        toolPlan: Object.freeze([
            'list_photo_packages', 'check_date_availability', 'request_photo_quote',
        ]),
        confirmation: 'explicit',
        fallback: 'handoff',
        states: Object.freeze(['collecting', 'quoted', 'handed_off']),
        commits: true,
    })]),

    payments: Object.freeze([Object.freeze<IntentContract>({
        key: 'pay',
        description: 'El cliente quiere pagar lo que ya acordó.',
        slots: Object.freeze([Object.freeze<SlotSchema>({
            key: 'payable_reference', type: 'reference', required: true,
            sensitivity: 'sensitive', source: 'derived', persistence: 'record',
            confirm: true,
        })]),
        toolPlan: Object.freeze(['create_payment_link', 'get_payment_status']),
        confirmation: 'explicit',
        fallback: 'handoff',
        states: Object.freeze(['pending', 'link_sent', 'paid', 'handed_off']),
        commits: true,
    })]),
});

function claimsFor(profile: ResolvedSubtypeExperienceProfile): readonly string[] {
    // El scope comercial es lo único que autoriza una afirmación. Un perfil de
    // captación no puede prometer que resuelve, aunque tenga tools para hacerlo.
    const byScope: Record<string, readonly string[]> = {
        captacion: ['puede tomar el interés y pasarlo a una persona'],
        calificacion: [
            'puede tomar el interés y pasarlo a una persona',
            'puede preguntar lo que el negocio declaró como criterio',
        ],
        cotizacion: [
            'puede tomar el interés y pasarlo a una persona',
            'puede informar precios que el negocio cargó',
        ],
        reserva: [
            'puede tomar el interés y pasarlo a una persona',
            'puede informar precios que el negocio cargó',
            'puede reservar cuando el motor confirma disponibilidad',
        ],
        operacion: [
            'puede tomar el interés y pasarlo a una persona',
            'puede informar precios que el negocio cargó',
            'puede reservar cuando el motor confirma disponibilidad',
            'puede ejecutar operaciones que el contrato efectivo autorizó',
        ],
    };
    return byScope[profile.scope] ?? byScope.captacion;
}

function disclosureFor(profile: ResolvedSubtypeExperienceProfile): readonly string[] {
    const base = [
        'es el asistente del negocio, no una persona ni parte del equipo',
        'dice lo que no puede hacer en vez de improvisarlo',
    ];
    if (!profile.commercialisable) {
        base.push('no cierra operaciones por chat y deriva a una persona');
    }
    return Object.freeze(base);
}

function navigationFor(manifest: ResolvedVerticalCapabilityManifest): NavigationPolicy {
    return {
        surfaces: manifest.routes,
        // Un deep link sólo puede apuntar a una ruta que el perfil TIENE. Sin
        // esta restricción el agente manda al dueño a una pantalla que su
        // propio menú no muestra: un callejón sin salida con permisos.
        deepLinks: Object.freeze(manifest.routes.map(route => ({
            kind: route.replace(/^\/admin\//, '').split('/')[0],
            route,
        }))),
    };
}

/**
 * De qué familia de tools sale cada intención.
 *
 * Se deriva del registro y no se escribe a mano: la prueba que verifica "el
 * perfil sólo declara intenciones que su manifiesto concede" llevaba su propia
 * copia de este mapa con cinco entradas, y al agregar quince grupos quedó
 * verificando contra un `undefined`. Una copia de una relación que ya existe es
 * una copia que se desactualiza.
 */
export function intentToolGroup(intentKey: string): string | undefined {
    for (const [group, intents] of Object.entries(INTENTS_BY_TOOL_GROUP)) {
        if (intents.some(intent => intent.key === intentKey)) return group;
    }
    return undefined;
}

function intentsFor(manifest: ResolvedVerticalCapabilityManifest): readonly IntentContract[] {
    const intents: IntentContract[] = [];
    for (const group of manifest.toolGroups as readonly VerticalToolGroup[]) {
        for (const intent of INTENTS_BY_TOOL_GROUP[group] ?? []) intents.push(intent);
    }
    return Object.freeze(intents);
}

function certificationFor(
    profile: ResolvedSubtypeExperienceProfile,
    intents: readonly IntentContract[],
): CertificationEvidenceV2 {
    const requirements: CertificationRequirement[] = [
        {
            key: 'intents_declared',
            statement: 'El perfil declara al menos una intención que su manifiesto puede ejecutar.',
            satisfied: intents.length > 0,
        },
        {
            key: 'terminology_four_languages',
            statement: 'Los sustantivos del perfil están en los cuatro idiomas.',
            satisfied: TERMINOLOGY_LANGUAGES.every(language => {
                const term = subtypeTerminologyFor(profile.industry, profile.subtype)?.primaryObject;
                return !term || typeof term[language] === 'string';
            }),
        },
        {
            key: 'commercialisable',
            statement: 'El perfil se puede vender: no está bloqueado por producto.',
            satisfied: profile.commercialisable,
        },
        {
            key: 'e2e_evidence',
            // Marcar certificado sin esto es exactamente lo que el encargo
            // prohíbe. Nadie lo puede satisfacer desde el código.
            statement: 'Existe una corrida end-to-end contra un tenant real de este perfil.',
            satisfied: false,
        },
    ];
    const blockers = requirements.filter(r => !r.satisfied).map(r => r.key);
    return {
        // Nunca `certified` desde una derivación: la evidencia E2E es externa.
        status: profile.commercialisable ? 'draft' : 'blocked',
        requirements: Object.freeze(requirements),
        blockers: Object.freeze(blockers),
    };
}

/**
 * El contrato de dominio de un perfil, derivado de lo ya declarado.
 *
 * Nace en `draft` siempre: describe lo que el sistema hace hoy, no lo que se
 * certificó que hace.
 */
export function buildDomainContractDraft(
    industry: string,
    subtype?: string | null,
): VerticalDomainContractV2 {
    const profile = resolveSubtypeExperienceProfile(industry, subtype);
    const manifest = resolveVerticalCapabilityManifest(
        profile.industry,
        profile.subtype === '__none__' ? undefined : profile.subtype,
    );
    const terminology = subtypeTerminologyFor(profile.industry, profile.subtype);
    const intents = intentsFor(manifest);
    const certification = certificationFor(profile, intents);

    const unresolved: string[] = [];
    if (!terminology?.primaryObject) unresolved.push('terminology.primaryObject');
    if (!intents.some(i => i.commits) && profile.scope !== 'captacion') {
        // El perfil promete más de lo que sus tools pueden ejecutar.
        unresolved.push('scope_without_committing_intent');
    }
    if (!profile.exclusions.length) unresolved.push('prompt.notOffered');

    return {
        contractVersion: VERTICAL_DOMAIN_CONTRACT_VERSION,
        profileId: profile.id,
        industry: profile.industry,
        subtype: profile.subtype,
        status: certification.status,
        prompt: {
            scope: profile.scope,
            disclosure: disclosureFor(profile),
            claims: claimsFor(profile),
            notOffered: profile.exclusions,
            terminology: {
                primaryObject: terminology?.primaryObject,
                customerNoun: terminology?.customerNoun,
                transactionNoun: terminology?.transactionNoun,
                avoid: terminology?.avoid ?? [],
            },
            languages: TERMINOLOGY_LANGUAGES,
        },
        intents,
        navigation: navigationFor(manifest),
        certification,
        unresolved: Object.freeze(unresolved),
    };
}

/** Los 76 contratos, todos en `draft`. */
export function listDomainContractDrafts(): VerticalDomainContractV2[] {
    return listSubtypeExperienceProfileIds().map((id) => {
        const [industry, subtype] = id.split('/');
        return buildDomainContractDraft(industry, subtype);
    });
}

/**
 * Qué le falta a un contrato para dejar de ser borrador.
 *
 * Devuelve motivos, no un booleano: "no está listo" sin el motivo es lo que
 * hace que nadie lo cierre nunca.
 */
export function domainContractGaps(contract: VerticalDomainContractV2): string[] {
    return [
        ...contract.unresolved,
        ...contract.certification.blockers.map(b => `certification.${b}`),
    ];
}
