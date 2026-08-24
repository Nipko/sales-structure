import type { VerticalCapability, VerticalReadinessKey, VerticalToolGroup } from './vertical-capability-manifest';
import type { VerticalDomainContractV2 } from './vertical-domain-contract';

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
    /** Customer-safe explanation, structured in every supported UI locale. */
    detail: LocalizedCapabilityText;
    /** Where the tenant fixes it, when they can. */
    repairRoute?: string;
}

export type CapabilityLocale = 'es' | 'en' | 'pt' | 'fr';
export type LocalizedCapabilityText = Readonly<Record<CapabilityLocale, string>>;

export interface EffectiveCapabilityContract {
    version: typeof EFFECTIVE_CAPABILITY_CONTRACT_VERSION;
    tenantId: string;
    agentId?: string;
    subtypeProfileId: string;
    /** Plan slug the decision was made against. */
    planSnapshot: string;
    countryPackId: string;
    /** Domain promise/intent contract used by the runtime decision. */
    domainContract: VerticalDomainContractV2;
    /** Tool names the model may be shown. */
    publishedTools: string[];
    /**
     * Lo mismo, repartido por procedencia.
     *
     * Las cuatro no se autorizan igual —`core` la decide el dueño y el plan,
     * `vertical` suma el manifiesto del subtipo, `provider` suma salud, alcance
     * y frescura del tercero, `mcp` se aprueba tool por tool a mano— y hasta acá
     * la traza mostraba una sola lista. Con eso, "¿por qué este turno no pudo
     * leer el menú?" no se podía contestar sin reproducir el turno: no se veía
     * si la tool nunca se publicó, si la familia estaba apagada o si Toast no
     * contestaba.
     */
    publishedByOrigin?: Readonly<Record<'core' | 'vertical' | 'provider' | 'mcp', readonly string[]>>;
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

function exclusionText(es: string, en: string, pt: string, fr: string): LocalizedCapabilityText {
    return Object.freeze({ es, en, pt, fr });
}

/** Human-readable reason text, so every surface says the same thing in its locale. */
export const CAPABILITY_EXCLUSION_TEXT: Readonly<Record<CapabilityExclusionReason, LocalizedCapabilityText>> = Object.freeze({
    not_in_subtype: exclusionText(
        'Esta familia no corresponde al tipo de negocio configurado.',
        'This family does not apply to the configured business type.',
        'Esta família não corresponde ao tipo de negócio configurado.',
        'Cette famille ne correspond pas au type d’activité configuré.',
    ),
    agent_disabled: exclusionText(
        'Este agente tiene esta capacidad desactivada.',
        'This capability is disabled for this agent.',
        'Esta capacidade está desativada para este agente.',
        'Cette capacité est désactivée pour cet agent.',
    ),
    plan_missing_feature: exclusionText(
        'El plan actual no incluye esta capacidad.',
        'The current plan does not include this capability.',
        'O plano atual não inclui esta capacidade.',
        'L’offre actuelle n’inclut pas cette capacité.',
    ),
    readiness_unmet: exclusionText(
        'Faltan datos operativos para que el agente use esta capacidad.',
        'Operational data is missing for the agent to use this capability.',
        'Faltam dados operacionais para o agente usar esta capacidade.',
        'Des données opérationnelles manquent pour que l’agent utilise cette capacité.',
    ),
    provider_unavailable: exclusionText(
        'La integración necesaria no está conectada, disponible o actualizada.',
        'The required integration is not connected, available, or up to date.',
        'A integração necessária não está conectada, disponível ou atualizada.',
        'L’intégration requise n’est pas connectée, disponible ou à jour.',
    ),
    not_approved: exclusionText(
        'No existe una política revisada para ejecutar esta capacidad.',
        'There is no reviewed policy for executing this capability.',
        'Não existe uma política revisada para executar esta capacidade.',
        'Aucune politique révisée ne permet d’exécuter cette capacité.',
    ),
    external_system_of_record: exclusionText(
        'Otro sistema administra este registro; el equipo debe confirmar la operación.',
        'Another system owns this record; the team must confirm the operation.',
        'Outro sistema administra este registro; a equipe deve confirmar a operação.',
        'Un autre système gère ce dossier ; l’équipe doit confirmer l’opération.',
    ),
    profile_blocked: exclusionText(
        'Este tipo de negocio todavía no puede cerrar operaciones por chat; el equipo las confirma.',
        'This business type cannot yet close operations in chat; the team confirms them.',
        'Este tipo de negócio ainda não pode concluir operações no chat; a equipe as confirma.',
        'Ce type d’activité ne peut pas encore conclure d’opérations par chat ; l’équipe les confirme.',
    ),
    role_not_operational: exclusionText(
        'El rol que solicita esta capacidad no opera conversaciones.',
        'The role requesting this capability does not operate conversations.',
        'A função que solicita esta capacidade não opera conversas.',
        'Le rôle qui demande cette capacité ne gère pas les conversations.',
    ),
    channel_not_certified: exclusionText(
        'Este canal no está certificado para cerrar operaciones; el agente informa y deriva.',
        'This channel is not certified to close operations; the agent informs and hands off.',
        'Este canal não é certificado para concluir operações; o agente informa e transfere.',
        'Ce canal n’est pas certifié pour conclure des opérations ; l’agent informe et transfère.',
    ),
});

export function localizeCapabilityText(
    detail: LocalizedCapabilityText,
    locale: string | null | undefined,
): string {
    const language = String(locale || 'es').slice(0, 2).toLowerCase() as CapabilityLocale;
    return detail[language] || detail.en;
}

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

// ── Autoridad de ejecución ───────────────────────────────────────────────

/**
 * De dónde salió el permiso para ejecutar una tool.
 *
 * No es decorativo: cada origen tiene su propia forma de estar mal, y saber
 * cuál fue es lo que permite auditar una ejecución después. Un
 * `human_approval` prueba que una persona decidió el ticket, pero no vuelve a
 * habilitar una capacidad retirada después: al reanudar se recompone el
 * contrato vigente. El origen sigue siendo útil para auditoría de ejecutores
 * internos que sólo representan la decisión humana.
 */
export type ToolAuthoritySource =
    /** El contrato efectivo resuelto para este turno de conversación. */
    | 'turn_contract'
    /** Agent Test: el mismo contrato, más la lista segura del banco de pruebas. */
    | 'agent_test'
    /** Una persona aprobó esta ejecución en la consola (sin ampliar el contrato vigente). */
    | 'human_approval'
    /** El servidor MCP expuesto: lista curada de sólo lectura, con API key. */
    | 'mcp_server'
    /** Trabajo interno de la plataforma, sin conversación detrás. */
    | 'system';

/**
 * Lo que el ejecutor necesita para decidir, y **sin lo cual no ejecuta nada**.
 *
 * ── Por qué es obligatoria ──────────────────────────────────────────────
 *
 * Hasta acá el ejecutor recibía `commitmentBlocked` y `deniedTools`, los dos
 * **opcionales**. Un llamador que omitía `opts` tenía acceso al catálogo
 * entero de tools — y de los llamadores reales, la mayoría no pasaba ninguna de
 * las dos. La puerta existía y casi nadie la cruzaba.
 *
 * Peor: la autorización era por NEGACIÓN. `deniedTools` lista lo prohibido, así
 * que todo lo que nadie pensó en prohibir estaba permitido. Una tool nueva
 * nacía autorizada para todos hasta que alguien se acordara de restringirla.
 *
 * `allowedTools` invierte eso: **lo que no está, no pasa**. Una tool nueva nace
 * denegada y sólo la ejecuta quien decidió publicarla.
 */
export interface ToolExecutionAuthority {
    /** Qué produjo este permiso. */
    source: ToolAuthoritySource;
    /**
     * Los nombres exactos que este origen autoriza. **Default-deny**: una tool
     * que no está acá no se ejecuta, sin importar quién la pida.
     */
    allowedTools: readonly string[];
    /**
     * El negocio no puede comprometerse en este turno: perfil `stop`, rol no
     * operativo, canal no conversacional, o contrato irresoluble.
     */
    commitmentBlocked?: { reason: string } | null;
    /** Lo que el dueño apagó a mano en su agente. */
    deniedTools?: readonly string[];
    /**
     * Cuándo se resolvió el contrato del que sale esta autoridad.
     *
     * Es lo que permite detectar una autoridad rancia: un ticket de
     * confirmación creado hace veinte minutos no puede ejecutarse contra el
     * permiso que había entonces, porque en el medio el dueño pudo apagar la
     * tool, el plan pudo bajar y el proveedor pudo caerse.
     */
    resolvedAt: string;
    /** El perfil contra el que se resolvió, para la línea de auditoría. */
    subtypeProfileId?: string;
}

/**
 * Cuánto puede envejecer una autoridad antes de exigir re-resolución.
 *
 * Dos minutos: más que el turno más lento y mucho menos que la ventana de un
 * ticket de confirmación, que es exactamente el caso que hay que atrapar.
 */
export const TOOL_AUTHORITY_MAX_AGE_SECONDS = 120;

export type ToolAuthorityDenialReason =
    | 'not_authorised'
    | 'commitment_blocked'
    | 'disabled_by_owner'
    | 'authority_stale';

/**
 * Los códigos con los que el ejecutor devuelve una denegación de autoridad.
 *
 * Existen como conjunto porque el handoff se dispara ante una operación
 * **denegada**, y reconocerla mirando `shouldHandoff` no alcanza: media docena
 * de fallas distintas lo levantan. Comparar contra este conjunto es la
 * diferencia entre "el cliente pidió algo que no podemos hacer" —que sí
 * necesita una persona— y "una lectura salió mal", que no.
 */
export const TOOL_AUTHORITY_DENIAL_ERRORS: readonly string[] = [
    'tool_not_authorised',
    'capability_blocked',
    'tool_disabled_by_owner',
    'authority_stale',
];

export function isToolAuthorityDenial(error: unknown): boolean {
    return typeof error === 'string' && TOOL_AUTHORITY_DENIAL_ERRORS.includes(error);
}

export type ToolAuthorityDecision =
    | { allowed: true }
    | {
        allowed: false;
        /** Motivo tipado. El mensaje al cliente se arma con esto, no con texto libre. */
        reason: ToolAuthorityDenialReason;
        detail: string;
    };

/**
 * La decisión, en un solo lugar.
 *
 * Vive en `shared` y no en el ejecutor porque la misma respuesta la tienen que
 * dar el ejecutor, la publicación de tools y Agent Test. Tres copias de esta
 * función son tres formas distintas de contestar la misma pregunta, y la
 * historia de este módulo es exactamente esa.
 *
 * **El orden importa.** Primero lo rancio (no sabemos), después lo bloqueado
 * (el negocio no puede), después lo apagado (el dueño no quiere) y último lo no
 * publicado. Al revés, una tool apagada por el dueño dentro de un perfil
 * bloqueado reportaría "no autorizada" y el dueño buscaría el problema donde no
 * está.
 */
export function decideToolAuthority(
    authority: ToolExecutionAuthority | undefined | null,
    toolName: string,
    options: { isNonCommittal: boolean; now?: Date },
): ToolAuthorityDecision {
    // Sin autoridad no se ejecuta. Éste es el default-deny.
    if (!authority) {
        return {
            allowed: false,
            reason: 'not_authorised',
            detail: 'La ejecución llegó sin autoridad declarada.',
        };
    }

    const now = options.now ?? new Date();
    const resolvedAt = Date.parse(authority.resolvedAt);
    // Una fecha ilegible es infinitamente vieja: desconocido no es fresco.
    const ageSeconds = Number.isFinite(resolvedAt)
        ? (now.getTime() - resolvedAt) / 1000
        : Number.POSITIVE_INFINITY;
    if (ageSeconds > TOOL_AUTHORITY_MAX_AGE_SECONDS) {
        return {
            allowed: false,
            reason: 'authority_stale',
            detail: `La autorización tiene ${Math.round(ageSeconds)}s y hay que resolverla de nuevo.`,
        };
    }

    if (authority.commitmentBlocked && !options.isNonCommittal) {
        return {
            allowed: false,
            reason: 'commitment_blocked',
            detail: authority.commitmentBlocked.reason,
        };
    }

    if (authority.deniedTools?.includes(toolName)) {
        return {
            allowed: false,
            reason: 'disabled_by_owner',
            detail: `${toolName} está apagada en la configuración del agente.`,
        };
    }

    if (!authority.allowedTools.includes(toolName)) {
        return {
            allowed: false,
            reason: 'not_authorised',
            detail: `${toolName} no está en las tools publicadas para este turno.`,
        };
    }

    return { allowed: true };
}
