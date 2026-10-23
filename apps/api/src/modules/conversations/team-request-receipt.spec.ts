import { readFileSync } from 'fs';
import { resolve } from 'path';
import { claimsTeamRequest, promisesHumanHandoff, teamRequestBacked } from '../../common/utils/outcome-claim.util';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
import { ConversationsService } from './conversations.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { ResponseValidatorService } from './response-validator.service';
import { HandoffService } from '../handoff/handoff.service';
import { rewriteReplayPromise } from './handoff-return-replay-turn';
import { HUMAN_OFFER_MARK, HUMAN_OFFER_QUESTION, NO_DATA_WAIT_REPLACEMENT, endsWithHumanOffer, isAffirmationOfHumanOffer, isOfferAcceptance, offerInsteadOfPromise, teamRequestClaimAction, withoutQuestions } from './human-offer';

/**
 * Production QA (Telegram, 3 cases): the agent offered «¿Quiere que alguien del equipo le confirme…?», the customer said
 * «Sí, por favor», and the agent answered that it had registered / requested / passed the request to the team. The only
 * tool was `ensure_crm_lead` (or none): no handoff, no task, the conversation stayed `active`.
 */
const LEAD = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const ensureLead = { name: 'ensure_crm_lead', result: { success: true, leadId: LEAD, created: true } };
const createdTask = { name: 'create_follow_up_task', result: { success: true, taskId: TASK, created: true, dueAt: null } };

const PRODUCTION = [
    {
        name: 'hotel amenities',
        offer: 'No tengo confirmado si el hotel cuenta con piscina y gimnasio. ¿Quiere que alguien del equipo le confirme esa información?',
        reply: 'He registrado su consulta para que alguien del equipo confirme si el hotel cuenta con piscina y gimnasio.',
    },
    {
        name: 'salon price',
        offer: 'No tengo el precio del alisado con keratina confirmado. ¿Quiere que alguien del equipo le confirme el precio?',
        reply: 'He solicitado a alguien del equipo que le confirme el precio del alisado con keratina.',
    },
    {
        name: 'hotel price',
        offer: 'No tengo confirmada la tarifa de la habitación doble. ¿Quiere que alguien del equipo se la confirme?',
        reply: 'Estoy pasando su solicitud al equipo para confirmar el precio de la habitación doble… Le avisaré en cuanto tenga la respuesta.',
    },
];

describe('TEAMREQ_A the three production replies are team-request claims', () => {
    it.each(PRODUCTION)('TEAMREQ_A_01 $name: recognised, and not a transfer promise the old branch already honoured', row => {
        expect(claimsTeamRequest(row.reply)).toBe(true);
        expect(promisesHumanHandoff(row.reply)).toBe(false);
    });

    it.each(PRODUCTION)('TEAMREQ_A_02 $name: the customer accepted the offer, so a lead alone opens the real handoff', row => {
        expect(isAffirmationOfHumanOffer('Sí, por favor.', row.offer)).toBe(true);
        for (const executed of [[ensureLead], []]) {
            expect(teamRequestClaimAction({ reply: row.reply, executed, customerAuthorized: true })).toBe('honour');
        }
    });

    it.each(PRODUCTION)('TEAMREQ_A_03 $name: unasked, the claim becomes the offer from the existing template and promises nothing', row => {
        expect(teamRequestClaimAction({ reply: row.reply, executed: [ensureLead], customerAuthorized: false })).toBe('rewrite_offer');
        const out = offerInsteadOfPromise(row.reply, 'es', true);
        expect(claimsTeamRequest(out)).toBe(false);
        expect(out === NO_DATA_WAIT_REPLACEMENT.es || out.endsWith(HUMAN_OFFER_QUESTION.es)).toBe(true);
        expect(out).not.toMatch(/registrado|solicitado|pasando|avisar[eé]/i);
    });

    it.each(PRODUCTION)('TEAMREQ_A_04 $name: on the replay of an unattended handoff the claim is removed, never honoured', row => {
        expect(teamRequestClaimAction({ reply: row.reply, executed: [ensureLead], customerAuthorized: true, replay: true })).toBe('replay_rewrite');
        expect(claimsTeamRequest(rewriteReplayPromise(row.reply, 'es', false))).toBe(false);
    });
});

describe('TEAMREQ_B receipts: only a handoff or a follow-up task created this turn makes the claim true', () => {
    const reply = PRODUCTION[0].reply;
    it('TEAMREQ_B_01 ensure_crm_lead alone is not a receipt, whatever it returned', () => {
        expect(teamRequestBacked([ensureLead])).toBe(false);
        expect(teamRequestBacked([{ name: 'ensure_crm_lead', result: { success: true, leadId: LEAD, created: false } }])).toBe(false);
        expect(teamRequestBacked([{ name: 'ensure_crm_lead', result: { success: true, leadId: LEAD, created: true, shouldHandoff: true } }])).toBe(false);
        expect(teamRequestBacked([{ name: 'add_contact_note', result: { success: true, recorded: 'nota' } }])).toBe(false);
    });
    it('TEAMREQ_B_02 a follow-up task created this turn keeps the text', () => {
        expect(teamRequestBacked([ensureLead, createdTask])).toBe(true);
        expect(teamRequestClaimAction({ reply, executed: [ensureLead, createdTask], customerAuthorized: false })).toBe('none');
        expect(teamRequestClaimAction({ reply, executed: [createdTask], customerAuthorized: true })).toBe('none');
    });
    it('TEAMREQ_B_03 an existing, failed or malformed task is not a new request', () => {
        for (const result of [
            { success: true, taskId: TASK, created: false },
            { error: 'follow_up_create_failed' },
            { success: true, created: true },
            { success: true, taskId: 'task-1', created: true },
        ]) expect(teamRequestBacked([{ name: 'create_follow_up_task', result }])).toBe(false);
    });
    it('TEAMREQ_B_04 a tool that asked for a person (the pipeline opens that handoff) keeps the text', () => {
        expect(teamRequestBacked([{ name: 'file_claim', result: { success: true, shouldHandoff: true } }])).toBe(true);
        expect(teamRequestBacked([{ name: 'file_claim', result: { success: false, shouldHandoff: true } }])).toBe(false);
    });
    it('TEAMREQ_B_05 a transfer promise and a fixed system text stay with the existing handoff branches', () => {
        const legitimate = 'Le voy a transferir con un agente de nuestro equipo.';
        expect(promisesHumanHandoff(legitimate)).toBe(true);
        expect(teamRequestClaimAction({ reply: legitimate, executed: [], customerAuthorized: true })).toBe('none');
        expect(teamRequestClaimAction({ reply, executed: [], customerAuthorized: true, fixedText: true })).toBe('none');
    });
});

describe('TEAMREQ_C the claim in four languages', () => {
    it.each([
        ['es', 'He pasado su consulta al equipo.'],
        ['es', 'Le estoy transfiriendo.'],
        ['es', 'Ya trasladé su solicitud a un asesor.'],
        ['es', 'Su consulta fue enviada al equipo de ventas.'],
        ['es', 'Le avisaré cuando tenga la respuesta.'],
        ['en', "I've passed your request to the team."],
        ['en', "I've asked someone from the team to confirm the price."],
        ['en', "I'm forwarding your question to our staff."],
        ['en', "I'll let you know."],
        ['en', "I'll get back to you as soon as I hear from them."],
        ['pt', 'Passei sua solicitação para a equipe.'],
        ['pt', 'Estou encaminhando sua pergunta para um atendente.'],
        ['pt', 'Pedi a alguém da equipe para confirmar o preço.'],
        ['pt', 'Vou te avisar assim que tiver a resposta.'],
        ['fr', "J'ai transmis votre demande à l'équipe."],
        ['fr', "J'ai demandé à quelqu'un de l'équipe de confirmer le prix."],
        ['fr', 'Je vous tiendrai informé.'],
        ['fr', "Je reviens vers vous dès que j'ai la réponse."],
    ])('TEAMREQ_C_01 %s: «%s» is a claim; unasked it becomes the offer, accepted it opens the handoff', (lang, reply) => {
        expect(claimsTeamRequest(reply)).toBe(true);
        expect(teamRequestClaimAction({ reply, executed: [ensureLead], customerAuthorized: true })).toBe('honour');
        expect(teamRequestClaimAction({ reply, executed: [ensureLead], customerAuthorized: false })).toBe('rewrite_offer');
        const out = offerInsteadOfPromise(reply, lang, true);
        expect(claimsTeamRequest(out)).toBe(false);
        expect(out).toBe(NO_DATA_WAIT_REPLACEMENT[lang]);
    });

    it.each([
        // es — the team named, nothing passed to it
        'Nuestro equipo de estilistas tiene más de 10 años de experiencia.',
        'El equipo de recepción atiende de 7:00 a 22:00.',
        'He enviado la foto del equipo de spa.',
        'He enviado su pedido al equipo de cocina.',
        'Le aviso que el equipo de cocina cierra a las 22:00.',
        'Le avisaremos por correo cuando su pedido se envíe.',
        '¿Quiere que pase su consulta al equipo?',
        'Si lo desea, le aviso cuando tenga la respuesta.',
        'No he pasado su consulta al equipo todavía.',
        // en
        'Our team has been working together for ten years.',
        "I've sent you the menu our team prepared.",
        'Would you like me to pass your request to the team?',
        'If you want, I will let you know when the team replies.',
        // pt
        'Nossa equipe tem dez anos de experiência.',
        'Vou te passar o cardápio da equipe.',
        // fr
        'Notre équipe vous accueille du lundi au samedi.',
        'Je vais vous passer les horaires de notre équipe.',
    ])('TEAMREQ_C_02 unrelated text is not touched: «%s»', text => {
        expect(claimsTeamRequest(text)).toBe(false);
        expect(teamRequestClaimAction({ reply: text, executed: [], customerAuthorized: true })).toBe('none');
        expect(teamRequestClaimAction({ reply: text, executed: [], customerAuthorized: false })).toBe('none');
    });

    it('TEAMREQ_C_03 the information around the claim stays, figures included', () => {
        const out = offerInsteadOfPromise('La habitación doble cuesta 250.000 COP por noche. He pasado su consulta al equipo para confirmar el desayuno.', 'es', true);
        expect(out).toContain('250.000 COP');
        expect(out.endsWith(HUMAN_OFFER_QUESTION.es)).toBe(true);
        expect(claimsTeamRequest(out)).toBe(false);
        // No person reachable from this conversation: promise nothing and offer nobody.
        expect(offerInsteadOfPromise(PRODUCTION[1].reply, 'es', false)).toBe('No tengo ese dato confirmado en este momento.');
    });
});

describe('TEAMREQ_D the output guardrails leave the claim for the handoff decision', () => {
    it.each(PRODUCTION)('TEAMREQ_D_01 $name: no rewrite round trip and no effect inside the guardrails', async row => {
        const f = agentTurnFixture();
        const session = { trace: { steps: [] as Array<{ signal: string }> } };
        const output = await (f.runtime as any).applyOutputGuardrails(row.reply, '<persona>Atiende con claridad.</persona>',
            [{ role: 'assistant', content: row.offer }, { role: 'user', content: 'Sí, por favor.' }], ['tier_1'], 'tenant', 'conversation',
            [ensureLead], 'es', [], {}, session, f.llmRouter);
        expect(output).toBe(row.reply);
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
        expect(f.handoffService.executeHandoff).not.toHaveBeenCalled();
    });
});

/** A whole live turn (`generateResponse`) with real guards and the real HandoffService rules; only I/O is substituted. */
function liveTurn(previousOutbound: string | null, reply: string) {
    const service: any = Object.create(ConversationsService.prototype);
    const executor: any = Object.create(AIToolExecutorService.prototype);
    executor.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const authority = { source: 'turn_contract', allowedTools: ['search_products'], deniedTools: [], commitmentBlocked: null, resolvedAt: new Date().toISOString() };
    const tools = authority.allowedTools.map(name => ({ name, description: name, parameters: { type: 'object', properties: {} } }));
    const llm = jest.fn().mockResolvedValue({ content: reply });
    const history = previousOutbound ? [{ id: 'm1', direction: 'outbound', content_text: previousOutbound, metadata: {} }] : [];
    let metadata: any = {};
    const query = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        if (sql.startsWith('SELECT contact_id FROM conversations')) return [{ contact_id: '22222222-2222-4222-8222-222222222222' }];
        if (sql.startsWith('UPDATE conversations SET metadata=(COALESCE')) { metadata = { ...metadata, ...JSON.parse(params[1]) }; return [{ id: params[0] }]; }
        if (sql.startsWith('SELECT metadata FROM conversations')) return [{ metadata: structuredClone(metadata) }];
        if (sql.startsWith('UPDATE conversations SET metadata=') && params[2]) { metadata = { ...metadata, ...JSON.parse(params[2]) }; return [{ id: params[0] }]; }
        if (sql.startsWith('SELECT id, direction, content_text, metadata FROM messages')) return history;
        return [];
    });
    const handoff: any = Object.create(HandoffService.prototype);
    Object.assign(handoff, { llmRouter: { execute: jest.fn().mockRejectedValue(new Error('classifier down')) }, logger: { warn: jest.fn(), log: jest.fn() },
        executeHandoff: jest.fn().mockResolvedValue({}), isInHandoff: jest.fn().mockResolvedValue(false) });
    Object.assign(service, {
        logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        prisma: { executeInTenantSchema: query, transactionInTenantSchema: (schema: string, work: any) => work((sql: string, params?: any[]) => query(schema, sql, params)), tenant: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) } },
        redis: { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn().mockResolvedValue(undefined), del: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined), incr: jest.fn().mockResolvedValue(1), expire: jest.fn(), sadd: jest.fn().mockResolvedValue(1), rpush: jest.fn() },
        llmRouter: { analyzeComplexity: () => 0, analyzeSentiment: () => 0, stageToScore: () => 0, execute: llm },
        languageDetector: { detect: () => 'es' },
        tenantSchema: jest.fn().mockResolvedValue('tenant_test'),
        isWithinBusinessHours: jest.fn().mockReturnValue(true),
        loadBookingState: jest.fn().mockResolvedValue({ step: 'idle' }),
        procedureEngine: { getState: jest.fn().mockResolvedValue(null), process: jest.fn().mockResolvedValue({ handled: false }), missionCandidates: jest.fn().mockResolvedValue([]) },
        bookingEngine: { process: jest.fn().mockResolvedValue({ handled: false, state: { step: 'idle' } }) },
        activeOperationsContext: { populateTurnContext: jest.fn() },
        businessInfoService: { getPrimary: jest.fn().mockResolvedValue(null) },
        knowledgeService: { tenantHasKnowledge: jest.fn().mockResolvedValue(false), searchRelevant: jest.fn().mockResolvedValue([]) },
        rewriteSearchQuery: jest.fn().mockImplementation(async (text: string) => text),
        turnCapabilityComposer: { resolve: jest.fn().mockResolvedValue({
            tools, authority, deniedTools: [], commitmentBlocked: null, status: { status: 'ok' },
            contract: { version: 1, publishedTools: authority.allowedTools, resolvedAt: authority.resolvedAt, excluded: [], writersBlocked: false },
        }) },
        toolExecutionControl: { findPendingConfirmation: jest.fn().mockResolvedValue(null) },
        mediaProcessing: { handlePendingConsentReply: jest.fn().mockResolvedValue({ handled: false }), processMedia: jest.fn(), getFallbackMessage: jest.fn() },
        toolExecutor: executor,
        handoffService: handoff,
        promptAssembler: new PromptAssemblerService({ buildSystemPrompt: () => '<persona>Assistant</persona>' } as any),
        responseValidator: new ResponseValidatorService(),
        throttle: { getPlanFeatures: jest.fn().mockResolvedValue({ llmTier: 'tier_2' }) },
        analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
        eventEmitter: { emit: jest.fn() },
        sendMedia: jest.fn(), sendPaymentLink: jest.fn(), sendFlow: jest.fn(),
    });
    service.bookingEngine.forExecution = () => service.bookingEngine;
    service.procedureEngine.forExecution = () => service.procedureEngine;
    const config: any = { language: 'es', industry: 'hotel', behavior: { handoffTriggers: [] }, llm: {}, tools: { appointments: { enabled: false } } };
    const conversation = { id: '33333333-3333-4333-8333-333333333333', contact_id: '22222222-2222-4222-8222-222222222222', updated_at: new Date(), metadata: {} };
    const run = (text: string) => service.generateResponse(
        '11111111-1111-4111-8111-111111111111', conversation,
        { channelType: 'telegram', channelAccountId: 'tg', content: { type: 'text', text }, metadata: {} },
        config, { id: conversation.contact_id, name: 'Alice' }, {}, conversation.updated_at, {}, '44444444-4444-4444-8444-444444444444', 'agent', undefined, 3,
    );
    return { run, handoff };
}

describe('TEAMREQ_F a whole Telegram turn', () => {
    it.each(PRODUCTION)('TEAMREQ_F_01 $name: «Sí, por favor» to the offer opens a real handoff and the reply stands', async row => {
        const { run, handoff } = liveTurn(row.offer, row.reply);
        expect(await run('Sí, por favor.')).toBe(row.reply);
        expect(handoff.executeHandoff).toHaveBeenCalledTimes(1);
        expect(handoff.executeHandoff.mock.calls[0][3]).toBe('customer_accepted_human_offer');
    });
    it.each(PRODUCTION)('TEAMREQ_F_02 $name: the same claim when nobody accepted anything is the offer, and nobody is transferred', async row => {
        const { run, handoff } = liveTurn('El hotel abre la recepción las 24 horas.', row.reply);
        const out = await run('¿Y tienen parqueadero?');
        expect(claimsTeamRequest(out)).toBe(false);
        expect(out === NO_DATA_WAIT_REPLACEMENT.es || out.endsWith(HUMAN_OFFER_QUESTION.es)).toBe(true);
        expect(handoff.executeHandoff).not.toHaveBeenCalled();
    });
    it('TEAMREQ_F_03 an answer that only names the team is not touched and opens nothing', async () => {
        const reply = 'Nuestro equipo de recepción atiende las 24 horas y el desayuno se sirve de 6:30 a 10:00.';
        const { run, handoff } = liveTurn(PRODUCTION[0].offer, reply);
        expect(await run('Sí, por favor.')).toBe(reply);
        expect(handoff.executeHandoff).not.toHaveBeenCalled();
    });
});

describe('TEAMREQ_E the pipeline wiring', () => {
    const source = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
    const start = source.indexOf('const teamAction = teamRequestClaimAction(');
    const branch = source.slice(start, source.indexOf('// Classifier unavailable + term backstop', start));
    it('TEAMREQ_E_01 decided after the transfer-promise branches, with the customer authorisation and this turn\'s tools', () => {
        expect(start).toBeGreaterThan(source.indexOf("'agent_promised_handoff'"));
        expect(branch).toContain('customerAuthorized: humanHandoffAuthorized');
        expect(branch).toContain('[...executedToolsThisTurn, ...engineExecutedTools]');
        expect(source.slice(source.lastIndexOf('else if', start), start)).toContain('!draftMode && !postToolHandoff');
    });
    it('TEAMREQ_E_02 honour opens the handoff and keeps the text; only a failure replaces it', () => {
        const honour = branch.slice(branch.indexOf("teamAction === 'honour'"));
        expect(honour).toContain("this.escalateWithinTurn(tenantId, conversation, msg, 'customer_accepted_human_offer'");
        expect(honour).toContain("'none'");
        expect(honour.match(/finalResponse = /g)).toEqual(['finalResponse = ']);
        expect(honour).toContain('finalResponse = handoffText(userLanguage).unavailable');
    });
    it('TEAMREQ_E_03 an unasked claim is the offer, remembered so the next «sí» escalates', () => {
        const rewrite = branch.slice(branch.indexOf("teamAction === 'rewrite_offer'"), branch.indexOf("teamAction === 'honour'"));
        expect(rewrite).toContain('offerInsteadOfPromise(finalResponse, userLanguage, allowHumanHandoff)');
        expect(rewrite).toContain('this.rememberHumanOffer(schemaName, conversation.id, finalResponse)');
    });
});

/**
 * Production QA after #180 (Telegram, gpt-4.1-mini). The offer of a person was the model's own words, not our fixed
 * sentence, so no mark was left and the customer's «sí» reached the model:
 *  - store: the reply «He tomado nota para que alguien del equipo confirme…» was not read as a claim: no handoff, `active`;
 *  - travel: «Sí, por favor pídanle que lo confirme» (seven words) was not read as an acceptance, so the claim was rewritten
 *    as the offer AFTER «¿Desea que le ayude con algo más mientras tanto?»: two questions, the offer made again;
 *  - hotel: worked (a real handoff), and must keep working.
 */
const FOLLOWUP = {
    store: {
        offer: 'No tengo información específica sobre la garantía del Audífono QA Aurora. ¿Quiere que le pida a alguien del equipo que se lo confirme?',
        accept: 'Sí, por favor.',
        reply: 'He tomado nota para que alguien del equipo confirme la garantía del Audífono QA Aurora y le contacte. ¿Desea que le ayude con algo más mientras tanto?',
    },
    travel: {
        offer: 'No tengo confirmado si el Tour QA Aurora incluye el almuerzo. ¿Quiere que le pida a alguien del equipo que lo confirme por usted?',
        accept: 'Sí, por favor pídanle que lo confirme.',
        reply: 'He pasado su consulta al equipo para que confirmen si el Tour QA Aurora incluye el almuerzo. ¿Desea que le ayude con algo más mientras tanto?',
    },
    hotel: {
        offer: 'No tengo confirmado el horario del spa. ¿Quiere que le consulte con alguien del equipo para confirmarlo?',
        accept: 'Sí, por favor.',
        reply: 'Con gusto, le paso con alguien del equipo para que le confirme el horario del spa.',
    },
};

describe('TEAMREQ_G the offer in the model\'s own words, accepted', () => {
    it.each(Object.entries(FOLLOWUP))('TEAMREQ_G_01 %s: the offer is recognised and the customer\'s words accept it', (_name, row) => {
        expect(endsWithHumanOffer(row.offer)).toBe(true);
        expect(isOfferAcceptance(row.accept)).toBe(true);
        expect(isAffirmationOfHumanOffer(row.accept, row.offer)).toBe(true);
    });

    it('TEAMREQ_G_02 store: «He tomado nota para que alguien del equipo… le contacte» is a team-request claim', () => {
        expect(claimsTeamRequest(FOLLOWUP.store.reply)).toBe(true);
        expect(teamRequestClaimAction({ reply: FOLLOWUP.store.reply, executed: [ensureLead], customerAuthorized: true })).toBe('honour');
    });

    it.each(Object.entries(FOLLOWUP))('TEAMREQ_G_03 %s: a whole turn opens the real handoff and keeps the reply', async (_name, row) => {
        const { run, handoff } = liveTurn(row.offer, row.reply);
        expect(await run(row.accept)).toBe(row.reply);
        expect(handoff.executeHandoff).toHaveBeenCalledTimes(1);
        expect(['customer_accepted_human_offer', 'agent_promised_handoff']).toContain(handoff.executeHandoff.mock.calls[0][3]);
    });

    it.each(['store', 'travel'] as const)('TEAMREQ_G_04 %s: unasked, the claim becomes ONE question, never «¿algo más?» followed by the offer', async name => {
        const row = FOLLOWUP[name];
        const { run, handoff } = liveTurn('El hotel abre la recepción las 24 horas.', row.reply);
        const out = await run('¿Y tienen parqueadero?');
        expect(handoff.executeHandoff).not.toHaveBeenCalled();
        expect(out.match(/\?/g)).toHaveLength(1);
        expect(out).not.toMatch(/algo más/);
        expect(out === NO_DATA_WAIT_REPLACEMENT.es || out.endsWith(HUMAN_OFFER_QUESTION.es)).toBe(true);
        // and the pure function, on the production reply
        const rewritten = offerInsteadOfPromise(row.reply, 'es', true);
        expect(rewritten.match(/\?/g)).toHaveLength(1);
        expect(rewritten).toBe(NO_DATA_WAIT_REPLACEMENT.es);
    });

    it('TEAMREQ_G_05 the information around the claim stays; only its questions go', () => {
        const reply = 'La habitación doble cuesta 250.000 COP. He tomado nota para que alguien del equipo confirme el desayuno. ¿Desea algo más?';
        expect(offerInsteadOfPromise(reply, 'es', true)).toBe(`La habitación doble cuesta 250.000 COP.\n\n${HUMAN_OFFER_QUESTION.es}`);
        expect(withoutQuestions('Tenemos 3 modelos, ¿cuál prefiere?')).toBe('Tenemos 3 modelos.');
        expect(withoutQuestions('Mientras tanto, ¿desea algo más?')).toBe('');
        expect(withoutQuestions('Abrimos a las 9.\nAnything else?')).toBe('Abrimos a las 9.');
    });
});

describe('TEAMREQ_H the acceptance is decided at turn start from the previous assistant message', () => {
    const harness = (lastOutbound: string | null, minutesAgo = 1) => {
        const row: any = { metadata: {} as Record<string, any> };
        const service: any = Object.create(ConversationsService.prototype);
        service.logger = { warn: jest.fn() };
        service.prisma = { executeInTenantSchema: jest.fn(async (_s: string, sql: string, params: any[]) => {
            if (sql.includes("'{" + HUMAN_OFFER_MARK + "}'")) row.metadata[HUMAN_OFFER_MARK] = JSON.parse(params[1]);
            else if (sql.includes("- '" + HUMAN_OFFER_MARK + "'")) delete row.metadata[HUMAN_OFFER_MARK];
            else if (/direction = 'outbound'/.test(sql)) {
                return lastOutbound === null ? [] : [{ content_text: lastOutbound, created_at: new Date(Date.now() - minutesAgo * 60_000) }];
            }
            return [];
        }) };
        const conversation = () => ({ id: 'conv', metadata: JSON.parse(JSON.stringify(row.metadata)) });
        return { service, row, conversation };
    };
    const fresh = () => ({ id: 'conv', metadata: {} });

    it.each(Object.entries(FOLLOWUP))('TEAMREQ_H_01 %s: no mark, the offer is the last message, the «sí» escalates before the model runs', async (_name, row) => {
        const { service, conversation } = harness(row.offer);
        expect(await service.resolveHumanOfferAcceptance('schema', conversation(), row.accept)).toBe(true);
    });

    it('TEAMREQ_H_02 the free-text offer also leaves the mark, and the mark path accepts it', async () => {
        const { service, row, conversation } = harness(FOLLOWUP.travel.offer, 60);
        expect(await service.rememberHumanOffer('schema', 'conv', FOLLOWUP.travel.offer)).toBe(true);
        expect(row.metadata[HUMAN_OFFER_MARK]).toBeDefined();
        // the mark is live, so the age of the message does not matter
        expect(await service.resolveHumanOfferAcceptance('schema', conversation(), FOLLOWUP.travel.accept)).toBe(true);
        expect(row.metadata[HUMAN_OFFER_MARK]).toBeUndefined();
    });

    it('TEAMREQ_H_03 an old offer, another last message, or a message that is not an acceptance does nothing', async () => {
        expect(await harness(FOLLOWUP.store.offer, 16).service.resolveHumanOfferAcceptance('schema', fresh(), 'sí')).toBe(false);
        expect(await harness('Recordatorio: su cita es mañana a las 10:00.').service.resolveHumanOfferAcceptance('schema', fresh(), 'sí')).toBe(false);
        expect(await harness(null).service.resolveHumanOfferAcceptance('schema', fresh(), 'sí')).toBe(false);
        for (const text of ['sí pero antes dime el precio del corte', 'no gracias', '¿cuánto cuesta?', 'quiero un corte']) {
            expect(await harness(FOLLOWUP.store.offer).service.resolveHumanOfferAcceptance('schema', fresh(), text)).toBe(false);
        }
        // an offer followed by another question: the «sí» answers that one
        const two = `${FOLLOWUP.store.offer} ¿O prefiere ver otro modelo?`;
        expect(await harness(two).service.resolveHumanOfferAcceptance('schema', fresh(), 'sí')).toBe(false);
    });

    it('TEAMREQ_H_04 an expired mark is not rescued by the message history', async () => {
        const { service, row, conversation } = harness(FOLLOWUP.store.offer, 1);
        row.metadata[HUMAN_OFFER_MARK] = { at: new Date(Date.now() - 20 * 60_000).toISOString(), expiresAt: new Date(Date.now() - 5 * 60_000).toISOString() };
        expect(await service.resolveHumanOfferAcceptance('schema', conversation(), 'sí')).toBe(false);
    });
});

describe('TEAMREQ_I the offer, the acceptance and the claim in four languages', () => {
    it.each([
        '¿Quiere que le pida a alguien del equipo que lo confirme?',
        '¿Quiere que le consulte con alguien del equipo?',
        '¿Quiere que le pregunte a alguien del equipo?',
        '¿Desea que alguien del equipo le confirme el horario?',
        '¿Quiere que lo consulte con el equipo?',
        '¿Le conecto con un asesor?',
        '¿Le pido a una persona del equipo que lo confirme?',
        'Would you like me to ask someone from the team to confirm it?',
        'Do you want me to check with the team?',
        'Shall I ask a colleague to confirm it?',
        'Quer que eu peça a alguém da equipe para confirmar?',
        'Posso perguntar para a equipe?',
        "Voulez-vous que je demande à quelqu'un de l'équipe ?",
        'Souhaitez-vous que je vérifie avec un collègue ?',
    ])('TEAMREQ_I_01 an offer of a person: «%s»', text => {
        expect(endsWithHumanOffer(text)).toBe(true);
    });

    it.each([
        '¿Desea agendar con nuestro equipo de estilistas?',
        '¿Quiere el kit del equipo de fútbol?',
        '¿Desea agendar con el especialista?',
        '¿Le agendo el sábado a las 4?',
        '¿Quiere que le pida a alguien del equipo que lo confirme? ¿O prefiere ver otro modelo?',
        'Would you like to book with our team of stylists?',
    ])('TEAMREQ_I_02 not an offer a «sí» would accept: «%s»', text => {
        expect(endsWithHumanOffer(text)).toBe(false);
    });

    it.each([
        'sí', 'Sí, por favor.', 'Sí, por favor pídanle que lo confirme.', 'sí, pídanle', 'dale', 'ok hazlo', 'por favor consúltelo',
        'sí, que lo confirmen', 'adelante', 'yes, go ahead', 'yes please ask them', 'please do', 'sim, pode pedir', 'sim, por favor',
        'oui, allez-y', "oui, demandez-leur s'il vous plaît",
    ])('TEAMREQ_I_03 an acceptance: «%s»', text => {
        expect(isOfferAcceptance(text)).toBe(true);
    });

    it.each([
        'no', 'no gracias', 'sí pero antes dime el precio del corte', 'mejor no', 'ok pero primero el precio', '¿y cuánto cuesta?',
        'quiero un corte', 'sí, el lunes', 'no, pídanle nada', 'yes but first tell me the price', 'non merci', 'não, obrigado', 'que lo',
    ])('TEAMREQ_I_04 not an acceptance: «%s»', text => {
        expect(isOfferAcceptance(text)).toBe(false);
    });

    it.each([
        'He tomado nota para que alguien del equipo confirme la garantía del Audífono QA Aurora y le contacte.',
        'Dejé anotado para que el equipo lo confirme.',
        'Le contactarán en cuanto tengan la respuesta.',
        'Alguien del equipo le contactará pronto.',
        'Se pondrán en contacto con usted hoy mismo.',
        "I've made a note so someone from the team can confirm it.",
        'Someone from our team will contact you shortly.',
        'You will be contacted shortly.',
        'Tomei nota para que alguém da equipe confirme.',
        'Você será contatado em breve.',
        "J'ai pris note pour que quelqu'un de l'équipe vous le confirme.",
        'Vous serez contacté rapidement.',
    ])('TEAMREQ_I_05 a team-request claim: «%s»', text => {
        expect(claimsTeamRequest(text)).toBe(true);
    });

    it.each([
        '¿Quiere que tome nota para que alguien del equipo le contacte?',
        'Si lo desea, tomo nota para que alguien del equipo le contacte.',
        'No he tomado nota todavía.',
        'No le contactarán sin su autorización.',
        'Le avisarán por correo cuando su pedido se envíe.',
        'Would you like to be contacted by our team?',
        'If you want, you will be contacted tomorrow.',
        'Si quiere, le contactarán mañana.',
    ])('TEAMREQ_I_06 not a claim: «%s»', text => {
        expect(claimsTeamRequest(text)).toBe(false);
    });
});
