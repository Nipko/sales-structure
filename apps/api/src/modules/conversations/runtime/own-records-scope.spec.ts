import { NO_PUBLISHED_OFFERS_MESSAGE, OWN_RECORDS_EMPTY_MESSAGE, scopeOwnRecordsResult } from './own-records-scope';

describe('E2ag C19/C20 · una lista propia vacía no prueba que no haya registros', () => {
    it.each([
        ['list_my_tour_bookings', { historyLimit: 10, historyMayBeTruncated: false, bookings: [] }],
        ['list_my_orders', { orders: [] }],
        ['list_my_property_bookings', { bookings: [] }],
        ['list_pets_for_contact', { pets: [] }],
    ])('%s vacía lleva el alcance y la instrucción', (tool, result) => {
        const out = scopeOwnRecordsResult(tool, result);
        expect(out).toMatchObject({ ...result, status: 'empty', scope: 'this_chat_contact', message: OWN_RECORDS_EMPTY_MESSAGE });
    });

    it.each([
        ['con registros', 'list_my_tour_bookings', { bookings: [{ id: 'b1' }] }],
        ['una falla', 'list_my_orders', { error: 'read_failed', errorCode: 'read_failed' }],
        ['otra herramienta', 'search_packages', { packages: [] }],
        ['sin listas', 'list_my_orders', { message: 'x' }],
        ['total mayor que cero', 'list_my_orders', { orders: [], total: 3 }],
    ])('queda igual: %s', (_why, tool, result) => {
        expect(scopeOwnRecordsResult(tool, result)).toBe(result);
    });
});

describe('E2ag C13 · sin promociones cargadas no es «no hay promociones»', () => {
    it.each([
        ['get_promotions', { promotions: [], message: 'No active promotions at this time.' }],
        ['list_active_offers', { offers: [], status: 'empty', source: 'tenant_db' }],
    ])('%s vacía dice que no hay publicadas', (tool, result) => {
        expect(scopeOwnRecordsResult(tool, result)).toMatchObject({ status: 'empty', scope: 'published', message: NO_PUBLISHED_OFFERS_MESSAGE });
    });
    it('con promociones queda igual', () => {
        const result = { promotions: [{ title: '2x1' }] };
        expect(scopeOwnRecordsResult('get_promotions', result)).toBe(result);
    });
});
