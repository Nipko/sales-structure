import type { TurnContext } from '@parallext/shared';
import { ActiveOperationsContextService } from './active-operations-context.service';
import { listTotal } from './list-total';
import { PromptAssemblerService } from './prompt-assembler.service';
import {
    ORDER_LISTING_READ_LIMIT, orderListing, orderListingTotal, runTransition, transitionTexts, type TransitionIO,
} from './transition-engine';

/**
 * Production QA (store tenant): the customer has exactly 6 orders, all cancelled. «¿Cuántos pedidos he hecho con ustedes?»
 * was answered «Usted ha hecho tres pedidos recientes» in 4 of 4 runs. Two sources:
 *  - the server's listing shows the newest 5 and said «Usted tiene 5 pedidos» (the shown rows, not the total);
 *  - the turn context lists the newest 3 orders with no total, so a model answering from context counted 3.
 */
const uuid = (i: number) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`;
const order = (i: number, status = 'cancelled') => ({
    id: uuid(i), status, paymentStatus: 'pending', totalAmount: 1000 * i, currency: 'COP', items: [{ productName: `Producto ${i}`, quantity: 1 }],
});
const orders = (n: number, status = 'cancelled') => Array.from({ length: n }, (_, i) => order(i + 1, status));

describe('the orders listing tells the real total, not the rows shown', () => {
    it('counts the reader rows (6) while showing the newest 5', () => {
        const listed = { success: true, orders: orders(6) };
        expect(orderListing(listed)).toHaveLength(5);
        expect(orderListingTotal(listed)).toEqual({ total: 6, atLeast: false });
        // the reader returned as many rows as asked for: there may be more
        expect(orderListingTotal({ orders: orders(ORDER_LISTING_READ_LIMIT) })).toEqual({ total: 50, atLeast: true });
        expect(orderListingTotal({ orders: orders(3), hasMore: true })).toEqual({ total: 3, atLeast: true });
    });

    it.each([
        ['es', 'usted', 'Usted tiene 6 pedidos; estos son los 5 más recientes:\n'],
        ['es', 'tu', 'Tienes 6 pedidos; estos son los 5 más recientes:\n'],
        ['en', 'usted', 'You have 6 orders; here are the 5 most recent:\n'],
        ['pt', 'usted', 'Você tem 6 pedidos; estes são os 5 mais recentes:\n'],
        ['fr', 'usted', 'Vous avez 6 commandes ; voici les 5 plus récentes :\n'],
    ] as const)('%s/%s: 6 orders → total 6 with the 5 most recent', (lang, form, opening) => {
        const listed = { orders: orders(6) };
        const { total, atLeast } = orderListingTotal(listed);
        const text = transitionTexts(lang, form).listOrders(orderListing(listed, 'es-CO', lang), total, atLeast);
        expect(text.startsWith(opening)).toBe(true);
        expect(text.split('\n').filter(line => line.startsWith('- '))).toHaveLength(5);
    });

    it.each([
        ['es', 'usted', 'Usted tiene al menos 50 pedidos; estos son los 5 más recientes:\n'],
        ['es', 'tu', 'Tienes al menos 50 pedidos; estos son los 5 más recientes:\n'],
        ['en', 'usted', 'You have at least 50 orders; here are the 5 most recent:\n'],
        ['pt', 'usted', 'Você tem pelo menos 50 pedidos; estes são os 5 mais recentes:\n'],
        ['fr', 'usted', 'Vous avez au moins 50 commandes ; voici les 5 plus récentes :\n'],
    ] as const)('%s/%s: a cut reader says «at least»', (lang, form, opening) => {
        const listed = { orders: orders(50) };
        const { total, atLeast } = orderListingTotal(listed);
        expect(transitionTexts(lang, form).listOrders(orderListing(listed, 'es-CO', lang), total, atLeast).startsWith(opening)).toBe(true);
    });

    it.each([
        ['es', 'usted', 'Usted tiene 3 pedidos:\n'],
        ['es', 'tu', 'Tienes 3 pedidos:\n'],
        ['en', 'usted', 'You have 3 orders:\n'],
        ['pt', 'usted', 'Você tem 3 pedidos:\n'],
        ['fr', 'usted', 'Vous avez 3 commandes :\n'],
    ] as const)('%s/%s: 3 orders → the text is unchanged', (lang, form, opening) => {
        const listed = { orders: orders(3) };
        const rows = orderListing(listed, 'es-CO', lang);
        const { total, atLeast } = orderListingTotal(listed);
        const texts = transitionTexts(lang, form);
        expect(texts.listOrders(rows, total, atLeast)).toBe(texts.listOrders(rows));
        expect(texts.listOrders(rows).startsWith(opening)).toBe(true);
    });

    it('the engine asks the reader for its maximum and tells 6 for 6 cancelled orders', async () => {
        const calls: Array<{ name: string; args: any }> = [];
        const io: TransitionIO = {
            execute: async (name: string, args: any) => { calls.push({ name, args }); return { success: true, orders: orders(6) }; },
            interpretTarget: async () => null, todayIso: '2026-10-22', language: 'es', form: 'usted',
        } as any;
        const outcome = await runTransition({ verb: 'list', domain: 'order' } as any, 'me confirmas cuántos pedidos tengo en total?', io);
        expect(calls).toEqual([{ name: 'list_my_catalog_orders', args: { limit: ORDER_LISTING_READ_LIMIT } }]);
        expect(outcome.handled).toBe(true);
        expect(outcome.text).toMatch(/^Usted tiene 6 pedidos; estos son los 5 más recientes:\n/);
        expect(outcome.text).not.toMatch(/tiene 5 pedidos/);
    });

    it('the upcoming-appointments listing tells the counted total when the reader cut it', async () => {
        const appointments = Array.from({ length: 10 }, (_, i) => ({ id: uuid(i + 1), service: 'Corte', date: '2026-10-30', time: `${10 + (i % 8)}:00`, status: 'confirmed' }));
        const io: TransitionIO = {
            execute: async () => ({ appointments, total: 12, hasMore: true }),
            interpretTarget: async () => null, todayIso: '2026-10-22', language: 'es', form: 'usted',
        } as any;
        const outcome = await runTransition({ verb: 'list', domain: 'appointment' } as any, '¿qué citas tengo?', io);
        expect(outcome.text).toMatch(/^Usted tiene 12 citas próximas; estas son las 10 más cercanas:\n/);
        // complete list: unchanged
        const two = transitionTexts('es', 'usted');
        expect(two.list([{ id: 'a', ref: 'A', label: 'Corte', date: '2026-10-30', time: '10:00', cancellable: true } as any], 1))
            .toMatch(/^Usted tiene una cita:\n/);
        expect(transitionTexts('en').list(appointments.map(a => ({ ...a, ref: 'X', label: 'Cut', cancellable: true })) as any, 12))
            .toMatch(/^You have 12 upcoming appointments; here are the next 10:\n/);
        expect(transitionTexts('pt').list(appointments.map(a => ({ ...a, ref: 'X', label: 'Corte', cancellable: true })) as any, 12))
            .toMatch(/^Você tem 12 agendamentos futuros; estes são os 10 mais próximos:\n/);
        expect(transitionTexts('fr').list(appointments.map(a => ({ ...a, ref: 'X', label: 'Coupe', cancellable: true })) as any, 12))
            .toMatch(/^Vous avez 12 rendez-vous à venir ; voici les 10 prochains :\n/);
    });

    it('a LIMITed reader carries its window COUNT as total/hasMore (restaurant orders, customer orders, appointments)', () => {
        expect(listTotal([{ id: 'a', total_count: 6 }, { id: 'b', total_count: 6 }])).toEqual({ total: 6, hasMore: true });
        expect(listTotal([{ id: 'a', total_count: 2 }, { id: 'b', total_count: 2 }])).toEqual({ total: 2, hasMore: false });
        expect(listTotal([{ id: 'a' }])).toEqual({});
        expect(listTotal([])).toEqual({});
    });
});

describe('the turn context marks a partial recent-orders list with its total', () => {
    const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
    const NOW = new Date('2026-10-22T12:00:00.000Z');
    const BASE_TURN: TurnContext = { language: 'es', timezone: 'America/Bogota', now: NOW.toISOString(), upcomingDays: [], businessHoursStatus: 'open' };

    async function load(total: number, shown: number) {
        const query = jest.fn(async (_schema: string, sql: string) => {
            if (!sql.includes('FROM orders')) return [];
            expect(sql).toContain('COUNT(*) OVER()::int AS total_count');
            return Array.from({ length: shown }, (_, i) => ({
                id: uuid(i + 1), status: 'cancelled', total_amount: 1000, currency: 'COP',
                starts_at_iso: '2026-10-01T10:00:00.000Z', updated_at_iso: '2026-10-01T10:00:00.000Z', total_count: total,
            }));
        });
        const turn: TurnContext = { ...BASE_TURN };
        const result = await new ActiveOperationsContextService({ executeInTenantSchema: query } as any).populateTurnContext(turn, {
            tenantId: 'tenant-1', schemaName: 'tenant_test', contactId: CONTACT_ID,
            config: { tools: { orders: { enabled: true } } } as any, timezone: 'America/Bogota', now: NOW,
        });
        return { turn, result };
    }

    it('6 orders, 3 loaded → recordTotals {order, total 6, shown 3}, rendered as partial in the prompt', async () => {
        const { turn, result } = await load(6, 3);
        expect(result.recordTotals).toEqual([{ kind: 'order', total: 6, shown: 3 }]);
        expect(turn.recordTotals).toEqual([{ kind: 'order', total: 6, shown: 3 }]);
        const prompt = new PromptAssemblerService({ buildSystemPrompt: jest.fn(() => '<persona />') } as any).assemble({} as any, turn);
        expect(prompt).toContain('<recent_orders total="6" shown="3" partial="true">');
        expect(prompt).toContain('<record_totals>');
        expect(prompt).toContain('<count kind="order" total="6" shown="3" partial="true">6 in total; only the 3 most recent are listed.');
    });

    it('a complete list carries no total and renders exactly as before', async () => {
        const { turn, result } = await load(3, 3);
        expect(result.recordTotals).toBeUndefined();
        expect(turn.recordTotals).toBeUndefined();
        const prompt = new PromptAssemblerService({ buildSystemPrompt: jest.fn(() => '<persona />') } as any).assemble({} as any, turn);
        expect(prompt).toContain('  <recent_orders>');
        expect(prompt).not.toContain('<record_totals>');
    });
});
