import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
    TenantConfig,
    TurnContext,
    TestAgentRequest,
    TestAgentResponse,
    TestAgentToolCall,
    RetrievedKnowledgeItem,
} from '@parallext/shared';
import { PersonaService } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { BusinessInfoService } from '../business-info/business-info.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { LanguageDetectorService } from './language-detector.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { discountToolsForRuntime, paymentToolsForRuntime } from './payment-tool-registration';
import { identityStepUpToolsFor } from './identity-step-up-registration';
import { buildToolParityReport } from './agent-test-parity';
import {
    GET_RESTAURANT_MENU_TOOL,
    GET_FITNESS_SCHEDULE_TOOL,
    LIST_CLINIC_SERVICES_TOOL,
    CHECK_CLINIC_AVAILABILITY_TOOL,
} from './tools/vertical-integration-tools';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { PaymentOperationService } from './payment-operation.service';
import { VerticalIntegrationsService } from '../vertical-integrations/vertical-integrations.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { TenantsService } from '../tenants/tenants.service';
import {
    agentTestBlockedToolResult,
    canEvalExecuteWriter,
    EVAL_WRITABLE_TOOL_NAMES,
    isAgentTestSafeToolName,
    isEvalWritableToolName,
    resolveAgentTestContactId,
} from './agent-test-tool-policy';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import {
    allowedModelTiersForPlan,
    clampModelTiersToBudget,
} from './agent-test-plan-policy';
import { ActiveOperationsContextService } from './active-operations-context.service';

/**
 * AgentTestService — runs the bounded prompt/read-only-tool preview for one
 * message without persisting business state. It is not a delivery-channel or
 * writer sandbox. Real provider usage and the monthly AI quota are accounted.
 */
@Injectable()
export class AgentTestService {
    private readonly logger = new Logger(AgentTestService.name);

    constructor(
        private readonly personaService: PersonaService,
        private readonly llmRouter: LLMRouterService,
        private readonly knowledgeService: KnowledgeService,
        private readonly businessInfoService: BusinessInfoService,
        private readonly promptAssembler: PromptAssemblerService,
        private readonly languageDetector: LanguageDetectorService,
        private readonly toolExecutor: AIToolExecutorService,
        private readonly tenantsService: TenantsService,
        private readonly throttle: TenantThrottleService,
        private readonly activeOperationsContext: ActiveOperationsContextService,
        // Optional: the specs build this service by hand, and a test that loses
        // a family is better than a test that cannot start. Every one of these
        // is a real provider in ConversationsModule, so production always
        // resolves the full contract.
        private readonly regionalProfile?: RegionalProfileService,
        private readonly paymentOperations?: PaymentOperationService,
        private readonly verticalIntegrations?: VerticalIntegrationsService,
        private readonly mcpClient?: McpClientService,
    ) {}

    async test(
        tenantId: string,
        agentId: string,
        req: TestAgentRequest,
        options?: {
            disableTools?: boolean;
            evalMode?: boolean;
            sandboxContactId?: string;
            /**
             * Sandbox conversation the evaluation gate created for this run. The
             * central guard binds every write to a conversation and an inbound
             * message; without one, an audited writer is rejected with
             * `conversation_context_required` and the gate can never verify that
             * the booking it asked for actually happened.
             */
            sandboxConversationId?: string;
        },
    ): Promise<TestAgentResponse> {
        const startedAt = Date.now();

        // 1. Resolve the agent config (may be a draft the user just saved)
        const executionContext = AGENT_TEST_EXECUTION_CONTEXT;
        const agent = await this.personaService.getAgent(tenantId, agentId, executionContext);
        if (!agent) throw new NotFoundException('Agent not found');
        const config = agent.config_json as TenantConfig;
        const schemaName = await this.tenantsService.getSchemaName(tenantId, executionContext);
        const testContactId = resolveAgentTestContactId(options?.sandboxContactId);

        // 2. Build the shared safe turn-context shape. This is intentionally a
        // subset of live runtime state, not a claim of full production parity.
        const configuredLanguage = config.language || 'es-CO';
        const detectedLanguage = this.languageDetector.detect(req.message, configuredLanguage);
        // Resolved once and reused: the clock, the currency and the jurisdiction
        // gate all have to be the ones production would use, or the test is
        // measuring a different agent.
        const regional = await this.regionalProfile?.resolve(tenantId).catch(() => null);
        const tz = config.hours?.timezone || regional?.timezone.value || 'America/Bogota';
        const now = new Date();

        const turnContext: TurnContext = {
            language: detectedLanguage,
            timezone: tz,
            now: now.toISOString(),
            upcomingDays: this.promptAssembler.computeUpcomingDays(now, tz, 8),
            businessHoursStatus: 'unknown',
            contact: {
                isKnown: false,
                name: 'Test User',
            },
        };

        // Same operating identity as live. Without it the test ran on a
        // Colombian clock and a Colombian currency whatever the tenant was, so
        // its answers about "mañana" and prices were not the ones production
        // would give.
        if (regional) {
            turnContext.regional = {
                operatingCountry: regional.operatingCountry.value,
                currency: regional.operatingCurrency.value,
                locale: regional.locale.value,
                addressForm: regional.addressForm.value,
                countryPackId: regional.countryPackId,
                countryPackVersion: regional.countryPackVersion,
                countryPackStatus: regional.countryPackStatus,
            };
        }

        // Same read-only, ownership-scoped operational context as production.
        await this.activeOperationsContext.populateTurnContext(turnContext, {
            tenantId,
            schemaName,
            contactId: testContactId,
            config: config as any,
            timezone: tz,
            now,
        });

        // Business identity
        try {
            const bi = await this.businessInfoService.getPrimary(tenantId, executionContext);
            if (bi) {
                turnContext.business = {
                    companyName: bi.companyName,
                    industry: bi.industry,
                    about: bi.about,
                    phone: bi.phone,
                    email: bi.email,
                    website: bi.website,
                    address: bi.address,
                    city: bi.city,
                    country: bi.country,
                    socialLinks: bi.socialLinks,
                };
            }
        } catch { /* Business identity is optional in Agent Test. */ }

        // 3. RAG (respects agent config topK + threshold)
        const ragHits: RetrievedKnowledgeItem[] = [];
        try {
            const ragConfig = config.rag;
            if (ragConfig?.enabled !== false) {
                const hasKnowledge = await this.knowledgeService.tenantHasKnowledge(tenantId, executionContext);
                if (hasKnowledge) {
                    const topK = ragConfig?.topK ?? 5;
                    const similarityThreshold = ragConfig?.similarityThreshold ?? 0;
                    const results = await this.knowledgeService.searchRelevant(
                        tenantId,
                        req.message,
                        topK,
                        {
                            similarityThreshold,
                            executionContext,
                            // Same jurisdiction gate as live: a test that can
                            // read another country's regulated sources proves
                            // nothing about what production will answer.
                            jurisdiction: regional?.operatingCountry.value,
                        },
                    );
                    for (const r of results) {
                        ragHits.push({
                            source: 'kb_article',
                            id: String(r.id ?? r.document_id),
                            score: typeof r.score === 'number' ? r.score : r.similarity,
                            title: r.title,
                            content: r.chunk_text,
                        });
                    }
                    if (ragHits.length > 0) turnContext.retrievedKnowledge = ragHits;
                }
            }
        } catch (e: any) {
            this.logger.warn(`[Test] RAG failed: ${e.message}`);
        }

        // 4. Tools — enable based on config flags (NO booking engine in test mode
        // to keep this pipeline simple and synchronous).
        // In simulation mode (T2.13) tools are disabled so a pre-deploy run can
        // execute dozens of scenarios without ever writing to production
        // (no real appointments/orders created, no events emitted).
        const cfgTools = options?.disableTools ? null : ((config.tools ?? (config as any)?.tools) as any);
        // Same registry as production. This block used to be its own copy of the
        // family list, so a tool family added to the pipeline silently never
        // appeared in Agent Test — a test that cannot see a tool cannot catch a
        // regression in it.
        const tools: any[] = [...staticToolsForAgentConfig(cfgTools)];

        // Resolution parity with production. These four families were simply
        // ABSENT from Agent Test, so an owner could test an agent and ship
        // something whose real contract they had never seen. They are resolved
        // here and reported; whether the test may RUN them is a separate
        // question, answered per tool below.
        try {
            const capability = await this.paymentOperations?.getRuntimeCapability(tenantId);
            if (capability) {
                if (cfgTools?.payments?.enabled === true) {
                    tools.push(...paymentToolsForRuntime(cfgTools.payments, capability));
                }
                tools.push(...discountToolsForRuntime(
                    {
                        canApplyDiscount: cfgTools?.ecommerce?.canApplyDiscount,
                        maxDiscountPercent: (config as any)?.upsell?.maxDiscountPercent,
                    },
                    capability,
                ));
            }
        } catch (e: any) {
            this.logger.debug(`[Test] payment capability unavailable: ${e.message}`);
        }
        try {
            const connected = await this.verticalIntegrations?.getConnectedProviders(tenantId);
            if (connected?.toast) tools.push(GET_RESTAURANT_MENU_TOOL);
            if (connected?.mindbody) tools.push(GET_FITNESS_SCHEDULE_TOOL);
            if (connected?.cliniko) tools.push(LIST_CLINIC_SERVICES_TOOL, CHECK_CLINIC_AVAILABILITY_TOOL);
        } catch (e: any) {
            this.logger.debug(`[Test] vertical integration gating skipped: ${e.message}`);
        }
        try {
            const mcp = await this.mcpClient?.listPublishableTools(tenantId);
            if (mcp?.tools?.length) tools.push(...mcp.tools);
        } catch (e: any) {
            this.logger.debug(`[Test] MCP tool resolution skipped: ${e.message}`);
        }
        // The OTP pair is derived from the A2 tools actually resolved, exactly
        // as production does — so a test can show that a guarded read has its
        // key, which is the failure this environment most needs to surface.
        tools.push(...identityStepUpToolsFor(tools));

        // What production would publish vs what this environment may execute.
        // The gap is the report: a tool that quietly disappears teaches the
        // operator that it does not exist.
        const toolParity = buildToolParityReport(tools);

        // Agent Test always points at the tenant's real schema. Advertise only the
        // audited read-only subset. evalMode alone is execution metadata; it is
        // NOT permission to write production data. Vertical integrations and MCP
        // stay unavailable until they have an isolated sandbox/read-only contract
        // (see agent-test-tool-policy.ts).
        //
        // The evaluation gate adds exactly the audited writers, and only when the
        // run is bound to the eval sandbox contact AND a sandbox conversation to
        // hang the operation off. Anything less and the writer stays hidden.
        const evalWritesAllowed = options?.evalMode === true
            && !!options?.sandboxConversationId
            && EVAL_WRITABLE_TOOL_NAMES.some(name => canEvalExecuteWriter(name, testContactId));
        const safeTools = tools.filter((t: any) => (
            isAgentTestSafeToolName(t?.name)
            || (evalWritesAllowed && isEvalWritableToolName(t?.name))
        ));
        tools.length = 0;
        tools.push(...safeTools);

        // 5. Assemble the FULL system prompt (Layer 1 + 2 + 3).
        const systemPrompt = this.promptAssembler.assemble(config, turnContext);

        // 6. Compose messages: history + current user message.
        const messages: Array<{ role: string; content: string }> = [];
        if (req.conversationHistory?.length) {
            for (const m of req.conversationHistory) {
                messages.push({ role: m.role, content: m.content });
            }
        }
        messages.push({ role: 'user', content: req.message });

        // 7. Run the LLM with tool loop (max 3 iterations in test mode to keep it bounded).
        if (!(await this.throttle.hasAiMessageQuota(tenantId))) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.TOO_MANY_REQUESTS,
                    error: 'ai_message_quota_exhausted',
                    message: 'La cuota mensual de mensajes de IA del plan está agotada.',
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const planFeatures = await this.throttle.getPlanFeatures(tenantId);
        let allowedTiers = allowedModelTiersForPlan(planFeatures.llmTier);
        const budgetUsdCents = typeof planFeatures.llmCostBudgetUsdCents === 'number'
            ? planFeatures.llmCostBudgetUsdCents
            : -1;
        if (budgetUsdCents > 0) {
            const spentUsdCents = await this.throttle.getLlmSpendUsdCents(tenantId);
            const budgetTiers = clampModelTiersToBudget(
                allowedTiers,
                spentUsdCents,
                budgetUsdCents,
            );
            if (budgetTiers.join(',') !== allowedTiers.join(',')) {
                this.logger.warn(
                    `[Test] tenant ${tenantId} over monthly LLM budget; `
                    + `clamping tiers to ${budgetTiers.join(',')}`,
                );
            }
            allowedTiers = budgetTiers;
        }

        const toolCalls: TestAgentToolCall[] = [];
        const currentMessages = [...messages] as any[];
        let finalResponse = '';
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCost = 0;
        let model = 'gpt-4.1-mini';
        let successfulProviderCalls = 0;

        const MAX_ITERATIONS = 3;
        try {
            for (let i = 0; i < MAX_ITERATIONS; i++) {
                const hasTools = tools.length > 0;
                const response = await this.llmRouter.execute({
                    task: hasTools ? 'tool_calling' : 'conversation',
                    messages: currentMessages,
                    systemPrompt,
                    temperature: hasTools ? 0.3 : (config.llm?.temperature ?? 0.7),
                    tools: hasTools ? tools : undefined,
                    allowedTiers,
                    tenantId,
                    executionContext,
                });
                successfulProviderCalls++;

                totalInputTokens += (response as any).usage?.inputTokens ?? (response as any).usage?.prompt_tokens ?? 0;
                totalOutputTokens += (response as any).usage?.outputTokens ?? (response as any).usage?.completion_tokens ?? 0;
                totalCost += (response as any).cost ?? 0;
                model = (response as any).model ?? model;

                if (response.toolCalls?.length) {
                    currentMessages.push({
                        role: 'assistant',
                        content: response.content || '',
                        toolCalls: response.toolCalls,
                    });
                    for (const tc of response.toolCalls) {
                        const args = this.safeJsonParse(tc.function.arguments);
                        const tStart = Date.now();
                        // Do not trust toolCalls merely because the provider returned
                        // them: a model can emit an unadvertised writer or mcp__* name.
                        // Enforce the same default-deny policy at the execution boundary.
                        const isAuditedEvalWriter = evalWritesAllowed
                            && canEvalExecuteWriter(tc.function.name, testContactId);
                        const result = (isAgentTestSafeToolName(tc.function.name) || isAuditedEvalWriter)
                            ? await this.toolExecutor.execute(
                                schemaName,
                                tenantId,
                                testContactId,
                                tc.function.name,
                                args,
                                // The audited writer needs the sandbox conversation:
                                // the central guard refuses to bind a write with
                                // nowhere to record the confirmation.
                                isAuditedEvalWriter ? options?.sandboxConversationId : undefined,
                                {
                                    evalMode: isAuditedEvalWriter,
                                    readOnly: !isAuditedEvalWriter,
                                    executionContext,
                                },
                            )
                            : agentTestBlockedToolResult(tc.function.name);
                        const dur = Date.now() - tStart;
                        toolCalls.push({
                            name: tc.function.name,
                            args,
                            result,
                            durationMs: dur,
                        });
                        currentMessages.push({
                            role: 'tool',
                            toolCallId: tc.id,
                            content: JSON.stringify(result),
                        });
                    }
                    continue;
                }

                finalResponse = response.content || '';
                break;
            }
        } finally {
            // Quota is per tested turn (not per internal tool-loop call), but a
            // turn that already consumed a provider call remains billable even
            // if a later tool-loop call fails.
            if (successfulProviderCalls > 0) {
                await this.throttle.incrementAiMessageCount(tenantId).catch((error: any) => {
                    this.logger.warn(`[Test] AI quota accounting failed: ${error.message}`);
                });
            }
        }

        const latencyMs = Date.now() - startedAt;

        return {
            reply: finalResponse,
            debug: {
                systemPrompt,
                toolCalls,
                ragHits,
                tokens: { input: totalInputTokens, output: totalOutputTokens },
                cost: totalCost,
                model,
                latencyMs,
                turnContext,
                // What production would publish for this agent, and which of
                // those the test may actually run. Without this the operator
                // saw a smaller toolset with no indication it was smaller, and
                // shipped an agent whose real contract they had never seen.
                toolParity,
                // The operating identity the run used, so a wrong clock or
                // currency in a test is visible instead of being blamed on the
                // model.
                regional: turnContext.regional ?? null,
            },
        };
    }

    private safeJsonParse(s: string): Record<string, any> {
        try { return JSON.parse(s); }
        catch { return {}; }
    }
}
