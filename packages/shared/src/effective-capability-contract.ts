import type { VerticalCapability, VerticalReadinessKey, VerticalToolGroup } from './vertical-capability-manifest';

/**
 * The one server-side answer to "what may this agent do, this turn".
 *
 * Tools were published mainly from toggles saved on each agent. The UI let a
 * tenant switch on families that had nothing to do with their subtype, the
 * manifest only supplied defaults to NEW agents, sub-permissions were
 * decorative, Procedures could invoke switched-off tools, and integrations
 * announced themselves for being connected. Seven different systems each held
 * part of the decision and none of them held all of it.
 *
 * The intersection is mandatory and fail-closed:
 *
 *     subtype profile
 *       ∩ permitted agent overrides
 *       ∩ runtime plan and quotas
 *       ∩ readiness / data
 *       ∩ provider health, scopes, freshness
 *       ∩ country / jurisdiction
 *       ∩ role and channel
 *       = publishable tools
 *
 * Every exclusion carries a REASON. A tool that silently disappears teaches the
 * owner it does not exist; one that says "your plan does not include this" or
 * "you have no products loaded" teaches them what to do.
 */

export const EFFECTIVE_CAPABILITY_CONTRACT_VERSION = 1 as const;

/** Why a tool the agent asked for is not published this turn. */
export type CapabilityExclusionReason =
    /** The subtype's manifest does not grant this family. */
    | 'not_in_subtype'
    /** The agent's own config has it switched off. */
    | 'agent_disabled'
    /** The tenant's plan does not include it. */
    | 'plan_missing_feature'
    /** The tenant has no data for it to answer with. */
    | 'readiness_unmet'
    /** The provider it depends on is not connected, ready or healthy. */
    | 'provider_unavailable'
    /** No reviewed policy (external/opaque tools). */
    | 'not_approved'
    /** The system of record for this object is owned elsewhere. */
    | 'external_system_of_record'
    /**
     * El perfil está declarado `stop`: no tiene el modelo de producto que su
     * rubro exige, así que no puede comprometer al negocio con nada.
     *
     * Hasta acá `stop` era documentación: el registro lo declaraba, la
     * auditoría lo contaba y el runtime publicaba los writers igual que en un
     * perfil certificado. Un perfil bloqueado que igual reserva, cotiza o cobra
     * es exactamente lo que el bloqueo existía para impedir.
     */
    | 'profile_blocked'
    /**
     * Quien pide no es un rol que opere.
     *
     * El contrato lo resuelven hoy la conversación y Agent Test, los dos como
     * el rol operativo. Un llamador futuro que pase otro rol —o ninguno que se
     * reconozca— no puede recibir el juego completo por omisión.
     */
    | 'role_not_operational'
    /**
     * El canal no es una superficie conversacional certificada.
     *
     * SMS es notificación de una sola vía en esta plataforma y el correo es un
     * adaptador de entrada interno sin autoservicio certificado. Un turno que
     * llegue por ahí puede leer y derivar; comprometer al negocio por un canal
     * que no sostiene la conversación de vuelta, no.
     */
    | 'channel_not_certified';

export interface ExcludedCapability {
    /** Tool family, or a single tool name when the exclusion is tool-level. */
    subject: string;
    reason: CapabilityExclusionReason;
    /** Customer-safe explanation for the dashboard. */
    detail: string;
    /** Where the tenant fixes it, when they can. */
    repairRoute?: string;
}

export interface EffectiveCapabilityContract {
    version: typeof EFFECTIVE_CAPABILITY_CONTRACT_VERSION;
    tenantId: string;
    agentId?: string;
    subtypeProfileId: string;
    /** Plan slug the decision was made against. */
    planSnapshot: string;
    countryPackId: string;
    /** Tool names the model may be shown. */
    publishedTools: string[];
    /** Families that survived every gate. */
    publishedGroups: VerticalToolGroup[];
    /** Everything that did not, with why. */
    excluded: ExcludedCapability[];
    /** Readiness keys the subtype declares that the tenant does not meet. */
    unmetReadiness: VerticalReadinessKey[];
    /** True when a gate could not be evaluated; the turn stays conservative. */
    degraded: boolean;
    /**
     * El perfil está `stop`: ninguna tool que escriba puede publicarse, venga
     * de donde venga.
     *
     * Se expone además de filtrar `publishedTools` porque las familias que se
     * resuelven asincrónicamente —pagos, descuentos, integraciones, MCP— se
     * agregan FUERA del contrato estático y conservan sus propias puertas. Sin
     * este flag, un perfil bloqueado seguía pudiendo generar un enlace de pago:
     * el bloqueo tapaba la puerta principal y dejaba la de servicio abierta.
     */
    writersBlocked: boolean;
    /**
     * Las entradas con las que se tomó la decisión.
     *
     * Viajan con el contrato para que "¿por qué este turno no pudo cobrar?" se
     * pueda contestar mirando la traza, sin reproducir el turno entero.
     */
    decisionInputs?: {
        role?: string;
        channelType?: string;
        operatingCountry?: string;
        jurisdiction?: string;
        /** Proveedores que el llamador midió en este turno. */
        providersMeasured?: string[];
    };
    resolvedAt: string;
}

/**
 * Plan feature each tool family requires, when it requires one.
 *
 * Absent means "included in every plan". Kept beside the capability map rather
 * than inside the billing module so a family cannot be added without someone
 * deciding whether it is free — the omission that let plan-gated pages be
 * advertised and then 403.
 */
// Keyed by `config.tools.*`, which is a superset of the manifest's tool groups:
// `payments` is a real family with no vertical of its own, because every
// vertical can charge.
export const TOOL_GROUP_PLAN_FEATURE: Readonly<Record<string, string>> = Object.freeze({
    // Money leaves the platform: always plan-gated.
    payments: 'customerPayments',
});

/**
 * Readiness key each tool family depends on.
 *
 * A family whose data requirement is not modelled here publishes without a
 * readiness gate, which is deliberate: inventing a requirement is as harmful as
 * missing one, and blocks a tenant for a reason they cannot act on.
 */
export const TOOL_GROUP_READINESS: Readonly<Partial<Record<VerticalToolGroup, VerticalReadinessKey>>> = Object.freeze({
    appointments: 'appointment_services',
    catalog: 'catalog_items',
    faqs: 'faq_content',
    treatments: 'treatment_catalog',
    realEstate: 'listings',
    restaurants: 'menu_items',
    vehicles: 'vehicle_inventory',
    tours: 'tour_packages',
    properties: 'properties',
    education: 'courses',
    gyms: 'membership_plans',
    insurance: 'insurance_plans',
    homeServices: 'service_catalog',
    petServices: 'pets',
    photography: 'photo_sessions',
    petBoarding: 'boarding_capacity',
    vehicleRentals: 'vehicle_inventory',
});

/** Human-readable reason text, so every surface says the same thing. */
export const CAPABILITY_EXCLUSION_TEXT: Readonly<Record<CapabilityExclusionReason, string>> = Object.freeze({
    not_in_subtype: 'Esta familia no corresponde al tipo de negocio configurado.',
    agent_disabled: 'Este agente la tiene desactivada.',
    plan_missing_feature: 'El plan actual no incluye esta capacidad.',
    readiness_unmet: 'Faltan datos para que el agente pueda responder con esto.',
    provider_unavailable: 'La integración que necesita no está conectada o no responde.',
    not_approved: 'No tiene una política revisada, así que no puede ejecutarse.',
    external_system_of_record: 'Otro sistema es dueño de este registro; el equipo confirma.',
    profile_blocked: 'Este tipo de negocio todavía no puede cerrar operaciones por chat; el equipo las confirma.',
    role_not_operational: 'Quien pide esto no tiene un rol que opere la conversación.',
    channel_not_certified: 'Este canal no cierra operaciones; por acá el agente informa y deriva.',
});

/** Canales donde la conversación de ida y vuelta está certificada. */
export const CONVERSATIONAL_CHANNELS: readonly string[] = Object.freeze([
    'whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget',
]);

/** Roles que operan una conversación. Cualquier otro no publica nada. */
export const OPERATIONAL_ROLES: readonly string[] = Object.freeze([
    'tenant_agent', 'tenant_supervisor', 'tenant_admin', 'super_admin',
]);

export function capabilityForToolGroup(
    group: VerticalToolGroup,
    map: Readonly<Record<VerticalToolGroup, VerticalCapability>>,
): VerticalCapability {
    return map[group];
}
