import { ConversationsService } from './conversations.service';
import { DEFAULT_PIPELINE_STAGES, PipelineService, TenantStageMapping } from '../pipeline/pipeline.service';
import { composeReturnReply } from './handoff-return-replay-turn';
import { UNATTENDED_HANDOFF_MINUTES } from '../handoff/handoff.service';

/**
 * Production QA, dental tenant, Telegram (2026-10-22). The handoff had gone unanswered for more than
 * UNATTENDED_HANDOFF_MINUTES when the customer asked «qué tratamientos hacen?», and what they read was:
 *
 *   Su solicitud sigue en espera; alguien del equipo le responderá apenas esté disponible.
 *   En este momento no hay nadie del equipo disponible; sigo ayudándole yo.
 *
 *   Ofrecemos los siguientes servicios dentales: …
 *   ¿Le gustaría que le ayude a agendar una cita o tiene alguna consulta específica?
 *
 *   Dejé su solicitud anotada para que el equipo la vea y le contacte cuando esté disponible.
 *
 * Three producers, one reply:
 *   · the queue notice (`sendQueueNoticeOnce`), sent because the conversation was still
 *     `waiting_human` — but that very message is what lets the sweep return it a minute later;
 *   · the return notice the replay of the same message puts in front of the answer;
 *   · the «anotada» note, said because the supervisors' alert (one `operational_notice_outbox` row)
 *     counted as a note although no follow-up was written down.
 *
 * Driven through the real `runTurn`, both halves of the episode: the message while the conversation
 * is still `waiting_human`, and the replay after the sweep gave it back.
 */
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const OPPORTUNITY_ID = '55555555-5555-4555-8555-555555555555';
const PIPELINE_ID = '66666666-6666-4666-8666-666666666666';
const SCHEMA = 'tenant_dental_return';

const QUESTION = 'qué tratamientos hacen?';
const DENTAL_ANSWER = 'Ofrecemos los siguientes servicios dentales:\n'
    + '- Consulta general: 30 minutos\n'
    + '- Limpieza dental: 45 minutos\n\n'
    + '¿Le gustaría que le ayude a agendar una cita o tiene alguna consulta específica?';
const RETURN_NOTICE = 'En este momento no hay nadie del equipo disponible; sigo ayudándole yo.';
const STILL_WAITING = 'Su solicitud sigue en espera; alguien del equipo le responderá apenas esté disponible.';
const NOTE = 'Dejé su solicitud anotada para que el equipo la vea y le contacte cuando esté disponible.';

const stages: TenantStageMapping[] = DEFAULT_PIPELINE_STAGES.map((stage) => ({
    id: `stage-${stage.position}`, pipeline_id: PIPELINE_ID, name: stage.name,
    slug: stage.slug, position: stage.position, prob: stage.default_probability,
    is_terminal: stage.is_terminal, terminal_outcome: stage.terminal_outcome as 'won' | 'lost' | null,
    transition_rules: [],
}));

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function fixture(opts: {
    status: 'active' | 'waiting_human';
    handoff: Record<string, unknown>;
    replay?: boolean;
    lead?: boolean;
    task?: boolean;
    reply?: string;
}) {
    const executed: string[] = [];
    const noticeRows: string[] = [];
    const prisma = {
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
            executed.push(sql);
            if (sql.includes('SELECT id, lead_id, stage')) return [{ id: OPPORTUNITY_ID, lead_id: LEAD_ID, stage: 'nuevo' }];
            if (sql.includes('to_regclass')) return [{ t: 'agent_dispatch_outbox' }];
            // "did a person answer?" probe of the queue notice: nobody did
            if (sql.startsWith('SELECT 1 FROM conversations c')) return [];
            // the replay is not stale: nobody answered since the claim
            if (sql.includes('returnReplayClaimedAt')) return [{ pending: 'true', newer_inbound: false, answered_since: false }];
            if (sql.includes("'{handoff,returnNoticePending}'") || sql.includes("'{handoff,queueNoticeSent}'")) {
                return [{ id: CONVERSATION_ID }];
            }
            return [];
        }),
        // The supervisors' alert: one durable operational notice, as in production.
        transactionInTenantSchema: jest.fn(async (_s: string, cb: (q: any) => Promise<unknown>) =>
            cb(async (sql: string) => {
                if (sql.includes('INSERT INTO operational_notice_outbox')) {
                    noticeRows.push(sql);
                    return [{ id: 'n1' }];
                }
                return [];
            })),
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
    const tasks = { createTaskIdempotently: jest.fn().mockResolvedValue({ task: { id: 't1' }, created: true }) };
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
            contact: { id: CONTACT_ID, name: 'Paciente QA', external_id: '12345' },
            lead: { id: opts.lead === false ? undefined : LEAD_ID },
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
        handoffService: {
            isInHandoff: jest.fn().mockResolvedValue(false),
            shouldHandoff: jest.fn().mockReturnValue(null),
            executeHandoff: jest.fn().mockResolvedValue({ assignedTo: null }),
        },
        complianceService: { detectOptOut: jest.fn().mockReturnValue(false), processOptOut: jest.fn() },
        eventEmitter: { emit: jest.fn() },
        isWithinBusinessHours: jest.fn().mockReturnValue(true),
        loadTenantBusinessHours: jest.fn().mockResolvedValue(null),
        persistConversationPersonaResolution: jest.fn().mockResolvedValue(undefined),
        saveMessage: jest.fn().mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888', duplicate: opts.replay === true }),
        saveAiMessage: jest.fn().mockResolvedValue(undefined), recordAgentSignal: jest.fn(),
        generateResponse: jest.fn().mockResolvedValue(opts.reply ?? DENTAL_ANSWER),
        dispatchReplyThroughOutbox: jest.fn().mockResolvedValue(true),
        replyOnceThroughOutbox: jest.fn().mockResolvedValue(true),
        dispatchOutbox: { findBatchForInbound: jest.fn().mockResolvedValue(null), publishBatch: jest.fn() },
        outboundQueue: { enqueueDispatch: jest.fn().mockResolvedValue(undefined) },
        ...(opts.task ? { tasksService: tasks } : {}),
    });
    const message: any = {
        id: 'provider-message', tenantId: TENANT_ID, contactId: '12345', channelType: 'telegram',
        channelAccountId: 'bot-connection', content: { type: 'text', text: QUESTION },
        metadata: opts.replay ? { handoffReturnReplay: true } : {},
    };
    return { service, message, executed, noticeRows, tasks };
}

/** Everything the customer was sent, in order: the deterministic replies and the turn's batch. */
const customerTexts = (service: any): string[] => [
    ...service.replyOnceThroughOutbox.mock.calls.map((c: any[]) => String(c[0].item?.payload?.text ?? '')),
    ...service.dispatchReplyThroughOutbox.mock.calls.flatMap((c: any[]) => c[0].chunks as string[]),
];
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('dental 2026-10-22: one return notice, then the answer', () => {
    // The episode: the handoff started 12 minutes ago, nobody answered, the customer had asked for a person.
    const started = minutesAgo(UNATTENDED_HANDOFF_MINUTES + 2);
    const waitingPastWindow = { startedAt: started, reason: 'human_request', summary: 'quiero hablar con alguien' };
    const returned = {
        ...waitingPastWindow, returnedToAi: true, returnNoticePending: true,
        returnReplayFor: started, returnReplayClaimedAt: minutesAgo(0.5),
    };

    /** The two halves of the episode, as the customer lives them: their message, then the replay of it. */
    async function episode(over: { lead?: boolean; task?: boolean; reply?: string } = {}) {
        const waiting = fixture({ status: 'waiting_human', handoff: waitingPastWindow, ...over });
        await waiting.service.runTurn(waiting.message);
        const replay = fixture({ status: 'active', handoff: returned, replay: true, ...over });
        await replay.service.runTurn(replay.message);
        const all = [...customerTexts(waiting.service), ...customerTexts(replay.service)].join('\n\n');
        return { waiting, replay, all };
    }

    it('the message past the unattended window gets no «still waiting»: the sweep is about to return it', async () => {
        const { service, message, executed } = fixture({ status: 'waiting_human', handoff: waitingPastWindow });
        await service.runTurn(message);
        expect(service.saveMessage).toHaveBeenCalledTimes(1);
        expect(service.replyOnceThroughOutbox).not.toHaveBeenCalled();
        expect(service.generateResponse).not.toHaveBeenCalled();
        // nor is the once-per-episode claim spent on a notice that was never sent
        expect(executed.some(sql => sql.includes("'{handoff,queueNoticeSent}'"))).toBe(false);
    });

    it('exactly one notice, consistent with the AI taking over, followed by the answer to the question', async () => {
        const { replay, all } = await episode({ lead: false });
        expect(replay.service.dispatchReplyThroughOutbox).toHaveBeenCalledTimes(1);
        expect(replay.service.replyOnceThroughOutbox).not.toHaveBeenCalled();
        expect(occurrences(all, RETURN_NOTICE)).toBe(1);
        expect(all.indexOf(RETURN_NOTICE)).toBe(0);
        expect(all.indexOf(RETURN_NOTICE)).toBeLessThan(all.indexOf('Ofrecemos los siguientes servicios dentales'));
        expect(all).toContain('- Consulta general: 30 minutos');
        expect(all.replace(/\s+/g, ' ')).toBe(`${RETURN_NOTICE} ${DENTAL_ANSWER}`.replace(/\s+/g, ' '));
    });

    it('never the contradictory pair: «sigue en espera» and «no hay nadie… sigo ayudándole yo»', async () => {
        const { all } = await episode({ lead: false });
        expect(all).not.toContain(STILL_WAITING);
        expect(all).not.toMatch(/sigue en espera|still waiting|continua em espera|toujours en attente/i);
        expect(all).toContain(RETURN_NOTICE);
    });

    it('no «anotada» when only the supervisors were alerted (one operational notice, no follow-up written)', async () => {
        const { replay, all } = await episode({ lead: false });
        // the alert itself still goes out
        expect(replay.noticeRows.length).toBe(1);
        expect(replay.tasks.createTaskIdempotently).not.toHaveBeenCalled();
        expect(all).not.toMatch(/anotad|solicitud.{0,40}(?:registrada|dejada)/i);
        expect(replay.service.generateResponse.mock.calls[0][2].handoffReturn)
            .toEqual({ ask: 'person', noteLeft: false, fromEpisode: true });
    });

    it('«anotada» once, after the answer, when the follow-up task was really recorded in this turn', async () => {
        const { replay, all } = await episode({ task: true });
        expect(replay.tasks.createTaskIdempotently).toHaveBeenCalledTimes(1);
        expect(occurrences(all, NOTE)).toBe(1);
        expect(occurrences(all, RETURN_NOTICE)).toBe(1);
        expect(all.indexOf(RETURN_NOTICE)).toBeLessThan(all.indexOf(NOTE));
        expect(all).not.toContain(STILL_WAITING);
    });

    it('a reply that was only a promise of a transfer does not say the notice twice', async () => {
        const { all } = await episode({ lead: false, reply: 'Un asesor se comunicará con usted en breve.' });
        expect(occurrences(all, RETURN_NOTICE)).toBe(1);
        expect(all).not.toContain('el equipo no está disponible');
        expect(all.trim()).toBe(RETURN_NOTICE);
    });

    it('a redelivery after the notice was claimed gets the plain answer: the notice is not said again', async () => {
        const again = fixture({ status: 'active', handoff: { ...returned, returnNoticePending: false }, replay: true, lead: false });
        await again.service.runTurn(again.message);
        const text = customerTexts(again.service).join('\n\n');
        expect(text).not.toContain(RETURN_NOTICE);
        expect(text.replace(/\s+/g, ' ')).toBe(DENTAL_ANSWER.replace(/\s+/g, ' '));
    });
});

describe('the ordinary handoff acknowledgements are unchanged while the customer is still waiting', () => {
    it('inside the unattended window the queue notice is sent once, with its own words', async () => {
        const { service, message } = fixture({ status: 'waiting_human', handoff: { startedAt: minutesAgo(3), reason: 'human_request' } });
        await service.runTurn(message);
        expect(service.replyOnceThroughOutbox).toHaveBeenCalledTimes(1);
        expect(service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text).toBe(STILL_WAITING);
        expect(service.replyOnceThroughOutbox.mock.calls[0][0].ownIdentity).toBe(true);
        expect(service.generateResponse).not.toHaveBeenCalled();
    });

    it.each([
        ['en', 'Your request is still waiting; someone from the team will reply as soon as they are available.'],
        ['pt', 'Sua solicitação continua em espera; alguém da equipe responderá assim que estiver disponível.'],
        ['fr', "Votre demande est toujours en attente ; quelqu'un de l'équipe vous répondra dès qu'il sera disponible."],
    ])('the queue notice in %s is unchanged', async (lang, expected) => {
        const { service, message } = fixture({ status: 'waiting_human', handoff: { startedAt: minutesAgo(3) } });
        service.languageDetector.detect.mockReturnValue(lang);
        await service.runTurn(message);
        expect(service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text).toBe(expected);
    });

    it('a handoff already returned once and started again long ago still gets its notice (the sweep would not return it)', async () => {
        const { service, message } = fixture({ status: 'waiting_human', handoff: { startedAt: minutesAgo(60), returnedToAi: true } });
        await service.runTurn(message);
        expect(service.replyOnceThroughOutbox).toHaveBeenCalledTimes(1);
    });

    it('the transfer notice that starts a handoff is unchanged', async () => {
        const { service, message } = fixture({ status: 'active', handoff: {} });
        service.handoffService.shouldHandoff.mockReturnValue('human_request');
        message.content.text = 'necesito hablar con una persona';
        await service.runTurn(message);
        expect(service.handoffService.executeHandoff).toHaveBeenCalledTimes(1);
        expect(service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text)
            .toBe('Entiendo su solicitud. Le estoy transfiriendo con nuestro equipo de atención. Un agente le responderá en breve. 🙋');
    });
});

describe('composeReturnReply', () => {
    const ANSWER = 'Atendemos de lunes a viernes de 9 a 18.';
    it('puts the notice once in front of the answer', () => {
        expect(composeReturnReply(RETURN_NOTICE, ANSWER)).toBe(`${RETURN_NOTICE}\n\n${ANSWER}`);
    });
    it('without a notice the answer is unchanged', () => {
        expect(composeReturnReply(null, ANSWER)).toBe(ANSWER);
        expect(composeReturnReply(RETURN_NOTICE, '')).toBe('');
    });
    it('the answer that already carries the notice, or the replay stand-in, does not repeat it', () => {
        expect(composeReturnReply(RETURN_NOTICE, `${RETURN_NOTICE}\n\n${ANSWER}`)).toBe(`${RETURN_NOTICE}\n\n${ANSWER}`);
        expect(composeReturnReply(RETURN_NOTICE, 'En este momento el equipo no está disponible; con gusto le ayudo yo.'))
            .toBe(RETURN_NOTICE);
        const en = 'Nobody from the team is available right now; I will keep helping you.';
        expect(composeReturnReply(en, `The team is not available right now; I am happy to help you myself.\n\n${ANSWER}`))
            .toBe(`${en}\n\n${ANSWER}`);
    });
});
