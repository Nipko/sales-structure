import { ConversationsService } from './conversations.service';
import { LanguageDetectorService } from './language-detector.service';

/**
 * Production 2026-10-07: the store tenant answered «Qual é a política de reembolso?» in Spanish although the turn
 * language was Portuguese (the prompt said so; a long Spanish history and Spanish policy text pulled the model).
 * The turn language is decided by the detector, so the reply is checked against it: a clearly different
 * language gets ONE rewrite in the customer's language, and a reply that was already right is never touched.
 */
describe('applyOutputGuardrails: the reply is in the turn language', () => {
    const SPANISH = 'Nuestra política de reembolso permite devolver el producto dentro de los treinta días siguientes a la compra, con el empaque original y la factura.';
    const OTHER_SPANISH = 'Puede devolver el producto durante los treinta días siguientes, siempre con el empaque original y la factura de compra.';
    const PORTUGUESE = 'Nossa política de reembolso permite devolver o produto em até trinta dias após a compra, com a embalagem original e a nota fiscal.';

    const build = (rewrite: string | null) => {
        const service: any = Object.create(ConversationsService.prototype);
        const execute = jest.fn(async () => ({ content: rewrite ?? '' }));
        Object.assign(service, {
            logger: { warn: jest.fn() }, eventEmitter: { emit: jest.fn() },
            languageDetector: new LanguageDetectorService(),
            responseValidator: { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) },
            recordAgentSignal: jest.fn(), llmRouter: { execute },
        });
        return { service, execute };
    };
    const run = (service: any, text: string, lang: string, trusted: any = {}) =>
        service.applyOutputGuardrails(text, 'sys', [{ role: 'user', content: 'Qual é a política de reembolso?' }], [], 'tenant', 'conv', [], lang, [], trusted);

    it('rewrites a Spanish reply to a Portuguese turn, once, with an instruction in Portuguese', async () => {
        const { service, execute } = build(PORTUGUESE);
        const reply = await run(service, SPANISH, 'pt');
        expect(reply).toBe(PORTUGUESE);
        expect(execute).toHaveBeenCalledTimes(1);
        const request = (execute.mock.calls[0] as any[])[0];
        expect(request.messages[request.messages.length - 1].content).toMatch(/portugu/i);
        expect(service.recordAgentSignal).toHaveBeenCalledWith('tenant', 'reply_language_mismatch', undefined);
    });

    it('keeps the original when the rewrite is still in the wrong language or the model fails', async () => {
        expect(await run(build(OTHER_SPANISH).service, SPANISH, 'pt')).toBe(SPANISH);
        expect(await run(build('').service, SPANISH, 'pt')).toBe(SPANISH);
        const failing = build(null);
        failing.execute.mockRejectedValue(new Error('down'));
        expect(await run(failing.service, SPANISH, 'pt')).toBe(SPANISH);
    });

    it('does not call the model when the reply is already in the turn language', async () => {
        const right = build(null);
        expect(await run(right.service, PORTUGUESE, 'pt')).toBe(PORTUGUESE);
        expect(await run(right.service, SPANISH, 'es')).toBe(SPANISH);
        expect(right.execute).not.toHaveBeenCalled();
    });

    it('leaves short replies, engine directives and mixed-language names alone', async () => {
        const { service, execute } = build(PORTUGUESE);
        expect(await run(service, 'Con gusto, ¿algo más?', 'pt')).toBe('Con gusto, ¿algo más?');
        expect(await run(service, SPANISH, 'pt', { directive: 'Te voy a transferir' })).toBe(SPANISH);
        // A few Spanish words in a Portuguese-turn reply are not clear evidence either.
        expect(await run(service, 'Claro, reembolso sera rapido, dias habiles despues de aprobado', 'pt')).toContain('reembolso');
        // One Spanish marker word ("cuesta") in an English reply is not evidence of another language.
        expect(await run(service, 'The Aurora headset cuesta 129.900 COP and it is available in the store today.', 'en')).toContain('Aurora');
        expect(execute).not.toHaveBeenCalled();
    });
});
