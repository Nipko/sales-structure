import { drainInboundWorker } from './drain-queue-workers';

/**
 * F4300-61 (production 28/29-oct, Sentry «Inbound job stalled»): on SIGTERM the inbound worker is closed — and its active turn
 * finished — before `app.close()` tears the database and Redis down.
 */
describe('F4300-61 · the inbound worker drains before the app closes', () => {
    it('closes the inbound worker and waits for it', async () => {
        const order: string[] = [];
        const worker = { close: jest.fn(async () => { await new Promise(r => setTimeout(r, 5)); order.push('worker closed'); }) };
        const app = { get: jest.fn(() => ({ worker })) } as any;
        await drainInboundWorker(app, line => order.push(line));
        order.push('app.close');
        expect(worker.close).toHaveBeenCalledTimes(1);
        expect(order[0]).toBe('worker closed');
        expect(order[order.length - 1]).toBe('app.close');
    });

    it('a process without the inbound consumer just goes on', async () => {
        const app = { get: jest.fn(() => { throw new Error('Nest could not find InboundQueueProcessor'); }) } as any;
        await expect(drainInboundWorker(app, () => undefined)).resolves.toBeUndefined();
    });

    it('a failing drain is logged, never thrown', async () => {
        const lines: string[] = [];
        const app = { get: () => ({ worker: { close: async () => { throw new Error('redis gone'); } } }) } as any;
        await drainInboundWorker(app, line => lines.push(line));
        expect(lines.join(' ')).toContain('redis gone');
    });
});
