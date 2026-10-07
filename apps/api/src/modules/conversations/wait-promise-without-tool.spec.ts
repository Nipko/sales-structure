import { ConversationsService } from './conversations.service';
import { isBareWaitPromise, promisesHumanHandoff } from '../../common/utils/outcome-claim.util';
import { PromptAssemblerService } from './prompt-assembler.service';
import { servicePriceNote } from '../appointments/service-price-status';

/**
 * QA Telegram campaign 2026-10-05: the model answered "déjame verificar…" and
 * the turn ended. There is no second phase, so the promise could never be kept.
 */
describe('isBareWaitPromise', () => {
    it.each([
        'Déjame verificar eso.',
        'Permítame consultar, un momento por favor.',
        'Un momento.',
        'Let me check that for you.',
        "I'll verify and be right back.",
        'Um momento, vou verificar.',
        'Laissez-moi vérifier, un instant.',
        'Je vais vérifier.',
    ])('is a bare wait promise: %s', text => {
        expect(isBareWaitPromise(text)).toBe(true);
    });

    it.each([
        'Abrimos de lunes a viernes de 9 a 18. Un momento, ¿para qué día?',
        'Déjame verificar: el corte cuesta 40000.',
        'Hola, ¿en qué puedo ayudarte?',
        '',
        'Listo, ya te confirmo: tu cita quedó para el martes.',
        'Claro, enseguida te ayudo',
        'Perfecto, ya le aviso al equipo y te contactan.',
        'Listo, un momento y te comparto el menú.',
        'Let me explain how our packages work. We have three tiers: basic, plus and premium, each one including different services for different group sizes.',
    ])('has content or no wait phrase, so it is left alone: %s', text => {
        expect(isBareWaitPromise(text)).toBe(false);
    });
});

describe('applyOutputGuardrails: wait promise without a tool', () => {
    const build = () => {
        const service: any = Object.create(ConversationsService.prototype);
        Object.assign(service, {
            logger: { warn: jest.fn() },
            eventEmitter: { emit: jest.fn() },
            responseValidator: { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) },
            recordAgentSignal: jest.fn(),
            llmRouter: { execute: jest.fn() },
        });
        return service;
    };
    const run = (service: any, text: string, tools: any[], lang = 'es') =>
        service.applyOutputGuardrails(text, 'sys', [], [], 'tenant', 'conv', tools, lang, [], {});

    it.each([
        ['es', 'Déjame verificar eso, un momento.', /no tengo ese dato confirmado/i],
        ['en', 'Let me check that for you.', /don’t have that information confirmed/i],
        ['pt', 'Um momento, vou verificar.', /não tenho essa informação confirmada/i],
        ['fr', 'Laissez-moi vérifier, un instant.', /pas cette information confirmée/i],
    ])('replaces it with an honest %s text, with no extra model call', async (lang, text, expected) => {
        const service = build();
        const reply = await run(service, text, [], lang);
        expect(reply).toMatch(expected);
        expect(reply).not.toMatch(/verific|verify|check|un momento|um momento|un instant|vérifier/i);
        expect(service.llmRouter.execute).not.toHaveBeenCalled();
        expect(service.recordAgentSignal).toHaveBeenCalledWith('tenant', 'wait_promise_without_tool', undefined);
    });

    it('leaves a wait phrase alone when a tool ran in the same turn', async () => {
        const service = build();
        const reply = await run(service, 'Un momento.', [{ name: 'check_availability', result: { ok: true } }]);
        expect(reply).toBe('Un momento.');
    });

    const UNVERIFIED = 'Ainda não posso considerar isso concluído: não tenho confirmação de que foi finalizado. Vou verificar e já te confirmo.';
    it('leaves fixed system texts, handoff promises and engine directives alone', async () => {
        const service = build();
        expect(await run(service, UNVERIFIED, [], 'pt')).toBe(UNVERIFIED);
        const handoff = 'Le paso con nuestro equipo especializado, espere un momento.';
        expect(await run(service, handoff, [])).toBe(handoff);
        const wait = 'Un momento.';
        expect(await service.applyOutputGuardrails(wait, 'sys', [], [], 'tenant', 'conv', [], 'es', [], { directive: 'Te voy a transferir' })).toBe(wait);
    });

    it('an offer sent with the wording the platform used before «usted» is still our offer (no loop, the «sí» still escalates)', async () => {
        const service = build();
        const legacy = 'No tengo ese dato confirmado en este momento. ¿Quieres que le pida a una persona del equipo que lo confirme?';
        const history = [{ role: 'assistant', content: legacy }, { role: 'user', content: 'sí' }];
        const reply = await service.applyOutputGuardrails('Un momento.', 'sys', history, [], 'tenant', 'conv', [], 'es', [], {});
        expect(reply.startsWith('Le voy')).toBe(true);
        expect(promisesHumanHandoff(reply)).toBe(true);
    });

    it('does not loop the offer: after our offer, a bare wait becomes an honest transfer that escalates', async () => {
        const service = build();
        const offer = 'No tengo ese dato confirmado en este momento. ¿Quiere que le pida a una persona del equipo que lo confirme?';
        for (const [lang, expectedStart] of [['es', 'Le voy'], ['en', 'I'], ['pt', 'Vou'], ['fr', 'Je vais']] as const) {
            const history = [{ role: 'assistant', content: offer }, { role: 'user', content: 'sí' }];
            const reply = await service.applyOutputGuardrails('Un momento.', 'sys', history, [], 'tenant', 'conv', [], lang, [], {});
            expect(reply.startsWith(expectedStart)).toBe(true);
            expect(promisesHumanHandoff(reply)).toBe(true);
        }
    });

    it('leaves a real answer alone', async () => {
        const service = build();
        const text = 'Atendemos de lunes a viernes, de 9:00 a 18:00.';
        expect(await run(service, text, [])).toBe(text);
    });
});

describe('contract and price instruction: no promise without delivery', () => {
    const contract: string = (new PromptAssemblerService({} as any) as any).buildContractLayer();

    it('injects the no-waiting-phrases rule and the human-confirmation fallback', () => {
        expect(contract).toContain('NO WAITING PHRASES WITHOUT A TOOL CALL');
        expect(contract).toContain('déjame verificar');
        expect(contract).toContain('offer to have a person from the team confirm it');
    });

    it('explains what <fallback_message> is for', () => {
        expect(contract).toContain('FALLBACK MESSAGE');
        expect(contract).toContain('ONLY when you cannot help');
    });

    it('an unconfirmed price is not confirmed and a person is offered, not "te lo confirman"', () => {
        const note = servicePriceNote('example')!;
        expect(note).toContain('el precio no está confirmado');
        expect(note).toContain('ofrece que una persona');
        expect(note).not.toContain('te lo confirman');
    });
});
