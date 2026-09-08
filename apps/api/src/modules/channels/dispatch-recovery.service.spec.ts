import { DispatchRecoveryService } from './dispatch-recovery.service';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const rowOf = (id: string) => ({ id, state: 'prepared' } as any);

describe('DispatchRecoveryService', () => {
    function harness(over: { pending?: Record<string, any[]>; expired?: Record<string, any[]>;
        failing?: string; } = {}) {
        const order: string[] = [];
        const outbox = {
            expireLeases: jest.fn(async (tenantId: string) => {
                order.push(`expire:${tenantId}`);
                if (over.failing === tenantId) throw new Error('schema unavailable');
                return over.expired?.[tenantId] ?? [];
            }),
            pending: jest.fn(async (tenantId: string) => {
                order.push(`pending:${tenantId}`);
                return { schemaName: 'tenant_x', rows: over.pending?.[tenantId] ?? [] };
            }),
            markQueued: jest.fn(async (tenantId: string, ids: string[]) => {
                order.push(`marked:${tenantId}:${ids.join(',')}`); return ids.length;
            }),
        };
        const queue = { enqueueDispatch: jest.fn(async (tenantId: string, dispatchId: string) => {
            order.push(`enqueue:${tenantId}:${dispatchId}`);
        }) };
        const prisma = { tenant: { findMany: jest.fn(async () => [{ id: tenantA }, { id: tenantB }]) } };
        const cronLock = { runExclusive: jest.fn(async (_n: string, _t: number, work: () => Promise<any>) => work()) };
        const service = new DispatchRecoveryService(prisma as any, outbox as any, queue as any, cronLock as any);
        return { service, outbox, queue, order, cronLock };
    }

    it('republishes pending rows and marks them only after publication', async () => {
        const h = harness({ pending: { [tenantA]: [rowOf('d-1'), rowOf('d-2')] } });
        await expect(h.service.recoverPending()).resolves.toEqual({ republished: 2, reconciled: 0 });
        // Marking before publication could hide a lost publish; the safe
        // direction leaves the rows pending and republishes the same ids.
        expect(h.order).toEqual([
            `expire:${tenantA}`, `pending:${tenantA}`,
            `enqueue:${tenantA}:d-1`, `enqueue:${tenantA}:d-2`, `marked:${tenantA}:d-1,d-2`,
            `expire:${tenantB}`, `pending:${tenantB}`,
        ]);
    });

    it('retires lapsed permissions before looking for anything to republish', async () => {
        const h = harness({ expired: { [tenantA]: [rowOf('d-9')] } });
        await expect(h.service.recoverPending()).resolves.toEqual({ republished: 0, reconciled: 1 });
        // A row still holding a permission must never be republished, and this
        // pass is what takes it out of that state.
        expect(h.order.indexOf(`expire:${tenantA}`)).toBeLessThan(h.order.indexOf(`pending:${tenantA}`));
        expect(h.queue.enqueueDispatch).not.toHaveBeenCalled();
    });

    it('publishes nothing and marks nothing when a tenant has no pending work', async () => {
        const h = harness();
        await expect(h.service.recoverPending()).resolves.toEqual({ republished: 0, reconciled: 0 });
        expect(h.outbox.markQueued).not.toHaveBeenCalled();
        expect(h.queue.enqueueDispatch).not.toHaveBeenCalled();
    });

    it('keeps sweeping the other tenants when one of them fails', async () => {
        const h = harness({ failing: tenantA, pending: { [tenantB]: [rowOf('d-3')] } });
        await expect(h.service.recoverPending()).resolves.toEqual({ republished: 1, reconciled: 0 });
        expect(h.queue.enqueueDispatch).toHaveBeenCalledWith(tenantB, 'd-3');
    });

    it('runs on a single instance, because API and worker load the same schedule', async () => {
        const h = harness();
        await h.service.recoverPendingDispatchCron();
        expect(h.cronLock.runExclusive).toHaveBeenCalledWith('dispatch-recovery.recoverPending', 110,
            expect.any(Function), { prefer: 'worker' });
    });
});
