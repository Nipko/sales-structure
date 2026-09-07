import { ConversationsService } from '../conversations.service';
import { AgentTestService } from '../agent-test.service';
import { BookingEngineService } from '../booking-engine.service';
import { ProcedureEngineService } from '../procedure-engine.service';
import { PromptAssemblerService } from '../prompt-assembler.service';
import { ResponseValidatorService } from '../response-validator.service';
import { LanguageDetectorService } from '../language-detector.service';
import { LLMRouterService } from '../../ai/router/llm-router.service';
import { authorityFor } from './tool-authority.fixture';
import { assertRevisionIntegrity, sealRevision } from '../../evaluation-revision/evaluation-revision';

/** Real orchestration/engines/guards; only I/O boundaries are substitutes. */
export function agentTurnFixture(overrides: Record<string, any> = {}) {
    const forbidden = (name: string) => jest.fn(() => { throw new Error(`unexpected effect: ${name}`); });
    const redis = { get: forbidden('redis.get'), getJson: forbidden('redis.getJson'),
        set: forbidden('redis.set'), setJson: forbidden('redis.setJson'), del: forbidden('redis.del') };
    const prisma = {
        tenant: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) },
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
            if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error(`unexpected SQL write: ${sql}`);
            return [];
        }),
    };
    const personaService = { getAgent: jest.fn().mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'retail', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } }), buildSystemPrompt: jest.fn().mockReturnValue('<persona>Atiende con claridad.</persona>') };
    const llmRouter = Object.assign(Object.create(LLMRouterService.prototype), {
        execute: jest.fn().mockResolvedValue({ content: 'Puedo ayudarte.', model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 }),
    });
    const throttle = { hasAiMessageQuota: jest.fn().mockResolvedValue(true),
        getPlanFeatures: jest.fn().mockResolvedValue({ llmTier: 'tier_2', llmCostBudgetUsdCents: -1 }),
        getLlmSpendUsdCents: jest.fn().mockResolvedValue(0), incrementAiMessageCount: jest.fn().mockResolvedValue(1) };
    const toolExecutor = { execute: jest.fn(async (_s: any, _t: any, _c: any, name: any, _a: any, _cid: any, opts: any) =>
        opts.authority.allowedTools.includes(name) ? { items: [] } : { error: 'tool_not_authorised' }) };
    const contract = { version: 1, publishedTools: [], excluded: [], publishedGroups: [],
        publishedByOrigin: { core: [], vertical: [], provider: [], mcp: [] }, writersBlocked: false,
        unmetReadiness: [], decisionInputs: {}, subtypeProfileId: 'retail/moda', resolvedAt: new Date().toISOString() };
    const turnCapabilityComposer = { resolve: jest.fn().mockResolvedValue({ contract,
        status: { status: 'ok', profileId: 'retail/moda' }, tools: [], authority: authorityFor(),
        deniedTools: [], commitmentBlocked: null }) };
    const deps: any = { prisma, redis, personaService, llmRouter, throttle, toolExecutor, turnCapabilityComposer,
        revisions: { capture: jest.fn(async (tenantId: string) => sealRevision(tenantId,[{key:'fixture',state:'present',hash:'fixture'}],[])),
            assertCurrent: jest.fn(async manifest => assertRevisionIntegrity(manifest)), captureProcedures: jest.fn().mockResolvedValue([]),
            captureAgentReleaseScope: jest.fn().mockResolvedValue({profileId:null,intentKeys:[],missionConfigured:false,channels:[],languages:['es','en','pt','fr']}) },
        mcp: { listPublishableTools: jest.fn().mockResolvedValue({tools:[],discoveredCount:0,approvedCount:0}) },
        integrations: { getAllHealth: jest.fn().mockResolvedValue({}) },
        tenantsService: { getSchemaName: jest.fn().mockResolvedValue('tenant_test') },
        knowledgeService: { tenantHasKnowledge: jest.fn().mockResolvedValue(false), searchRelevant: jest.fn().mockResolvedValue([]) },
        businessInfoService: { getPrimary: jest.fn().mockResolvedValue(null) },
        activeOperationsContext: { populateTurnContext: jest.fn().mockResolvedValue({ failures: [] }) },
        toolExecutionControl: { findPendingConfirmation: jest.fn().mockResolvedValue(null) },
        verticalTurnContext: { resolve: jest.fn().mockResolvedValue({ industry: 'retail', subType: 'moda' }) },
        responseValidator: new ResponseValidatorService(), languageDetector: new LanguageDetectorService(),
        customerMemory: { getMemory: jest.fn().mockResolvedValue(null), extractAndPersist: forbidden('memory.extract') },
        eventEmitter: { emit: forbidden('emit') }, outboundQueue: { enqueue: forbidden('outbound') },
        handoffService: { executeHandoff: forbidden('handoff'), isInHandoff: forbidden('handoff.read') },
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        ...overrides,
    };
    deps.bookingEngine = overrides.bookingEngine || new BookingEngineService(deps.prisma, deps.redis, deps.toolExecutor);
    deps.procedureEngine = overrides.procedureEngine || new ProcedureEngineService(deps.prisma, deps.redis, deps.toolExecutor);
    deps.promptAssembler = overrides.promptAssembler || new PromptAssemblerService(deps.personaService);
    const runtime = Object.assign(Object.create(ConversationsService.prototype), deps) as ConversationsService;
    const service = new AgentTestService(deps.personaService, deps.tenantsService, deps.throttle, runtime, deps.learning, undefined,
        deps.revisions, deps.mcp, deps.integrations);
    return { ...deps, runtime, service, contract };
}

export function publishTools(fixture: ReturnType<typeof agentTurnFixture>, names: string[]) {
    const contract = { ...fixture.contract, publishedTools: names };
    fixture.turnCapabilityComposer.resolve.mockResolvedValue({ contract,
        status: { status: 'ok', profileId: 'retail/moda' },
        tools: names.map(name => ({ name, description: name, parameters: { type: 'object', properties: {} } })),
        authority: authorityFor(...names), deniedTools: [], commitmentBlocked: null });
    return contract;
}
