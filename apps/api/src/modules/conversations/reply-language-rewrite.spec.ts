import { ConversationsService } from './conversations.service';
import { languageMismatch, replyLanguageOf, rewriteRejection, verbatimTermsOf } from './reply-language';

/**
 * Production 2026-10-22 (image 53654cac):
 * - Salon, turn 2 in Portuguese («e quanto tempo demora?»). The guard saw the Spanish reply and asked for one rewrite,
 *   which came back and was dropped without a word in the log: the most likely reason is that the translation turned
 *   the service «Corte y estilo» into «Corte e estilo», so the Spanish reply was delivered. The request now lists the
 *   strings to copy verbatim, a rejection says WHY, and a lost name / figure gets one more (last) attempt.
 * - Dental, turn 2 in French («et combien de temps dure la consultation générale ?»). The booking engine handled the
 *   turn and the model voiced its directive in Spanish; the guard skipped every directive turn, so it never looked.
 *   Only the server's own texts are exempt now.
 */
const SALON_ES = 'El servicio de Corte y estilo dura aproximadamente 45 minutos. ¿Le gustaría que le ayude a agendar una cita?';
const SALON_PT_LOST_NAME = 'O serviço Corte e estilo dura cerca de 45 minutos. Gostaria de agendar?';
const SALON_PT_OK = 'O serviço Corte y estilo dura cerca de 45 minutos. Gostaria que eu ajudasse a agendar uma visita?';
const SALON_CONTEXT = { availableServices: [{ name: 'Corte y estilo' }] };

const DENTAL_ES = 'La consulta general dura 30 minutos. ¿Le gustaría agendar una cita para una consulta general?';
const DENTAL_FR = 'La consulta general dure 30 minutes. Souhaitez-vous prendre rendez-vous pour une consulta general ?';
const DENTAL_CONTEXT = {
    availableServices: [{ name: 'Consulta general' }],
    directive: 'Service: Consulta general. Duration: 30 minutes. Offer to book it.',
};

const build = (...rewrites: string[]) => {
    const service: any = Object.create(ConversationsService.prototype);
    const execute = jest.fn();
    for (const rewrite of rewrites) execute.mockResolvedValueOnce({ content: rewrite });
    execute.mockResolvedValue({ content: '' });
    Object.assign(service, {
        logger: { warn: jest.fn(), log: jest.fn(), debug: jest.fn() }, eventEmitter: { emit: jest.fn() },
        responseValidator: { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) },
        recordAgentSignal: jest.fn(), llmRouter: { execute },
    });
    return { service, execute };
};
const run = (service: any, text: string, lang: string, trusted: any, customer: string) =>
    service.applyOutputGuardrails(text, 'sys', [{ role: 'user', content: customer }], [], 'tenant', 'conv', [], lang, [], trusted);
const lastContent = (execute: jest.Mock, call: number) => {
    const messages = (execute.mock.calls[call] as any[])[0].messages;
    return String(messages[messages.length - 1].content);
};
const rejections = (service: any) => (service.recordAgentSignal as jest.Mock).mock.calls
    .filter(call => call[1] === 'reply_language_rewrite_rejected').map(call => call[3]);

describe('rewriteRejection says why a rewrite cannot be sent', () => {
    it('the salon case: the Spanish reply is detected and the translated name is the reason', () => {
        expect(replyLanguageOf(SALON_ES, ['Corte y estilo'])).toBe('es');
        expect(rewriteRejection(SALON_ES, SALON_PT_LOST_NAME, ['Corte y estilo'], 'es')).toEqual({ reason: 'lost_name', missing: ['Corte y estilo'] });
        expect(rewriteRejection(SALON_ES, SALON_PT_OK, ['Corte y estilo'], 'es')).toBeNull();
    });

    it('names a still-Spanish rewrite, a lost figure and a lost URL; figures and URLs are compared exactly', () => {
        const original = 'El Corte y estilo cuesta $45.000 y puede reservarlo en https://salon.example.com/reservar cuando guste.';
        expect(rewriteRejection(original, 'El Corte y estilo tiene un precio de $45.000, puede reservarlo en https://salon.example.com/reservar cuando quiera.', ['Corte y estilo'], 'es')?.reason)
            .toBe('still_source_language');
        expect(rewriteRejection(original, 'O Corte y estilo custa $54.000 e pode reservá-lo em https://salon.example.com/reservar quando quiser.', ['Corte y estilo'], 'es'))
            .toEqual({ reason: 'lost_figure', missing: ['45.000'] });
        expect(rewriteRejection(original, 'O Corte y estilo custa $45.000 e pode reservá-lo no nosso site quando quiser.', ['Corte y estilo'], 'es'))
            .toEqual({ reason: 'lost_url', missing: ['https://salon.example.com/reservar'] });
        expect(rewriteRejection(original, '', ['Corte y estilo'], 'es')?.reason).toBe('lost_figure');
    });

    it('a name survives with another case, accents or spacing, never translated', () => {
        expect(rewriteRejection(DENTAL_ES, DENTAL_FR, ['Consulta general'], 'es')).toBeNull();
        expect(rewriteRejection(DENTAL_ES, 'La CONSULTA  GENERAL dure 30 minutes. Souhaitez-vous prendre rendez-vous pour une consulta general ?', ['Consulta general'], 'es')).toBeNull();
        expect(rewriteRejection(DENTAL_ES, 'La consultation générale dure 30 minutes. Souhaitez-vous prendre rendez-vous pour une consultation ?', ['Consulta general'], 'es'))
            .toEqual({ reason: 'lost_name', missing: ['consulta general'] });
    });

    it('verbatimTermsOf lists the names as the reply wrote them, the figures outside URLs, and the URLs', () => {
        expect(verbatimTermsOf('Vea el corte y estilo (45 min) en https://salon.example.com/p/45.', ['Corte y estilo', 'Color y tratamiento']))
            .toEqual({ names: ['corte y estilo'], figures: ['45'], urls: ['https://salon.example.com/p/45'] });
    });
});

describe('alignReplyLanguage: the rewrite is told what to keep and gets one more try for a lost name or figure', () => {
    it('salon pt: first rewrite translates the service name → rejected (lost_name); second keeps it → sent', async () => {
        const { service, execute } = build(SALON_PT_LOST_NAME, SALON_PT_OK);
        const reply = await run(service, SALON_ES, 'pt', SALON_CONTEXT, 'e quanto tempo demora?');
        expect(reply).toBe(SALON_PT_OK);
        expect(execute).toHaveBeenCalledTimes(2);
        // The first request already lists the exact strings to copy, in the requested language.
        expect(lastContent(execute, 0)).toMatch(/^Sua resposta anterior não está em português/);
        expect(lastContent(execute, 0)).toContain('Copie estes textos exatamente');
        expect(lastContent(execute, 0)).toContain('\n- Corte y estilo');
        expect(lastContent(execute, 0)).toContain('\n- 45');
        // The retry names what was lost and sees its own rejected attempt.
        expect(lastContent(execute, 1)).toMatch(/^Sua reescrita mudou ou removeu: Corte y estilo\./);
        const retryMessages = (execute.mock.calls[1] as any[])[0].messages;
        expect(retryMessages[retryMessages.length - 2]).toEqual({ role: 'assistant', content: SALON_PT_LOST_NAME });
        expect(rejections(service)).toEqual([{ reason: 'lost_name', attempt: 1, missing: ['Corte y estilo'] }]);
        expect(service.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Language rewrite 1 rejected (lost_name: Corte y estilo)'));
    });

    it('a rewrite that stays Spanish is rejected (still_source_language) with no second call', async () => {
        const stillSpanish = 'El servicio de Corte y estilo tiene una duración de unos 45 minutos. ¿Le gustaría agendar una cita?';
        const { service, execute } = build(stillSpanish, SALON_PT_OK);
        expect(await run(service, SALON_ES, 'pt', SALON_CONTEXT, 'e quanto tempo demora?')).toBe(SALON_ES);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(rejections(service)).toEqual([{ reason: 'still_source_language', attempt: 1, missing: [] }]);
    });

    it('a lost URL is never sent and not retried; a figure lost twice keeps the original after two calls', async () => {
        const original = 'Puede ver todos nuestros servicios y sus precios en https://salon.example.com/servicios cuando guste, con mucho gusto.';
        const noUrl = build('Você pode ver todos os nossos serviços e preços no nosso site quando quiser, com muito prazer.');
        // the link is the business's own (F4300-34: a link the business data does not hold is not sent)
        expect(await run(noUrl.service, original, 'pt', { ...SALON_CONTEXT, retrievedKnowledge: ['Precios: https://salon.example.com/servicios'] }, 'onde vejo os preços?')).toBe(original);
        expect(noUrl.execute).toHaveBeenCalledTimes(1);
        expect(rejections(noUrl.service)[0].reason).toBe('lost_url');

        const lostFigure = 'O serviço Corte y estilo dura cerca de 54 minutos. Gostaria que eu ajudasse a agendar uma visita?';
        const twice = build(lostFigure, lostFigure, SALON_PT_OK);
        expect(await run(twice.service, SALON_ES, 'pt', SALON_CONTEXT, 'e quanto tempo demora?')).toBe(SALON_ES);
        expect(twice.execute).toHaveBeenCalledTimes(2);
        expect(rejections(twice.service).map(r => r.reason)).toEqual(['lost_figure', 'lost_figure']);
    });

    it('records the rejection reason in the agent-test trace when a session runs the turn', async () => {
        const { service } = build(SALON_PT_LOST_NAME, SALON_PT_LOST_NAME);
        service.recordAgentSignal = (ConversationsService.prototype as any).recordAgentSignal;
        const session: any = { trace: { steps: [] } };
        const router = { execute: service.llmRouter.execute };
        const reply = await service.applyOutputGuardrails(SALON_ES, 'sys', [{ role: 'user', content: 'e quanto tempo demora?' }], [], 'tenant', 'conv', [], 'pt', [], SALON_CONTEXT, session, router);
        expect(reply).toBe(SALON_ES);
        expect(session.trace.steps).toEqual(expect.arrayContaining([
            { signal: 'reply_language_mismatch' },
            { signal: 'reply_language_rewrite_rejected', reason: 'lost_name', attempt: 1, missing: ['Corte y estilo'] },
            { signal: 'reply_language_rewrite_rejected', reason: 'lost_name', attempt: 2, missing: ['Corte y estilo'] },
        ]));
    });
});

describe('es→pt / es→fr: a short Spanish reply whose catalog name takes most of its words', () => {
    // Live matrix after PR160: only switches FROM Spanish INTO pt/fr failed, all on short replies naming a Spanish service.
    const cases = [
        { to: 'pt', name: 'Corte y estilo', reply: 'Corte y estilo dura 45 minutos, ¿se lo agendo hoy?',
            rewrite: 'Corte y estilo leva 45 minutos, quer que eu agende hoje?', customer: 'e quanto tempo demora?' },
        { to: 'fr', name: 'Limpieza dental profunda', reply: 'Limpieza dental profunda: dura 60 minutos y cuesta $120.000, ¿le reservo?',
            rewrite: 'Limpieza dental profunda : elle dure 60 minutes et coûte $120.000, je vous la réserve ?', customer: 'et combien de temps dure-t-elle ?' },
    ];

    it.each(cases)('es→$to: no word of the turn language and two of Spanish is a mismatch, not "undecided"', ({ to, name, reply }) => {
        expect(replyLanguageOf(reply, [name])).toBeNull();
        expect(languageMismatch(reply, to, [name])).toBe('es');
        // The same reply on a Spanish turn is, of course, fine.
        expect(languageMismatch(reply, 'es', [name])).toBeNull();
    });

    it.each(cases)('es→$to: the reply is rewritten, keeping the service name verbatim', async ({ to, name, reply, rewrite, customer }) => {
        const { service, execute } = build(rewrite);
        expect(await run(service, reply, to, { availableServices: [{ name }] }, customer)).toBe(rewrite);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(lastContent(execute, 0)).toContain(`\n- ${name}`);
    });

    it.each(cases)('es→$to: a rewrite that translates the service name gets one more try, then the original stays', async ({ to, name, reply, customer }) => {
        const translated = to === 'pt'
            ? 'Corte e estilo leva 45 minutos, quer que eu agende hoje?'
            : 'Le détartrage profond : il dure 60 minutes et coûte $120.000, je vous le réserve ?';
        const { service, execute } = build(translated, translated);
        expect(await run(service, reply, to, { availableServices: [{ name }] }, customer)).toBe(reply);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(rejections(service).map(r => r.reason)).toEqual(['lost_name', 'lost_name']);
    });
});

describe('a reply that switches language mid-way is judged sentence by sentence', () => {
    // Production 2026-10-22, dental, Portuguese from the first message.
    const MIXED = 'Sinto muito que esteja passando por isso. Inchaço no rosto e febre após a extração de um dente podem indicar uma infección o complicación que requiere atención médica. Le recomiendo que busque atención urgente en la clínica o un servicio de urgencias odontológicas para que un especialista pueda evaluar su situación y brindarle el tratamiento adecuado. ¿Quiere que le ayude a agendar una cita lo antes posible?';
    const PORTUGUESE = 'Sinto muito que esteja passando por isso. Inchaço no rosto e febre após a extração de um dente podem indicar uma infecção ou complicação que requer atenção médica. Recomendo que procure atendimento urgente na clínica ou num serviço de urgências odontológicas para que um especialista possa avaliar a sua situação. Quer que eu ajude a agendar uma consulta o quanto antes?';

    it('the whole text is not clearly Spanish, but one of its sentences is', () => {
        expect(replyLanguageOf(MIXED)).toBeNull();
        expect(languageMismatch(MIXED, 'pt')).toBe('es');
        expect(languageMismatch(PORTUGUESE, 'pt')).toBeNull();
    });

    it('the mixed reply is rewritten; a rewrite still carrying a Spanish sentence is rejected', async () => {
        const ok = build(PORTUGUESE);
        expect(await run(ok.service, MIXED, 'pt', {}, 'estou com o rosto inchado e febre depois de tirar um dente, o que faço?')).toBe(PORTUGUESE);
        expect(ok.execute).toHaveBeenCalledTimes(1);

        // Only the opening translated: the Spanish advice sentence is kept as it was.
        const halfway = 'Sinto muito que esteja passando por isso. Inchaço no rosto e febre após a extração de um dente podem indicar uma infecção. Le recomiendo que busque atención urgente en la clínica o un servicio de urgencias odontológicas para que un especialista pueda evaluar su situación y brindarle el tratamiento adecuado.';
        const still = build(halfway);
        expect(await run(still.service, MIXED, 'pt', {}, 'o que faço?')).toBe(MIXED);
        expect(rejections(still.service)).toEqual([{ reason: 'still_source_language', attempt: 1, missing: [] }]);
    });
});

describe('the reply-language guard runs on model-written replies of engine-directive turns', () => {
    it('dental fr: a booking directive voiced in Spanish is rewritten into French', async () => {
        const { service, execute } = build(DENTAL_FR);
        const reply = await run(service, DENTAL_ES, 'fr', DENTAL_CONTEXT, 'et combien de temps dure la consultation générale ?');
        expect(reply).toBe(DENTAL_FR);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(lastContent(execute, 0)).toMatch(/^Votre réponse précédente n'est pas en français/);
        expect(lastContent(execute, 0)).toContain('\n- consulta general');
        expect(service.recordAgentSignal).toHaveBeenCalledWith('tenant', 'reply_language_mismatch', undefined);
    });

    it('the engine\'s own reply text sent as is and the fixed system texts are still left alone', async () => {
        const { service, execute } = build(DENTAL_FR);
        expect(await run(service, DENTAL_ES, 'fr', { ...DENTAL_CONTEXT, engineReplyText: DENTAL_ES }, 'et combien ?')).toBe(DENTAL_ES);
        expect(execute).not.toHaveBeenCalled();
    });
});
