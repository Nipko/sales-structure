import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConversationsService } from './conversations.service';
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
