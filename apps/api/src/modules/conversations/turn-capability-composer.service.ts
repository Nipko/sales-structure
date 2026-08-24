import { Injectable, Logger } from '@nestjs/common';
import {
    CAPABILITY_EXCLUSION_TEXT,
    CONVERSATIONAL_CHANNELS,
    OPERATIONAL_ROLES,
    type EffectiveCapabilityContract,
    type TenantConfig,
    type ToolDefinition,
    type ToolExecutionAuthority,
    type TurnCapability,
} from '@parallext/shared';
import { VerticalIntegrationsService } from '../vertical-integrations/vertical-integrations.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { EffectiveCapabilityService, type ProviderHealthInput } from './effective-capability.service';
import { PaymentOperationService } from './payment-operation.service';
import { discountToolsForRuntime, paymentToolsForRuntime } from './payment-tool-registration';
import { staticToolsForAgentConfig, subpermissionDeniedToolNames } from './agent-tool-registry';
import { identityStepUpToolsFor } from './identity-step-up-registration';
import {
    GET_FITNESS_SCHEDULE_TOOL,
    GET_RESTAURANT_MENU_TOOL,
    LIST_CLINIC_SERVICES_TOOL,
    CHECK_CLINIC_AVAILABILITY_TOOL,
} from './tools/vertical-integration-tools';
import { isNonCommittalTool, toolOrigin } from './tool-policy-registry';
import { buildTurnAuthority, type TurnAuthorityInput } from './turn-authority';

export interface ComposedTurnCapability {
    contract: EffectiveCapabilityContract | null;
    status: TurnCapability;
    /** Exact definitions every runtime consumer must use for this turn. */
    tools: ToolDefinition[];
    /** Exact authority paired with `tools`; consumers must not widen it. */
    authority: ToolExecutionAuthority;
    deniedTools: string[];
    commitmentBlocked: { reason: string } | null;
}

export interface ComposeTurnCapabilityInput {
    tenantId: string;
    schemaName: string;
    config: TenantConfig;
    industry: string;
    subType?: string | null;
    agentId?: string;
    role?: string;
    channelType?: string;
    operatingCountry?: string;
    jurisdiction?: string;
}

const PROVIDER_DEFINITIONS: Readonly<Record<string, ToolDefinition>> = Object.freeze({
    get_restaurant_menu: GET_RESTAURANT_MENU_TOOL,
    get_fitness_schedule: GET_FITNESS_SCHEDULE_TOOL,
    list_clinic_services: LIST_CLINIC_SERVICES_TOOL,
    check_clinic_availability: CHECK_CLINIC_AVAILABILITY_TOOL,
});

/** One definition per name; registration order is stable and first wins. */
function uniqueTools(tools: readonly ToolDefinition[]): ToolDefinition[] {
    const seen = new Set<string>();
    const result: ToolDefinition[] = [];
    for (const tool of tools) {
        const name = String(tool?.name || '');
        if (!name || seen.has(name)) continue;
        seen.add(name);
        result.push(tool);
    }
    return result;
}

function statusFor(contract: EffectiveCapabilityContract): TurnCapability {
    if (contract.writersBlocked) {
        const blockingReason = (
            contract.decisionInputs?.role
                && !OPERATIONAL_ROLES.includes(contract.decisionInputs.role)
                ? 'role_not_operational'
                : contract.decisionInputs?.channelType
                    && !CONVERSATIONAL_CHANNELS.includes(contract.decisionInputs.channelType)
                    ? 'channel_not_certified'
                    : null
        ) ?? contract.excluded.find(entry => (
            entry.reason === 'profile_blocked'
            || entry.reason === 'role_not_operational'
            || entry.reason === 'channel_not_certified'
        ))?.reason ?? 'profile_blocked';
        return { status: 'blocked', reason: blockingReason, profileId: contract.subtypeProfileId };
    }
    if (contract.degraded) {
        return { status: 'degraded', reason: 'gate_unevaluable', profileId: contract.subtypeProfileId };
    }
    return { status: 'ok', profileId: contract.subtypeProfileId };
}

/**
 * Resolves one immutable capability snapshot before Booking, Procedures,
 * confirmations or the LLM can consume anything.
 *
 * The base resolver owns subtype/plan/readiness/provider decisions. This layer
 * composes the runtime-only families (payments, discounts, approved MCP and the
 * derived identity key) into that same contract. Previously those families
 * were appended after the deterministic consumers had already run, so the LLM
 * could ask for a payment that the subsequent "yes" was never authorised to
 * execute.
 */
@Injectable()
export class TurnCapabilityComposerService {
    private readonly logger = new Logger(TurnCapabilityComposerService.name);

    constructor(
        private readonly effectiveCapability: EffectiveCapabilityService,
        private readonly paymentOperations: PaymentOperationService,
        private readonly verticalIntegrations: VerticalIntegrationsService,
        private readonly mcpClient: McpClientService,
    ) {}

    async resolve(input: ComposeTurnCapabilityInput): Promise<ComposedTurnCapability> {
        const cfgTools = input.config.tools ?? {};
        const deniedTools = [...subpermissionDeniedToolNames(cfgTools)];
        let providers: Readonly<Record<string, ProviderHealthInput>> | undefined;

        try {
            const health = await this.verticalIntegrations.getAllHealth(input.tenantId);
            providers = Object.fromEntries(Object.entries(health).map(([name, value]: [string, any]) => [
                name,
                {
                    configured: value?.configured === undefined
                        ? !!value?.connected
                        : !!value.configured,
                    connected: !!value?.connected,
                    // `stale` describes the mirror, not the live rail. Keep the
                    // connection usable for live tools while mirror-backed
                    // tools are evaluated against `mirrorAsOf` below.
                    healthy: !!value?.connected
                        && !['unavailable', 'unhealthy', 'not_applicable'].includes(value?.status)
                        && value?.scopeStatus !== 'missing'
                        && value?.circuitState !== 'open',
                    scopes: value?.grantedScopes,
                    mirrorAsOf: value?.lastSuccessfulSyncAt || undefined,
                },
            ]));
        } catch (error: any) {
            this.logger.debug(`Provider health unavailable for ${input.tenantId}: ${error?.message}`);
            // Availability may be unknown while ownership is still certain.
            // Preserve the durable binding and publish no provider reads; the
            // base resolver will continue displacing the covered local writer.
            try {
                const bindings = await this.verticalIntegrations
                    .getConfiguredProviderBindings(input.tenantId);
                providers = Object.fromEntries(Object.entries(bindings).map(([name, configured]) => [
                    name,
                    { configured, connected: false, healthy: undefined },
                ]));
            } catch (bindingError: any) {
                this.logger.debug(
                    `Provider ownership unavailable for ${input.tenantId}: ${bindingError?.message}`,
                );
            }
        }

        let base: EffectiveCapabilityContract;
        try {
            base = await this.effectiveCapability.resolve({
                tenantId: input.tenantId,
                schemaName: input.schemaName,
                industry: input.industry,
                subType: input.subType,
                toolsConfig: cfgTools,
                agentId: input.agentId,
                role: input.role,
                channelType: input.channelType,
                operatingCountry: input.operatingCountry,
                jurisdiction: input.jurisdiction,
                providers,
            });
        } catch (error: any) {
            this.logger.warn(`Capability contract unresolved for ${input.tenantId}: ${error?.message}`);
            const status: TurnCapability = {
                status: 'unresolved',
                reason: 'resolver_failed',
                profileId: input.subType ? `${input.industry}/${input.subType}` : input.industry,
            };
            const authorityInput: TurnAuthorityInput = {
                contract: null,
                commitmentBlocked: { reason: 'capability:unresolved:resolver_failed' },
                deniedTools,
                subtypeProfileId: status.profileId,
            };
            return {
                contract: null,
                status,
                tools: [],
                authority: buildTurnAuthority(authorityInput, []),
                deniedTools,
                commitmentBlocked: authorityInput.commitmentBlocked,
            };
        }

        const baseAllowed = new Set(base.publishedTools);
        let tools = uniqueTools([
            ...staticToolsForAgentConfig(cfgTools),
            ...Object.values(PROVIDER_DEFINITIONS),
        ]).filter(tool => baseAllowed.has(String(tool.name)));

        const exclusions = [...base.excluded];
        let degraded = base.degraded;

        // Runtime money capability includes the current plan, provider support
        // and provider readiness. It is resolved now, not after Procedures and
        // pending confirmations.
        const needsMoney = (cfgTools as any)?.payments?.enabled === true
            || (cfgTools as any)?.ecommerce?.canApplyDiscount === true;
        if (needsMoney) {
            try {
                const paymentCapability = await this.paymentOperations.getRuntimeCapability(input.tenantId);
                const paymentTools = paymentToolsForRuntime((cfgTools as any).payments, paymentCapability);
                const discountTools = discountToolsForRuntime({
                    canApplyDiscount: (cfgTools as any)?.ecommerce?.canApplyDiscount,
                    maxDiscountPercent: input.config.upsell?.maxDiscountPercent,
                }, paymentCapability);
                tools = uniqueTools([...tools, ...paymentTools, ...discountTools]);

                if ((cfgTools as any)?.payments?.enabled === true
                    && (cfgTools as any)?.payments?.canCreateLinks === true
                    && !paymentTools.some(tool => String(tool.name) === 'create_payment_link')) {
                    exclusions.push({
                        subject: 'payments',
                        reason: paymentCapability.planEnabled ? 'provider_unavailable' : 'plan_missing_feature',
                        detail: paymentCapability.planEnabled
                            ? CAPABILITY_EXCLUSION_TEXT.provider_unavailable
                            : CAPABILITY_EXCLUSION_TEXT.plan_missing_feature,
                        repairRoute: paymentCapability.planEnabled
                            ? '/admin/settings/integrations/vertical'
                            : '/admin/settings/billing',
                    });
                }
            } catch (error: any) {
                degraded = true;
                exclusions.push({
                    subject: 'payments',
                    reason: 'provider_unavailable',
                    detail: CAPABILITY_EXCLUSION_TEXT.provider_unavailable,
                    repairRoute: '/admin/settings/integrations/vertical',
                });
                this.logger.warn(`Payment capability unavailable for ${input.tenantId}: ${error?.message}`);
            }
        }

        // MCP discovery is not authority. `listPublishableTools` already keeps
        // only tools whose effect/confirmation policy a person reviewed.
        try {
            const mcp = await this.mcpClient.listPublishableTools(input.tenantId);
            tools = uniqueTools([...tools, ...mcp.tools]);
            if (mcp.discoveredCount > mcp.approvedCount) {
                exclusions.push({
                    subject: 'mcp',
                    reason: 'not_approved',
                    detail: CAPABILITY_EXCLUSION_TEXT.not_approved,
                    repairRoute: '/admin/settings/integrations/vertical',
                });
            }
        } catch (error: any) {
            degraded = true;
            this.logger.debug(`MCP capability unavailable for ${input.tenantId}: ${error?.message}`);
        }

        // STOP/role/channel apply to every origin. Reviewed MCP reads survive;
        // unknown or non-read MCP effects remain conservative.
        if (base.writersBlocked) {
            tools = tools.filter((tool: ToolDefinition & { reviewedEffect?: string | null }) => {
                const name = String(tool.name);
                if (name.startsWith('mcp__')) return tool.reviewedEffect === 'read';
                return isNonCommittalTool(name);
            });
        }

        tools = uniqueTools([...tools, ...identityStepUpToolsFor(tools)]);
        const publishedTools = tools.map(tool => String(tool.name));
        const contract: EffectiveCapabilityContract = {
            ...base,
            publishedTools,
            excluded: exclusions,
            degraded,
            publishedByOrigin: Object.freeze({
                core: publishedTools.filter(name => toolOrigin(name) === 'core'),
                vertical: publishedTools.filter(name => toolOrigin(name) === 'vertical'),
                provider: publishedTools.filter(name => toolOrigin(name) === 'provider'),
                mcp: publishedTools.filter(name => name.startsWith('mcp__')),
            }),
        };
        const status = statusFor(contract);
        const commitmentBlocked = status.status === 'ok' || status.status === 'degraded'
            ? null
            : { reason: `capability:${status.status}:${status.reason ?? 'sin_motivo'}` };
        const authorityInput: TurnAuthorityInput = {
            contract,
            commitmentBlocked,
            deniedTools,
            subtypeProfileId: contract.subtypeProfileId,
        };

        return {
            contract,
            status,
            tools,
            authority: buildTurnAuthority(authorityInput, publishedTools),
            deniedTools,
            commitmentBlocked,
        };
    }
}
