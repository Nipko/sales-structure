import { ConversationsService } from './conversations.service';
import { isBareWaitPromise } from '../../common/utils/outcome-claim.util';

/**
 * Telegram campaign 2026-10-07: «¿Dónde están ubicados?» and «¿Qué incluye color y tratamiento?» were answered
 * with the persona template's fallback «Déjame verificar eso. ¿Puedo ayudarte con algo más?». The closing
 * question made the reply look like it advanced the turn, so the guardrail for "wait promise without a tool"
 * (nothing can ever send the promised follow-up) let it through.
 */
describe('a wait promise followed by a courtesy "anything else?" is still a bare wait promise', () => {
    it.each([
        'Déjame verificar eso. ¿Puedo ayudarte con algo más?',
        'Déjame verificar eso. ¿Hay algo más en lo que pueda ayudarte?',
        'Let me check that. Can I help you with anything else?',
        'Deixe-me verificar. Posso ajudar com mais alguma coisa?',
        'Laissez-moi vérifier. Puis-je vous aider avec autre chose ?',
    ])('%s', text => {
        expect(isBareWaitPromise(text)).toBe(true);
    });

    it.each([
        'Déjame verificar: ¿para qué día lo necesita?',
        'Atendemos de lunes a viernes. ¿Puedo ayudarte con algo más?',
        'Un momento, ¿me confirma su nombre?',
        '¿Puedo ayudarte con algo más?',
    ])('a real question or real content keeps the reply: %s', text => {
        expect(isBareWaitPromise(text)).toBe(false);
    });

    it('the output guardrail replaces it with the honest "not confirmed" text and offers a person', async () => {
        const service: any = Object.create(ConversationsService.prototype);
        Object.assign(service, {
            logger: { warn: jest.fn() }, eventEmitter: { emit: jest.fn() },
            responseValidator: { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) },
            recordAgentSignal: jest.fn(), llmRouter: { execute: jest.fn() },
        });
        const reply = await service.applyOutputGuardrails(
            'Déjame verificar eso. ¿Puedo ayudarte con algo más?', 'sys', [], [], 'tenant', 'conv', [], 'es', [], {});
        expect(reply).toMatch(/no tengo ese dato confirmado/i);
        expect(reply).not.toMatch(/verificar/i);
        expect(service.llmRouter.execute).not.toHaveBeenCalled();
    });
});
