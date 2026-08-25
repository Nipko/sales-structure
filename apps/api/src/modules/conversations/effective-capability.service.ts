import { Injectable, Logger, Optional } from '@nestjs/common';
import {
    CAPABILITY_EXCLUSION_TEXT,
    CONVERSATIONAL_CHANNELS,
    EFFECTIVE_CAPABILITY_CONTRACT_VERSION,
    OPERATIONAL_ROLES,
    TOOL_GROUP_PLAN_FEATURE,
    TOOL_GROUP_READINESS,
    VERTICAL_TOOL_GROUPS,
    PROVIDER_PROFILE_IDS,
    providerFreshnessFor,
    profileSystemOfRecordPolicy,
    buildDomainContractDraft,
    resolveVerticalCertificationSnapshot,
    resolveSubtypeExperienceProfile,
    type EffectiveCapabilityContract,
    type ExcludedCapability,
    type VerticalToolGroup,
} from '@parallext/shared';
import type { ToolDefinition } from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { VerticalReadinessService } from '../verticals/vertical-readiness.service';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { enabledToolFamilies, staticToolsForAgentConfig } from './agent-tool-registry';
import { isNonCommittalTool, toolOrigin } from './tool-policy-registry';
import { SystemOfRecordBoundaryService } from '../integrations/system-of-record-boundary.service';
import { buildVerticalOperationContract } from '../verticals/vertical-operation-contract';

/**
 * Lo que se sabe de un proveedor externo en el momento del turno.
 *
 * `connected` sin `healthy` es una integración guardada que no responde;
 * publicar sus tools con eso es prometer un dato que no va a llegar.
 * `asOf` ausente NO se trata como fresco: se trata como desconocido.
 */
export interface ProviderHealthInput {
    /**
     * Durable ownership evidence: a provider configuration/binding exists.
     * This does not become false when credentials, scopes, health retrieval or
     * the provider itself fail. Ownership and availability are separate axes.
     */
    configured?: boolean;
    connected: boolean;
    /**
     * Health of the live connection (credential, scopes and circuit). Mirror
     * age is deliberately excluded: a stale local copy cannot make a request
     * that goes straight to the provider stale before it starts.
     */
    healthy?: boolean;
    /** Permisos que el proveedor concedió de verdad, no los que se pidieron. */
    scopes?: readonly string[];
    /**
     * Last successful mirror refresh. Kept as `asOf` for compatibility with
     * older callers; new callers should use `mirrorAsOf` explicitly.
     */
    asOf?: string;
    mirrorAsOf?: string;
    /** Exact external API/contract version; never inferred from a green health check. */
    apiVersion?: string;
    /** Canonical provider class when the vendor id is more specific. */
    kind?: string;
    /** Evidence-backed provider capabilities, not requested OAuth scopes. */
    certifiedCapabilities?: readonly string[];
}

/**
 * Las tools cuyo dato vive en un proveedor externo, y de cual.
 *
 * Es por TOOL, no por familia. El primer intento gateo las familias
 * `restaurants`, `gyms` y `treatments`, que son NATIVAS: su readiness apunta a
 * tablas propias (`menu_items`) y funcionan sin ningun proveedor conectado.
 * Gatearlas por Toast habria apagado a todo restaurante que nunca integro
 * nada. Lo que depende del proveedor son estas cuatro lecturas y nada mas.
 */
/**
 * ═══ QUÉ SIGNIFICA CADA PROVEEDOR, EN UN SOLO REGISTRO ═══
 *
 * Antes vivía repartido en dos mapas —qué tools aporta, cuánto dura su dato— y
 * faltaban las dos cosas que más importan:
 *
 * **En qué industrias tiene sentido.** Las lecturas de proveedor se agregaban
 * DESPUÉS del manifiesto del subtipo, así que se saltaban su techo: un taller
 * mecánico que conectara Mindbody publicaba `get_fitness_schedule`. El
 * manifiesto es un techo para las familias nativas y no lo era para las
 * externas — que son justamente las que traen datos de otro sistema.
 *
 * **Qué escritor local vuelve deshonesto.** Es la misma forma del defecto que
 * ya costó caro en alojamiento: el agente lee la disponibilidad del PMS y
 * escribe la reserva en el registro local, que el PMS nunca ve. Con Mindbody y
 * Cliniko pasa igual — se consulta la agenda del proveedor y se agenda en
 * `appointments`, donde el sistema real del negocio no la ve— y ahí el
 * resultado es un turno vendido dos veces.
 *
 * La regla es la misma asimetría: **las lecturas se publican, los escritores
 * locales desplazados no.** Escribir de vuelta al proveedor necesita
 * credenciales verificadas y un mapeo certificado; hasta entonces la respuesta
 * honesta es "lo confirma el equipo".
 */
export interface ProviderIntegrationPolicy {
    /**
     * Las industrias donde este proveedor significa algo. Fuera de esta lista
     * no se publica ni una tool suya, aunque la conexión esté sana: un dato
     * fresco de un sistema que no es de este negocio sigue sin ser suyo.
     */
    profileIds: readonly string[];
    /** Lo que aporta. Es por TOOL, nunca por familia: las familias son nativas. */
    tools: readonly string[];
    /**
     * Escritores locales que dejan de ser honestos mientras este proveedor
     * manda. Vacío significa que el proveedor sólo informa y no administra
     * ningún calendario ni inventario propio.
     */
    localWritersDisplaced: readonly string[];
}

const PROVIDER_POLICIES: Readonly<Record<string, ProviderIntegrationPolicy>> = Object.freeze({
    toast: Object.freeze({
        profileIds: PROVIDER_PROFILE_IDS.toast,
        tools: Object.freeze(['get_restaurant_menu']),
        // Toast es el POS. Publicar su menú y crear/cancelar el pedido sólo en
        // la tabla local produce órdenes que cocina/caja nunca reciben.
        localWritersDisplaced: Object.freeze(['place_order', 'cancel_order']),
    }),
    mindbody: Object.freeze({
        profileIds: PROVIDER_PROFILE_IDS.mindbody,
        tools: Object.freeze(['get_fitness_schedule']),
        // Mindbody ES la agenda del gimnasio. Consultar los cupos allá y
        // anotarlos acá produce una clase con dos personas en el mismo lugar.
        localWritersDisplaced: Object.freeze(['book_class', 'cancel_class_booking']),
    }),
    cliniko: Object.freeze({
        profileIds: PROVIDER_PROFILE_IDS.cliniko,
        tools: Object.freeze(['list_clinic_services', 'check_clinic_availability']),
        // Lo mismo con la agenda clínica, donde el turno vendido dos veces se
        // convierte en dos pacientes en la sala de espera.
        localWritersDisplaced: Object.freeze([
            'create_appointment', 'reschedule_appointment', 'cancel_appointment',
        ]),
    }),
});

/**
 * Es por TOOL, no por familia. El primer intento gateó las familias
 * `restaurants`, `gyms` y `treatments`, que son NATIVAS: su readiness apunta a
 * tablas propias (`menu_items`) y funcionan sin ningún proveedor conectado.
 * Gatearlas por Toast habría apagado a todo restaurante que nunca integró nada.
 */
const PROVIDER_TOOLS: Readonly<Record<string, readonly string[]>> = Object.freeze(
    Object.fromEntries(
        Object.entries(PROVIDER_POLICIES).map(([name, policy]) => [name, policy.tools]),
    ),
);

/**
 * Lo mismo, aplanado, para que la taxonomía de procedencias del registro de
 * política se pueda contrastar contra ESTA lista y no contra una copia.
 */
export const PROVIDER_ORIGIN_TOOL_NAMES: readonly string[] = Object.freeze(
    Object.values(PROVIDER_TOOLS).flat(),
);

/** El registro de proveedores, para las pruebas de contrato y la UI de Ops. */
export const PROVIDER_INTEGRATION_POLICIES = PROVIDER_POLICIES;

/**
 * Resolves the effective capability contract, server-side and fail-closed.
 *
 * Publication used to be a saved toggle. The dashboard let a tenant switch on
 * families unrelated to their subtype; the manifest only supplied defaults to
 * NEW agents, so an existing one kept whatever it was created with; readiness
 * was advisory and nothing checked it; and plan gating happened, when it
 * happened, somewhere else entirely. Seven systems each held part of the
 * decision and none held all of it.
 *
 * The two rules that make this trustworthy:
 *
 * 1. **The subtype is a ceiling, not a suggestion.** A toggle can only ever
 *    narrow what the manifest grants — no JSON a tenant can edit widens
 *    authority.
 * 2. **Every exclusion carries a reason.** A tool that quietly vanishes teaches
 *    the owner it does not exist; one that says "you have no products loaded"
 *    teaches them what to do next.
 */
@Injectable()
export class EffectiveCapabilityService {
    private readonly logger = new Logger(EffectiveCapabilityService.name);

    constructor(
        private readonly throttle: TenantThrottleService,
        @Optional() private readonly readiness?: VerticalReadinessService,
        @Optional() private readonly regionalProfile?: RegionalProfileService,
        @Optional() private readonly systemOfRecord?: SystemOfRecordBoundaryService,
    ) {}

    async resolve(input: {
        tenantId: string;
        schemaName: string;
        industry: string;
        subType?: string | null;
        /** The agent's saved `config.tools`. */
        toolsConfig: unknown;
        agentId?: string;
        /**
         * Quién actúa. El agente de IA es siempre `tenant_agent`: opera, no
         * administra catálogo ni configuración desde una conversación. Sin esta
         * entrada, el contrato no distinguía una familia de catálogo de una
         * operativa y publicaba las dos por igual.
         */
        role?: string;
        /**
         * Por dónde. Un canal público sin identidad —el widget web anónimo— no
         * puede sostener las mismas acciones que un WhatsApp con teléfono
         * verificado.
         */
        channelType?: string;
        /** País operativo y jurisdicción del turno. */
        operatingCountry?: string;
        jurisdiction?: string;
        /**
         * Salud, scopes y frescura de los proveedores externos, medidos por
         * quien ya los consulta. Se pasan como entrada en vez de que este
         * servicio los busque: quien arma el turno ya paga esa consulta, y
         * duplicarla sería pagarla dos veces por turno.
         */
        providers?: Readonly<Record<string, ProviderHealthInput>>;
    }): Promise<EffectiveCapabilityContract> {
        const profile = resolveSubtypeExperienceProfile(input.industry, input.subType);
        const excluded: ExcludedCapability[] = [];
        let degraded = false;

        const manifestGroups = new Set<VerticalToolGroup>(profile.capability.toolGroups);
        const subtypeScopedFamilies = new Set<string>(VERTICAL_TOOL_GROUPS);
        const enabledFamilies = enabledToolFamilies(input.toolsConfig);
        const agentGroups = enabledFamilies.filter(
            (group): group is VerticalToolGroup => subtypeScopedFamilies.has(group),
        );
        // Horizontal/core families are controlled by the agent toggle and their
        // own plan/readiness gates, not by a business-subtype manifest. Treating
        // them as `VerticalToolGroup` removed CRM, policies, knowledge and order
        // status from every profile because those keys cannot appear in the
        // subtype ceiling by construction.
        const globalFamilies = enabledFamilies.filter(group => !subtypeScopedFamilies.has(group));

        // (1) The subtype is a ceiling. A family the agent switched on that the
        // manifest does not grant is dropped, not honoured: a saved toggle is
        // the tenant's preference, never a grant of authority.
        const withinSubtype: VerticalToolGroup[] = [];
        for (const group of agentGroups) {
            if (manifestGroups.has(group)) {
                withinSubtype.push(group);
                continue;
            }
            excluded.push({
                subject: group,
                reason: 'not_in_subtype',
                detail: CAPABILITY_EXCLUSION_TEXT.not_in_subtype,
            });
        }

        // A family the subtype grants but the agent switched off is a real
        // choice, reported so the dashboard can show what is available.
        for (const group of manifestGroups) {
            if (!agentGroups.includes(group)) {
                excluded.push({
                    subject: group,
                    reason: 'agent_disabled',
                    detail: CAPABILITY_EXCLUSION_TEXT.agent_disabled,
                });
            }
        }

        // (2) Plan.
        let planFeatures: Record<string, any> = {};
        let planSlug = 'unknown';
        try {
            planFeatures = await this.throttle.getPlanFeatures(input.tenantId);
            // `getPlanFeatures()` deliberately returns the flattened feature
            // payload, not the tenant's plan slug. Reading `features.plan`
            // therefore recorded `unknown` in every real contract even though
            // the plan gate itself had been evaluated. Resolve the audit
            // snapshot from the authoritative plan lookup when available.
            const getTenantPlan = (this.throttle as any).getTenantPlan;
            const runtimePlan = typeof getTenantPlan === 'function'
                ? await getTenantPlan.call(this.throttle, input.tenantId)
                : null;
            planSlug = String(
                (typeof runtimePlan === 'string' ? runtimePlan : runtimePlan?.slug)
                || planFeatures?.plan
                || planFeatures?.slug
                || 'unknown',
            );
        } catch (error: any) {
            // A plan lookup that fails must not silently grant paid capability.
            degraded = true;
            this.logger.warn(`[Capability] plan lookup failed for ${input.tenantId}: ${error?.message}`);
        }

        const withinPlan: VerticalToolGroup[] = [];
        for (const group of withinSubtype) {
            const feature = TOOL_GROUP_PLAN_FEATURE[group];
            if (!feature) { withinPlan.push(group); continue; }
            const granted = planFeatures?.[feature] === true;
            if (granted) { withinPlan.push(group); continue; }
            excluded.push({
                subject: group,
                reason: 'plan_missing_feature',
                detail: CAPABILITY_EXCLUSION_TEXT.plan_missing_feature,
                repairRoute: '/admin/settings/billing',
            });
        }

        // (3) Readiness. "Enabled" and "has something to answer with" were never
        // the same claim, and only the first was being made.
        const readinessKeys = withinPlan
            .map(group => TOOL_GROUP_READINESS[group])
            .filter((key): key is NonNullable<typeof key> => !!key);

        const readinessReport = this.readiness
            ? await this.readiness
                .evaluate(input.tenantId, input.schemaName, [...new Set(readinessKeys)])
                .catch(() => null)
            : null;
        if (this.readiness && !readinessReport) degraded = true;
        if (readinessReport?.degraded) degraded = true;

        const unmet = new Set(readinessReport?.unmet ?? []);
        const readyGroups: VerticalToolGroup[] = [];
        for (const group of withinPlan) {
            const key = TOOL_GROUP_READINESS[group];
            if (!key || !unmet.has(key)) { readyGroups.push(group); continue; }
            const check = readinessReport?.checks.find(c => c.key === key);
            excluded.push({
                subject: group,
                reason: 'readiness_unmet',
                // `check.repair` is legacy Spanish prose. The route remains
                // specific; the customer-facing detail comes from the typed
                // four-locale reason catalogue.
                detail: CAPABILITY_EXCLUSION_TEXT.readiness_unmet,
                repairRoute: check?.repairRoute,
            });
        }

        const published: VerticalToolGroup[] = [...readyGroups];
        const savedTools = input.toolsConfig && typeof input.toolsConfig === 'object'
            ? input.toolsConfig as Record<string, Record<string, unknown>>
            : {};
        const publishedConfig = Object.fromEntries(
            [...published, ...globalFamilies].map(group => [
                group,
                { ...(savedTools[group] || {}), enabled: true },
            ]),
        );
        let publishedTools = staticToolsForAgentConfig(publishedConfig)
            .map((tool: ToolDefinition) => String(tool.name));

        // (4) Salud, scopes y frescura del proveedor.
        //
        // Las lecturas externas se publicaban por estar CONECTADAS, y fuera del
        // contrato. Conectada no es sana, sana no es fresca, y un token con la
        // mitad de los permisos esta conectado igual: el agente contestaba con
        // el ultimo dato que alguien logro traer, sin decir de cuando era.
        //
        // Que entren y salgan ACA, y no en el sitio de publicacion, es lo que
        // las pone bajo el mismo contrato que el resto: quedan en
        // `publishedTools`, se recortan si el perfil esta bloqueado y su
        // exclusion lleva motivo como cualquier otra.
        const now = Date.now();
        /** Escritores locales que un binding autoritativo desplaza en este turno. */
        const displacedWriters = new Set<string>();
        for (const [providerName, policy] of Object.entries(PROVIDER_POLICIES)) {
            const providerTools = policy.tools;
            // ═══ EL TECHO DEL SUBTIPO TAMBIÉN ALCANZA A LO EXTERNO ═══
            //
            // Estas lecturas se agregaban DESPUÉS del manifiesto, así que se
            // saltaban su techo: un taller mecánico que conectara Mindbody
            // publicaba `get_fitness_schedule`. Un dato fresco de un sistema
            // que no es de este negocio sigue sin ser suyo.
            if (!policy.profileIds.includes(profile.id)) {
                if (input.providers?.[providerName]) {
                    excluded.push({
                        subject: providerName,
                        reason: 'provider_unavailable',
                        detail: CAPABILITY_EXCLUSION_TEXT.provider_unavailable,
                        repairRoute: '/admin/settings/integrations/vertical',
                    });
                }
                continue;
            }
            const health = input.providers?.[providerName];

            // Ownership is durable; health is ephemeral. Once the tenant has
            // bound this domain to a provider, an outage must remove provider
            // reads but can never hand the writer back to the local ledger.
            // `connected` is retained as a compatibility inference for older
            // callers; current callers always send `configured` explicitly.
            const authoritativeBinding = health?.configured === true
                || (health?.configured === undefined && health?.connected === true);
            if (authoritativeBinding) {
                for (const writer of policy.localWritersDisplaced) displacedWriters.add(writer);
            }

            if (!health) {
                // Sin canal de medicion no hay puerta que fallara: el llamador
                // no midio nada. Con canal y sin este proveedor, no esta
                // conectado y no se publica. Ninguno de los dos casos publica,
                // pero solo el segundo es una exclusion que valga reportar.
                if (input.providers) {
                    excluded.push({
                        subject: providerName,
                        reason: 'provider_unavailable',
                        detail: CAPABILITY_EXCLUSION_TEXT.provider_unavailable,
                        repairRoute: '/admin/settings/integrations/vertical',
                    });
                }
                continue;
            }

            const connectionUsable = health.connected && health.healthy !== false;
            if (!connectionUsable) {
                excluded.push({
                    subject: providerName,
                    reason: 'provider_unavailable',
                    detail: CAPABILITY_EXCLUSION_TEXT.provider_unavailable,
                    repairRoute: '/admin/settings/integrations/vertical',
                });
                continue;
            }

            const freshness = providerFreshnessFor(providerName);
            const mirrorAsOf = health.mirrorAsOf || health.asOf;
            const budget = freshness?.mirrorMaxAgeSeconds ?? 900;
            // Freshness is evaluated per tool. Cliniko availability is live;
            // blocking it because appointment_types in vi_items are old was a
            // provider-wide split-brain between the health panel and runtime.
            const availableProviderTools = providerTools.filter((tool) => {
                if (freshness?.liveTools.includes(tool)) return true;
                if (!freshness?.mirrorBackedTools.includes(tool)) return false;
                if (!mirrorAsOf) return false;
                const parsed = Date.parse(mirrorAsOf);
                return Number.isFinite(parsed) && (now - parsed) / 1000 <= budget;
            });
            const unavailableProviderTools = providerTools.filter(
                tool => !availableProviderTools.includes(tool),
            );
            if (unavailableProviderTools.length) {
                excluded.push({
                    subject: unavailableProviderTools.join(', '),
                    reason: 'provider_unavailable',
                    detail: CAPABILITY_EXCLUSION_TEXT.provider_unavailable,
                    repairRoute: '/admin/settings/integrations/vertical',
                });
            }

            publishedTools = [...publishedTools, ...availableProviderTools];
        }

        if (displacedWriters.size) {
            const displaced = publishedTools.filter(tool => displacedWriters.has(tool));
            if (displaced.length) {
                publishedTools = publishedTools.filter(tool => !displacedWriters.has(tool));
                excluded.push({
                    subject: displaced.join(', '),
                    reason: 'external_system_of_record',
                    detail: CAPABILITY_EXCLUSION_TEXT.external_system_of_record,
                    repairRoute: '/admin/settings/integrations/vertical',
                });
            }
        }

        // (5) System-of-record boundary for subtype-owned domain objects.
        //
        // A provider-required profile can never fall back to a local commit:
        // that creates two ledgers. Reads also require a binding the runtime
        // can prove healthy/fresh. Unknown vendors and generic settings stay
        // fail-closed until a certified adapter supplies that evidence.
        const sorPolicy = profileSystemOfRecordPolicy(profile.id);
        if (sorPolicy?.boundary === 'provider_required') {
            let readsAvailable = false;
            if (this.systemOfRecord) {
                try {
                    const boundary = await this.systemOfRecord.resolve({
                        tenantId: input.tenantId,
                        schemaName: input.schemaName,
                        profileId: profile.id,
                    });
                    readsAvailable = boundary.readsAvailable;
                } catch (error: any) {
                    degraded = true;
                    this.logger.warn(
                        `[Capability] SoR lookup failed tenant=${input.tenantId} `
                        + `profile=${profile.id}: ${error?.message}`,
                    );
                }
            }

            const displaced = publishedTools.filter(tool => sorPolicy.displacedWriters.includes(tool));
            if (displaced.length) {
                publishedTools = publishedTools.filter(tool => !sorPolicy.displacedWriters.includes(tool));
                excluded.push({
                    subject: displaced.join(', '),
                    reason: 'external_system_of_record',
                    detail: CAPABILITY_EXCLUSION_TEXT.external_system_of_record,
                    repairRoute: '/admin/settings/integrations/vertical',
                });
            }
            if (!readsAvailable) {
                const blockedReads = publishedTools.filter(tool => sorPolicy.readTools.includes(tool));
                if (blockedReads.length) {
                    publishedTools = publishedTools.filter(tool => !sorPolicy.readTools.includes(tool));
                    excluded.push({
                        subject: blockedReads.join(', '),
                        reason: 'provider_unavailable',
                        detail: CAPABILITY_EXCLUSION_TEXT.provider_unavailable,
                        repairRoute: '/admin/settings/integrations/vertical',
                    });
                }
            }
        }

        // (6) Un perfil `stop` no cierra nada.
        //
        // `stop` era documentación: el registro lo declaraba, la auditoría lo
        // contaba y el runtime publicaba los writers igual que en un perfil
        // certificado. Un perfil bloqueado que igual reserva, cotiza o cobra es
        // exactamente lo que el bloqueo existía para impedir.
        //
        // Las LECTURAS se conservan a propósito: el negocio existe y responde
        // preguntas con honestidad. Lo que no puede es comprometerlo con algo
        // que su modelo de producto todavía no sostiene — para eso está el
        // handoff, que sigue publicado.
        // (7) Rol y canal.
        //
        // Los dos entran al contrato porque los dos cambian qué es honesto
        // prometer, y hasta acá ninguno se miraba: el contrato decidía sin
        // saber quién actúa ni por dónde llega la conversación.
        const roleBlocked = input.role !== undefined && !OPERATIONAL_ROLES.includes(input.role);
        const channelBlocked = input.channelType !== undefined
            && !CONVERSATIONAL_CHANNELS.includes(input.channelType);
        // Availability is an execution boundary, not only selector metadata.
        // Waitlisted and legacy profiles may resolve for audit/compatibility,
        // but cannot publish writers until their product gate is promoted.
        const writersBlocked = !profile.commercialisable || roleBlocked || channelBlocked;
        if (writersBlocked) {
            // Lo que cae es lo que COMPROMETE, no lo que escribe una fila. Con
            // `effect !== 'read'` se llevaba puestas siete lecturas —FAQs, base
            // de conocimiento, políticas, estado de póliza, mis siniestros—
            // marcadas `conditional_write` sólo porque preparan una tabla
            // perezosa, y también el par de identidad, que es la única llave de
            // las lecturas guardadas por A2.
            const writers = publishedTools.filter((tool) => !isNonCommittalTool(tool));
            // El motivo dice CUÁL de las tres puertas cerró, porque las tres se
            // reparan en lugares distintos: el perfil espera una decisión de
            // producto, el rol es de quien llama y el canal es del producto.
            const reason = roleBlocked ? 'role_not_operational'
                : channelBlocked ? 'channel_not_certified'
                    : 'profile_blocked';
            // A waitlist target can intentionally have zero domain writers.
            // It still needs a typed, localized explanation in the contract;
            // otherwise Ops sees `writersBlocked=true` with no repair reason.
            if (!profile.commercialisable) {
                excluded.push({
                    subject: `profile:${profile.id}`,
                    reason: 'profile_blocked',
                    detail: CAPABILITY_EXCLUSION_TEXT.profile_blocked,
                });
            }
            if (writers.length) {
                publishedTools = publishedTools.filter((tool) => !writers.includes(tool));
                for (const tool of writers) {
                    excluded.push({
                        subject: tool,
                        reason,
                        detail: CAPABILITY_EXCLUSION_TEXT[reason],
                    });
                }
            }
        }

        const regional = this.regionalProfile
            ? await this.regionalProfile.resolve(input.tenantId).catch(() => null)
            : null;

        const operatingCountry = input.operatingCountry
            ?? regional?.operatingCountry?.value
            ?? undefined;
        const certification = resolveVerticalCertificationSnapshot({
            industry: profile.industry,
            subtype: profile.subtype,
            operatingCountry,
            providers: Object.entries(input.providers || {}).map(([name, health]) => ({
                name,
                kind: health.kind,
                apiVersion: health.apiVersion,
                configured: health.configured ?? health.connected,
                healthy: health.healthy,
                certifiedCapabilities: health.certifiedCapabilities,
            })),
        });

        return {
            version: EFFECTIVE_CAPABILITY_CONTRACT_VERSION,
            tenantId: input.tenantId,
            agentId: input.agentId,
            subtypeProfileId: profile.id,
            planSnapshot: planSlug,
            countryPackId: certification.market.countryPackId,
            domainContract: buildDomainContractDraft(profile.industry, profile.subtype),
            certification,
            operations: buildVerticalOperationContract(profile.industry, profile.subtype),
            publishedTools,
            // La misma lista, repartida por procedencia. Se calcula acá —donde
            // ya está decidida— y no en el sitio de publicación: recalcularla
            // allá fue lo que produjo la resta de conjuntos que dejaba pasar
            // todo lo que no reconocía.
            publishedByOrigin: Object.freeze({
                core: publishedTools.filter(t => toolOrigin(t) === 'core'),
                vertical: publishedTools.filter(t => toolOrigin(t) === 'vertical'),
                provider: publishedTools.filter(t => toolOrigin(t) === 'provider'),
                mcp: [],
            }),
            publishedGroups: published,
            excluded,
            unmetReadiness: [...unmet],
            degraded,
            writersBlocked,
            // Las entradas de la decisión viajan con ella: sin esto, "¿por qué
            // este turno no pudo cobrar?" sólo se contesta reproduciendo el
            // turno entero.
            decisionInputs: {
                role: input.role,
                channelType: input.channelType,
                operatingCountry,
                jurisdiction: input.jurisdiction ?? regional?.operatingCountry?.value ?? undefined,
                providersMeasured: input.providers ? Object.keys(input.providers) : undefined,
            },
            resolvedAt: new Date().toISOString(),
        };
    }
}
