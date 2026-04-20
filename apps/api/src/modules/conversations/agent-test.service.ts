import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
    TenantConfig,
    TurnContext,
    TestAgentRequest,
    TestAgentResponse,
    TestAgentToolCall,
    RetrievedKnowledgeItem,
    ChannelType,
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
import { TenantsService } from '../tenants/tenants.service';

const TEST_CONTACT_ID = 'test-agent-contact';

/**
 * AgentTestService — runs the full prompt pipeline for a single test message
 * without persisting anything. Used by the dashboard Test Agent UI so a user
 * can see exactly what the LLM sees before going live.
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
    ) {}

    async test(tenantId: string, agentId: string, req: TestAgentRequest): Promise<TestAgentResponse> {
        const startedAt = Date.now();

        // 1. Resolve the agent config (may be a draft the user just saved)
        const agent = await this.personaService.getAgent(tenantId, agentId);
        if (!agent) throw new NotFoundException('Agent not found');
        const config = agent.config_json as TenantConfig;

        // 2. Build turn context (same structure as production pipeline).
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

        // Business identity
        try {
            const bi = await this.businessInfoService.getPrimary(tenantId);
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
        } catch {}

        // 3. RAG (respects agent config topK + threshold)
        const ragHits: RetrievedKnowledgeItem[] = [];
        try {
            const ragConfig = config.rag;
            if (ragConfig?.enabled !== false) {
                const hasKnowledge = await this.knowledgeService.tenantHasKnowledge(tenantId);
                if (hasKnowledge) {
                    const topK = ragConfig?.topK ?? 5;
                    const similarityThreshold = ragConfig?.similarityThreshold ?? 0;
                    const results = await this.knowledgeService.searchRelevant(
                        tenantId, req.message, topK, { similarityThreshold },
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
        const cfgTools = (config.tools ?? (config as any)?.tools) as any;
        const tools: any[] = [];
        if (cfgTools?.appointments?.enabled === true) tools.push(...APPOINTMENT_TOOLS);
        if (cfgTools?.catalog?.enabled === true) tools.push(...CATALOG_TOOLS);
        if (cfgTools?.faqs?.enabled === true) tools.push(FAQ_TOOL);
        if (cfgTools?.policies?.enabled === true) tools.push(POLICY_TOOL);
        if (cfgTools?.knowledge?.enabled === true) tools.push(KB_TOOL);
        if (cfgTools?.offers?.enabled === true) tools.push(OFFER_TOOL);
        if (cfgTools?.orders?.enabled === true) tools.push(ORDER_TOOL);
        if (cfgTools?.crm?.enabled === true) tools.push(CUSTOMER_CONTEXT_TOOL);

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
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        const toolCalls: TestAgentToolCall[] = [];
        let currentMessages = [...messages] as any[];
        let finalResponse = '';
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCost = 0;
        let model = 'gpt-4.1-mini';

        const MAX_ITERATIONS = 3;
        for (let i = 0; i < MAX_ITERATIONS; i++) {
            const response = await this.llmRouter.execute({
                model: 'gpt-4.1-mini',
                messages: currentMessages,
                systemPrompt,
                temperature: config.llm?.temperature ?? 0.7,
                tools: tools.length > 0 ? tools : undefined,
                routingFactors: { ticketValue: 50, complexity: 50, conversationStage: 50, sentiment: 50, intentType: 50 },
            });

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
                    const result = await this.toolExecutor.execute(
                        schemaName, tenantId, TEST_CONTACT_ID, tc.function.name, args,
                    );
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
