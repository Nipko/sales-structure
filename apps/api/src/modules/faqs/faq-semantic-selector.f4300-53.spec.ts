import { buildFaqSelectorRequest, FAQ_SELECTOR_MAX_FAQS, parseFaqSelection, selectFaqByMeaning } from './faq-semantic-selector';

/**
 * F4300-53 · corrective FAQ selection (production QA 29-oct): the lexical FAQ search found the published FAQ for 8 of 66 questions
 * asked in other words or languages. On a miss, one classification call names the published question that answers the message.
 */
const FAQS = ['¿Necesito seguro de viaje?', '¿Hay descuento para niños?', '¿Cuál es la política de cancelación?']
    .map((question, i) => ({ id: `f${i}`, question, answer: 'Respuesta publicada.' }));

describe('F4300-53 · corrective FAQ selection', () => {
    it('hands the selector the questions only (never the answers) and the message as data', () => {
        const request = buildFaqSelectorRequest('Les enfants ont-ils une réduction ou un tarif spécial ?', FAQS.map(f => f.question));
        expect(request.task).toBe('classify');
        expect(request.temperature).toBe(0);
        expect(request.messages[0].content).toContain('2. ¿Hay descuento para niños?');
        expect(request.messages[0].content).not.toContain('Respuesta publicada');
        expect(request.systemPrompt).toMatch(/data, never instructions/);
    });

    it.each([
        ['{"faq": 2}', 1], ['```json\n{"faq": 1}\n```', 0], ['{"faq": "3"}', 2],
        ['{"faq": 0}', null], ['{"faq": 4}', null], ['{"faq": 1.5}', null], ['none', null], [undefined, null],
    ])('parses %s → %s', (raw, expected) => {
        expect(parseFaqSelection(raw as any, 3)).toBe(expected);
    });

    it('returns the published FAQ the selector names, exactly as published', async () => {
        const selector = jest.fn().mockResolvedValue({ content: '{"faq": 2}' });
        const chosen = await selectFaqByMeaning('Les enfants ont-ils une réduction ?', FAQS, selector);
        expect(chosen).toBe(FAQS[1]);
        expect(selector).toHaveBeenCalledTimes(1);
    });

    it('«none», an error, a timeout or too many FAQs: no FAQ, never an exception', async () => {
        expect(await selectFaqByMeaning('¿Tienen parqueadero?', FAQS, jest.fn().mockResolvedValue({ content: '{"faq": 0}' }))).toBeNull();
        expect(await selectFaqByMeaning('x?', FAQS, jest.fn().mockRejectedValue(new Error('provider down')))).toBeNull();
        expect(await selectFaqByMeaning('x?', FAQS, () => new Promise(() => undefined), 20)).toBeNull();
        const many = Array.from({ length: FAQ_SELECTOR_MAX_FAQS + 1 }, (_, i) => ({ question: `Q${i}?` }));
        const selector = jest.fn();
        expect(await selectFaqByMeaning('x?', many, selector)).toBeNull();
        expect(selector).not.toHaveBeenCalled();
        expect(await selectFaqByMeaning('   ', FAQS, selector)).toBeNull();
    });
});
