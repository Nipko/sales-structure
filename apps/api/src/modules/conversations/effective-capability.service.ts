import { Injectable, Logger, Optional } from '@nestjs/common';
import {
    CAPABILITY_EXCLUSION_TEXT,
    EFFECTIVE_CAPABILITY_CONTRACT_VERSION,
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
import { TOOL_POLICY_REGISTRY } from './tool-policy-registry';

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
        const published: VerticalToolGroup[] = [];
        for (const group of withinPlan) {
            const key = TOOL_GROUP_READINESS[group];
            if (!key || !unmet.has(key)) { published.push(group); continue; }
            const check = readinessReport?.checks.find(c => c.key === key);
            excluded.push({
                subject: group,
                reason: 'readiness_unmet',
                detail: check?.repair ?? CAPABILITY_EXCLUSION_TEXT.readiness_unmet,
                repairRoute: check?.repairRoute,
            });
        }

        const publishedConfig = Object.fromEntries(published.map(g => [g, { enabled: true }]));
        let publishedTools = staticToolsForAgentConfig(publishedConfig)
            .map((tool: ToolDefinition) => String(tool.name));

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
        if (profile.strategy === 'stop') {
            const writers = publishedTools.filter((tool) => {
                const policy = TOOL_POLICY_REGISTRY[tool];
                return policy ? policy.effect !== 'read' : false;
            });
            if (writers.length) {
                publishedTools = publishedTools.filter((tool) => !writers.includes(tool));
                for (const tool of writers) {
                    excluded.push({
                        subject: tool,
                        reason: 'profile_blocked',
                        detail: CAPABILITY_EXCLUSION_TEXT.profile_blocked,
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
            resolvedAt: new Date().toISOString(),
        };
    }
}
