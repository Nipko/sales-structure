import { ConversationsService } from './conversations.service';
import { HandoffService } from '../handoff/handoff.service';
import { HANDOFF_QUEUE_HEAD, handoffReasonPreface, type HandoffNoticeLanguage } from '../handoff/handoff-notice';
import { normalizeCustomerIntent } from '../../common/conversation/intent-normalizer';

/**
 * F4300-07 (production 2026-10-22, image f33f4b22): the agent handed conversations to a person nobody asked for, and every later
 * turn only got «Su solicitud sigue en espera…».
 *   - «tienen algún descuento esta semana?» → `discount_request`: the policy classifier labelled a question about whether a
 *     promotion exists as a negotiation; the rules (and the prompt) say it is a read the agent answers from its promotions.
 *   - «¿cuál es el tour más barato que tienen?» → `discount_request`: «más barato» was a discount keyword.
 *   - «tienen disponible el producto QA Agente Stock? lo quiero comprar» → `human_request`: the product name contains «Agente» and
 *     «quiero» (to buy) was read as the verb asking for it.
 *   - «si pido 5 platos me haces 30% de descuento? confírmamelo ya» is a real negotiation and still transfers, but the reply now
 *     says first that the discount cannot be confirmed, so the transfer never reads as a yes.
 *
 * Driven through the real `runTurn` and the real `HandoffService` decision (rules + the classifier, whose model is mocked to the
 * label production got), so what is pinned is the turn's outcome, not a helper.
 */
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const ANSWER = 'Respuesta del agente.';

function turn(text: string, classifierLabel: string | null = null, language = 'es') {
    const handoff: any = Object.create(HandoffService.prototype);
    const classify = jest.fn().mockImplementation(async () => {
        if (classifierLabel === null) throw new Error('classifier down');
        return { content: JSON.stringify({ label: classifierLabel }) };
    });
    Object.assign(handoff, {
        llmRouter: { execute: classify }, logger: { warn: jest.fn() },
        executeHandoff: jest.fn().mockResolvedValue({ assignedTo: null }),
        isInHandoff: jest.fn().mockResolvedValue(false),
    });
    const prisma = {
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
            if (sql.includes('to_regclass')) return [{ t: 'agent_dispatch_outbox' }];
            if (sql.includes('COUNT(*) as cnt')) return [{ cnt: 1 }];
            return [];
        }),
        transactionInTenantSchema: jest.fn(async (_s: string, cb: (tx: any) => Promise<unknown>) => cb(jest.fn(async () => []))),
    };
    const service: any = Object.create(ConversationsService.prototype);
    Object.assign(service, {
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        prisma,
        pipelineService: { autoProgressFromConversation: jest.fn().mockResolvedValue(undefined), isAutoProgressEnabled: jest.fn().mockResolvedValue(false) },
        redis: {
            acquireLockToken: jest.fn().mockResolvedValue('owned'), releaseLockToken: jest.fn().mockResolvedValue(true),
            renewLockToken: jest.fn().mockResolvedValue(true), get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
        },
        languageDetector: { detect: jest.fn().mockReturnValue(language) },
        debounceBurst: jest.fn().mockResolvedValue(undefined),
        resolveConversation: jest.fn().mockResolvedValue({
            contact: { id: CONTACT_ID }, lead: { id: LEAD_ID },
            conversation: { id: CONVERSATION_ID, contact_id: CONTACT_ID, status: 'active', updated_at: new Date(), metadata: {} },
        }),
        tenantSchema: jest.fn().mockResolvedValue('tenant_over_escalation'),
        analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
        nurturingService: { cancelFollowUp: jest.fn().mockResolvedValue(undefined), scheduleFollowUp: jest.fn().mockResolvedValue(undefined) },
        dripSequenceService: { stopOnReply: jest.fn().mockResolvedValue(undefined) },
        leadScoring: { scoreAfterMessage: jest.fn().mockResolvedValue(undefined) },
        personaService: { resolvePersonaForChannel: jest.fn().mockResolvedValue({
            config: { language, hours: { aiOutsideHours: true }, behavior: { handoffTriggers: [] } },
            agentId: '77777777-7777-4777-8777-777777777777', version: 1,
        }) },
        llmRouter: { analyzeComplexity: () => 0, analyzeSentiment: () => 0 },
        throttle: {
            getAiMessageUsage: jest.fn().mockResolvedValue({ used: 0, limit: Infinity }),
            reserveAiMessageCount: jest.fn().mockResolvedValue({ allowed: true }),
            commitAiMessageCount: jest.fn().mockResolvedValue(undefined),
            releaseAiMessageCount: jest.fn().mockResolvedValue(undefined),
        },
        handoffService: handoff,
        complianceService: { detectOptOut: jest.fn().mockReturnValue(false) },
        isWithinBusinessHours: jest.fn().mockReturnValue(true),
        loadTenantBusinessHours: jest.fn().mockResolvedValue(null),
        persistConversationPersonaResolution: jest.fn().mockResolvedValue(undefined),
        sendTypingIndicatorQuietly: jest.fn().mockResolvedValue(undefined),
        saveMessage: jest.fn().mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888', duplicate: false }),
        saveAiMessage: jest.fn().mockResolvedValue(undefined), recordAgentSignal: jest.fn(),
        generateResponse: jest.fn().mockResolvedValue(ANSWER),
        dispatchReplyThroughOutbox: jest.fn().mockResolvedValue(true),
        replyOnceThroughOutbox: jest.fn().mockResolvedValue(true),
    });
    const message: any = {
        id: 'provider-message', tenantId: TENANT_ID, contactId: '12345', channelType: 'telegram',
        channelAccountId: 'bot-connection', content: { type: 'text', text }, metadata: {},
    };
    return { service, handoff, classify, run: () => service.runTurn(message) };
}

const answeredByTheAgent = (service: any) => {
    expect(service.handoffService.executeHandoff).not.toHaveBeenCalled();
    expect(service.replyOnceThroughOutbox).not.toHaveBeenCalled();
    // The turn reaches the model with its tools (promotions, catalogue) and its answer is what is sent.
    expect(service.generateResponse).toHaveBeenCalledTimes(1);
    expect(service.dispatchReplyThroughOutbox).toHaveBeenCalledTimes(1);
};

describe('F4300-07: no handoff the customer did not ask for', () => {
    it('case 1: «tienen algún descuento esta semana?» is answered (promotions read), even when the model labels it a negotiation', async () => {
        const t = turn('tienen algún descuento esta semana?', 'negotiation');
        await t.run();
        answeredByTheAgent(t.service);
        // A plain question about whether a promotion exists is decided without asking the model.
        expect(t.classify).not.toHaveBeenCalled();
    });

    it.each([
        ['es', '¿hay promociones o descuentos hoy?'],
        ['pt', 'vocês têm algum desconto esta semana?'],
        ['fr', 'avez-vous des remises cette semaine ?'],
        ['en', 'do you have any discounts this week?'],
    ])('asking whether a discount exists is a read in %s', async (_lang, text) => {
        const t = turn(text, 'negotiation');
        await t.run();
        answeredByTheAgent(t.service);
    });

    it('case 2: «¿cuál es el tour más barato que tienen?» is a catalogue read, not a discount request', async () => {
        const t = turn('¿cuál es el tour más barato que tienen?');
        await t.run();
        answeredByTheAgent(t.service);
    });

    it('case 3: an availability question about a product named «QA Agente Stock» plus «lo quiero comprar» is answered (out of stock), not transferred', async () => {
        const t = turn('tienen disponible el producto QA Agente Stock? lo quiero comprar');
        await t.run();
        answeredByTheAgent(t.service);
    });

    it('case 4: a real negotiation still transfers, and the reply first says the discount cannot be confirmed', async () => {
        const t = turn('si pido 5 platos me haces 30% de descuento? confírmamelo ya', 'negotiation');
        await t.run();
        expect(t.service.handoffService.executeHandoff).toHaveBeenCalledWith(
            TENANT_ID, CONVERSATION_ID, expect.anything(), 'discount_request');
        expect(t.service.generateResponse).not.toHaveBeenCalled();
        const sent = t.service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text as string;
        expect(sent).toBe(`${handoffReasonPreface('discount_request', 'es')} ${HANDOFF_QUEUE_HEAD.es}`);
        expect(sent.startsWith('No puedo confirmar descuentos')).toBe(true);
    });

    it.each(['es', 'en', 'pt', 'fr'] as const)('the "cannot confirm" sentence exists in %s and only for a discount request', (lang) => {
        expect(handoffReasonPreface('discount_request', lang)).toBeTruthy();
        expect(handoffReasonPreface('human_request', lang)).toBeNull();
        expect(handoffReasonPreface('complaint', lang)).toBeNull();
        expect(handoffReasonPreface('toString', lang)).toBeNull();
    });

    it.each<[HandoffNoticeLanguage, string]>([
        ['es', 'quiero hablar con una persona'],
        ['pt', 'quero falar com uma pessoa'],
        ['en', 'I want to talk to a person'],
        ['fr', 'je veux parler à une personne'],
    ])('«I want to talk to a person» still transfers at once in %s', async (lang, text) => {
        const t = turn(text, null, lang);
        await t.run();
        expect(t.service.handoffService.executeHandoff).toHaveBeenCalledWith(
            TENANT_ID, CONVERSATION_ID, expect.anything(), 'human_request');
        expect(t.service.generateResponse).not.toHaveBeenCalled();
        // No negotiation preface on a plain request for a person.
        expect(t.service.replyOnceThroughOutbox.mock.calls[0][0].item.payload.text).toBe(HANDOFF_QUEUE_HEAD[lang]);
    });
});

describe('F4300-07: what a request for a person and a price negotiation are', () => {
    it.each([
        'tienen disponible el producto QA Agente Stock? lo quiero comprar',
        'quiero comprar el Agente Stock',
        'necesito saber si el Asesor Premium tiene garantía',
        'lo quiero reservar con el plan Agente Plus',
    ])('purchase or information intent is never a request for a person: %s', (text) => {
        expect(normalizeCustomerIntent(text, { maxLength: Number.MAX_SAFE_INTEGER }).intent).not.toBe('request_human');
    });

    it.each([
        'quiero hablar con un asesor',
        'necesito un asesor',
        'quiero hablar con un Asesor Comercial',
        'QUIERO UN ASESOR',
        'tienen el producto? Quiero Hablar Con Un Asesor',
        'pásame con un agente por favor',
        'no quiero reservar, pero quiero un asesor',
    ])('a request for a person is still one: %s', (text) => {
        expect(normalizeCustomerIntent(text, { maxLength: Number.MAX_SAFE_INTEGER }).intent).toBe('request_human');
    });

    const service = (): any => {
        const s: any = Object.create(HandoffService.prototype);
        s.logger = { warn: jest.fn() };
        return s;
    };
    const config: any = { behavior: { handoffTriggers: [] } };

    it.each([
        '¿cuál es el tour más barato que tienen?',
        '¿tienen algo más barato?',
        'dame el más barato',
        '¿tienen precio especial para grupos?',
        'qual é o passeio mais barato?',
        'quel est le moins cher ?',
    ])('a price comparison is a read: %s', (text) => {
        expect(service().shouldHandoff(text, { metadata: {} }, config)).toBeNull();
    });

    it.each([
        '¿me lo dejas más barato?',
        'dámelo más barato',
        '¿lo pueden dejar más barato?',
        'hazme un mejor precio',
        'me lo deja en 50 mil?',
        'faz mais barato pra mim',
    ])('asking for the price to be lowered is a negotiation: %s', (text) => {
        expect(service().shouldHandoff(text, { metadata: {} }, config)).toBe('discount_request');
    });
});
