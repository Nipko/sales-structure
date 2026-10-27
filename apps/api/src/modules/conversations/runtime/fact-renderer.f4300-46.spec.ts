import { FACT_TTL_MS, type VerifiedFact } from './facts-ledger';
import { renderReplyFacts } from './fact-renderer';

/**
 * F4300-46 (production QA 27-oct, image 84f88db8, renderedFacts on). A sentence whose amount no confirmed fact backed was restated
 * as «the price of» the one item with a confirmed price, whatever the sentence was about:
 *   - salon: «qto custa a manicure e pedicure?» (an example price) → «O preço de Corte y estilo é 40.000 COP», twice;
 *   - hotel: «cobram algo extra pela limpeza?» / «is there any extra charge for cleaning?» → «O preço de Spark QA Habitacion é
 *     150.000 COP» — a fee is not the room's price.
 */
const NOW = new Date('2026-10-27T01:00:00.000Z');
const money = (subject: VerifiedFact['subject'], field: string, value: number, priceStatus: 'confirmed' | 'example'): VerifiedFact => ({
    v: 1, kind: 'money', subject, field, value, currency: 'COP', priceStatus, source: { tool: 'search_faqs' },
    observedAt: new Date(NOW.getTime() - 60_000).toISOString(), expiresAt: new Date(NOW.getTime() + FACT_TTL_MS.money).toISOString(),
} as VerifiedFact);
const CUT = { type: 'service', id: 'svc-cut', name: 'Corte y estilo' };
const MANI = { type: 'service', id: 'svc-mani', name: 'Manicure y pedicure' };
const ROOM = { type: 'property', id: 'room-1', name: 'Spark QA Habitacion' };
const render = (reply: string, facts: VerifiedFact[], language: string, customerText: string) =>
    renderReplyFacts({ reply, facts, now: NOW, language, locale: language === 'pt' ? 'pt-BR' : language === 'en' ? 'en-US' : 'es-CO', customerText });

describe('F4300-46 · an unbacked amount is not restated as another item’s price', () => {
    const salon = [money(CUT, 'price', 40000, 'confirmed'), money(MANI, 'price', 50000, 'example')];

    it('the example-priced service the customer named is never priced as Corte y estilo', () => {
        const out = render('A manicure e pedicure custa 50.000 COP.', salon, 'pt', 'qto custa a manicure e pedicure?');
        expect(out.text).not.toMatch(/Corte y estilo|40\.000|50\.000/);
    });

    it('the confirmed service named in the sentence keeps its own price', () => {
        const out = render('O corte e estilo custa 45.000 COP.', salon, 'pt', 'quanto custa o Corte y estilo?');
        expect(out.text).toContain('40.000 COP');
    });

    it.each([
        ['pt', 'cobram algo extra pela limpeza?', 'Não há taxa de limpeza extra: 0 COP no Spark QA Habitacion.'],
        ['en', 'is there any extra charge for cleaning?', 'The cleaning fee for the Spark QA Habitacion is 0 COP.'],
    ])('[%s] a cleaning-fee sentence is not «the price of the room»', (lang, ask, reply) => {
        const out = render(reply, [money(ROOM, 'nightPrice', 150000, 'confirmed')], lang, ask);
        expect(out.text).not.toMatch(/150[.,]000/);
    });
});
