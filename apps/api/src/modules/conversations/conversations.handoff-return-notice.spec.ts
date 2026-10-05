import { ConversationsService } from './conversations.service';
import { DEFAULT_PIPELINE_STAGES, PipelineService, TenantStageMapping } from '../pipeline/pipeline.service';
import { offerInsteadOfPromise, withReturnNotice } from './human-offer';

/**
 * Behavior of the two customer-facing notices around an unattended handoff,
 * through the real `runTurn`:
 *   · after the sweep returned the conversation, the honest "nobody is available"
 *     notice and the turn's own answer reach the customer TOGETHER, in the one
 *     durable batch (a separate reply for the same inbound made the batch that
 *     `dispatchReplyThroughOutbox` later treated as "already answered", so the
 *     real answer was never sent);
 *   · a customer writing into a queue nobody serves gets one queue notice, and a
 *     person's reply (not the bot's own transfer notice) is what silences it.
 */
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const OPPORTUNITY_ID = '55555555-5555-4555-8555-555555555555';
const PIPELINE_ID = '66666666-6666-4666-8666-666666666666';
const SCHEMA = 'tenant_handoff_return_notice';
const ANSWER = 'Atendemos de lunes a viernes de 9 a 18.';
const RETURN_NOTICE = 'No hay nadie del equipo disponible ahora; sigo ayudándote yo.';

const stages: TenantStageMapping[] = DEFAULT_PIPELINE_STAGES.map((stage) => ({
    id: `stage-${stage.position}`, pipeline_id: PIPELINE_ID, name: stage.name,
    slug: stage.slug, position: stage.position, prob: stage.default_probability,
    is_terminal: stage.is_terminal, terminal_outcome: stage.terminal_outcome as 'won' | 'lost' | null,
    transition_rules: [],
}));

function fixture(opts: {
    status: 'active' | 'waiting_human';
    handoff: Record<string, unknown>;
    humanReplied?: boolean;
    claimWins?: boolean;
    text?: string;
}) {
    const query = jest.fn(async () => []);
    const executed: string[] = [];
    const prisma = {
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
            executed.push(sql);
            if (sql.includes('SELECT id, lead_id, stage')) return [{ id: OPPORTUNITY_ID, lead_id: LEAD_ID, stage: 'nuevo' }];
            if (sql.includes('to_regclass')) return [{ t: 'agent_dispatch_outbox' }];
            // "did a person answer?" probe of the queue notice
            if (sql.startsWith('SELECT 1 FROM conversations c')) return opts.humanReplied ? [{ '?column?': 1 }] : [];
            if (sql.includes("'{handoff,returnNoticePending}'") || sql.includes("'{handoff,queueNoticeSent}'")) {
                return opts.claimWins === false ? [] : [{ id: CONVERSATION_ID }];
            }
            return [];
        }),
        transactionInTenantSchema: jest.fn(async (_s: string, cb: (tx: typeof query) => Promise<unknown>) => cb(query)),
    };
    const pipeline = new PipelineService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    Object.assign(pipeline, {
        ensurePipelinesTables: jest.fn().mockResolvedValue(undefined),
        migrateToMultiPipeline: jest.fn().mockResolvedValue(PIPELINE_ID),
        getTenantStageCatalog: jest.fn().mockResolvedValue(stages),
        syncExactOpportunityDealTx: jest.fn().mockResolvedValue(undefined),
        isAutoProgressEnabled: jest.fn().mockResolvedValue(false),
        autoProgressFromConversation: jest.fn().mockResolvedValue(undefined),
    });
    const service: any = Object.create(ConversationsService.prototype);
    Object.assign(service, {
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        prisma, pipelineService: pipeline,
        redis: {
            acquireLockToken: jest.fn().mockResolvedValue('owned'), releaseLockToken: jest.fn().mockResolvedValue(true),
            renewLockToken: jest.fn().mockResolvedValue(true), get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
        },
        languageDetector: { detect: jest.fn().mockReturnValue('es') },
        debounceBurst: jest.fn().mockResolvedValue(undefined),
        resolveConversation: jest.fn().mockResolvedValue({
            contact: { id: CONTACT_ID }, lead: { id: LEAD_ID },
            conversation: {
                id: CONVERSATION_ID, contact_id: CONTACT_ID, status: opts.status, updated_at: new Date(),
                metadata: { handoff: opts.handoff },
            },
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
        replyOnceThroughOutbox: jest.fn().mockResolvedValue(true),
    });
    const message: any = {
        id: 'provider-message', tenantId: TENANT_ID, contactId: '12345', channelType: 'telegram',
        channelAccountId: 'bot-connection', content: { type: 'text', text: opts.text ?? '¿Hasta qué hora atienden?' }, metadata: {},
    };
    return { service, message, executed };
}

const sentChunks = (service: any): string[] =>
    service.dispatchReplyThroughOutbox.mock.calls.flatMap((c: any[]) => c[0].chunks as string[]);

describe('handoff return notice rides with the real answer', () => {
    const returned = { startedAt: '2026-10-05T20:00:00Z', returnedToAi: true, returnNoticePending: true };

    it('the customer receives the notice AND the answer, in one dispatch, and nothing is sent separately', async () => {
        const { service, message } = fixture({ status: 'active', handoff: returned });
        await service.runTurn(message);
        expect(service.dispatchReplyThroughOutbox).toHaveBeenCalledTimes(1);
        const text = sentChunks(service).join('\n');
        expect(text).toContain(RETURN_NOTICE);
        expect(text).toContain(ANSWER);
        expect(text.indexOf(RETURN_NOTICE)).toBeLessThan(text.indexOf(ANSWER));
        expect(service.replyOnceThroughOutbox).not.toHaveBeenCalled();
    });

    it('says it only once: a conversation whose notice was already claimed gets the plain answer', async () => {
        const { service, message } = fixture({ status: 'active', handoff: { ...returned, returnNoticePending: false } });
        await service.runTurn(message);
        expect(sentChunks(service).join('\n')).toBe(ANSWER);
    });

    it('a concurrent turn that lost the claim does not repeat the notice', async () => {
        const { service, message } = fixture({ status: 'active', handoff: returned, claimWins: false });
        await service.runTurn(message);
        expect(sentChunks(service).join('\n')).toBe(ANSWER);
    });

    it('the notice is never added to an answer recovered from an earlier attempt', () => {
        expect(withReturnNotice(RETURN_NOTICE, ANSWER, true)).toBe(ANSWER);
        expect(withReturnNotice(null, ANSWER, false)).toBe(ANSWER);
        expect(withReturnNotice(RETURN_NOTICE, '', false)).toBe('');
        expect(withReturnNotice(RETURN_NOTICE, ANSWER, false)).toBe(`${RETURN_NOTICE}\n\n${ANSWER}`);
    });
});

describe('queue notice for a customer waiting on a handoff nobody serves', () => {
    const waiting = { startedAt: '2026-10-05T20:00:00Z' };

    it('sends the queue notice once even though the bot already announced the transfer', async () => {
        const { service, message } = fixture({ status: 'waiting_human', handoff: waiting });
        await service.runTurn(message);
        expect(service.replyOnceThroughOutbox).toHaveBeenCalledTimes(1);
        expect(service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text).toContain('transfiriendo con nuestro equipo');
        expect(service.generateResponse).not.toHaveBeenCalled();
    });

    it('does not repeat it once sent', async () => {
        const { service, message } = fixture({ status: 'waiting_human', handoff: { ...waiting, queueNoticeSent: true } });
        await service.runTurn(message);
        expect(service.replyOnceThroughOutbox).not.toHaveBeenCalled();
    });

    it('does not send it when a person already replied', async () => {
        const { service, message } = fixture({ status: 'waiting_human', handoff: waiting, humanReplied: true });
        await service.runTurn(message);
        expect(service.replyOnceThroughOutbox).not.toHaveBeenCalled();
    });
});

describe('an unsolicited promise becomes an offer without losing the correct information', () => {
    const OFFER = '¿Quieres que le pida a una persona del equipo que lo confirme?';
    it('I09: keeps the true statements and swaps the promise for the offer', () => {
        const out = offerInsteadOfPromise(
            'Con gusto le ayudo con esa búsqueda en Chapinero. Hoy no puedo consultar el catálogo.\n\nLe paso con nuestro equipo para que le compartan las opciones.',
            OFFER);
        expect(out).toBe(`Con gusto le ayudo con esa búsqueda en Chapinero. Hoy no puedo consultar el catálogo.\n\n${OFFER}`);
    });
    it('a reply that was only the promise becomes just the offer', () => {
        expect(offerInsteadOfPromise('Le paso con nuestro equipo especializado, espere un momento.', OFFER)).toBe(OFFER);
    });
});
