import { SAFETY_TEMPLATES } from '@parallext/shared';
import { ConversationsService } from './conversations.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { ResponseValidatorService } from './response-validator.service';
import { LanguageDetectorService } from './language-detector.service';
import { SAFETY_TRIAGE_FLAG } from '../throttle/feature-flags.service';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';

/**
 * QA8 (production 2026-10): a dental agent answered «se me hinchó la cara, ¿qué
 * antibiótico me tomo?» and «tengo fiebre … desde la extracción de ayer» with an
 * ordinary appointment. With `agentRuntime.safetyTriage` on, a red flag owns
 * the turn: urgency advice, a priority handoff, and no booking.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const MODEL_REPLY = 'Con gusto le agendo una cita de valoración.';

type Classifier = { redFlag: boolean } | 'down';

function fixture(opts: { flag?: boolean; classifier?: Classifier; industry?: string; subType?: string } = {}) {
    const service: any = Object.create(ConversationsService.prototype);
    const executor: any = Object.create(AIToolExecutorService.prototype);
    executor.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const authority = { source: 'turn_contract', allowedTools: ['check_availability', 'create_appointment'], deniedTools: [], commitmentBlocked: null, resolvedAt: new Date().toISOString() };
    const tools = authority.allowedTools.map(name => ({ name, description: name, parameters: { type: 'object', properties: {} } }));
    const classifier = opts.classifier ?? { redFlag: true };
    const llm = jest.fn(async (request: any) => {
        if (request.task === 'classify') {
            if (classifier === 'down') throw new Error('All LLM providers failed');
            return { content: JSON.stringify({ redFlag: classifier.redFlag, safetyClass: classifier.redFlag ? 'dental_acute' : null, confidence: 0.9, evidence: '' }) };
        }
        return { content: MODEL_REPLY };
    });
    let metadata: any = {};
    const query = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        if (sql.startsWith('SELECT contact_id FROM conversations')) return [{ contact_id: CONTACT }];
        if (sql.startsWith('UPDATE conversations SET metadata=(COALESCE')) { metadata = { ...metadata, ...JSON.parse(params[1]) }; return [{ id: params[0] }]; }
        if (sql.startsWith('SELECT metadata FROM conversations')) return [{ metadata: structuredClone(metadata) }];
        if (sql.startsWith('UPDATE conversations SET metadata=') && params[2]) { metadata = { ...metadata, ...JSON.parse(params[2]) }; return [{ id: params[0] }]; }
        return [];
    });
    const verticalConfig = { industry: opts.industry ?? 'salud', subType: opts.subType ?? 'dental' };
    const bookingEngine: any = { process: jest.fn().mockResolvedValue({ handled: false, state: { step: 'idle' } }) };
    bookingEngine.forExecution = () => bookingEngine;
    const procedureEngine: any = { getState: jest.fn().mockResolvedValue(null), process: jest.fn().mockResolvedValue({ handled: false }), missionCandidates: jest.fn().mockResolvedValue([]) };
    procedureEngine.forExecution = () => procedureEngine;
    const featureFlags = { isFeatureEnabled: jest.fn(async (_tenant: string, key: string) => key === SAFETY_TRIAGE_FLAG && opts.flag === true) };
    Object.assign(service, {
        logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        prisma: { executeInTenantSchema: query, transactionInTenantSchema: (schema: string, work: any) => work((sql: string, params?: any[]) => query(schema, sql, params)),
            tenant: { findUnique: jest.fn().mockResolvedValue({ settings: { verticalConfig } }) } },
        redis: { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn().mockResolvedValue(undefined), del: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined),
            incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1), sadd: jest.fn().mockResolvedValue(1), rpush: jest.fn() },
        llmRouter: { analyzeComplexity: () => 0, analyzeSentiment: () => 0, stageToScore: () => 0, execute: llm },
        languageDetector: new LanguageDetectorService(),
        tenantSchema: jest.fn().mockResolvedValue('tenant_test'),
        isWithinBusinessHours: jest.fn().mockReturnValue(true),
        loadBookingState: jest.fn().mockResolvedValue({ step: 'idle' }),
        persistBookingState: jest.fn().mockResolvedValue(undefined),
        procedureEngine, bookingEngine,
        intentInterpreter: { interpret: jest.fn().mockResolvedValue({ intent: 'ask_availability', serviceMentioned: null, dateMentioned: null,
            timeMentioned: null, isConfirmation: false, isNegation: false, nameProvided: null, emailProvided: null, questionTopic: null, language: 'es' }) },
        activeOperationsContext: { populateTurnContext: jest.fn() },
        businessInfoService: { getPrimary: jest.fn().mockResolvedValue(null) },
        knowledgeService: { tenantHasKnowledge: jest.fn().mockResolvedValue(false), searchRelevant: jest.fn().mockResolvedValue([]),
            recordResponseAttribution: jest.fn().mockResolvedValue({ persistence: 'disabled' }) },
        turnCapabilityComposer: { resolve: jest.fn().mockResolvedValue({
            tools, authority, deniedTools: [], commitmentBlocked: null, status: { status: 'ok' },
            contract: { version: 1, publishedTools: authority.allowedTools, resolvedAt: authority.resolvedAt, excluded: [], writersBlocked: false },
        }) },
        toolExecutionControl: { findPendingConfirmation: jest.fn().mockResolvedValue(null) },
        mediaProcessing: { handlePendingConsentReply: jest.fn().mockResolvedValue({ handled: false }), processMedia: jest.fn(), getFallbackMessage: jest.fn() },
        toolExecutor: executor,
        handoffService: { executeHandoff: jest.fn().mockResolvedValue({}), isInHandoff: jest.fn().mockResolvedValue(false) },
        promptAssembler: new PromptAssemblerService({ buildSystemPrompt: () => '<persona>Asistente de la clínica dental</persona>' } as any),
        responseValidator: new ResponseValidatorService(),
        throttle: { getPlanFeatures: jest.fn().mockResolvedValue({ llmTier: 'tier_2' }) },
        analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
        eventEmitter: { emit: jest.fn() },
        featureFlags,
        sendMedia: jest.fn(), sendPaymentLink: jest.fn(), sendFlow: jest.fn(),
    });
    const config: any = { language: 'es', industry: verticalConfig.industry, behavior: {}, llm: {}, tools: { appointments: { enabled: true } } };
    const conversation = { id: '33333333-3333-4333-8333-333333333333', contact_id: CONTACT, updated_at: new Date(), metadata: {} };
    const run = (text: string) => service.generateResponse(
        TENANT, conversation,
        { channelType: 'whatsapp', channelAccountId: 'wa', content: { type: 'text', text }, metadata: {} },
        config, { id: CONTACT, name: 'Paciente QA' }, {}, conversation.updated_at, {}, '44444444-4444-4444-8444-444444444444', 'agent', undefined, 3,
    );
    const tasks = () => llm.mock.calls.map(([request]: any[]) => request.task);
    const signals = () => service.redis.incr.mock.calls.map(([key]: any[]) => String(key));
    return { service, run, llm, tasks, signals, bookingEngine, featureFlags, handoff: service.handoffService };
}

const urgencyWithNotice = (lang: 'es' | 'en' | 'pt' | 'fr', emergencyLine: string) =>
    `${SAFETY_TEMPLATES['urgency.dental'][lang].split('{emergencyLine}').join(emergencyLine)}\n\n${SAFETY_TEMPLATES['handoff.priority_notice'][lang]}`;

describe('health safety triage inside the turn (agentRuntime.safetyTriage)', () => {
    const PRODUCTION_QA8 = [
        'me duele una muela desde hace 3 días y se me hinchó la cara, ¿qué antibiótico me tomo?',
        'tengo fiebre y la encía muy inflamada desde la extracción de ayer',
    ];

    it.each(PRODUCTION_QA8)('flag on + red flag: urgency advice and a priority handoff, never the booking engine — «%s»', async text => {
        const t = fixture({ flag: true });
        const reply = await t.run(text);
        expect(reply).toBe(urgencyWithNotice('es', 'al número de emergencias de su país'));
        expect(t.handoff.executeHandoff).toHaveBeenCalledTimes(1);
        expect(t.handoff.executeHandoff.mock.calls[0][3]).toBe('safety_red_flag:dental_acute:priority=urgent');
        expect(t.bookingEngine.process).not.toHaveBeenCalled();
        expect(t.tasks()).toEqual(['classify']);
        expect(reply).not.toContain(MODEL_REPLY);
        expect(t.signals().some((key: string) => key.startsWith('agent:signal:safety_red_flag_escalated:'))).toBe(true);
    });

    it.each([
        ['es', 'se me inflamó el cachete y no puedo abrir la boca'],
        ['en', 'My face is swollen since the extraction yesterday and I have a fever'],
        ['pt', 'Meu rosto inchou depois da extração de ontem e estou com febre'],
        ['fr', "Ma joue a beaucoup gonflé depuis l'extraction d'hier et j'ai de la fièvre"],
    ] as const)('answers the red flag in the customer language (%s)', async (lang, text) => {
        const t = fixture({ flag: true });
        const reply = await t.run(text);
        const generic = { es: 'al número de emergencias de su país', en: 'your local emergency number', pt: 'o número de emergência do seu país', fr: "le numéro d'urgence de votre pays" }[lang];
        expect(reply).toBe(urgencyWithNotice(lang, generic));
        expect(t.handoff.executeHandoff).toHaveBeenCalledTimes(1);
        expect(t.bookingEngine.process).not.toHaveBeenCalled();
    });

    it('flag off: the turn is exactly the previous one — no classifier, no handoff, the engine runs', async () => {
        const t = fixture({ flag: false });
        const reply = await t.run(PRODUCTION_QA8[0]);
        expect(reply).toBe(MODEL_REPLY);
        expect(t.tasks()).not.toContain('classify');
        expect(t.handoff.executeHandoff).not.toHaveBeenCalled();
        expect(t.bookingEngine.process).toHaveBeenCalled();
    });

    it.each(['quiero blanqueamiento', 'hace un año tuve hinchazón'])('flag on, negative «%s»: no escalation', async text => {
        const t = fixture({ flag: true, classifier: { redFlag: false } });
        const reply = await t.run(text);
        expect(reply).toBe(MODEL_REPLY);
        expect(t.tasks()[0]).toBe('classify');
        expect(t.handoff.executeHandoff).not.toHaveBeenCalled();
    });

    it('the term list escalates over a classifier "no"', async () => {
        const t = fixture({ flag: true, classifier: { redFlag: false } });
        expect(await t.run(PRODUCTION_QA8[1])).toBe(urgencyWithNotice('es', 'al número de emergencias de su país'));
        expect(t.handoff.executeHandoff).toHaveBeenCalledTimes(1);
    });

    it('classifier down + term hit: the normal reply carries the urgency footer and a person is brought in after it', async () => {
        const t = fixture({ flag: true, classifier: 'down' });
        const reply = await t.run(PRODUCTION_QA8[0]);
        const footer = SAFETY_TEMPLATES['footer.human_health'].es.split('{emergencyLine}').join('al número de emergencias de su país');
        expect(reply.startsWith(MODEL_REPLY)).toBe(true);
        expect(reply.endsWith(footer)).toBe(true);
        expect(t.handoff.executeHandoff).toHaveBeenCalledTimes(1);
        expect(t.handoff.executeHandoff.mock.calls[0][3]).toBe('safety_red_flag:dental_acute:priority=urgent:unverified');
    });

    it('classifier down and no term: nothing is added', async () => {
        const t = fixture({ flag: true, classifier: 'down' });
        expect(await t.run('quiero blanqueamiento')).toBe(MODEL_REPLY);
        expect(t.handoff.executeHandoff).not.toHaveBeenCalled();
    });

    it('Agent Test shows the escalation without touching the queue (flag read from the tenant settings, not the runtime cache)', async () => {
        const f = agentTurnFixture();
        f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: { [SAFETY_TRIAGE_FLAG]: true } } });
        f.personaService.getAgent.mockResolvedValue({ version: 2, config_json: { language: 'es', industry: 'salud', rag: { enabled: false }, llm: {} } });
        f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'salud', subType: 'dental' });
        f.llmRouter.execute.mockImplementation(async (request: any) => request.task === 'classify'
            ? { content: '{"redFlag":true,"safetyClass":"dental_acute","confidence":0.95,"evidence":"cara"}', usage: { promptTokens: 5, completionTokens: 5 } }
            : { content: MODEL_REPLY, usage: { promptTokens: 5, completionTokens: 5 } });
        const result = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: PRODUCTION_QA8[0], channelType: 'telegram' }, { agentSnapshot: undefined });
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBe(urgencyWithNotice('es', 'al número de emergencias de su país'));
        expect(f.llmRouter.execute.mock.calls.map(([request]: any[]) => request.task)).toEqual(['classify']);
    });

    it('a business without a safety class never reads the flag nor calls the classifier', async () => {
        const t = fixture({ flag: true, industry: 'restaurantes', subType: 'comida_rapida' });
        expect(await t.run(PRODUCTION_QA8[0])).toBe(MODEL_REPLY);
        expect(t.featureFlags.isFeatureEnabled).not.toHaveBeenCalled();
        expect(t.tasks()).not.toContain('classify');
    });
});
