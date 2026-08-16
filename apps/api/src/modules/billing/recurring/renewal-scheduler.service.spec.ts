import {
    billingLocalDayKey,
    nextBillingLocalDay,
    RenewalSchedulerService,
    wompiTransactionLimitViolation,
} from './renewal-scheduler.service';
import { SubscriptionStatus } from '../types/subscription-status.enum';

describe('RenewalSchedulerService capacity and money units', () => {
    const sub: any = {
        id: 'sub-1',
        tenantId: 'tenant-1',
        provider: 'wompi',
        engine: 'internal',
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date('2026-08-15T14:00:00.000Z'),
        billingAnchorDay: 15,
        billingTimezone: 'America/Bogota',
        chargeAmountCents: 27_690_000, // COP 276.900
        chargeCurrency: 'COP',
        defaultPaymentSourceId: 'src-1',
        metadata: { billingCycle: 'monthly' },
    };

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-08-15T13:00:00.000Z'));
        process.env.WOMPI_MAX_TRANSACTION_COP_CENTS = '1000000000'; // COP 10M
        process.env.WOMPI_DAILY_CAP_COP_CENTS = '8000000000'; // COP 80M (example contract only)
    });

    afterEach(() => jest.useRealTimers());

    function harness(options: {
        evalResults?: number[];
        claims?: Array<any | null>;
        latest?: any[];
        dueSub?: any;
    } = {}) {
        const evalResults = [...(options.evalResults ?? [sub.chargeAmountCents])];
        const claims = [...(options.claims ?? [{ id: 'a1' }])];
        const latest = [...(options.latest ?? [null])];
        const redisClient = { eval: jest.fn(async () => evalResults.shift() ?? sub.chargeAmountCents) };
        const prisma: any = {
            billingSubscription: {
                findMany: jest.fn().mockResolvedValue([options.dueSub ?? sub]),
                update: jest.fn().mockResolvedValue({}),
            },
            billingChargeAttempt: {
                findFirst: jest.fn(async () => latest.shift() ?? null),
                update: jest.fn().mockResolvedValue({}),
            },
            $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
        };
        const engine = {
            computeNextCycle: jest.fn().mockReturnValue({
                periodStart: sub.currentPeriodEnd,
                periodEnd: new Date('2026-09-15T14:00:00.000Z'),
                scheduledAt: new Date('2026-08-15T14:00:00.000Z'),
                timezone: 'America/Bogota',
            }),
            claimAttempt: jest.fn(async () => claims.shift() ?? null),
        };
        const queue = { add: jest.fn().mockResolvedValue({}), getJob: jest.fn() };
        const service = new RenewalSchedulerService(
            prisma,
            { getClient: () => redisClient } as any,
            {} as any,
            engine as any,
            queue as any,
        );
        return { service, prisma, engine, queue, redisClient };
    }

    it('interprets configured limits as COP cents, not whole COP', () => {
        expect(wompiTransactionLimitViolation(999_999_999, 'COP')).toBeNull();
        expect(wompiTransactionLimitViolation(1_000_000_001, 'COP')).toMatchObject({
            error: 'wompi_transaction_limit_exceeded',
            limitCents: 1_000_000_000,
        });
        delete process.env.WOMPI_MAX_TRANSACTION_COP_CENTS;
        expect(wompiTransactionLimitViolation(1, 'COP')).toMatchObject({
            error: 'wompi_transaction_limit_not_configured',
        });
    });

    it('uses the Bogotá merchant day instead of the UTC day', () => {
        const instant = new Date('2026-08-16T04:30:00.000Z'); // Aug 15, 23:30 Bogotá
        expect(billingLocalDayKey(instant, 'America/Bogota')).toBe('2026-08-15');
        expect(nextBillingLocalDay(instant, 'America/Bogota').toISOString())
            .toBe('2026-08-16T14:00:00.000Z');
    });

    it('does not reserve capacity when a twin cron loses the durable claim', async () => {
        const h = harness({ claims: [{ id: 'a1' }, null], latest: [null, null] });
        await h.service.scheduleRenewals();
        await h.service.scheduleRenewals();
        // Capacity is reserved by the worker immediately before the provider
        // POST so initial and upgrade attempts cannot bypass the same ceiling.
        expect(h.redisClient.eval).not.toHaveBeenCalled();
        expect(h.queue.add).toHaveBeenCalledTimes(1);
    });

    it('uses a new merchant-day bucket when a capped attempt runs the next day', async () => {
        const h = harness({
            evalResults: [-1, sub.chargeAmountCents],
        });

        await expect(h.service.reserveDailyCapacity(
            sub.chargeAmountCents, 'COP', 'wompi', 'a1', 'America/Bogota',
        )).resolves.toBe(false);

        jest.setSystemTime(new Date('2026-08-16T13:00:00.000Z'));
        await expect(h.service.reserveDailyCapacity(
            sub.chargeAmountCents, 'COP', 'wompi', 'a1', 'America/Bogota',
        )).resolves.toBe(true);

        expect(h.redisClient.eval).toHaveBeenCalledTimes(2);
        const evalCalls = h.redisClient.eval.mock.calls as any[][];
        expect(String(evalCalls[0][3])).toContain('2026-08-15');
        expect(String(evalCalls[1][3])).toContain('2026-08-16');
    });

    it('fails closed when Redis cannot prove remaining merchant capacity', async () => {
        const h = harness();
        h.redisClient.eval.mockRejectedValueOnce(new Error('redis down'));

        await expect(h.service.reserveDailyCapacity(
            sub.chargeAmountCents, 'COP', 'wompi', 'a1', 'America/Bogota',
        )).resolves.toBe(false);
    });

    it('recovers a zero-day pending_auth initial on its current period, never the following month', async () => {
        const currentPeriodStart = new Date('2026-08-15T13:00:00.000Z');
        const currentPeriodEnd = new Date('2026-09-15T13:00:00.000Z');
        const pending = {
            ...sub,
            status: SubscriptionStatus.PENDING_AUTH,
            currentPeriodStart,
            currentPeriodEnd,
            nextChargeAt: new Date('2026-08-15T13:00:00.000Z'),
        };
        const h = harness({ dueSub: pending, latest: [null] });

        await h.service.scheduleRenewals();

        expect(h.engine.claimAttempt).toHaveBeenCalledWith(expect.objectContaining({
            purpose: 'initial',
            periodStart: currentPeriodStart,
            periodEnd: currentPeriodEnd,
        }));
    });

    it('does not create a second initial while the zero-day attempt is unresolved', async () => {
        const pending = {
            ...sub,
            status: SubscriptionStatus.PENDING_AUTH,
            currentPeriodStart: new Date('2026-08-15T13:00:00.000Z'),
            currentPeriodEnd: new Date('2026-09-15T13:00:00.000Z'),
            nextChargeAt: new Date('2026-08-15T13:00:00.000Z'),
        };
        const h = harness({
            dueSub: pending,
            latest: [{ id: 'initial-1', status: 'scheduled', attemptNumber: 1 }],
        });

        await h.service.scheduleRenewals();

        expect(h.engine.claimAttempt).not.toHaveBeenCalled();
        expect(h.queue.add).not.toHaveBeenCalled();
    });
});
