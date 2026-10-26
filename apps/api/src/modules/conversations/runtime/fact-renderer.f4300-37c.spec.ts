import { FACT_TTL_MS, type VerifiedFact } from './facts-ledger';
import { factTokenId, renderReplyFacts } from './fact-renderer';

/**
 * F4300-37 residue (production QA 26-oct, image fee22cc7, renderedFacts on): «quanto fica três pratos Spark?» got «o total para
 * três pratos é 13.500 COP multiplicado por três». #229 said the total only for «⟦price⟧ x 2» written with a digit; the operator
 * and the count may be words, in any of the four languages.
 */
const NOW = new Date('2026-10-26T03:20:00.000Z');
const DISH = { type: 'menu_item', id: 'dish-spark', name: 'Spark QA Plato 20261018T110518Z' };
const price: VerifiedFact = { v: 1, kind: 'money', subject: DISH, field: 'price', value: 13500, currency: 'COP', priceStatus: 'confirmed',
    source: { tool: 'get_menu' }, observedAt: new Date(NOW.getTime() - 60_000).toISOString(), expiresAt: new Date(NOW.getTime() + FACT_TTL_MS.money).toISOString() };
const token = `⟦fact:${factTokenId(price)}⟧`;
const LOCALES: Record<string, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };
const render = (reply: string, language: string, customerText: string) =>
    renderReplyFacts({ reply, facts: [price], now: NOW, language, locale: LOCALES[language], customerText });

describe('F4300-37c · a price multiplied in words is said as the total', () => {
    it.each([
        ['pt', 'quanto fica três pratos Spark?', `Então o total para três pratos é ${token} multiplicado por três.`, '40.500 COP (3 × 13.500 COP)'],
        ['es', 'cuánto me salen dos platos Spark?', `El total es ${token} multiplicado por dos.`, '27.000 COP (2 × 13.500 COP)'],
        ['en', 'how much for three Spark dishes?', `The total is ${token} times three.`, '40,500 COP (3 × 13,500 COP)'],
        ['fr', 'combien pour deux plats Spark ?', `Le total est de ${token} multiplié par deux.`, '27 000 COP (2 × 13 500 COP)'],
        ['pt', 'e se eu pedir 2 pratos?', `Fica ${token} vezes 2.`, '27.000 COP (2 × 13.500 COP)'],
    ])('%s: «%s»', (lang, ask, reply, total) => {
        const out = render(reply, lang, ask);
        const spaced = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');
        expect(spaced(out.text)).toContain(spaced(total));
        expect(out.fallbacks).toEqual([]);
    });

    it('a count the customer did not ask for stays as written', () => {
        const out = render(`Cada porción es ${token} multiplicado por dos ingredientes.`, 'es', 'cuánto vale el plato Spark?');
        expect(out.text).toBe('Cada porción es 13.500 COP multiplicado por dos ingredientes.');
    });
});
