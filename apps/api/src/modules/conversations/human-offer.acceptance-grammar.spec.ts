import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConversationsService } from './conversations.service';
import { LanguageDetectorService } from './language-detector.service';
import {
    HUMAN_OFFER_QUESTION, NO_DATA_WAIT_REPLACEMENT, POLICY_PERSON_OFFER_QUESTION,
    endsWithHumanOffer, isAffirmationOfHumanOffer, isOfferAcceptance, isRequestVerb, opensWithAffirmation,
    repeatsAcceptedHumanOffer, repliesYesToHumanOffer,
} from './human-offer';

/**
 * F4300-25 (production QA): the agent offered «¿Quiere que le pida a alguien del equipo que lo confirme?», the customer
 * accepted, and no handoff happened: the acceptance had a word outside a closed list, reached the model, and the model
 * offered the person again or said «Un momento, por favor». Fixed by layer: an acceptance GRAMMAR (a «yes» that echoes
 * the offer, request verbs read by root with their clitics folded), and an output rule that never makes the same offer
 * twice in a row after a «yes».
 */
const PRODUCTION_ACCEPTANCES = [
    'Sí, por favor pídalo.',
    'Sí, por favor comunícame con alguien del equipo para que me confirme la garantía.',
    'Yes, please check with the team.',
];

type Lang = 'es' | 'en' | 'pt' | 'fr';
const MODEL_OFFERS: Record<Lang, string[]> = {
    es: [
        'No tengo confirmada la garantía del Audífono QA Aurora. ¿Quiere que le pida a alguien del equipo que lo confirme?',
        '¿Le conecto con un asesor?',
    ],
    en: ['I do not have the warranty confirmed. Would you like me to check with someone from the team?'],
    pt: ['Não tenho a garantia confirmada. Quer que eu peça a alguém da equipe para confirmar?'],
    fr: ["Je n'ai pas la garantie confirmée. Souhaitez-vous que je demande à quelqu'un de l'équipe de la confirmer ?"],
};
const offersOf = (lang: Lang): string[] => [
    HUMAN_OFFER_QUESTION[lang], NO_DATA_WAIT_REPLACEMENT[lang], POLICY_PERSON_OFFER_QUESTION[lang], ...MODEL_OFFERS[lang],
];

const ACCEPTANCES: Record<Lang, string[]> = {
    es: [
        ...PRODUCTION_ACCEPTANCES.slice(0, 2),
        'sí', 'Sí, por favor.', 'claro, pídanselo', 'dale, consúltemelo por favor', 'ok, que me confirmen',
        'Sí, por favor, pregúntele al equipo si tienen garantía extendida para mi compra', 'Sí, se lo agradezco mucho',
        'De acuerdo, comuníqueme con un asesor', 'Por favor confírmelo', 'Pídanle que lo confirme',
        'sí, que alguien del equipo me contacte hoy',
    ],
    en: [PRODUCTION_ACCEPTANCES[2], 'yes please', 'Sure, ask them', 'Yes, go ahead and contact the team for me', 'please do', 'Of course, thank you'],
    pt: ['Sim, por favor.', 'sim, pode pedir', 'Sim, por favor pergunte à equipe', 'Claro, peça para alguém da equipe confirmar', 'Pode verificar, obrigado'],
    fr: ['oui', "Oui, demandez-leur s'il vous plaît", "D'accord, vérifiez avec l'équipe", 'Oui, contactez quelqu’un de l’équipe svp', 'Volontiers, merci'],
};

const NON_ACCEPTANCES = [
    'no', 'no gracias', 'No, gracias, así está bien', 'not now', 'No thanks', 'sí, pero ¿cuánto cuesta?', '¿y el precio?',
    'no, mejor después', 'mejor no', 'sí, pero antes dime el precio', 'Si me confirman el precio hoy entonces sí',
    'depende del precio', 'only if it is free', 'yes but first tell me the price', 'não, obrigado', 'non merci', 'pas maintenant',
    'quiero un corte', 'sí, el lunes', '¿Tienen otro modelo?', 'Sí, ¿y tienen envío a Medellín?', '', 'que lo',
];

describe('F4300-25 the acceptance grammar: offers × acceptance forms in es/en/pt/fr', () => {
    it.each(PRODUCTION_ACCEPTANCES)('regression: «%s» accepts the offer', text => {
        expect(isOfferAcceptance(text)).toBe(true);
        expect(isAffirmationOfHumanOffer(text, HUMAN_OFFER_QUESTION.es)).toBe(true);
        expect(repliesYesToHumanOffer(text, MODEL_OFFERS.es[0])).toBe(true);
    });

    const matrix = (Object.keys(ACCEPTANCES) as Lang[]).flatMap(lang =>
        offersOf(lang).flatMap(offer => ACCEPTANCES[lang].map(accept => [lang, offer, accept] as const)));
    it.each(matrix)('%s: «%s» ← «%s» is an acceptance', (_lang, offer, accept) => {
        expect(endsWithHumanOffer(offer)).toBe(true);
        expect(isOfferAcceptance(accept)).toBe(true);
        expect(isAffirmationOfHumanOffer(accept, offer)).toBe(true);
        expect(repliesYesToHumanOffer(accept, offer)).toBe(true);
    });

    const negatives = (Object.keys(MODEL_OFFERS) as Lang[]).flatMap(lang =>
        offersOf(lang).flatMap(offer => NON_ACCEPTANCES.map(text => [lang, offer, text] as const)));
    it.each(negatives)('%s: «%s» ← «%s» is NOT an acceptance', (_lang, offer, text) => {
        expect(isOfferAcceptance(text)).toBe(false);
        expect(isAffirmationOfHumanOffer(text, offer)).toBe(false);
    });

    it('a refusal, a condition or a question never even opens with a yes', () => {
        for (const text of ['no gracias', 'not now', 'sí, pero ¿cuánto cuesta?', '¿y el precio?', 'no, mejor después', 'Si me confirman el precio hoy entonces sí']) {
            expect(opensWithAffirmation(text)).toBe(false);
            expect(repliesYesToHumanOffer(text, HUMAN_OFFER_QUESTION.es)).toBe(false);
        }
    });

    it('a yes with new content and no echo of the offer is a yes, not an acceptance', () => {
        expect(opensWithAffirmation('sí, el lunes')).toBe(true);
        expect(isOfferAcceptance('sí, el lunes')).toBe(false);
    });

    it('request verbs are read by root, clitics folded, not enumerated', () => {
        for (const t of ['pidalo', 'pidanselo', 'comunicame', 'comuniqueme', 'consultemelo', 'confirmenoslo', 'preguntele', 'verifiquelo', 'check', 'asked', 'demandez', 'verifiez', 'pergunte', 'peca']) {
            expect(isRequestVerb(t)).toBe(true);
        }
        for (const t of ['calle', 'pedido', 'precio', 'lunes', 'garantia', 'equipo']) expect(isRequestVerb(t)).toBe(false);
    });

    it('a yes to anything that is not an offer of a person is not read against one', () => {
        expect(repliesYesToHumanOffer('Sí, por favor pídalo.', '¿Le agendo el sábado a las 4?')).toBe(false);
        expect(repliesYesToHumanOffer('sí', undefined)).toBe(false);
        // An offer followed by another question: the yes answers that one.
        expect(repliesYesToHumanOffer('sí', '¿Quiere que le pida a alguien del equipo que lo confirme? ¿O prefiere ver otro modelo?')).toBe(false);
    });
});

describe('F4300-25 the same offer is never made twice in a row', () => {
    const offer = MODEL_OFFERS.es[0];
    it.each([
        ['the offer again', '¿Quiere que le pida a alguien del equipo que lo confirme?'],
        ['the fixed offer', NO_DATA_WAIT_REPLACEMENT.es],
        ['a bare wait', 'Un momento, por favor.'],
        ['a bare wait (en)', 'One moment, please.'],
    ])('after a yes, %s opens the handoff', (_name, reply) => {
        for (const accept of [...PRODUCTION_ACCEPTANCES, 'Sim, por favor.', 'sí, el lunes']) {
            expect(repeatsAcceptedHumanOffer(reply, accept, offer)).toBe(true);
        }
    });

    it('a refusal, a question, a promise already honoured or a real answer does not', () => {
        expect(repeatsAcceptedHumanOffer('¿Quiere que le pida a alguien del equipo que lo confirme?', 'no gracias', offer)).toBe(false);
        expect(repeatsAcceptedHumanOffer('¿Quiere que le pida a alguien del equipo que lo confirme?', '¿y el precio?', offer)).toBe(false);
        expect(repeatsAcceptedHumanOffer('Le estoy transfiriendo con nuestro equipo.', 'sí', offer)).toBe(false);
        expect(repeatsAcceptedHumanOffer('La garantía es de 12 meses.', 'sí', offer)).toBe(false);
        expect(repeatsAcceptedHumanOffer('Un momento, por favor.', 'sí', '¿Le agendo el sábado a las 4?')).toBe(false);
    });

    it('the pipeline honours it through the handoff path, after the promise branches and before the team-request claim', () => {
        const src = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
        const authorized = src.slice(src.indexOf('const humanHandoffAuthorized ='), src.indexOf('if (safetyTriage?.reply) {', src.indexOf('const humanHandoffAuthorized =')));
        expect(authorized).toContain('repliesYesToHumanOffer(userText, lastOutboundText)');
        const at = src.indexOf('repeatsAcceptedHumanOffer(finalResponse, userText, lastOutboundText)');
        const honour = src.indexOf('} else if (!draftMode && !postToolHandoff && promisesHumanHandoff(finalResponse))');
        const team = src.indexOf('const teamAction = teamRequestClaimAction(');
        expect(at).toBeGreaterThan(honour);
        expect(team).toBeGreaterThan(at);
        const branch = src.slice(at, team);
        expect(branch).toContain("this.escalateWithinTurn(tenantId, conversation, msg, 'customer_accepted_human_offer'");
        expect(branch).toContain('finalResponse = handoffText(userLanguage).transferring');
        expect(branch).not.toContain('llmRouter');
        // The bare-wait guard reads the model's own offer too, not only the fixed sentence.
        expect(src).toContain('&& endsWithHumanOffer(lastAssistant.content);');
    });
});

describe('F4300-25 the acceptance escalates at turn start, before the model', () => {
    const harness = (lastOutbound: string) => {
        const service: any = Object.create(ConversationsService.prototype);
        service.logger = { warn: jest.fn() };
        service.prisma = { executeInTenantSchema: jest.fn(async (_s: string, sql: string) =>
            /direction = 'outbound'/.test(sql) ? [{ content_text: lastOutbound, created_at: new Date(Date.now() - 60_000) }] : []) };
        return service;
    };
    it.each(PRODUCTION_ACCEPTANCES)('«%s» after the model-worded offer', async text => {
        expect(await harness(MODEL_OFFERS.es[0]).resolveHumanOfferAcceptance('schema', { id: 'conv', metadata: {} }, text)).toBe(true);
    });
    it.each(['no gracias', 'sí, pero ¿cuánto cuesta?', 'no, mejor después'])('«%s» does not escalate', async text => {
        expect(await harness(MODEL_OFFERS.es[0]).resolveHumanOfferAcceptance('schema', { id: 'conv', metadata: {} }, text)).toBe(false);
    });
});

/**
 * F4300-25 residual (production QA 23-oct, after #191): the offer was worded as a FOLLOW-UP by the team — remind or tell
 * the customer once the team confirms, note the question for the team — and was not read as the offer of a person, so
 * the customer's «sí» reached the model, which offered the person again. The family is recognised (offer lead, follow-up
 * verb by root, the team as the one who answers) and its acceptances are honoured by the same path.
 */
const FOLLOW_UP_PRODUCTION = {
    store: {
        offer: 'No tengo la confirmación aún sobre si el Audífono QA Aurora es Bluetooth. ¿Quiere que le recuerde cuando el equipo confirme esa información?',
        accept: 'Sí, por favor pregúntele a alguien del equipo y me avisa por aquí',
    },
    restaurant: {
        offer: 'No puedo comunicarme directamente con la cocina, pero puedo anotar su consulta para que el equipo confirme la información sobre la opción sin gluten y le responda lo antes posible. ¿Quiere que lo haga?',
        accept: 'Sí, porfa, anótela y me avisa cuando la cocina me confirme si es seguro.',
    },
};
const FOLLOW_UP_OFFERS: Record<Lang, string[]> = {
    es: [
        FOLLOW_UP_PRODUCTION.store.offer, FOLLOW_UP_PRODUCTION.restaurant.offer,
        '¿Quiere que le avise cuando el equipo confirme el horario?',
        '¿Desea que anote su pregunta para que alguien del equipo le responda?',
        'Puedo dejar registrada su consulta con el equipo. ¿Desea que proceda?',
    ],
    en: [
        'Want me to let you know once the team confirms?',
        'Would you like me to note your question for the team so they can confirm it?',
        'I can pass your question on to the team. Would you like me to do that?',
    ],
    pt: [
        'Posso anotar sua pergunta para a equipe e avisar quando confirmarem?',
        'Quer que eu avise quando a equipe confirmar?',
        'Posso anotar sua pergunta para a equipe. Quer que eu faça isso?',
    ],
    fr: [
        "Voulez-vous que je note votre question pour l'équipe ?",
        "Souhaitez-vous que je vous prévienne quand l'équipe aura confirmé ?",
    ],
};
const NOT_A_PERSON_OFFER = [
    '¿Quiere que le agende una cita con nuestro equipo para el sábado?',
    '¿Quiere que anote su pedido para que el equipo lo prepare?',
    'Puedo anotar su pedido. ¿Quiere que lo haga?',
    '¿Le puedo ayudar con algo más?',
    '¿Quiere que le recuerde su cita un día antes?',
    'Can I help you with anything else?',
    'Would you like me to book an appointment with our team?',
    'Would you like me to let you know when the product is back in stock?',
    'Would you like me to place the order for you?',
    'Posso anotar o seu pedido para a equipe preparar?',
    "Voulez-vous que je note votre commande pour l'équipe ?",
    'No puedo avisar al equipo desde aquí. ¿Quiere que lo haga?',
    'La garantía es de 12 meses. ¿Quiere que lo haga?',
];

describe('F4300-25 an offer worded as a follow-up by the team is an offer of a person', () => {
    const offers = (Object.keys(FOLLOW_UP_OFFERS) as Lang[]).flatMap(lang => FOLLOW_UP_OFFERS[lang].map(offer => [lang, offer] as const));
    it.each(offers)('%s: «%s» offers a person and ends with that offer', (_lang, offer) => {
        expect(endsWithHumanOffer(offer)).toBe(true);
        expect(repliesYesToHumanOffer('yes please', offer)).toBe(true);
    });

    it.each(NOT_A_PERSON_OFFER)('«%s» is not an offer of a person', text => {
        expect(endsWithHumanOffer(text)).toBe(false);
        expect(isAffirmationOfHumanOffer('sí', text)).toBe(false);
    });

    it.each(Object.entries(FOLLOW_UP_PRODUCTION))('regression (%s): the yes is an acceptance of that offer', (_name, { offer, accept }) => {
        expect(isOfferAcceptance(accept)).toBe(true);
        expect(isAffirmationOfHumanOffer(accept, offer)).toBe(true);
        expect(repliesYesToHumanOffer(accept, offer)).toBe(true);
        // The model answered with the standard offer again: the turn opens the handoff instead.
        expect(repeatsAcceptedHumanOffer(NO_DATA_WAIT_REPLACEMENT.es, accept, offer)).toBe(true);
    });

    it.each(Object.entries(FOLLOW_UP_PRODUCTION))('regression (%s): the yes escalates at turn start, before the model', async (_name, { offer, accept }) => {
        const service: any = Object.create(ConversationsService.prototype);
        service.logger = { warn: jest.fn() };
        service.prisma = { executeInTenantSchema: jest.fn(async (_s: string, sql: string) =>
            /direction = 'outbound'/.test(sql) ? [{ content_text: offer, created_at: new Date(Date.now() - 60_000) }] : []) };
        expect(await service.resolveHumanOfferAcceptance('schema', { id: 'conv', metadata: {} }, accept)).toBe(true);
        expect(await service.resolveHumanOfferAcceptance('schema', { id: 'conv', metadata: {} }, 'no gracias')).toBe(false);
    });

    it('the follow-up verbs a customer echoes are request verbs, by root', () => {
        for (const t of ['anotela', 'anotelo', 'apuntelo', 'recuerdeme', 'lembre', 'remind', 'notez', 'rappelez']) expect(isRequestVerb(t)).toBe(true);
    });
});

describe('F4300-25 the transfer notice of an accepted offer is in the customer language', () => {
    const PT_ACCEPT = 'Sim, por favor pergunte ao corretor e me avise por aqui';
    const service = (recentInbound: string[]) => {
        const s: any = Object.create(ConversationsService.prototype);
        s.languageDetector = new LanguageDetectorService();
        // Newest first, as the query orders them.
        s.prisma = { executeInTenantSchema: jest.fn(async (_s: string, sql: string) =>
            /direction = 'inbound'/.test(sql) ? [...recentInbound].reverse().map(content_text => ({ content_text })) : []) };
        return s;
    };

    it('regression: «Sim, por favor pergunte ao corretor e me avise por aqui» in a Portuguese conversation gets the notice in Portuguese', async () => {
        const lang = await service(['o condomínio tem piscina?']).turnStartLanguage('schema', { id: 'conv', metadata: {} }, { language: 'es-CO' }, PT_ACCEPT, 'in-1');
        expect(lang).toBe('pt');
        expect(isOfferAcceptance(PT_ACCEPT)).toBe(true);
    });

    it('the stored conversation language holds when the message itself is not decisive', async () => {
        const lang = await service([]).turnStartLanguage('schema', { id: 'conv', metadata: { detectedLanguage: 'pt' } }, { language: 'es-CO' }, PT_ACCEPT, 'in-1');
        expect(lang).toBe('pt');
    });

    it.each([
        ['en', 'Yes, please check with the team.', ['Does the apartment have parking?']],
        ['fr', "Oui, demandez-leur s'il vous plaît", ["Bonjour, est-ce que l'appartement a un parking ?"]],
        ['es', 'Sí, por favor pídalo.', ['¿El audífono tiene garantía?']],
    ])('%s: «%s» keeps the customer language', async (expected, text, recent) => {
        const lang = await service(recent as string[]).turnStartLanguage('schema', { id: 'conv', metadata: {} }, { language: 'es-CO' }, text, 'in-1');
        expect(lang).toBe(expected);
    });

    it('the early handoff branch and the replay notices read the language through it', () => {
        const src = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
        const start = src.indexOf('if (handoffReason && !draftMode) {');
        const branch = src.slice(start, src.indexOf('originKey: `handoff-notice:${inboundMessageId}`', start));
        expect(branch).toContain('const handoffLanguage = await this.turnStartLanguage(schemaName, conversation, config, content?.text, inboundMessageId);');
        expect(src).not.toContain("this.languageDetector.detect(content?.text || '', config.language || 'es')");
    });
});

/**
 * Production QA 24-oct (dental tenant, pt, 3/3): «Deseja que eu peça para alguém da clínica confirmar para você?» →
 * «Sim, por favor.» did not hand off. The pt lead «Deseja» was not read as an offer lead, and the business named by its
 * KIND («alguém da clínica») was not read as the person offered, so the «sim» reached the model, which asked for full name
 * and phone as for a callback. The business and its staff areas and roles are read as a family, by root, in es/en/pt/fr.
 */
describe('the business named by its kind is the person offered', () => {
    const PRODUCTION_OFFER = 'O preço da consulta especializada não está confirmado no sistema. '
        + 'Deseja que eu peça para alguém da clínica confirmar para você?';

    it('production pair: «Sim, por favor.» accepts «…alguém da clínica confirmar…»', () => {
        expect(endsWithHumanOffer(PRODUCTION_OFFER)).toBe(true);
        expect(isAffirmationOfHumanOffer('Sim, por favor.', PRODUCTION_OFFER)).toBe(true);
        expect(repliesYesToHumanOffer('Sim, por favor.', PRODUCTION_OFFER)).toBe(true);
        // #191: offering the same person again after the «sim» is a repeated offer: the turn hands off instead.
        expect(repeatsAcceptedHumanOffer('Deseja que eu peça para alguém da clínica confirmar?', 'Sim, por favor.', PRODUCTION_OFFER)).toBe(true);
    });

    it.each([
        // pt
        'Deseja que eu peça para alguém da equipe confirmar para você?',
        'Deseja que eu peça para alguém da recepção confirmar?',
        'Quer que o corretor entre em contato com você?',
        'Deseja falar com o corretor?',
        // es
        '¿Quiere que le pida a alguien de la clínica que lo confirme?',
        '¿Desea que le consulte a alguien del restaurante?',
        '¿Quiere que lo consulte con la cocina?',
        '¿Desea que alguien del hotel le confirme la tarifa?',
        '¿Quiere que le pregunte a alguien de la agencia?',
        '¿Desea que le pida a alguien de la inmobiliaria que lo confirme?',
        '¿Desea que le comunique con recepción?',
        '¿Quiere que el asesor le confirme el precio?',
        '¿Desea hablar con el asesor?',
        '¿Quiere que le pida a un asesor que lo confirme?',
        // en
        'Would you like me to ask someone from the clinic to confirm it?',
        'Do you want me to check with the kitchen?',
        'Shall I ask the front desk?',
        'Would you like someone from reception to call you back?',
        // fr
        'Voulez-vous que je demande à quelqu’un de la clinique ?',
        'Voulez-vous que je demande à la réception ?',
        "Souhaitez-vous qu'un conseiller vous rappelle ?",
        'Souhaitez-vous parler à un conseiller ?',
    ])('«%s» offers a person', offer => {
        expect(endsWithHumanOffer(offer)).toBe(true);
        expect(repliesYesToHumanOffer('Sí, por favor', offer)).toBe(true);
    });

    it.each([
        '¿Quiere el kit del equipo de fútbol?',
        '¿Desea agendar con el especialista?',
        '¿Quiere agendar una consulta con el especialista?',
        '¿Quiere una cita con la doctora?',
        'Deseja agendar uma consulta com o dentista?',
        '¿Desea que le muestre fotos del hotel?',
        '¿Quiere ver el menú del restaurante?',
        '¿Le paso el menú del restaurante?',
        '¿Le paso la dirección de la clínica?',
        '¿Quiere que le pida el menú a la cocina?',
        '¿Desea reservar una mesa en el restaurante?',
        '¿Quiere que le consulte la disponibilidad del hotel?',
        '¿Quiere saber el horario de la recepción?',
        '¿Le puedo ayudar con algo más?',
        "Would you like the clinic's address?",
        'Would you like to book with our specialist?',
        'Voulez-vous voir la carte du restaurant ?',
    ])('«%s» offers no person', reply => {
        expect(endsWithHumanOffer(reply)).toBe(false);
        expect(repliesYesToHumanOffer('Sí, por favor', reply)).toBe(false);
    });

    it('a «yes» naming the role offered echoes the offer', () => {
        expect(isOfferAcceptance('Sí, con el asesor por favor')).toBe(true);
        expect(isOfferAcceptance('Sim, com o corretor')).toBe(true);
    });
});
