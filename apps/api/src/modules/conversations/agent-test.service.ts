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
import { APPOINTMENT_TOOLS } from './tools/appointment-tools';
import { CATALOG_TOOLS, OFFER_TOOL } from './tools/catalog-tools';
import { FAQ_TOOL, POLICY_TOOL, KB_TOOL } from './tools/knowledge-tools';
import { ORDER_TOOL, CUSTOMER_CONTEXT_TOOL } from './tools/crm-tools';
import { VACATION_RENTAL_TOOLS } from './tools/vacation-rental-tools';
import { TOURS_TOOLS } from './tools/tours-tools';
import { TREATMENT_TOOLS } from './tools/treatment-tools';
import { LISTINGS_TOOLS } from './tools/listings-tools';
import { VEHICLE_TOOLS } from './tools/vehicle-tools';
import { PETS_TOOLS } from './tools/pets-tools';
import { RESTAURANTS_TOOLS } from './tools/restaurants-tools';
import { GYMS_TOOLS } from './tools/gyms-tools';
import { EDUCATION_TOOLS } from './tools/education-tools';
import { INSURANCE_TOOLS } from './tools/insurance-tools';
import {
    HOME_SERVICES_TOOLS,
    PET_SERVICES_TOOLS,
    PHOTOGRAPHY_TOOLS,
    PROFESSIONAL_SERVICES_TOOLS,
} from './tools/tier3-tools';
import { ECOMMERCE_TOOLS } from './tools/ecommerce-tools';
import { TenantsService } from '../tenants/tenants.service';
import {
    agentTestBlockedToolResult,
    isAgentTestSafeToolName,
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
    ) {}

    async test(
        tenantId: string,
        agentId: string,
        req: TestAgentRequest,
        options?: { disableTools?: boolean; evalMode?: boolean; sandboxContactId?: string },
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
        const tz = config.hours?.timezone || 'America/Bogota';
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
                        { similarityThreshold, executionContext },
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
        const tools: any[] = [];
        if (cfgTools?.appointments?.enabled === true) tools.push(...APPOINTMENT_TOOLS);
        if (cfgTools?.catalog?.enabled === true) tools.push(...CATALOG_TOOLS);
        if (cfgTools?.faqs?.enabled === true) tools.push(FAQ_TOOL);
        if (cfgTools?.policies?.enabled === true) tools.push(POLICY_TOOL);
        if (cfgTools?.knowledge?.enabled === true) tools.push(KB_TOOL);
        if (cfgTools?.offers?.enabled === true) tools.push(OFFER_TOOL);
        if (cfgTools?.orders?.enabled === true) tools.push(ORDER_TOOL);
        if (cfgTools?.crm?.enabled === true) tools.push(CUSTOMER_CONTEXT_TOOL);
        if (cfgTools?.properties?.enabled === true) tools.push(...VACATION_RENTAL_TOOLS);
        if (cfgTools?.tours?.enabled === true) tools.push(...TOURS_TOOLS);
        if (cfgTools?.treatments?.enabled === true) tools.push(...TREATMENT_TOOLS);
        if (cfgTools?.realEstate?.enabled === true) tools.push(...LISTINGS_TOOLS);
        if (cfgTools?.vehicles?.enabled === true) tools.push(...VEHICLE_TOOLS);
        if (cfgTools?.pets?.enabled === true) tools.push(...PETS_TOOLS);
        if (cfgTools?.restaurants?.enabled === true) tools.push(...RESTAURANTS_TOOLS);
        if (cfgTools?.gyms?.enabled === true) tools.push(...GYMS_TOOLS);
        if (cfgTools?.education?.enabled === true) tools.push(...EDUCATION_TOOLS);
        if (cfgTools?.insurance?.enabled === true) tools.push(...INSURANCE_TOOLS);
        if (cfgTools?.homeServices?.enabled === true) tools.push(...HOME_SERVICES_TOOLS);
        if (cfgTools?.petServices?.enabled === true) tools.push(...PET_SERVICES_TOOLS);
        if (cfgTools?.photography?.enabled === true) tools.push(...PHOTOGRAPHY_TOOLS);
        if (cfgTools?.professionalServices?.enabled === true) tools.push(...PROFESSIONAL_SERVICES_TOOLS);
        if (cfgTools?.ecommerce?.enabled === true) tools.push(...ECOMMERCE_TOOLS);

        // Agent Test always points at the tenant's real schema. Advertise only the
        // audited read-only subset, regardless of evalMode. In particular, evalMode
        // is execution metadata; it is NOT permission to write production data.
        // Vertical integrations and MCP stay unavailable until they have an isolated
        // sandbox/read-only contract (see agent-test-tool-policy.ts).
        const safeTools = tools.filter((t: any) => isAgentTestSafeToolName(t?.name));
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
                        const result = isAgentTestSafeToolName(tc.function.name)
                            ? await this.toolExecutor.execute(
                                schemaName,
                                tenantId,
                                testContactId,
                                tc.function.name,
                                args,
                                undefined,
                                { evalMode: false, readOnly: true, executionContext },
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
            },
        };
    }

    private safeJsonParse(s: string): Record<string, any> {
        try { return JSON.parse(s); }
        catch { return {}; }
    }
}
