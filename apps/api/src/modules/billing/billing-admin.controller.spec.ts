import { BillingAdminController } from './billing-admin.controller';

describe('BillingAdminController provider price fingerprints', () => {
    function createController(planOverrides: Record<string, any>) {
        const prisma = {
            billingPlan: {
                findUnique: jest.fn().mockResolvedValue({
                    slug: 'starter',
                    name: 'Starter',
                    priceUsdCents: 4_900,
                    mpPlanId: null,
                    priceLocalOverrides: planOverrides,
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        const mp = {
            createPlan: jest.fn().mockResolvedValue({ providerPlanId: 'new-provider-plan' }),
        };
        const mpConfig = { isConfigured: jest.fn().mockReturnValue(true) };
        const controller = new BillingAdminController(
            {} as any,
            prisma as any,
            {} as any,
            mp as any,
            mpConfig as any,
            {} as any,
            {} as any, // PaymentRoutingService — unused by the sync path under test
            {} as any, // PaymentProviderFactory — idem
        );
        return { controller, prisma, mp };
    }

    it('stores a server-owned monthly amount/currency fingerprint after a real sync', async () => {
        const { controller, prisma, mp } = createController({
            co: { currency: 'COP', amountCents: 27_690_000 },
        });

        await controller.syncPlanToMp(
            'starter',
            { country: ' co ', cycle: 'month' },
            { user: { id: 'admin-id' } },
        );

        expect(prisma.billingPlan.update).toHaveBeenCalledWith({
            where: { slug: 'starter' },
            data: {
                mpPlanId: 'new-provider-plan',
                priceLocalOverrides: {
                    CO: expect.objectContaining({
                        currency: 'COP',
                        amountCents: 27_690_000,
                        mpPlanId: 'new-provider-plan',
                        syncedAmountCents: 27_690_000,
                        syncedCurrency: 'COP',
                    }),
                },
            },
        });
        expect(mp.createPlan).toHaveBeenCalledWith(expect.objectContaining({
            amountCents: 27_690_000,
            currency: 'COP',
            billingInterval: 'month',
        }));
    });

    it('recreates a historical id instead of blessing unverified database state', async () => {
        const { controller, prisma, mp } = createController({
            CO: { currency: 'COP', amountCents: 27_690_000, mpPlanId: 'historical-id' },
        });

        const result = await controller.syncPlanToMp(
            'starter',
            { country: 'CO', cycle: 'month' },
            { user: { id: 'admin-id' } },
        );

        expect(result.data).toMatchObject({ skipped: false, mpPlanId: 'new-provider-plan' });
        expect(mp.createPlan).toHaveBeenCalledTimes(1);
        expect(prisma.billingPlan.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                priceLocalOverrides: expect.objectContaining({
                    CO: expect.objectContaining({
                        mpPlanId: 'new-provider-plan',
                        syncedAmountCents: 27_690_000,
                        syncedCurrency: 'COP',
                    }),
                }),
            }),
        }));
    });

    it('skips only when id and server-owned fingerprint match the configured cycle', async () => {
        const { controller, prisma, mp } = createController({
            CO: {
                currency: 'COP',
                amountCents: 27_690_000,
                mpPlanId: 'verified-id',
                syncedAmountCents: 27_690_000,
                syncedCurrency: 'COP',
            },
        });

        const result = await controller.syncPlanToMp(
            'starter',
            { country: 'CO', cycle: 'month' },
            { user: { id: 'admin-id' } },
        );

        expect(result.data).toMatchObject({ skipped: true, mpPlanId: 'verified-id' });
        expect(mp.createPlan).not.toHaveBeenCalled();
        expect(prisma.billingPlan.update).not.toHaveBeenCalled();
    });

    it('stores an independent annual fingerprint without disturbing monthly metadata', async () => {
        const { controller, prisma } = createController({
            MX: {
                currency: 'MXN',
                amountCents: 100_000,
                mpPlanId: 'monthly-id',
                syncedAmountCents: 100_000,
                syncedCurrency: 'MXN',
                annual: { currency: 'MXN', amountCents: 1_100_000 },
            },
        });

        await controller.syncPlanToMp(
            'starter',
            { country: 'mx', cycle: 'year' },
            { user: { id: 'admin-id' } },
        );

        const update = prisma.billingPlan.update.mock.calls[0][0];
        expect(update.data.priceLocalOverrides.MX).toMatchObject({
            mpPlanId: 'monthly-id',
            syncedAmountCents: 100_000,
            annual: {
                currency: 'MXN',
                amountCents: 1_100_000,
                mpPlanId: 'new-provider-plan',
                syncedAmountCents: 1_100_000,
                syncedCurrency: 'MXN',
            },
        });
        expect(update.data).not.toHaveProperty('mpPlanId');
    });
});
