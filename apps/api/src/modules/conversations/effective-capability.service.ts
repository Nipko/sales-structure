import { Injectable, Logger, Optional } from '@nestjs/common';
import {
    CAPABILITY_EXCLUSION_TEXT,
    CONVERSATIONAL_CHANNELS,
    EFFECTIVE_CAPABILITY_CONTRACT_VERSION,
    OPERATIONAL_ROLES,
    TOOL_GROUP_PLAN_FEATURE,
    TOOL_GROUP_READINESS,
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
import { isNonCommittalTool } from './tool-policy-registry';

/**
 * Lo que se sabe de un proveedor externo en el momento del turno.
 *
 * `connected` sin `healthy` es una integración guardada que no responde;
 * publicar sus tools con eso es prometer un dato que no va a llegar.
 * `asOf` ausente NO se trata como fresco: se trata como desconocido.
 */
export interface ProviderHealthInput {
    connected: boolean;
    healthy?: boolean;
    /** Permisos que el proveedor concedió de verdad, no los que se pidieron. */
    scopes?: readonly string[];
    /** Cuándo se supo esto. ISO-8601. */
    asOf?: string;
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
const PROVIDER_TOOLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    toast: Object.freeze(['get_restaurant_menu']),
    mindbody: Object.freeze(['get_fitness_schedule']),
    cliniko: Object.freeze(['list_clinic_services', 'check_clinic_availability']),
});

/**
 * Cuánto puede tardar en volverse mentira lo que dijo un proveedor.
 *
 * Un menú de ayer todavía sirve; una disponibilidad de ayer, no. El número no
 * es "cuándo expira el caché" sino "cuándo deja de ser honesto repetirlo".
 */
const PROVIDER_FRESHNESS_BUDGET_SECONDS: Readonly<Record<string, number>> = Object.freeze({
    toast: 3600,
    mindbody: 900,
    cliniko: 900,
});

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
        const agentGroups = enabledToolFamilies(input.toolsConfig) as VerticalToolGroup[];

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
            planSlug = String(planFeatures?.plan ?? planFeatures?.slug ?? 'unknown');
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
                detail: check?.repair ?? CAPABILITY_EXCLUSION_TEXT.readiness_unmet,
                repairRoute: check?.repairRoute,
            });
        }

        const published: VerticalToolGroup[] = [...readyGroups];
        const publishedConfig = Object.fromEntries(published.map(g => [g, { enabled: true }]));
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
        for (const [providerName, providerTools] of Object.entries(PROVIDER_TOOLS)) {
            const health = input.providers?.[providerName];
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

            const budget = PROVIDER_FRESHNESS_BUDGET_SECONDS[providerName] ?? 900;
            // Sin `asOf` no se sabe de cuando es. Desconocido no es fresco.
            const stale = health.asOf
                ? (now - Date.parse(health.asOf)) / 1000 > budget
                : true;

            if (!health.connected || health.healthy === false || stale) {
                excluded.push({
                    subject: providerName,
                    reason: 'provider_unavailable',
                    detail: CAPABILITY_EXCLUSION_TEXT.provider_unavailable,
                    repairRoute: '/admin/settings/integrations/vertical',
                });
                continue;
            }

            publishedTools = [...publishedTools, ...providerTools];
        }

        // (5) Un perfil `stop` no cierra nada.
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
        // (6) Rol y canal.
        //
        // Los dos entran al contrato porque los dos cambian qué es honesto
        // prometer, y hasta acá ninguno se miraba: el contrato decidía sin
        // saber quién actúa ni por dónde llega la conversación.
        const roleBlocked = input.role !== undefined && !OPERATIONAL_ROLES.includes(input.role);
        const channelBlocked = input.channelType !== undefined
            && !CONVERSATIONAL_CHANNELS.includes(input.channelType);
        const writersBlocked = profile.strategy === 'stop' || roleBlocked || channelBlocked;
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

        return {
            version: EFFECTIVE_CAPABILITY_CONTRACT_VERSION,
            tenantId: input.tenantId,
            agentId: input.agentId,
            subtypeProfileId: profile.id,
            planSnapshot: planSlug,
            countryPackId: regional?.countryPackId ?? profile.capability.industry,
            publishedTools,
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
                operatingCountry: input.operatingCountry ?? regional?.operatingCountry?.value ?? undefined,
                jurisdiction: input.jurisdiction ?? regional?.operatingCountry?.value ?? undefined,
                providersMeasured: input.providers ? Object.keys(input.providers) : undefined,
            },
            resolvedAt: new Date().toISOString(),
        };
    }
}
