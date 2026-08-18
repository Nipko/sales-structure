import { TenantPaymentReconciliationService } from './tenant-payment-reconciliation.service';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function intent(over: Record<string, unknown> = {}) {
    return {
        id: 'intent-1',
        provider: 'wompi',
        status: 'pending',
        providerLinkId: 'link-1',
        providerTransactionId: undefined,
        amountCents: 250_000,
        ...over,
    } as any;
}

function harness(options: {
    tenants?: Array<{ id: string }>;
    orphansByTenant?: Record<string, any[]>;
    recover?: jest.Mock;
} = {}) {
    const tenants = options.tenants ?? [{ id: TENANT_A }];
    const orphansByTenant = options.orphansByTenant ?? { [TENANT_A]: [intent()] };

    const prisma = { tenant: { findMany: jest.fn().mockResolvedValue(tenants) } };
    const store = {
        findWompiIntentsAwaitingProviderEvidence: jest.fn(async (tenantId: string, _minutes?: number, _limit?: number) => {
            const rows = orphansByTenant[tenantId];
            if (rows === undefined) throw new Error('relation "tenant_payment_intents" does not exist');
            return rows;
        }),
    };
    const payments = {
        recoverWompiIntentFromProvider: options.recover
            ?? jest.fn().mockResolvedValue({ outcome: 'settled', intent: intent({ status: 'paid' }) }),
    };
    // The real lock fails open; the sweep body is what is under test here.
    const cronLock = { runExclusive: jest.fn(async (_n: string, _t: number, fn: () => Promise<unknown>) => { await fn(); }) };

    const service = new TenantPaymentReconciliationService(
        prisma as any,
        store as any,
        payments as any,
        cronLock as any,
    );
    return { service, prisma, store, payments, cronLock };
}

describe('TenantPaymentReconciliationService', () => {
    it('settles an intent whose commerce event never arrived', async () => {
        const h = harness();

        const result = await h.service.reconcileOrphanIntents();

        expect(h.payments.recoverWompiIntentFromProvider)
            .toHaveBeenCalledWith(TENANT_A, expect.objectContaining({ id: 'intent-1' }), 'reconciliation');
        expect(result).toEqual({ scanned: 1, settled: 1 });
    });

    it('does not count an intent nobody has paid yet as settled', async () => {
        const h = harness({
            recover: jest.fn().mockResolvedValue({ outcome: 'no_transaction', intent: null }),
        });

        await expect(h.service.reconcileOrphanIntents()).resolves.toEqual({ scanned: 1, settled: 0 });
    });

    it('does not count an unreachable provider as settled', async () => {
        // 'unavailable' proves nothing. Counting it would let a real payment be
        // written off as reconciled.
        const h = harness({
            recover: jest.fn().mockResolvedValue({ outcome: 'unavailable', intent: null }),
        });

        await expect(h.service.reconcileOrphanIntents()).resolves.toEqual({ scanned: 1, settled: 0 });
    });

    it('does not count an intent that is still pending at the provider', async () => {
        const h = harness({
            recover: jest.fn().mockResolvedValue({ outcome: 'settled', intent: intent({ status: 'pending' }) }),
        });

        await expect(h.service.reconcileOrphanIntents()).resolves.toEqual({ scanned: 1, settled: 0 });
    });

    it('skips tenants that never configured payments instead of aborting the sweep', async () => {
        // Tenant A has no payment tables at all; tenant B must still be swept.
        const h = harness({
            tenants: [{ id: TENANT_A }, { id: TENANT_B }],
            orphansByTenant: { [TENANT_B]: [intent({ id: 'intent-b' })] },
        });

        const result = await h.service.reconcileOrphanIntents();

        expect(result).toEqual({ scanned: 1, settled: 1 });
        expect(h.payments.recoverWompiIntentFromProvider)
            .toHaveBeenCalledWith(TENANT_B, expect.objectContaining({ id: 'intent-b' }), 'reconciliation');
    });

    it('keeps sweeping after one intent throws', async () => {
        const recover = jest.fn()
            .mockRejectedValueOnce(new Error('provider unreachable'))
            .mockResolvedValueOnce({ outcome: 'settled', intent: intent({ status: 'paid' }) });
        const h = harness({
            orphansByTenant: { [TENANT_A]: [intent({ id: 'bad' }), intent({ id: 'good' })] },
            recover,
        });

        await expect(h.service.reconcileOrphanIntents()).resolves.toEqual({ scanned: 2, settled: 1 });
    });

    it('only sweeps intents old enough that the webhook has had its chance', async () => {
        const h = harness();

        await h.service.reconcileOrphanIntents();

        const [, olderThanMinutes] = h.store.findWompiIntentsAwaitingProviderEvidence.mock.calls[0];
        expect(olderThanMinutes).toBeGreaterThanOrEqual(10);
    });

    it('runs the cron body under an exclusive lock (API and worker share AppModule)', async () => {
        const h = harness();

        await h.service.reconcileOrphanIntentsCron();

        expect(h.cronLock.runExclusive).toHaveBeenCalledWith(
            'tenant-payments.reconcileOrphanIntents',
            expect.any(Number),
            expect.any(Function),
            expect.objectContaining({ prefer: 'worker' }),
        );
    });

    it('returns quietly when the tenant list cannot be read', async () => {
        const h = harness();
        h.prisma.tenant.findMany.mockRejectedValue(new Error('db down'));

        await expect(h.service.reconcileOrphanIntents()).resolves.toEqual({ scanned: 0, settled: 0 });
    });
});
