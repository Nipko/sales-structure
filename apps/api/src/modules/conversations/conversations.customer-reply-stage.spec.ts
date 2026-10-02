import { ConversationsService } from './conversations.service';
import { DEFAULT_PIPELINE_STAGES, PipelineService, TenantStageMapping } from '../pipeline/pipeline.service';
import { VERTICAL_REGISTRY } from '../verticals/vertical-definitions';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const OPPORTUNITY_ID = '55555555-5555-4555-8555-555555555555';
const PIPELINE_ID = '66666666-6666-4666-8666-666666666666';
const SCHEMA = 'tenant_customer_reply_stage';
const ANSWER = 'Hola, te ayudo a encontrar una propiedad.';

// Use the actual catalog: respondio's 30% maps to visita_agendada, whose
// appointment requirement must also apply to the very first /start message.
const realEstateStages: TenantStageMapping[] = VERTICAL_REGISTRY.inmobiliaria.pipeline.stages.map((stage, position) => ({
    id: `stage-${position}`, pipeline_id: PIPELINE_ID, name: stage.name.es,
    slug: stage.slug, position, prob: stage.probability,
    is_terminal: stage.isTerminal, terminal_outcome: stage.terminalOutcome ?? null,
    transition_rules: stage.transitionRules,
}));
const genericStages: TenantStageMapping[] = DEFAULT_PIPELINE_STAGES.map((stage) => ({
    id: `stage-${stage.position}`, pipeline_id: PIPELINE_ID, name: stage.name,
    slug: stage.slug, position: stage.position, prob: stage.default_probability,
    is_terminal: stage.is_terminal, terminal_outcome: stage.terminal_outcome as 'won' | 'lost' | null,
    transition_rules: [],
}));

function fixture(stages = realEstateStages, options: { enabled?: boolean; hasAppointment?: boolean } = {}) {
    let persistedStage = stages[0].slug;
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM opportunities') && sql.includes('FOR UPDATE')) {
            return [{ id: OPPORTUNITY_ID, stage: persistedStage, won_at: null, lost_at: null }];
        }
        if (sql.includes('FROM leads l') && sql.includes('FOR UPDATE OF l')) {
            return [{ lead_id: LEAD_ID, contact_id: CONTACT_ID, first_name: 'Ana', score: 0,
                opportunity_id: OPPORTUNITY_ID, opportunity_created_at: new Date() }];
        }
        if (sql.includes('FROM appointments e')) return options.hasAppointment ? [{ exists: 1 }] : [];
        if (sql.includes('UPDATE opportunities')) persistedStage = String(params[0]);
        return [];
    });
    const prisma = {
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string) =>
            sql.includes('SELECT id, lead_id, stage')
                ? [{ id: OPPORTUNITY_ID, lead_id: LEAD_ID, stage: persistedStage }]
                : []),
        transactionInTenantSchema: jest.fn(async (_schema: string, callback: (tx: typeof query) => Promise<unknown>) => callback(query)),
    };
    const pipeline = new PipelineService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    Object.assign(pipeline, {
        ensurePipelinesTables: jest.fn().mockResolvedValue(undefined),
        migrateToMultiPipeline: jest.fn().mockResolvedValue(PIPELINE_ID),
        getTenantStageCatalog: jest.fn().mockResolvedValue(stages),
        syncExactOpportunityDealTx: jest.fn().mockResolvedValue(undefined),
        isAutoProgressEnabled: jest.fn().mockResolvedValue(options.enabled ?? true),
        // This suite isolates the early customer_reply writer. The later
        // signal-based writer has its own transition-rule coverage.
        autoProgressFromConversation: jest.fn().mockResolvedValue(undefined),
    });
    const writeStage = jest.spyOn(pipeline, 'writeLeadStage');
    const service: any = Object.create(ConversationsService.prototype);
    Object.assign(service, {
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        prisma, pipelineService: pipeline,
        redis: {
            acquireLockToken: jest.fn().mockResolvedValue('owned'),
            releaseLockToken: jest.fn().mockResolvedValue(true),
            renewLockToken: jest.fn().mockResolvedValue(true),
            get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined),
        },
        debounceBurst: jest.fn().mockResolvedValue(undefined),
        resolveConversation: jest.fn().mockResolvedValue({
            contact: { id: CONTACT_ID }, lead: { id: LEAD_ID },
            conversation: { id: CONVERSATION_ID, contact_id: CONTACT_ID, status: 'active', updated_at: new Date(), metadata: {} },
        }),
        tenantSchema: jest.fn().mockResolvedValue(SCHEMA),
        analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
        nurturingService: { cancelFollowUp: jest.fn().mockResolvedValue(undefined), scheduleFollowUp: jest.fn().mockResolvedValue(undefined) },
        dripSequenceService: { stopOnReply: jest.fn().mockResolvedValue(undefined) },
        leadScoring: { scoreAfterMessage: jest.fn().mockResolvedValue(undefined) },
        personaService: { resolvePersonaForChannel: jest.fn().mockResolvedValue({
            config: { language: 'es', hours: { aiOutsideHours: true } },
            agentId: '77777777-7777-4777-8777-777777777777', version: 1,
        }) },
        llmRouter: { analyzeComplexity: () => 0, analyzeSentiment: () => 0 },
        throttle: {
            getAiMessageUsage: jest.fn().mockResolvedValue({ used: 0, limit: Infinity }),
            reserveAiMessageCount: jest.fn().mockResolvedValue({ allowed: true }),
            commitAiMessageCount: jest.fn().mockResolvedValue(undefined),
            releaseAiMessageCount: jest.fn().mockResolvedValue(undefined),
        },
        handoffService: { isInHandoff: jest.fn().mockResolvedValue(false), shouldHandoff: jest.fn().mockReturnValue(null) },
        complianceService: { detectOptOut: jest.fn().mockReturnValue(false) },
        isWithinBusinessHours: jest.fn().mockReturnValue(true),
        loadTenantBusinessHours: jest.fn().mockResolvedValue(null),
        persistConversationPersonaResolution: jest.fn().mockResolvedValue(undefined),
        saveMessage: jest.fn().mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888', duplicate: false }),
        saveAiMessage: jest.fn().mockResolvedValue(undefined), recordAgentSignal: jest.fn(),
        generateResponse: jest.fn().mockResolvedValue(ANSWER),
        dispatchReplyThroughOutbox: jest.fn().mockResolvedValue(true),
    });
    const message: any = {
        id: 'provider-message', tenantId: TENANT_ID, contactId: '12345', channelType: 'telegram',
        channelAccountId: 'bot-connection', content: { type: 'text', text: '/start' }, metadata: {},
    };
    return { service, message, pipeline, query, writeStage, stage: () => persistedStage };
}

function expectReply(service: any) {
    expect(service.generateResponse).toHaveBeenCalledTimes(1);
    expect(service.dispatchReplyThroughOutbox).toHaveBeenCalledWith(expect.objectContaining({ chunks: [ANSWER] }));
}

describe('customer replies honor pipeline progression rules', () => {
    it('keeps a first real-estate /start in consulta without a viewing and still answers', async () => {
        const { service, message, pipeline, query, writeStage, stage } = fixture();
        await expect(pipeline.resolveTenantStage(TENANT_ID, 'respondio')).resolves.toMatchObject({ slug: 'visita_agendada' });

        await service.runTurn(message);

        expect(writeStage).toHaveBeenCalledWith(TENANT_ID, LEAD_ID, 'visita_agendada', expect.objectContaining({
            opportunityId: OPPORTUNITY_ID, triggeredBy: 'customer_reply', enforceTransitionRules: true,
        }));
        expect(query.mock.calls.some(([sql]) => sql.includes('FROM appointments e'))).toBe(true);
        expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE leads') || sql.includes('INSERT INTO stage_history'))).toBe(false);
        expect(stage()).toBe('consulta');
        expectReply(service);
    });

    it('still advances a generic initial stage to respondio and answers', async () => {
        const { service, message, stage } = fixture(genericStages);
        await service.runTurn(message);
        expect(stage()).toBe('respondio');
        expectReply(service);
    });

    it('allows the real-estate stage when its required appointment exists', async () => {
        const { service, message, stage } = fixture(realEstateStages, { hasAppointment: true });
        await service.runTurn(message);
        expect(stage()).toBe('visita_agendada');
        expectReply(service);
    });

    it('leaves the initial stage untouched when automatic progression is off', async () => {
        const { service, message, writeStage, stage } = fixture(genericStages, { enabled: false });
        await service.runTurn(message);
        expect(writeStage).not.toHaveBeenCalled();
        expect(stage()).toBe('nuevo');
        expectReply(service);
    });

    it('continues the reply if a stage write fails for an unexpected reason', async () => {
        const { service, message, writeStage, stage } = fixture(genericStages);
        writeStage.mockRejectedValueOnce(new Error('temporary stage storage failure'));
        await service.runTurn(message);
        expect(stage()).toBe('nuevo');
        expect(service.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Customer-reply progression failed'));
        expectReply(service);
    });
});
