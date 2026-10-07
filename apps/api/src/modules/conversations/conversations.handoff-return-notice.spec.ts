import { ConversationsService } from './conversations.service';
import { DEFAULT_PIPELINE_STAGES, PipelineService, TenantStageMapping } from '../pipeline/pipeline.service';
import { containsHumanOffer, HUMAN_OFFER_QUESTION, offerInsteadOfPromise, withReturnNotice } from './human-offer';
import { budgetExhaustedReplayText } from './handoff-return-replay-turn';

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
const RETURN_NOTICE = 'En este momento no hay nadie del equipo disponible; sigo ayudándole yo.';

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
        // its own words: it is not the transfer notice said again
        expect(service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text)
            .toBe('Su solicitud sigue en espera; alguien del equipo le responderá apenas esté disponible.');
        expect(service.generateResponse).not.toHaveBeenCalled();
    });

    it.each([
        ['es', 'Su solicitud sigue en espera; alguien del equipo le responderá apenas esté disponible.'],
        ['en', 'Your request is still waiting; someone from the team will reply as soon as they are available.'],
        ['pt', 'Sua solicitação continua em espera; alguém da equipe responderá assim que estiver disponível.'],
        ['fr', "Votre demande est toujours en attente ; quelqu'un de l'équipe vous répondra dès qu'il sera disponible."],
    ])('the queue notice in %s is not the transfer text', async (lang, expected) => {
        const { service, message } = fixture({ status: 'waiting_human', handoff: waiting });
        service.languageDetector.detect.mockReturnValue(lang);
        await service.runTurn(message);
        const text = service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text;
        expect(text).toBe(expected);
        expect(text).not.toMatch(/transfi|transf[eé]r|transferring|transferindo/i);
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

describe('the return notice is only consumed by a turn that sends text', () => {
    const returned = { startedAt: '2026-10-05T20:00:00Z', returnedToAi: true, returnNoticePending: true };
    const claimed = (executed: string[]) => executed.some(sql => sql.includes("'{handoff,returnNoticePending}'"));

    it('an empty turn (interactive flow, nothing to say) leaves it pending', async () => {
        const { service, message, executed } = fixture({ status: 'active', handoff: returned });
        service.generateResponse.mockResolvedValue('');
        await service.runTurn(message);
        expect(claimed(executed)).toBe(false);
        expect(sentChunks(service)).toEqual([]);
    });

    it('a generic error fallback does not consume it', async () => {
        const { service, message, executed } = fixture({ status: 'active', handoff: returned });
        service.generateResponse.mockResolvedValue('Disculpa, tuve un problema procesando tu mensaje. ¿Podrías repetirlo?');
        await service.runTurn(message);
        expect(claimed(executed)).toBe(false);
        expect(sentChunks(service).join('\n')).not.toContain(RETURN_NOTICE);
    });

    it('a reply refused for learning provenance does not consume it', async () => {
        const { service, message, executed } = fixture({ status: 'active', handoff: returned });
        service.generateResponse.mockImplementation(async (...args: any[]) => {
            args[args.length - 1].learningProvenanceRefused = true;
            return ANSWER;
        });
        await service.runTurn(message);
        expect(claimed(executed)).toBe(false);
        expect(service.dispatchReplyThroughOutbox).not.toHaveBeenCalled();
    });
});

describe('an unsolicited promise becomes an offer that agrees with the rest of the reply (H7)', () => {
    it('data stays and only the question is added: no contradictory "no confirmed data"', () => {
        const out = offerInsteadOfPromise('El kit cuesta 50.000 COP.\n\nLe paso con nuestro equipo para que se lo confirmen.', 'es', true);
        expect(out).toBe(`El kit cuesta 50.000 COP.\n\n${HUMAN_OFFER_QUESTION.es}`);
        expect(out).not.toContain('No tengo ese dato');
    });
    it('a figure inside the promise sentence is kept, the promise is not', () => {
        const out = offerInsteadOfPromise('El kit cuesta 50.000 COP, le paso con nuestro equipo para que lo confirmen.', 'es', true);
        expect(out).toContain('50.000 COP');
        expect(out).not.toMatch(/le paso/i);
        expect(out.endsWith(HUMAN_OFFER_QUESTION.es)).toBe(true);
    });
    it('lists keep their line breaks', () => {
        const out = offerInsteadOfPromise('Tenemos:\n- Corte 30.000\n- Color 80.000\nLe paso con nuestro equipo ahora mismo.', 'es', true);
        expect(out).toBe(`Tenemos:\n- Corte 30.000\n- Color 80.000\n\n${HUMAN_OFFER_QUESTION.es}`);
    });
    it('only the promise left: the whole honest reply and its question', () => {
        expect(offerInsteadOfPromise('Le paso con nuestro equipo especializado, espere un momento.', 'es', true))
            .toBe('No tengo ese dato confirmado en este momento. ¿Quiere que le pida a una persona del equipo que lo confirme?');
    });
    it.each(['es', 'en', 'pt', 'fr'])('%s: the question alone is a human offer, so a "sí" still escalates', lang => {
        const out = offerInsteadOfPromise(lang === 'en' ? 'We open at 9 am. I will transfer you to our team now.' : 'Abrimos a las 9. Le paso con nuestro equipo ahora mismo.', lang, true);
        expect(out.endsWith(HUMAN_OFFER_QUESTION[lang])).toBe(true);
        expect(containsHumanOffer(out)).toBe(true);
    });
    it('no person reachable: nothing is offered', () => {
        expect(offerInsteadOfPromise('Abrimos a las 9. Le paso con nuestro equipo.', 'es', false)).toBe('Abrimos a las 9.');
        expect(offerInsteadOfPromise('Le paso con nuestro equipo.', 'es', false)).toBe('No tengo ese dato confirmado en este momento.');
    });
});

/**
 * The unattended-return replay: the inbound row the customer wrote while waiting
 * is processed again (`saveMessage` reports a duplicate, `turn:done` cleared). It
 * is a fresh turn for that message, so the notice and the answer leave together.
 */
describe('replay of the message the customer wrote while waiting', () => {
    const returned = { startedAt: '2026-10-05T20:00:00Z', returnedToAi: true, returnNoticePending: true };
    const replayFixture = (owned: unknown[] | null) => {
        const f = fixture({ status: 'active', handoff: returned });
        const findBatchForInbound = jest.fn().mockResolvedValue(owned);
        Object.assign(f.service, {
            saveMessage: jest.fn().mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888', duplicate: true }),
            dispatchOutbox: { findBatchForInbound, publishBatch: jest.fn() },
            outboundQueue: { enqueueDispatch: jest.fn().mockResolvedValue(undefined) },
        });
        return { ...f, findBatchForInbound };
    };

    it('answers it once, with the return notice leading the answer, in one batch', async () => {
        const { service, message, findBatchForInbound } = replayFixture(null);
        await service.runTurn(message);
        expect(findBatchForInbound).toHaveBeenCalledTimes(1);
        expect(service.dispatchReplyThroughOutbox).toHaveBeenCalledTimes(1);
        const text = sentChunks(service).join('\n');
        expect(text).toBe(`${RETURN_NOTICE}\n\n${ANSWER}`);
        expect(service.replyOnceThroughOutbox).not.toHaveBeenCalled();
    });

    it('a message whose answer is already committed is not answered a second time', async () => {
        const { service, message } = replayFixture([{ id: 'row' }]);
        await service.runTurn(message);
        expect(service.dispatchReplyThroughOutbox).not.toHaveBeenCalled();
        expect(service.generateResponse).not.toHaveBeenCalled();
    });
});

/**
 * The replay turn is not an ordinary turn: it never escalates by keyword (that
 * would repeat "te estoy transfiriendo" and another ten minutes of silence), it
 * acknowledges what was asked, it does not read a stale "sí" as consent, it
 * yields to a turn that already answered, and it records an opt-out.
 */
describe('the replay turn of an unattended handoff return', () => {
    const claimed = {
        startedAt: '2026-10-05T20:00:00Z', returnedToAi: true, returnNoticePending: true,
        returnReplayFor: '2026-10-05T20:00:00Z', returnReplayClaimedAt: '2026-10-05T20:10:00Z',
    };
    function build(opts: { reason?: string | null; text?: string; stale?: boolean; optOut?: boolean; replay?: boolean;
        withTasks?: boolean; notify?: boolean; optOutLine?: string } = {}) {
        const f = fixture({ status: 'active', handoff: claimed, text: opts.text ?? 'necesito hablar con un asesor\n¿hola?' });
        const service: any = f.service;
        const inner = service.prisma.executeInTenantSchema;
        const sqls: string[] = [];
        service.prisma.executeInTenantSchema = jest.fn(async (schema: string, sql: string, params: any[]) => {
            sqls.push(sql);
            if (sql.includes('returnReplayClaimedAt')) {
                return [{ pending: 'true', newer_inbound: false, answered_since: opts.stale === true }];
            }
            return inner(schema, sql, params);
        });
        const tasks = { createTaskIdempotently: jest.fn().mockResolvedValue({ task: { id: 't1' }, created: true }) };
        // The durable operator notices (the SLA alert's own mechanism) run through this query.
        const noticeSql: string[] = [];
        service.prisma.transactionInTenantSchema = jest.fn(async (_s: string, cb: (q: any) => Promise<unknown>) =>
            cb(async (sql: string, params?: any[]) => {
                noticeSql.push(sql);
                if (sql.includes('INSERT INTO operational_notice_outbox') && opts.notify !== false) return [{ id: 'n1' }, { id: 'n2' }];
                return [];
            }));
        const events = { emit: jest.fn() };
        Object.assign(service, {
            eventEmitter: events,
            saveMessage: jest.fn().mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888', duplicate: true }),
            dispatchOutbox: { findBatchForInbound: jest.fn().mockResolvedValue(null), publishBatch: jest.fn() },
            outboundQueue: { enqueueDispatch: jest.fn().mockResolvedValue(undefined) },
            handoffService: {
                isInHandoff: jest.fn().mockResolvedValue(false),
                shouldHandoff: jest.fn().mockReturnValue(opts.reason === undefined ? 'human_request' : opts.reason),
                executeHandoff: jest.fn().mockResolvedValue({ assignedTo: null }),
            },
            complianceService: {
                detectOptOut: jest.fn((t: string) => opts.optOutLine ? t.trim() === opts.optOutLine : opts.optOut === true),
                processOptOut: jest.fn().mockResolvedValue(undefined),
            },
            ...(opts.withTasks ? { tasksService: tasks } : {}),
        });
        f.message.metadata = opts.replay === false ? {} : { handoffReturnReplay: true };
        return { ...f, service, sqls, tasks, events, noticeSql };
    }

    it('does not escalate «necesito hablar con un asesor» again: notice + answer, one batch, no second transfer', async () => {
        const { service, message } = build();
        await service.runTurn(message);
        expect(service.handoffService.executeHandoff).not.toHaveBeenCalled();
        expect(service.replyOnceThroughOutbox).not.toHaveBeenCalled();
        expect(service.dispatchReplyThroughOutbox).toHaveBeenCalledTimes(1);
        expect(sentChunks(service).join('\n')).toBe(`${RETURN_NOTICE}\n\n${ANSWER}`);
    });

    it('hands the model what was asked, so the answer can acknowledge it', async () => {
        const { service, message } = build({ reason: 'complaint', text: 'esto es pésimo, nadie responde' });
        await service.runTurn(message);
        const msg = service.generateResponse.mock.calls[0][2];
        // the supervisors' alert went out, so a true sentence can say the request was left
        expect(msg.handoffReturn).toEqual({ ask: 'complaint', noteLeft: true, fromEpisode: false });
        expect(service.handoffService.executeHandoff).not.toHaveBeenCalled();
    });

    it('leaves the request on the team follow-up list, and says so only when it exists', async () => {
        const { service, message, tasks } = build({ withTasks: true });
        await service.runTurn(message);
        expect(tasks.createTaskIdempotently).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({
            leadId: LEAD_ID, createdBy: 'handoff_return', type: 'follow_up',
            title: 'Cliente pidió hablar con una persona y nadie respondió',
        }));
        expect(service.generateResponse.mock.calls[0][2].handoffReturn).toEqual({ ask: 'person', noteLeft: true, fromEpisode: false });
    });

    it('no request heard, no task', async () => {
        const { service, message, tasks } = build({ withTasks: true, reason: null, text: '¿hasta qué hora atienden?' });
        await service.runTurn(message);
        expect(tasks.createTaskIdempotently).not.toHaveBeenCalled();
        expect(service.generateResponse.mock.calls[0][2].handoffReturn).toEqual({ ask: null, noteLeft: false, fromEpisode: false });
    });

    it('a NEW message asking for a person after the return is an ordinary message and hands off normally', async () => {
        const { service, message } = build({ replay: false });
        await service.runTurn(message);
        expect(service.handoffService.executeHandoff).toHaveBeenCalledTimes(1);
    });

    it('a marker with no claim for this episode is not a replay', async () => {
        const { service, message } = build();
        service.resolveConversation.mockResolvedValue({
            contact: { id: CONTACT_ID }, lead: { id: LEAD_ID },
            conversation: { id: CONVERSATION_ID, contact_id: CONTACT_ID, status: 'active', updated_at: new Date(),
                metadata: { handoff: { ...claimed, returnReplayFor: '2026-09-01T00:00:00Z' } } },
        });
        await service.runTurn(message);
        expect(service.handoffService.executeHandoff).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when another turn already answered the customer (the race)', async () => {
        const { service, message } = build({ stale: true });
        await service.runTurn(message);
        expect(service.dispatchReplyThroughOutbox).not.toHaveBeenCalled();
        expect(service.generateResponse).not.toHaveBeenCalled();
    });

    it('records the opt-out found in the waiting texts and clears the pending notice', async () => {
        const { service, message, sqls } = build({ optOut: true, text: 'basta, no me escriban más' });
        await service.runTurn(message);
        expect(service.complianceService.processOptOut).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({
            leadId: LEAD_ID, detectedFrom: 'keyword', channel: 'telegram',
        }));
        expect(sqls.some(sql => sql.includes("'{handoff,returnNoticePending}', 'false'::jsonb"))).toBe(true);
        expect(service.dispatchReplyThroughOutbox).not.toHaveBeenCalled();
    });

    it('an opt-out outside a replay leaves the notice alone', async () => {
        const { service, message, sqls } = build({ optOut: true, replay: false, text: 'basta, no me escriban más' });
        await service.runTurn(message);
        expect(sqls.some(sql => sql.includes("'{handoff,returnNoticePending}', 'false'::jsonb"))).toBe(false);
    });

    it('a waiting text that was only «sí» is not consent: the customer is asked again, without running the model', async () => {
        const { service, message } = build({ reason: null, text: 'sí' });
        await service.runTurn(message);
        expect(service.generateResponse).not.toHaveBeenCalled();
        const text = sentChunks(service).join('\n');
        expect(text).toContain(RETURN_NOTICE);
        expect(text).toContain('¿podría indicarme de nuevo qué necesita?');
    });

    it('the same «sí» outside a replay still reaches the normal turn', async () => {
        const { service, message } = build({ reason: null, text: 'sí', replay: false });
        await service.runTurn(message);
        expect(service.generateResponse).toHaveBeenCalledTimes(1);
    });
});

describe('the replay: opt-out per line, and the team actually sees the request', () => {
    const claimed = {
        startedAt: '2026-10-05T20:00:00Z', returnedToAi: true, returnNoticePending: true,
        returnReplayFor: '2026-10-05T20:00:00Z', returnReplayClaimedAt: '2026-10-05T20:10:00Z',
    };
    function build(opts: { text: string; reason?: string | null; optOutLine?: string; notify?: boolean; withTasks?: boolean }) {
        const f = fixture({ status: 'active', handoff: claimed, text: opts.text });
        const service: any = f.service;
        const noticeSql: string[] = [];
        service.prisma.transactionInTenantSchema = jest.fn(async (_s: string, cb: (q: any) => Promise<unknown>) =>
            cb(async (sql: string) => {
                noticeSql.push(sql);
                return sql.includes('INSERT INTO operational_notice_outbox') && opts.notify !== false ? [{ id: 'n1' }] : [];
            }));
        const events = { emit: jest.fn() };
        const tasks = { createTaskIdempotently: jest.fn().mockResolvedValue({ task: { id: 't1' }, created: true }) };
        Object.assign(service, {
            eventEmitter: events,
            saveMessage: jest.fn().mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888', duplicate: true }),
            dispatchOutbox: { findBatchForInbound: jest.fn().mockResolvedValue(null), publishBatch: jest.fn() },
            outboundQueue: { enqueueDispatch: jest.fn().mockResolvedValue(undefined) },
            handoffService: {
                isInHandoff: jest.fn().mockResolvedValue(false),
                shouldHandoff: jest.fn().mockReturnValue(opts.reason === undefined ? 'human_request' : opts.reason),
                executeHandoff: jest.fn(),
            },
            complianceService: {
                detectOptOut: jest.fn((t: string) => opts.optOutLine !== undefined && t.trim() === opts.optOutLine),
                processOptOut: jest.fn().mockResolvedValue(undefined),
            },
            ...(opts.withTasks ? { tasksService: tasks } : {}),
        });
        f.message.metadata = { handoffReturnReplay: true };
        return { ...f, service, events, noticeSql, tasks };
    }

    it.each([
        ['hola\n¿hay alguien?\nSTOP', 'STOP'],
        ['¿hola?\nbaja', 'baja'],
        ['basta\nquiero ver precios', 'basta'],
    ])('finds the opt-out in «%s» although the folded text is long', async (text, line) => {
        const { service, message } = build({ text, optOutLine: line });
        await service.runTurn(message);
        expect(service.complianceService.processOptOut).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({
            triggerMessage: line, leadId: LEAD_ID, detectedFrom: 'keyword',
        }));
        // what the normal opt-out path does: nothing is sent
        expect(service.dispatchReplyThroughOutbox).not.toHaveBeenCalled();
        expect(service.generateResponse).not.toHaveBeenCalled();
    });

    it('no opt-out in any line: the turn answers', async () => {
        const { service, message } = build({ text: 'hola\n¿hay alguien?', reason: null });
        await service.runTurn(message);
        expect(service.complianceService.processOptOut).not.toHaveBeenCalled();
        expect(service.dispatchReplyThroughOutbox).toHaveBeenCalledTimes(1);
    });

    it('alerts the tenant admins and supervisors the way the unattended-handoff SLA escalation does, once per episode', async () => {
        const { service, message, noticeSql, events } = build({ text: 'necesito hablar con un asesor' });
        await service.runTurn(message);
        const insert = noticeSql.find(sql => sql.includes('INSERT INTO operational_notice_outbox'))!;
        expect(insert).toBeTruthy();
        expect(service.prisma.transactionInTenantSchema).toHaveBeenCalled();
        expect(events.emit).toHaveBeenCalledWith('handoff.escalated_supervisor', expect.objectContaining({
            tenantId: TENANT_ID, conversationId: CONVERSATION_ID, reason: 'unattended_return:person',
        }));
    });

    it('tells the customer the request was left when the alert went out, even without a CRM lead task', async () => {
        const { service, message } = build({ text: 'necesito hablar con un asesor' });
        await service.runTurn(message);
        expect(service.generateResponse.mock.calls[0][2].handoffReturn).toEqual({ ask: 'person', noteLeft: true, fromEpisode: false });
    });

    it('says nothing was left when neither the task nor the alert exists', async () => {
        const { service, message, events } = build({ text: 'necesito hablar con un asesor', notify: false });
        await service.runTurn(message);
        expect(events.emit).not.toHaveBeenCalledWith('handoff.escalated_supervisor', expect.anything());
        expect(service.generateResponse.mock.calls[0][2].handoffReturn).toEqual({ ask: 'person', noteLeft: false, fromEpisode: false });
    });

    it('no request heard: nobody is alerted', async () => {
        const { service, message, events } = build({ text: '¿hasta qué hora atienden?', reason: null });
        await service.runTurn(message);
        expect(events.emit).not.toHaveBeenCalled();
    });
});

describe('the replay: one alert per episode, and a budget text that is not an answer', () => {
    const claimed = {
        startedAt: '2026-10-05T20:00:00Z', returnedToAi: true, returnNoticePending: true,
        returnReplayFor: '2026-10-05T20:00:00Z', returnReplayClaimedAt: '2026-10-05T20:10:00Z',
    };
    function build(over: { escalated?: boolean; reply?: string } = {}) {
        const f = fixture({ status: 'active', handoff: { ...claimed, ...(over.escalated ? { escalated: 'true' } : {}) },
            text: 'necesito hablar con un asesor' });
        const service: any = f.service;
        service.prisma.transactionInTenantSchema = jest.fn(async (_s: string, cb: (q: any) => Promise<unknown>) =>
            cb(async (sql: string) => sql.includes('INSERT INTO operational_notice_outbox') ? [{ id: 'n1' }] : []));
        const events = { emit: jest.fn() };
        Object.assign(service, {
            eventEmitter: events,
            saveMessage: jest.fn().mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888', duplicate: true }),
            dispatchOutbox: { findBatchForInbound: jest.fn().mockResolvedValue(null), publishBatch: jest.fn() },
            outboundQueue: { enqueueDispatch: jest.fn().mockResolvedValue(undefined) },
            handoffService: {
                isInHandoff: jest.fn().mockResolvedValue(false),
                shouldHandoff: jest.fn().mockReturnValue('human_request'),
                executeHandoff: jest.fn(),
            },
            complianceService: { detectOptOut: jest.fn().mockReturnValue(false), processOptOut: jest.fn() },
        });
        if (over.reply) service.generateResponse.mockResolvedValue(over.reply);
        f.message.metadata = { handoffReturnReplay: true };
        return { ...f, service, events };
    }

    it('the live inbox alert is skipped when the SLA escalation already alerted this episode (the durable notice still goes)', async () => {
        const { service, message, events } = build({ escalated: true });
        await service.runTurn(message);
        expect(events.emit).not.toHaveBeenCalledWith('handoff.escalated_supervisor', expect.anything());
        // the notice was enqueued, so the request is honestly said to be left
        expect(service.generateResponse.mock.calls[0][2].handoffReturn).toEqual({ ask: 'person', noteLeft: true, fromEpisode: false });
    });

    it('the live inbox alert goes out when nobody was alerted before', async () => {
        const { service, message, events } = build();
        await service.runTurn(message);
        expect(events.emit).toHaveBeenCalledWith('handoff.escalated_supervisor', expect.anything());
    });

    it('the budget-exhausted text is sent alone: no «I keep helping you» in front of «I cannot help you»', async () => {
        const text = budgetExhaustedReplayText('es');
        const { service, message } = build({ reply: text });
        await service.runTurn(message);
        expect(sentChunks(service).join('\n')).toBe(text);
        // the notice stays pending for the next real answer
        expect(service.prisma.executeInTenantSchema.mock.calls.some((c: any[]) =>
            String(c[1]).includes("'{handoff,returnNoticePending}', 'false'::jsonb"))).toBe(false);
    });
});

describe('the turn escalates through the classifier-backed decision', () => {
    it('a personal refund case reaches a person before any reply is generated, and the decision is asked once', async () => {
        const text = 'Quiero devolver el audífono';
        const { service, message } = fixture({ status: 'active', handoff: {}, text });
        service.handoffService.decideHandoff = jest.fn().mockResolvedValue('complaint');
        service.handoffService.executeHandoff = jest.fn().mockResolvedValue({ assignedTo: null });
        await service.runTurn(message);
        expect(service.handoffService.decideHandoff).toHaveBeenCalledTimes(1);
        expect(service.handoffService.decideHandoff.mock.calls[0]).toEqual([
            text, expect.objectContaining({ id: CONVERSATION_ID }), expect.anything(), undefined, TENANT_ID,
        ]);
        expect(service.handoffService.executeHandoff).toHaveBeenCalledWith(TENANT_ID, CONVERSATION_ID, expect.anything(), 'complaint');
        expect(service.generateResponse).not.toHaveBeenCalled();
    });

    it('a policy question is answered: the classifier said nothing escalates, and the turn goes on', async () => {
        const { service, message } = fixture({ status: 'active', handoff: {}, text: '¿Cuál es la política de devoluciones?' });
        service.handoffService.decideHandoff = jest.fn().mockResolvedValue(null);
        service.handoffService.executeHandoff = jest.fn();
        await service.runTurn(message);
        expect(service.handoffService.decideHandoff).toHaveBeenCalledTimes(1);
        expect(service.handoffService.executeHandoff).not.toHaveBeenCalled();
        expect(service.generateResponse).toHaveBeenCalledTimes(1);
        expect(sentChunks(service).join('\n')).toBe(ANSWER);
    });
});

describe('typing is shown before the turn waits on the classifier', () => {
    const typingFixture = (text: string, topic: boolean) => {
        const f = fixture({ status: 'active', handoff: {}, text });
        const sendTyping = jest.fn().mockResolvedValue(undefined);
        const seenAtDecision: number[] = [];
        Object.assign(f.service, {
            channelGateway: { sendTypingIndicator: sendTyping },
            resolveAccessToken: jest.fn().mockResolvedValue('token'),
        });
        Object.assign(f.service.handoffService, {
            needsPolicyClassification: jest.fn().mockReturnValue(topic),
            decideHandoff: jest.fn(async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                seenAtDecision.push(sendTyping.mock.calls.length);
                return null;
            }),
        });
        return { ...f, sendTyping, seenAtDecision };
    };

    it('a refund / return / discount message shows typing before the decision is back, and only once', async () => {
        const { service, message, sendTyping, seenAtDecision } = typingFixture('¿Puedo pedir un reembolso?', true);
        await service.runTurn(message);
        expect(seenAtDecision).toEqual([1]);
        expect(sendTyping).toHaveBeenCalledTimes(1);
    });

    it('any other message keeps the typing where it was, once, after the decision', async () => {
        const { service, message, sendTyping, seenAtDecision } = typingFixture('¿A qué hora abren?', false);
        await service.runTurn(message);
        expect(seenAtDecision).toEqual([0]);
        expect(sendTyping).toHaveBeenCalledTimes(1);
    });
});

/**
 * The live Telegram test of 2026-10-07 (store tenant), turn by turn, through the real `runTurn`:
 *   08:36:53 «…necesito hablar con una persona del equipo, por favor» → transfer notice
 *   08:39:19 «…¿hola? mientras tanto, ¿hasta qué hora atienden hoy?»  → queue notice (was the SAME text)
 *   08:47:05 the replay: return notice + answer. The person request that STARTED the handoff was not
 *            counted (the waiting text asks no such thing), so nothing was left for the team and the
 *            model offered a person again right after saying nobody was available.
 */
describe('the 2026-10-07 live sequence', () => {
    const STARTED = '2026-10-07T13:36:53Z';
    const T1 = 'Prueba QA 20261007: necesito hablar con una persona del equipo, por favor';
    const T2 = 'Prueba QA 20261007: ¿hola? mientras tanto, ¿hasta qué hora atienden hoy?';
    const MODEL_REPLY = 'No tengo el horario de atención configurado. ¿Quiere que le pase con alguien del equipo para que le confirme?';

    function wire(service: any, over: { reason: string | null; tasks?: any }) {
        service.prisma.transactionInTenantSchema = jest.fn(async (_s: string, cb: (q: any) => Promise<unknown>) =>
            cb(async (sql: string) => sql.includes('INSERT INTO operational_notice_outbox') ? [{ id: 'n1' }] : []));
        Object.assign(service, {
            eventEmitter: { emit: jest.fn() },
            handoffService: {
                isInHandoff: jest.fn().mockResolvedValue(false),
                shouldHandoff: jest.fn().mockReturnValue(over.reason),
                executeHandoff: jest.fn().mockResolvedValue({ assignedTo: null }),
            },
            complianceService: { detectOptOut: jest.fn().mockReturnValue(false), processOptOut: jest.fn() },
            ...(over.tasks ? { tasksService: over.tasks } : {}),
        });
    }

    it('T1 starts the handoff with the transfer notice', async () => {
        const { service, message } = fixture({ status: 'active', handoff: {}, text: T1 });
        wire(service, { reason: 'human_request' });
        await service.runTurn(message);
        expect(service.handoffService.executeHandoff).toHaveBeenCalledTimes(1);
        expect(service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text)
            .toBe('Entiendo su solicitud. Le estoy transfiriendo con nuestro equipo de atención. Un agente le responderá en breve. 🙋');
    });

    it('T2 gets a queue notice that is NOT the transfer notice again', async () => {
        const { service, message } = fixture({ status: 'waiting_human', handoff: { startedAt: STARTED, reason: 'human_request' }, text: T2 });
        wire(service, { reason: null });
        await service.runTurn(message);
        const text = service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text;
        expect(text).toBe('Su solicitud sigue en espera; alguien del equipo le responderá apenas esté disponible.');
        expect(text).not.toContain('transfiriendo');
    });

    it('the replay counts the request that STARTED the handoff, leaves it for the team and never offers a person again', async () => {
        const tasks = { createTaskIdempotently: jest.fn().mockResolvedValue({ task: { id: 't1' }, created: true }) };
        const { service, message } = fixture({
            status: 'active', text: T2,
            handoff: { startedAt: STARTED, reason: 'human_request', summary: T1, returnedToAi: true, returnNoticePending: true,
                returnReplayFor: STARTED, returnReplayClaimedAt: '2026-10-07T13:47:00Z' },
        });
        wire(service, { reason: null, tasks });
        Object.assign(service, {
            saveMessage: jest.fn().mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888', duplicate: true }),
            dispatchOutbox: { findBatchForInbound: jest.fn().mockResolvedValue(null), publishBatch: jest.fn() },
            outboundQueue: { enqueueDispatch: jest.fn().mockResolvedValue(undefined) },
        });
        service.generateResponse.mockResolvedValue(MODEL_REPLY);
        message.metadata = { handoffReturnReplay: true };
        await service.runTurn(message);

        // nothing escalated, one batch
        expect(service.handoffService.executeHandoff).not.toHaveBeenCalled();
        expect(service.replyOnceThroughOutbox).not.toHaveBeenCalled();
        expect(service.dispatchReplyThroughOutbox).toHaveBeenCalledTimes(1);
        // the request that started the handoff is counted: a follow-up for the team, and the model is told
        expect(tasks.createTaskIdempotently).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({
            title: 'Cliente pidió hablar con una persona y nadie respondió', createdBy: 'handoff_return',
            description: expect.stringContaining(T1),
        }));
        expect(service.generateResponse.mock.calls[0][2].handoffReturn)
            .toEqual({ ask: 'person', noteLeft: true, fromEpisode: true });
        // one message: the notice, the part of the answer that was true, and the request left for the team
        expect(sentChunks(service).join('\n')).toBe(
            `${RETURN_NOTICE}\n\nNo tengo el horario de atención configurado.\n\n`
            + 'Dejé su solicitud anotada para que el equipo la vea y le contacte cuando esté disponible.');
    });

    it('without a task or a notice the offer is still removed, and nothing false is said', async () => {
        const { service, message } = fixture({
            status: 'active', text: T2,
            handoff: { startedAt: STARTED, reason: 'human_request', returnedToAi: true, returnNoticePending: true,
                returnReplayFor: STARTED, returnReplayClaimedAt: '2026-10-07T13:47:00Z' },
        });
        wire(service, { reason: null });
        service.prisma.transactionInTenantSchema = jest.fn(async (_s: string, cb: (q: any) => Promise<unknown>) => cb(async () => []));
        Object.assign(service, {
            saveMessage: jest.fn().mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888', duplicate: true }),
            dispatchOutbox: { findBatchForInbound: jest.fn().mockResolvedValue(null), publishBatch: jest.fn() },
            outboundQueue: { enqueueDispatch: jest.fn().mockResolvedValue(undefined) },
        });
        service.generateResponse.mockResolvedValue(MODEL_REPLY);
        message.metadata = { handoffReturnReplay: true };
        await service.runTurn(message);
        const text = sentChunks(service).join('\n');
        expect(text).toBe(`${RETURN_NOTICE}\n\nNo tengo el horario de atención configurado.`);
        expect(text).not.toMatch(/pase con alguien|Dejé su solicitud/);
    });

    it.each([
        ['en', 'Nobody from the team is available right now; I will keep helping you.'],
        ['pt', 'Neste momento não há ninguém da equipe disponível; continuo ajudando você.'],
        ['fr', "Personne de l'équipe n'est disponible pour le moment ; je continue de vous aider."],
    ])('the return notice in %s', async (lang, expected) => {
        const { service, message } = fixture({ status: 'active', text: T2,
            handoff: { startedAt: STARTED, returnedToAi: true, returnNoticePending: true } });
        service.languageDetector.detect.mockReturnValue(lang);
        await service.runTurn(message);
        expect(sentChunks(service).join('\n')).toContain(expected);
    });
});

/**
 * The platform talks to its customers with «usted» in Spanish, and without the colloquial «te» in
 * Portuguese. The fixed handoff texts live in a table that no behaviour test reaches in every
 * language, so the table itself is checked.
 */
describe('the fixed handoff texts speak with usted', () => {
    const { readFileSync } = jest.requireActual('fs');
    const { resolve } = jest.requireActual('path');
    const source: string = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
    const table = (start: string, end: string) => {
        const from = source.indexOf(start);
        return source.slice(from, source.indexOf(end, from));
    };
    const esLines = (block: string) => block.split(/\r?\n/).filter(line => /^\s*(?:es:|withAgent:|queueHead:|queueN:|queueWaiting:|transferring:|unavailable:)/.test(line));

    it('HANDOFF_MSG: Spanish is usted, Portuguese has no «te»', () => {
        const block = table('const HANDOFF_MSG', 'const handoffText');
        const es = block.slice(block.indexOf('    es: {'), block.indexOf('    en: {'));
        const pt = block.slice(block.indexOf('    pt: {'), block.indexOf('    fr: {'));
        for (const line of esLines(es)) expect(line).not.toMatch(/\b(?:tu|tus|te|eres|puedes|inténtalo|conectarte)\b/i);
        for (const line of pt.split(/\r?\n/)) expect(line).not.toMatch(/\b(?:te|teu|tua)\b/i);
        expect(es).toContain('Le estoy transfiriendo');
        expect(pt).toContain('transferindo você');
    });

    it.each(['UNVERIFIED_CLAIM_FALLBACK', 'PARTIAL_SUCCESS_MSG', 'BUDGET_EXHAUSTED_MSG', 'WIDGET_HANDOFF_UNAVAILABLE'])(
        '%s: the Spanish text is usted', name => {
            const block = table(`const ${name}`, '};');
            const es = block.split(/\r?\n/).find(line => /^\s*es:/.test(line))!;
            expect(es).toBeTruthy();
            expect(es).not.toMatch(/\b(?:tu|tus|te|eres|puedes|repitas|inténtalo|quieres|darte|transferirte|contigo)\b/i);
        });

    it('the notice a transferred customer reads, in a full turn, is the usted one', async () => {
        const { service, message } = fixture({ status: 'active', handoff: {}, text: 'necesito hablar con una persona' });
        Object.assign(service, {
            eventEmitter: { emit: jest.fn() },
            handoffService: {
                isInHandoff: jest.fn().mockResolvedValue(false),
                shouldHandoff: jest.fn().mockReturnValue('human_request'),
                executeHandoff: jest.fn().mockResolvedValue({ assignedTo: null }),
            },
        });
        await service.runTurn(message);
        expect(service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text)
            .toBe('Entiendo su solicitud. Le estoy transfiriendo con nuestro equipo de atención. Un agente le responderá en breve. 🙋');
    });
});
