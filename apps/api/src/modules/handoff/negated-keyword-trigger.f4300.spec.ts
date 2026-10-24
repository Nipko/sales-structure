import { HandoffService } from './handoff.service';
import { complaintIsOfferOnly } from './handoff-policy-question';
import {
    customTriggerFires, isDeniedTriggerMention, outboundAskedAbout, triggerDecisionNeedsPreviousOutbound,
} from './custom-trigger-negation';
import { ConversationsService } from '../conversations/conversations.service';

/**
 * F4300-30, production QA 24-oct (restaurant tenant). Inside the order flow the agent asked «Antes de confirmar,
 * ¿podría indicarme la dirección de entrega…? También, ¿quiere confirmar que no tiene alergias alimentarias?».
 * The customer answered «No tengo alergias, solo que esté bien cocido.» and the turn went to a person as
 * `handoff:custom_trigger:alergia`. Earlier «el plato Spark tiene huevo? soy alérgico» went to a person as
 * `custom_trigger:alergico`, which is right: an allergy affirmed. A business keyword fires on an affirmed
 * mention, never on one the customer only denies.
 */
const AGENT_QUESTION = 'Antes de confirmar, ¿podría indicarme la dirección de entrega para su pedido? También, ¿quiere confirmar que no tiene alergias alimentarias?';
const PRODUCTION_REPLY = 'No tengo alergias, solo que esté bien cocido.';
const RESTAURANT_TRIGGERS = ['alergia', 'alergico', 'queja alimentaria'];

const service = Object.create(HandoffService.prototype) as HandoffService;
const decide = (message: string, triggers: string[], previousOutbound?: string) => service.shouldHandoff(
    message, { metadata: {} }, { behavior: { handoffTriggers: triggers } } as any, 'CO', previousOutbound ? { previousOutbound } : undefined,
);

describe('F4300-30 production regression', () => {
    it('the answer to the agent\'s own allergy question does not hand off', () => {
        expect(decide(PRODUCTION_REPLY, RESTAURANT_TRIGGERS)).toBeNull();
        expect(decide(PRODUCTION_REPLY, RESTAURANT_TRIGGERS, AGENT_QUESTION)).toBeNull();
    });

    it('an allergy affirmed in a product question still hands off', () => {
        expect(decide('el plato Spark tiene huevo? soy alérgico', RESTAURANT_TRIGGERS)).toBe('custom_trigger:alergico');
    });
});

describe('a denied keyword does not fire (es / en / pt / fr)', () => {
    it.each([
        ['no tengo alergias', 'alergia'],
        ['sin alergias, gracias', 'alergia'],
        ['ninguna alergia', 'alergia'],
        ['no soy alérgico', 'alérgico'],
        ['nada de alergias', 'alergia'],
        ['No tengo ningún tipo de alergia', 'alergia'],
        ['alergias no, solo sin cebolla', 'alergia'],
        ['no allergies', 'allergies'],
        ["I'm not allergic", 'allergic'],
        ["I don't have any allergies", 'allergies'],
        ['sem alergias', 'alergia'],
        ['não tenho alergia', 'alergia'],
        ['não sou alérgico', 'alérgico'],
        ["pas d'allergie", 'allergie'],
        ['je ne suis pas allergique', 'allergique'],
        ['aucune allergie', 'allergie'],
        ["je n'ai aucune allergie", 'allergie'],
    ])('«%s» (%s)', (message, trigger) => {
        expect(isDeniedTriggerMention(message, trigger)).toBe(true);
        expect(customTriggerFires(message, trigger)).toBe(false);
        expect(decide(message, [trigger])).toBeNull();
    });
});

describe('an affirmed keyword still fires', () => {
    it.each([
        ['soy alérgico', 'alérgico'],
        ['tengo alergia al maní', 'alergia'],
        ['my kid has a nut allergy', 'allergy'],
        ['sou alérgica a camarão', 'alérgica'],
        ["j'ai une allergie", 'allergie'],
        // A denial followed by a contrast or exception that affirms an allergy again.
        ['no tengo alergia al gluten pero sí al maní', 'alergia'],
        ['no tengo alergias excepto a los mariscos', 'alergia'],
        ['no allergies except peanuts', 'allergies'],
        ['não tenho alergia a glúten, mas sim a camarão', 'alergia'],
        ["pas d'allergie au gluten, mais aux arachides oui", 'allergie'],
        // A negator that denies something else.
        ['no sé si soy alérgico al maní', 'alérgico'],
        ['no puedo comer maní porque soy alérgico', 'alérgico'],
        ['No, soy alérgico al maní', 'alérgico'],
    ])('«%s» (%s)', (message, trigger) => {
        expect(customTriggerFires(message, trigger)).toBe(true);
        expect(decide(message, [trigger])).toBe(`custom_trigger:${trigger}`);
    });

    it('the bare «no» rule never silences an affirmed allergy after the agent asked about it', () => {
        expect(decide('No, soy alérgico al maní', ['alérgico'], '¿Tiene alguna alergia?')).toBe('custom_trigger:alérgico');
        expect(decide('No... bueno, tengo alergia al maní', ['alergia'], '¿Tiene alguna alergia?')).toBe('custom_trigger:alergia');
    });

    it('a multi-word keyword after a negated clause still fires', () => {
        // («queja» alone is already a built-in complaint word, so only the keyword rule is asserted here.)
        expect(customTriggerFires('no me llegó el plato, quiero poner una queja alimentaria', 'queja alimentaria')).toBe(true);
        expect(customTriggerFires('no es una queja alimentaria, solo una pregunta', 'queja alimentaria')).toBe(false);
    });

    it('«al menos» is not an exception', () => {
        expect(customTriggerFires('no tengo alergias, al menos que yo sepa', 'alergia')).toBe(false);
    });

    it('refund / return keywords keep their own policy rules: «no hay reembolso» is still a grievance', () => {
        expect(decide('¿Por qué no hay reembolso todavía?', ['reembolso'])).toBe('complaint');
    });
});

describe('a bare «no» answering the agent\'s own question about the topic', () => {
    const asked = '¿Tiene alguna alergia alimentaria que debamos saber?';

    it('the agent asked about the topic', () => {
        expect(outboundAskedAbout(asked, 'alergia')).toBe(true);
        expect(outboundAskedAbout('¿A qué dirección se lo enviamos?', 'alergia')).toBe(false);
        expect(outboundAskedAbout('Tomamos nota de las alergias.', 'alergia')).toBe(false);
    });

    it.each([
        'No, de alergias estoy bien',
        'No. Alergias, ninguna.',
        'Non, allergie : rien à signaler',
    ])('«%s» does not fire after the question, and is only decided with it', message => {
        const trigger = /allergie/.test(message) ? 'allergie' : 'alergia';
        const question = trigger === 'allergie' ? 'Avez-vous une allergie alimentaire ?' : asked;
        expect(triggerDecisionNeedsPreviousOutbound(message, [trigger])).toBe(true);
        expect(decide(message, [trigger], question)).toBeNull();
        // Without the agent's question the bare mention is not known to be an answer, so it still fires.
        expect(decide(message, [trigger])).toBe(`custom_trigger:${trigger}`);
        expect(decide(message, [trigger], '¿A qué dirección se lo enviamos?')).toBe(`custom_trigger:${trigger}`);
    });

    it('«no» / «no, ninguna» carry no keyword and never fire', () => {
        for (const m of ['no', 'No, ninguna', 'Não, nenhuma', 'Non, aucune', 'No, none']) {
            expect(decide(m, RESTAURANT_TRIGGERS, asked)).toBeNull();
            expect(triggerDecisionNeedsPreviousOutbound(m, RESTAURANT_TRIGGERS)).toBe(false);
        }
    });

    it('a message already decided needs no previous message', () => {
        expect(triggerDecisionNeedsPreviousOutbound(PRODUCTION_REPLY, RESTAURANT_TRIGGERS)).toBe(false);
        expect(triggerDecisionNeedsPreviousOutbound('soy alérgico', RESTAURANT_TRIGGERS)).toBe(false);
    });
});

describe('every reader of the keywords applies the same rule', () => {
    it('a product complaint with a denied keyword stays offer-only; an affirmed one does not', () => {
        expect(complaintIsOfferOnly('complaint', 'la camiseta llegó rota, sin factura', ['factura'], { industry: 'retail' })).toBe(true);
        expect(complaintIsOfferOnly('complaint', 'la camiseta llegó rota y necesito la factura', ['factura'], { industry: 'retail' })).toBe(false);
    });

    it('the turn reads the previous outbound only when the decision depends on it, and hands it to the handoff service', async () => {
        const conversations = Object.create(ConversationsService.prototype) as any;
        const executeInTenantSchema = jest.fn().mockResolvedValue([{ content_text: '¿Tiene alguna alergia alimentaria?' }]);
        conversations.prisma = { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_x'), executeInTenantSchema };
        conversations.logger = { warn: jest.fn() };
        conversations.handoffService = service;
        const config = { behavior: { handoffTriggers: ['alergia'] } };
        const conversation = { id: '22222222-2222-4222-8222-222222222222', metadata: {} };

        await expect(conversations.rawHandoffReason('No, de alergias estoy bien', conversation, config, 't', false)).resolves.toBeNull();
        expect(executeInTenantSchema).toHaveBeenCalledTimes(1);
        expect(executeInTenantSchema.mock.calls[0][1]).toContain("direction = 'outbound'");

        await expect(conversations.rawHandoffReason(PRODUCTION_REPLY, conversation, config, 't', false)).resolves.toBeNull();
        await expect(conversations.rawHandoffReason('soy alérgico, ¿el plato tiene huevo?', conversation, { behavior: { handoffTriggers: ['alérgico'] } }, 't', false))
            .resolves.toBe('custom_trigger:alérgico');
        expect(executeInTenantSchema).toHaveBeenCalledTimes(1);
    });

    it('a failed read keeps the plain keyword rule', async () => {
        const conversations = Object.create(ConversationsService.prototype) as any;
        conversations.prisma = { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_x'), executeInTenantSchema: jest.fn().mockRejectedValue(new Error('down')) };
        conversations.logger = { warn: jest.fn() };
        conversations.handoffService = service;
        await expect(conversations.rawHandoffReason('No, de alergias estoy bien', { id: 'c', metadata: {} }, { behavior: { handoffTriggers: ['alergia'] } }, 't', false))
            .resolves.toBe('custom_trigger:alergia');
    });
});
