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
import { HUMAN_OFFER_QUESTION, NO_DATA_WAIT_REPLACEMENT, isAffirmationOfHumanOffer, offerInsteadOfPromise, teamRequestClaimAction } from './human-offer';

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
