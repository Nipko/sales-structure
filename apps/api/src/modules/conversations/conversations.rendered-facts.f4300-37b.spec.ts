import { ConversationsService, rememberRenderedFactsInput } from './conversations.service';
import { languageMismatch } from './reply-language';
import { FACT_TTL_MS, type VerifiedFact } from './runtime/facts-ledger';
import { factTokenId, renderReplyFacts } from './runtime/fact-renderer';

/**
 * F4300-37, second measurement: `agentRuntime.renderedFacts` on again in the 7 QA tenants after #226 (image d865ef65),
 * 8 of 12 cases right. The three left, from the production replies and the API log:
 *   1. menu EN «how many orders have I made?» — the model answered in Spanish; the language guard asked for an English
 *      rewrite, which came back as «You have made a total of ⟦count:f0vl378k⟧ order…» (the system prompt tells it to cite
 *      figures by token), lost the «1», was rejected twice, and the Spanish reply was sent;
 *   2. store FR «combien de commandes ai-je chez vous ?» — «Usted tiene un total de 6 commandes chez nous, mais toutes
 *      sont annulées actuellement. ¿Desea que le ayude con algo más?»: the Spanish closing was not seen as Spanish;
 *   3. menu ES «si pido dos platos Spark cuánto pago?» — «13.500 COP por cada plato, es decir, 13.500 COP x 2»: no total.
 */
const NOW = new Date('2026-10-25T19:18:00.000Z');
function fact(kind: VerifiedFact['kind'], subject: VerifiedFact['subject'], field: string, value: VerifiedFact['value'], extra: Partial<VerifiedFact> = {}): VerifiedFact {
    return { v: 1, kind, subject, field, value, source: { tool: 'test_read' }, observedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        expiresAt: new Date(NOW.getTime() + FACT_TTL_MS[kind]).toISOString(), ...extra };
}
const DISH = { type: 'menu_item', id: 'dish-spark', name: 'Spark QA Plato 20261018T110518Z' };
const dishPrice = fact('money', DISH, 'price', 13500, { currency: 'COP', priceStatus: 'confirmed' });
const orders = fact('record_list', { type: 'orders', id: 'customer' }, 'records', ['0B1C2D3E cancelled'],
    { complete: true, total: 1, source: { tool: 'list_my_orders' } });

describe('F4300-37b · 3. a confirmed price times the quantity the customer asked for is said as the total', () => {
    const price = `⟦fact:${factTokenId(dishPrice)}⟧`;
    const render = (reply: string, customerText: string) =>
        renderReplyFacts({ reply, facts: [dishPrice], now: NOW, language: 'es', locale: 'es-CO', customerText });

    it('«⟦price⟧ x 2» to «si pido dos» → 27.000 COP with its working', () => {
        const out = render(`Si pide dos platos Spark, pagará ${price} por cada plato, es decir, ${price} x 2. ¿Desea hacer el pedido?`,
            'si pido dos platos Spark cuánto pago?');
        expect(out.text).toContain('27.000 COP (2 × 13.500 COP)');
        expect(out.text).toContain('pagará 13.500 COP por cada plato');
        expect(out.fallbacks).toEqual([]);
    });

    it('«3 × ⟦price⟧» works the other way round', () => {
        const out = render(`Tres platos le cuestan 3 × ${price}.`, 'y si pido 3?');
        expect(out.text).toBe('Tres platos le cuestan 40.500 COP (3 × 13.500 COP).');
    });

    it('a quantity the customer did not ask for is left as written', () => {
        const out = render(`El plato cuesta ${price} x 2 porciones.`, 'cuánto vale el plato Spark?');
        expect(out.text).toBe('El plato cuesta 13.500 COP x 2 porciones.');
    });
});

describe('F4300-37b · 2. a Spanish closing inside a French reply is a mismatch', () => {
    it('the store reply is seen as Spanish, the French one is not', () => {
        const mixed = 'Usted tiene un total de 6 commandes chez nous, mais toutes sont annulées actuellement. ¿Desea que le ayude con algo más?';
        expect(languageMismatch(mixed, 'fr')).toBe('es');
        expect(languageMismatch('Vous avez 6 commandes chez nous, toutes annulées. Souhaitez-vous que je vous aide avec autre chose ?', 'fr')).toBeNull();
    });
});

describe('F4300-37b · 1. a language rewrite that wrote fact tokens is rendered before it is checked', () => {
    const SPANISH = 'Ha realizado un total de 1 pedido, que fue cancelado. ¿Le gustaría hacer un nuevo pedido?';
    const REWRITE = `You have made a total of ⟦count:${factTokenId(orders)}⟧ order, which was cancelled. Would you like to place a new order?`;
    const build = () => {
        const service: any = Object.create(ConversationsService.prototype);
        const execute = jest.fn().mockResolvedValue({ content: REWRITE });
        Object.assign(service, { logger: { warn: jest.fn(), log: jest.fn(), debug: jest.fn() }, recordAgentSignal: jest.fn() });
        return { service, execute };
    };
    const align = (service: any, execute: jest.Mock, trusted: object) => service.alignReplyLanguage(
        SPANISH, 'en', [{ role: 'user', content: 'how many orders have I made?' }], 'sys', [], 'tenant', { execute }, trusted);

    it('with the turn\'s render input the English rewrite says «1 order» and is sent', async () => {
        const { service, execute } = build();
        const trusted = { factTokens: [] };
        rememberRenderedFactsInput(trusted, { facts: [orders], now: NOW, language: 'en', locale: 'en-US', customerText: 'how many orders have I made?' });
        const out = await align(service, execute, trusted);
        expect(out).toBe('You have made a total of 1 order, which was cancelled. Would you like to place a new order?');
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('without it (flag off) a tokenized rewrite is still rejected and never sent', async () => {
        const { service, execute } = build();
        const out = await align(service, execute, {});
        expect(out).toBe(SPANISH);
        expect(out).not.toContain('⟦');
    });
});
