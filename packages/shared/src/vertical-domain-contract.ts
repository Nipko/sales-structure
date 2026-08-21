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
            toolPlan: Object.freeze(['list_my_appointments', 'cancel_appointment']),
            confirmation: 'explicit',
            fallback: 'handoff',
            states: Object.freeze(['identifying', 'confirming', 'cancelled', 'handed_off']),
            commits: true,
        }),
    ]),
    catalog: Object.freeze([Object.freeze<IntentContract>({
        key: 'browse_catalog',
        description: 'El cliente pregunta qué hay y a qué precio.',
        slots: Object.freeze([Object.freeze<SlotSchema>({
            key: 'query', type: 'text', required: false,
            sensitivity: 'public', source: 'customer', persistence: 'turn',
        })]),
        toolPlan: Object.freeze(['search_products', 'get_product_details']),
        confirmation: 'none',
        fallback: 'answer',
        states: Object.freeze(['listed', 'empty', 'handed_off']),
        commits: false,
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
