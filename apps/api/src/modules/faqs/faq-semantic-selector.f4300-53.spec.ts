import { asksTheCustomerBack, buildFaqSelectorRequest, FAQ_SELECTOR_MAX_FAQS, parseFaqSelection, selectFaqByMeaning } from './faq-semantic-selector';

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

    it('a question about one named item is not matched to a FAQ about items in general; a business-wide policy still is', () => {
        const { systemPrompt } = buildFaqSelectorRequest('What is the price of the synthetic QA plate?', FAQS.map(f => f.question));
        expect(systemPrompt).toMatch(/ONE specific item/);
        expect(systemPrompt).toMatch(/about items in general \(what a package includes, the average price per person\) is NOT a match/);
        expect(systemPrompt).toMatch(/business-wide policy \(discounts, cancellation, payment, delivery\) still is/);
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

/**
 * Production QA 29-oct, after #307: the selector still named «¿Qué incluye el paquete?» («Cada paquete es distinto. Cuéntame cuál te
 * interesa…») for a tour already named, 29 of 29 times. A FAQ that only hands the question back is not offered to the selector.
 * The answers are the published ones of the QA tenants.
 */
describe('F4300-53 · a FAQ that hands the question back is not a candidate', () => {
    it.each([
        'Cada paquete es distinto. Cuéntame cuál te interesa y te detallo exactamente qué incluye antes de cotizar.',
        'Cuéntame qué día te sirve y te confirmo el horario de atención. Si quieres agendar ahora mismo, escribe "quiero una cita".',
        'Depende de lo que pidas. Escribe "menú" y te muestro la carta con los precios vigentes.',
        'Con gusto te compartimos nuestra dirección y cómo llegar. Escríbenos y te la confirmamos.',
        'Depende del tour y de la disponibilidad de guías. Dime qué idioma prefieres y te confirmo si lo tenemos para la fecha que buscas.',
        'Each package is different. Tell me which one you like.',
    ])('«%s» asks back', answer => expect(asksTheCustomerBack(answer)).toBe(true));

    it.each([
        'En caso de emergencia acude al servicio de urgencias más cercano o llama a la línea de emergencias de tu ciudad.',
        'Para este piloto ficticio, el audífono QA tiene garantía de 72 días calendario desde la entrega. Escríbenos si tienes dudas.',
        'Depende del paquete y de los proveedores involucrados. Te confirmamos las condiciones exactas antes de que reserves.',
        'Depende de tu caso, pero generalmente entre 12 y 24 meses con citas mensuales.',
        undefined,
    ])('«%s» answers (or has no answer to judge): still a candidate', answer => expect(asksTheCustomerBack(answer)).toBe(false));

    it('the selector never sees it, and its numbering is over the candidates it sees', async () => {
        const faqs = [
            { question: '¿Qué incluye el paquete?', answer: 'Cada paquete es distinto. Cuéntame cuál te interesa y te detallo exactamente qué incluye.' },
            { question: '¿Cuál es la política de cancelación?', answer: 'Depende del paquete y de los proveedores involucrados.' },
        ];
        const selector = jest.fn().mockResolvedValue({ content: '{"faq": 1}' });
        expect(await selectFaqByMeaning('Que comprend exactement le prix de ce tour ?', faqs, selector)).toBe(faqs[1]);
        expect(selector.mock.calls[0][0].messages[0].content).not.toContain('¿Qué incluye el paquete?');
        expect(await selectFaqByMeaning('x?', [faqs[0]], selector)).toBeNull();
        expect(selector).toHaveBeenCalledTimes(1);
    });
});
