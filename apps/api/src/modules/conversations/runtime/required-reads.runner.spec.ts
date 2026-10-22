import { getOperation } from '@parallext/shared';
import {
    buildRequiredReadsTrace,
    pickReceiptId,
    REQUIRED_READS_CONFIDENCE_THRESHOLD,
    REQUIRED_READS_PILOT_OPERATIONS,
    requiredReadsGate,
    requiredReadsPilotForProfile,
    runRequiredReads,
    withListEvidence,
} from './required-reads.runner';
import type { OperationShadowVerdict } from './operation-classifier.service';
import { extractVerifiedFacts } from './facts-extractors';

const verdict = (operationKey: string, confidence: number, fallback: OperationShadowVerdict['fallback'] = null): OperationShadowVerdict =>
    ({ version: 1, operationKey, confidence, fallback, candidates: [operationKey], latencyMs: 5 });

const op = (key: string) => {
    const operation = getOperation(key);
    if (!operation) throw new Error(`missing operation ${key}`);
    return operation;
};

describe('required reads: pilot and gate', () => {
    it('the pilot is only restaurants and store, by the profile industry', () => {
        expect(requiredReadsPilotForProfile('restaurantes/casual_dining')).toBe('restaurants');
        expect(requiredReadsPilotForProfile('retail/electronica')).toBe('catalog');
        for (const other of ['salud/odontologia', 'turismo/hotel', 'inmobiliaria/venta', 'otro/generico', null, undefined, '']) {
            expect(requiredReadsPilotForProfile(other as any)).toBeNull();
        }
        expect(Object.keys(REQUIRED_READS_PILOT_OPERATIONS).sort())
            .toEqual(['check_my_orders', 'menu_info', 'product_info', 'track_catalog_order', 'track_food_order']);
        // Every pilot operation exists in the catalogue and owes at least one read.
        for (const key of Object.keys(REQUIRED_READS_PILOT_OPERATIONS)) expect(op(key).requiredReads.length).toBeGreaterThan(0);
    });

    it('acts only on a confident verdict of a pilot operation of the tenant\'s own pilot', () => {
        expect(requiredReadsGate(null, 'catalog')).toEqual({ run: false, reason: 'no_verdict' });
        expect(requiredReadsGate(verdict('none', 0.99, 'none'), 'catalog')).toEqual({ run: false, reason: 'fallback:none' });
        expect(requiredReadsGate(verdict('track_catalog_order', 0.5, 'low_confidence'), 'catalog')).toEqual({ run: false, reason: 'fallback:low_confidence' });
        expect(requiredReadsGate(verdict('track_catalog_order', REQUIRED_READS_CONFIDENCE_THRESHOLD - 0.01), 'catalog')).toEqual({ run: false, reason: 'below_threshold' });
        expect(requiredReadsGate(verdict('listing_info', 0.95), 'catalog')).toEqual({ run: false, reason: 'not_pilot_operation' });
        expect(requiredReadsGate(verdict('menu_info', 0.95), 'catalog')).toEqual({ run: false, reason: 'pilot_mismatch' });
        const gate = requiredReadsGate(verdict('track_catalog_order', REQUIRED_READS_CONFIDENCE_THRESHOLD), 'catalog');
        expect(gate.run && gate.operation.key).toBe('track_catalog_order');
    });
});

describe('required reads: runner', () => {
    const io = (results: Record<string, (args: any) => any>, extra: Partial<Parameters<typeof runRequiredReads>[1]> = {}) => {
        const calls: Array<{ name: string; args: any; at: number }> = [];
        let clock = 0;
        return {
            calls,
            io: {
                publishedTools: Object.keys(results),
                alreadyRead: [],
                projectedContexts: [],
                now: () => clock++,
                execute: async (name: string, args: any) => {
                    calls.push({ name, args, at: clock });
                    return results[name](args);
                },
                ...extra,
            } as Parameters<typeof runRequiredReads>[1],
        };
    };

    it('track_food_order: lists by contact, then reads the one open order (no number asked)', async () => {
        const h = io({
            list_my_orders: () => ({ orders: [{ id: 'o-open', status: 'preparing' }, { id: 'o-old', status: 'delivered' }] }),
            check_order_status: args => ({ id: args.orderId, status: 'preparing' }),
        });
        const run = await runRequiredReads(op('track_food_order'), h.io);
        expect(h.calls.map(c => [c.name, c.args])).toEqual([['list_my_orders', { limit: 20 }], ['check_order_status', { orderId: 'o-open' }]]);
        expect(run.outcome).toBe('read');
        expect(run.reads).toEqual([
            expect.objectContaining({ tool: 'list_my_orders', status: 'read', rows: 2, complete: true, total: 2 }),
            expect.objectContaining({ tool: 'check_order_status', status: 'read', args: { orderId: 'o-open' } }),
        ]);
    });

    it('several open orders: the detail read is not guessed, the list answers', async () => {
        const h = io({
            list_my_orders: () => ({ orders: [{ id: 'a', status: 'preparing' }, { id: 'b', status: 'pending' }] }),
            check_order_status: () => { throw new Error('must not run'); },
        });
        const run = await runRequiredReads(op('track_food_order'), h.io);
        expect(h.calls.map(c => c.name)).toEqual(['list_my_orders']);
        expect(run.reads[1]).toEqual({ tool: 'check_order_status', args: {}, status: 'ambiguous_receipt' });
    });

    it('a list read at the reader\'s maximum is marked incomplete, with hasMore', () => {
        const rows = Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, status: 'delivered' }));
        const full = withListEvidence('list_my_orders', { limit: 20 }, { orders: rows });
        expect(full).toMatchObject({ rows: 20, complete: false });
        expect(full.total).toBeUndefined();
        expect(full.result).toMatchObject({ hasMore: true, complete: false });
        const six = withListEvidence('list_my_catalog_orders', { limit: 50 }, { success: true, orders: rows.slice(0, 6) });
        expect(six).toMatchObject({ rows: 6, complete: true, total: 6 });
        // The facts ledger reads the same completeness from the enriched result.
        const facts = extractVerifiedFacts([{ name: 'list_my_catalog_orders', args: { limit: 50 }, result: six.result }], new Date('2026-10-22T16:00:00Z'));
        expect(facts.facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'record_list', complete: true, total: 6 })]));
    });

    it('a failed read (error result or exception) yields an admit, never an empty list', async () => {
        for (const failing of [() => ({ error: 'boom' }), () => { throw new Error('connection reset'); }]) {
            const h = io({ list_my_orders: failing, check_order_status: () => ({}) });
            const run = await runRequiredReads(op('track_food_order'), h.io);
            expect(run.outcome).toBe('admit');
            expect(run.results).toHaveLength(1);
            const result = run.results[0].result;
            expect(result.error).toBeTruthy();
            expect(result.orders).toBeUndefined();
            expect(result.message).toMatch(/^No pude consultar/);
            expect(run.reads).toEqual([
                expect.objectContaining({ tool: 'list_my_orders', status: 'failed' }),
                { tool: 'check_order_status', args: {}, status: 'upstream_failed' },
            ]);
        }
    });

    it('an explained refusal from the executor reaches the model as it is', async () => {
        const h = io({ list_my_orders: () => ({ error: 'identity_required', message: 'Necesito verificar su identidad.' }), check_order_status: () => ({}) });
        const run = await runRequiredReads(op('track_food_order'), h.io);
        expect(run.results[0].result).toMatchObject({ error: 'identity_required', message: 'Necesito verificar su identidad.', requiredRead: true });
    });

    it('Agent Test: an exception is rethrown when the caller says so', async () => {
        const h = io({ list_my_orders: () => { throw new Error('infra'); }, check_order_status: () => ({}) }, { rethrow: () => true });
        await expect(runRequiredReads(op('track_food_order'), h.io)).rejects.toThrow('infra');
    });

    it('reuses a read the runtime already made, and does not read a projected catalogue again', async () => {
        const menu = io({ get_menu: () => { throw new Error('must not run'); } }, { alreadyRead: [{ name: 'get_menu', result: { items: [] } }] });
        const menuRun = await runRequiredReads(op('menu_info'), menu.io);
        expect(menu.calls).toEqual([]);
        expect(menuRun).toMatchObject({ outcome: 'nothing_to_run', reads: [{ tool: 'get_menu', status: 'already_read' }] });

        const products = io({ search_products: () => { throw new Error('must not run'); }, get_product: () => { throw new Error('must not run'); } },
            { projectedContexts: ['turn_catalog'] });
        const productRun = await runRequiredReads(op('product_info'), products.io);
        expect(products.calls).toEqual([]);
        expect(productRun.reads.map(r => r.status)).toEqual(['projected', 'projected']);
    });

    it('an unpublished reader is never run', async () => {
        const h = io({ list_my_orders: () => ({ orders: [] }) });
        const run = await runRequiredReads(op('track_food_order'), { ...h.io, publishedTools: [] });
        expect(h.calls).toEqual([]);
        expect(run.reads.map(r => r.status)).toEqual(['unpublished', 'unpublished']);
    });

    it('independent reads of one stage run in parallel', async () => {
        let inFlight = 0;
        let peak = 0;
        const slow = (value: any) => async () => {
            inFlight++; peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 5));
            inFlight--;
            return value;
        };
        const operation = { ...op('menu_info'), requiredReads: [...op('menu_info').requiredReads, ...op('check_my_orders').requiredReads] };
        const h = io({ get_menu: slow({ items: [] }), list_my_orders: slow({ orders: [] }) });
        const run = await runRequiredReads(operation, h.io);
        expect(peak).toBe(2);
        expect(run.reads.map(r => r.status)).toEqual(['read', 'read']);
    });

    it('pickReceiptId: one row, one open row, or nothing', () => {
        const ref = { tool: 'list_my_orders', container: 'orders', field: 'id' };
        expect(pickReceiptId({ orders: [{ id: 'x', status: 'delivered' }] }, ref)).toEqual({ id: 'x' });
        expect(pickReceiptId({ orders: [] }, ref)).toEqual({ reason: 'no_receipt' });
        expect(pickReceiptId({ orders: [{ id: 'a', status: 'cancelled' }, { id: 'b', status: 'cancelled' }] }, ref)).toEqual({ reason: 'ambiguous_receipt' });
    });

    it('trace step: operation, reads, outcome and latency; a skip carries its reason', () => {
        const skipped = buildRequiredReadsTrace({ pilot: 'catalog', verdict: verdict('none', 0.9, 'none'), gate: { run: false, reason: 'fallback:none' }, latencyMs: 12 });
        expect(skipped).toMatchObject({ pilot: 'catalog', operation: 'none', outcome: 'skipped', reason: 'fallback:none', reads: [], latencyMs: 12 });
    });
});
