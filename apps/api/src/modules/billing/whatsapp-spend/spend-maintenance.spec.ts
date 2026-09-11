import * as fs from 'fs';
import * as path from 'path';
import { WhatsappSpendMaintenanceService } from './whatsapp-spend-maintenance.service';

/**
 * ═══ A SWEEP WITH NO CALLER IS NOT A SWEEP ═══
 *
 * `sweep()`, `sweepTransmissions()` and the reconciler all existed and all ran
 * nowhere. That is this repository's oldest failure — a correct implementation
 * nothing reaches — and for the ledger it has a specific cost: a worker that
 * dies holding the right to send leaves a message owed to a customer that
 * nobody may claim, and a reservation past its lease keeps its ceiling occupied
 * for ever.
 *
 * So these tests are about the CALLER, not the queries. That one pass covers
 * every tenant, that a broken tenant cannot starve the others, that the numbers
 * an operator reads are the numbers the passes returned, and that it runs under
 * a lock — because every `@Cron` in this application runs twice, once in the
 * API and once in the worker.
 */
describe('the pass that keeps the ledger honest', () => {
    const tenants = [
        { id: 't1', schemaName: 'tenant_one' },
        { id: 't2', schemaName: 'tenant_two' },
    ];

    function harness(over: Record<string, any> = {}) {
        const prisma = { tenant: { findMany: jest.fn(async () => tenants) } };
        const spend = {
            sweepTransmissions: jest.fn(async () => ({ recovered: ['a'], uncertain: ['b', 'c'] })),
            sweep: jest.fn(async () => ['d', 'e']),
            reconcile: jest.fn(async () => ({ settled: 3, settledMinor: 900, needsPerson: 1 })),
            ...over,
        };
        const cronLock = { runExclusive: jest.fn(async (_n: string, _t: number, fn: any) => fn()) };
        const incidents = { record: jest.fn(async (..._args: unknown[]) => undefined) };
        const service = new WhatsappSpendMaintenanceService(
            prisma as any, spend as any, cronLock as any, incidents as any);
        jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
        return { service, prisma, spend, cronLock, incidents };
    }

    it('sweeps every tenant that has a WhatsApp number', async () => {
        const h = harness();
        const totals = await h.service.sweepEveryTenant();

        expect(h.spend.sweepTransmissions).toHaveBeenCalledTimes(2);
        expect(h.spend.sweep).toHaveBeenCalledTimes(2);
        expect(h.spend.reconcile).toHaveBeenCalledTimes(2);
        expect(totals).toMatchObject({
            tenants: 2, recovered: 2, uncertain: 4, expired: 4,
            reconciled: 6, needsPerson: 2, failed: 0, skipped: 0,
        });
    });

    it('looks for tenants by their connection, not by rows they already have', async () => {
        // A tenant whose very first send crashed has a channel account and no
        // ledger rows at all. A query that started from the reservations table
        // would skip precisely the tenant that needs sweeping most.
        const h = harness();
        await h.service.sweepEveryTenant();
        expect(h.prisma.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                isActive: true,
                channelAccounts: { some: { channelType: 'whatsapp' } },
            }),
        }));
    });

    it('keeps going when one tenant throws, and rests that one', async () => {
        const h = harness({
            sweep: jest.fn(async (schema: string) => {
                if (schema === 'tenant_one') throw new Error('schema unreachable');
                return ['d'];
            }),
        });

        const first = await h.service.sweepEveryTenant(new Date('2026-10-05T10:00:00Z'));
        expect(first.failed).toBe(1);
        // The second tenant was still swept: one broken schema must not stop
        // every other business's ceilings from being freed.
        expect(first.expired).toBe(1);

        // A minute later the broken one is skipped rather than retried into the
        // same failure, and the healthy one is swept again.
        h.spend.sweep.mockClear();
        const second = await h.service.sweepEveryTenant(new Date('2026-10-05T10:01:00Z'));
        expect(second.skipped).toBe(1);
        expect(h.spend.sweep).toHaveBeenCalledTimes(1);
        expect(h.spend.sweep).toHaveBeenCalledWith('tenant_two', expect.any(Number));

        // And eleven minutes later it is tried again: a backoff that never ends
        // is a tenant that silently stops being maintained.
        const third = await h.service.sweepEveryTenant(new Date('2026-10-05T10:12:00Z'));
        expect(third.skipped).toBe(0);
        expect(third.tenants).toBe(2);
    });

    it('runs under a lock, because every cron in this application runs twice', async () => {
        // The API and the worker both load `AppModule`. Two processes sweeping
        // the same schema would not corrupt anything — the writers are
        // idempotent — but they would double every query on a pass that exists
        // to be cheap, and the lock is how the other 47 crons already do it.
        const h = harness();
        await h.service.run();
        expect(h.cronLock.runExclusive).toHaveBeenCalledWith(
            'whatsapp-spend.maintenance', expect.any(Number), expect.any(Function),
            { prefer: 'worker' });
    });

    it('raises an incident for what a person has to decide, and for what we broke', async () => {
        const h = harness({
            sweep: jest.fn(async (schema: string) => {
                if (schema === 'tenant_one') throw new Error('schema unreachable');
                return [];
            }),
        });
        await h.service.sweepEveryTenant();

        const keys = h.incidents.record.mock.calls.map((call: any[]) => call[0]);
        expect(keys).toContain('whatsapp_spend_maintenance_failing');
        expect(keys).toContain('whatsapp_spend_awaiting_resolution');
    });

    it('says nothing when there is nothing to say', async () => {
        const h = harness({
            sweepTransmissions: jest.fn(async () => ({ recovered: [], uncertain: [] })),
            sweep: jest.fn(async () => []),
            reconcile: jest.fn(async () => ({ settled: 0, settledMinor: 0, needsPerson: 0 })),
        });
        await h.service.sweepEveryTenant();
        expect(h.incidents.record).not.toHaveBeenCalled();
    });

    it('still sweeps when no incident writer is wired', async () => {
        // The alert is a nice-to-have; the sweep is not. Reversing that — no
        // sweep because no Ops Center — is how the money stops being maintained
        // in exactly the deployment that is already degraded.
        const prisma = { tenant: { findMany: jest.fn(async () => tenants) } };
        const spend = {
            sweepTransmissions: jest.fn(async () => ({ recovered: [], uncertain: [] })),
            sweep: jest.fn(async () => []),
            reconcile: jest.fn(async () => ({ settled: 0, settledMinor: 0, needsPerson: 5 })),
        };
        const service = new WhatsappSpendMaintenanceService(
            prisma as any, spend as any,
            { runExclusive: jest.fn() } as any, undefined);
        jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

        await expect(service.sweepEveryTenant()).resolves.toMatchObject({ tenants: 2 });
    });

    it('is registered where a scheduler will actually find it', () => {
        // The whole point. A provider nothing declares is the same as a sweep
        // nothing calls, and this file is the only place that difference shows
        // up before production.
        const module = fs.readFileSync(
            path.join(__dirname, 'whatsapp-spend.module.ts'), 'utf8');
        expect(module).toContain('WhatsappSpendMaintenanceService');
    });
});
