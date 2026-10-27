import { FACT_TTL_MS, type VerifiedFact } from './facts-ledger';
import { factTokenId, renderReplyFacts } from './fact-renderer';

/**
 * F4300-37 (production QA 27-oct, hotel tenant, image 1a719d86, renderedFacts on): «¿el precio de la noche incluye la limpieza?»
 * read the room (`cleaningFee: 0`) and the customer got «Prefiero no darle una cifra que no tengo confirmada en el sistema», in es
 * and pt. A fee read as 0 backs «0 COP» in a sentence about that fee.
 */
const NOW = new Date('2026-10-27T08:30:00.000Z');
const money = (field: string, value: number): VerifiedFact => ({
    v: 1, kind: 'money', subject: { type: 'property', id: 'room-1', name: 'Spark QA Habitacion' }, field, value, currency: 'COP',
    priceStatus: 'confirmed', source: { tool: 'get_property_details' },
    observedAt: new Date(NOW.getTime() - 60_000).toISOString(), expiresAt: new Date(NOW.getTime() + FACT_TTL_MS.money).toISOString(),
} as VerifiedFact);
const render = (reply: string, facts: VerifiedFact[], language: string, customerText: string) =>
    renderReplyFacts({ reply, facts, now: NOW, language, locale: language === 'pt' ? 'pt-BR' : 'es-CO', customerText });
const room = [money('nightPrice', 150000), money('cleaningFee', 0)];
const token = (f: VerifiedFact) => `⟦fact:${factTokenId(f)}⟧`;

describe('F4300-37 · a fee read as 0 is said, not refused', () => {
    it.each([
        ['es', '¿el precio de la noche incluye la limpieza?', 'La habitación no tiene tarifa de limpieza (0 COP).'],
        ['pt', 'o preço da diária inclui a limpeza?', 'O quarto não tem taxa de limpeza: 0 COP.'],
    ])('[%s] «%s»', (lang, ask, reply) => {
        const out = render(reply, room, lang, ask);
        expect(out.text).toBe(reply);
    });

    it.each([
        ['es', '¿el precio de la noche incluye la limpieza?', 'La tarifa de limpieza es de ', '0 COP'],
        ['pt', 'o preço da diária inclui a limpeza?', 'A taxa de limpeza é de ', '0 COP'],
    ])('[%s] the fee token of 0 is rendered, not refused (image c6a5fa88)', (lang, ask, lead, amount) => {
        const out = render(`${lead}${token(room[1])}.`, room, lang, ask);
        expect(out.text).toBe(`${lead}${amount}.`);
    });

    it('a PRICE token of 0 is still a missing price', () => {
        const out = render(`La noche cuesta ${token(money('nightPrice', 0))}.`, [money('nightPrice', 0)], 'es', '¿cuánto cuesta la noche?');
        expect(out.text).not.toContain('0 COP');
    });

    it('with no fee read, 0 COP for cleaning is still not backed', () => {
        const out = render('La tarifa de limpieza es 0 COP.', [money('nightPrice', 150000)], 'es', '¿cobran limpieza?');
        expect(out.text).not.toContain('0 COP');
    });

    it('a fee read as 0 never backs another amount', () => {
        const out = render('La tarifa de limpieza es 20.000 COP.', room, 'es', '¿cobran limpieza?');
        expect(out.text).not.toContain('20.000');
    });
});
