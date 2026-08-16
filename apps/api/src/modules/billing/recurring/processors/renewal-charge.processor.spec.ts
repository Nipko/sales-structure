import { RenewalChargeProcessor } from './renewal-charge.processor';

describe('RenewalChargeProcessor merchant capacity and source isolation', () => {
    const previousTransactionLimit = process.env.WOMPI_MAX_TRANSACTION_COP_CENTS;

    beforeAll(() => {
        process.env.WOMPI_MAX_TRANSACTION_COP_CENTS = '1000000000'; // COP 10.000.000
    });

    afterAll(() => {
        if (previousTransactionLimit === undefined) {
            delete process.env.WOMPI_MAX_TRANSACTION_COP_CENTS;
        } else {
            process.env.WOMPI_MAX_TRANSACTION_COP_CENTS = previousTransactionLimit;
        }
    });

    const baseAttempt = {
        id: 'attempt-1',
        subscription_id: 'sub-1',
        tenant_id: 'tenant-1',
        provider: 'wompi',
        payment_source_id: 'source-1',
        reference: 'sub_full_ren_20260815_1',
        amount_cents: 27_690_000,
        currency: 'COP',
        scheduled_at: new Date(),
        purpose: 'renewal',
    };

    function harness(attemptPatch: Record<string, unknown> = {}, capacity = true) {
        const attempt = { ...baseAttempt, ...attemptPatch };
        const prisma = {
            billingPaymentSource: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'source-1', tenantId: 'tenant-1', provider: 'wompi',
                    providerSourceId: 'tok-1', kind: 'card', status: 'available',
                }),
            },
            tenant: { findUnique: jest.fn().mockResolvedValue({ billingEmail: 'owner@example.com' }) },
        };
        const engine = {
            reserveForExecution: jest.fn().mockResolvedValue(attempt),
            revalidate: jest.fn().mockResolvedValue({ ok: true }),
            isTooLate: jest.fn().mockReturnValue(false),
            markAttempt: jest.fn().mockResolvedValue(true),
            markProviderPostStarted: jest.fn().mockResolvedValue(true),
            settleApproved: jest.fn().mockResolvedValue(undefined),
            settleFailed: jest.fn(),
            classifyFailure: jest.fn(),
            markIndeterminate: jest.fn(),
        };
        const charging = {
            getAcceptanceContracts: jest.fn().mockResolvedValue({ endUserPolicy: { token: 'a' } }),
            charge: jest.fn().mockResolvedValue({
                providerChargeId: 'txn-1', reference: attempt.reference,
                amountCents: attempt.amount_cents, currency: 'COP', status: 'approved',
            }),
        };
        const providerFactory = { getCharging: jest.fn().mockReturnValue(charging) };
        const capacityService = { reserveDailyCapacity: jest.fn().mockResolvedValue(capacity) };
        const renewalQueue = { add: jest.fn().mockResolvedValue(undefined) };
        const pollQueue = { add: jest.fn() };
        const processor = new RenewalChargeProcessor(
            prisma as any,
            engine as any,
            providerFactory as any,
            capacityService as any,
            renewalQueue as any,
            pollQueue as any,
        );
        return { processor, prisma, engine, charging, capacityService, renewalQueue };
    }

    it.each(['initial', 'renewal', 'upgrade_proration'])(
        'reserves the one platform cap immediately before a %s provider POST',
        async (purpose) => {
            const h = harness({ purpose });
            await h.processor.process({ data: { attemptId: 'attempt-1' }, id: 'job-1' } as any);

            expect(h.capacityService.reserveDailyCapacity).toHaveBeenCalledWith(
                27_690_000,
                'COP',
                'wompi',
                'attempt-1',
                'America/Bogota',
            );
            expect(h.capacityService.reserveDailyCapacity.mock.invocationCallOrder[0])
                .toBeLessThan(h.charging.charge.mock.invocationCallOrder[0]);
            expect(h.engine.markProviderPostStarted.mock.invocationCallOrder[0])
                .toBeLessThan(h.charging.charge.mock.invocationCallOrder[0]);
            expect(h.engine.settleApproved).toHaveBeenCalled();
        },
    );

    it('defers the same durable attempt when capacity is unavailable and moves no money', async () => {
        const h = harness({ purpose: 'upgrade_proration' }, false);
        await h.processor.process({ data: { attemptId: 'attempt-1' }, id: 'job-1' } as any);

        expect(h.charging.charge).not.toHaveBeenCalled();
        expect(h.engine.markProviderPostStarted).not.toHaveBeenCalled();
        expect(h.engine.markAttempt).toHaveBeenCalledWith(
            'attempt-1',
            'scheduled',
            expect.objectContaining({ failureCode: 'daily_capacity_deferred' }),
        );
        expect(h.renewalQueue.add).toHaveBeenCalledWith(
            'charge',
            { attemptId: 'attempt-1' },
            expect.objectContaining({
                jobId: expect.stringContaining('attempt-1-capacity-'),
                delay: expect.any(Number),
            }),
        );
    });

    it('blocks an over-limit upgrade before capacity reservation or provider POST', async () => {
        const h = harness({
            purpose: 'upgrade_proration',
            amount_cents: 1_000_000_001,
        });

        await h.processor.process({ data: { attemptId: 'attempt-1' }, id: 'job-1' } as any);

        expect(h.engine.markAttempt).toHaveBeenCalledWith(
            'attempt-1',
            'scheduled',
            expect.objectContaining({ failureCode: 'wompi_transaction_limit_exceeded' }),
        );
        expect(h.capacityService.reserveDailyCapacity).not.toHaveBeenCalled();
        expect(h.engine.markProviderPostStarted).not.toHaveBeenCalled();
        expect(h.charging.charge).not.toHaveBeenCalled();
    });

    it('requires the source to match both the attempt tenant and provider', async () => {
        const h = harness();
        h.prisma.billingPaymentSource.findFirst.mockResolvedValue(null);
        await h.processor.process({ data: { attemptId: 'attempt-1' }, id: 'job-1' } as any);

        expect(h.prisma.billingPaymentSource.findFirst).toHaveBeenCalledWith({
            where: { id: 'source-1', tenantId: 'tenant-1', provider: 'wompi' },
        });
        expect(h.engine.settleFailed).toHaveBeenCalledWith(
            'attempt-1',
            expect.objectContaining({ statusMessage: 'no_payment_source' }),
            'hard',
        );
        expect(h.charging.charge).not.toHaveBeenCalled();
    });
});
