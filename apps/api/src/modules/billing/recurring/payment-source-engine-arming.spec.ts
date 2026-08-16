import { PaymentSourceService } from './payment-source.service';
import { MERCADOPAGO_CAPABILITIES, WOMPI_CAPABILITIES } from '../adapters/provider-capabilities';
import { SubscriptionStatus } from '../types/subscription-status.enum';

/**
 * El eslabón que faltaba del ciclo de cobro.
 *
 * Con un operador sin suscripciones nativas NADIE cobra si el motor no está
 * encendido, y hasta ahora nada lo encendía: `activateWithEngine` existía pero
 * no tenía un solo llamador. El trial vencía en silencio, con la tarjeta del
 * cliente guardada y sin un intento de cobro.
 */
describe('armar el motor al guardar un método de pago', () => {
    const TENANT = 'tenant-1';
    const SOURCE = 'source-1';

    beforeAll(() => {
        process.env.WOMPI_MAX_TRANSACTION_COP_CENTS = '1000000000'; // COP 10.000.000
    });

    function makeService(sub: any, capabilities = WOMPI_CAPABILITIES) {
        const updates: any[] = [];
        const engine = { claimAttempt: jest.fn().mockResolvedValue({ id: 'attempt-1' }) };
        const queue = { add: jest.fn().mockResolvedValue(undefined) };
        const redis = { del: jest.fn().mockResolvedValue(undefined) };
        const prisma: any = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    billingCountry: 'CO', settings: {}, isInternal: false,
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            billingPlan: { findUnique: jest.fn().mockResolvedValue({ slug: 'starter' }) },
            billingSubscription: {
                findUnique: jest.fn().mockResolvedValue(sub),
                findFirst: jest.fn().mockResolvedValue(sub),
                findMany: jest.fn().mockResolvedValue([]),
                update: jest.fn(async (args: any) => { updates.push(args); return sub; }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            billingPaymentSource: {
                findFirst: jest.fn().mockResolvedValue({
                    id: SOURCE, tenantId: TENANT, status: 'available', supportsUnattended: true,
                }),
            },
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: sub.id }]),
            $transaction: jest.fn(async (callback: any) => callback(prisma)),
        };
        const service = new PaymentSourceService(
            prisma as any,
            redis as any,
            { emit: jest.fn() } as any,
            { capabilitiesOf: () => capabilities } as any,
            {} as any,
            engine as any,
            { getConfig: jest.fn().mockResolvedValue({ fiscalGateEnabled: false }) } as any,
            queue as any,
        );
        return { service, prisma, updates, engine, queue, redis };
    }

    const arm = (service: PaymentSourceService) =>
        (service as any).armEngineForNewSource(TENANT, SOURCE);

    it('durante un trial vigente agenda el cobro para el final, no para ahora', async () => {
        // El cliente tiene días prometidos. Cobrarle por adelantado sólo porque
        // guardó la tarjeta rompería el trato que aceptó.
        const trialEndsAt = new Date(Date.now() + 10 * 86_400_000);
        const { service, updates } = makeService({
            id: 'sub-1', tenantId: TENANT, provider: 'wompi', engine: 'provider',
            status: SubscriptionStatus.TRIALING, trialEndsAt,
            chargeAmountCents: 75_770_000, chargeCurrency: 'COP',
            billingAnchorDay: null, billingTimezone: null,
        });

        await arm(service);

        expect(updates).toHaveLength(1);
        expect(updates[0].data).toMatchObject({
            engine: 'internal',
            defaultPaymentSourceId: SOURCE,
            unattendedCapable: true,
            nextChargeAt: trialEndsAt,
        });
    });

    it('con el trial ya vencido pre-reclama un único initial y sale del barrido hasta settlement', async () => {
        const { service, updates, engine, queue, prisma } = makeService({
            id: 'sub-1', tenantId: TENANT, provider: 'wompi', engine: 'provider',
            status: SubscriptionStatus.PENDING_AUTH,
            trialEndsAt: new Date(Date.now() - 86_400_000),
            chargeAmountCents: 27_690_000, chargeCurrency: 'COP',
        });

        await arm(service);

        expect(updates).toHaveLength(1);
        expect(updates[0].data.engine).toBe('internal');
        expect(updates[0].data.nextChargeAt).toBeNull();
        expect(engine.claimAttempt).toHaveBeenCalledWith(
            expect.objectContaining({ purpose: 'initial' }),
            prisma,
        );
        expect(queue.add).toHaveBeenCalledWith(
            'charge',
            { attemptId: 'attempt-1' },
            expect.objectContaining({ jobId: 'attempt-1' }),
        );
    });

    it('serializa dos callbacks de autorización aunque crucen medianoche UTC', async () => {
        jest.useFakeTimers();
        try {
            const sub = {
                id: 'sub-midnight', tenantId: TENANT, provider: 'wompi', engine: 'provider',
                status: SubscriptionStatus.PENDING_AUTH, trialEndsAt: null,
                chargeAmountCents: 27_690_000, chargeCurrency: 'COP', metadata: { billingCycle: 'monthly' },
            };
            const { service, prisma, engine, queue } = makeService(sub);
            prisma.billingSubscription.findUnique
                .mockResolvedValueOnce(sub) // callback A pre-lock snapshot
                .mockResolvedValueOnce(sub) // callback A row-lock re-read
                .mockResolvedValueOnce(sub) // callback B stale pre-lock snapshot
                .mockResolvedValueOnce({ ...sub, engine: 'internal' }); // sees A commit under lock

            jest.setSystemTime(new Date('2026-08-15T23:59:59.900Z'));
            await arm(service);
            jest.setSystemTime(new Date('2026-08-16T00:00:00.100Z'));
            await arm(service);

            expect(engine.claimAttempt).toHaveBeenCalledTimes(1);
            expect(engine.claimAttempt).toHaveBeenCalledWith(
                expect.objectContaining({
                    operationKey: 'initial-activation:sub-midnight',
                    purpose: 'initial',
                }),
                prisma,
            );
            expect(queue.add).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it.each([SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE])(
        'normaliza una cohorte legacy %s a pending_auth y no concede acceso hasta APPROVED',
        async (legacyStatus) => {
            const { service, updates, prisma, engine, queue, redis } = makeService({
                id: 'sub-legacy', tenantId: TENANT, provider: 'wompi', engine: 'provider',
                providerSubscriptionId: null,
                cancellationReason: null,
                status: legacyStatus,
                trialEndsAt: new Date(Date.now() + 30 * 86_400_000), // stale legacy value: must be ignored
                chargeAmountCents: 27_690_000, chargeCurrency: 'COP',
                planId: 'plan-starter', metadata: { billingCycle: 'monthly' },
            });

            await arm(service);

            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(updates[0].data).toMatchObject({
                engine: 'internal',
                status: SubscriptionStatus.PENDING_AUTH,
                trialEndsAt: null,
                defaultPaymentSourceId: SOURCE,
            });
            expect(prisma.tenant.update).toHaveBeenCalledWith({
                where: { id: TENANT },
                data: expect.objectContaining({
                    subscriptionStatus: SubscriptionStatus.PENDING_AUTH,
                    trialEndsAt: null,
                }),
            });
            expect(engine.claimAttempt).toHaveBeenCalledWith(
                expect.objectContaining({
                    purpose: 'initial',
                    paymentSourceId: SOURCE,
                }),
                prisma,
            );
            expect(queue.add).toHaveBeenCalled();
            expect(redis.del).toHaveBeenCalledWith(`sub_status:${TENANT}`);
        },
    );

    it('no toca una suscripción que el proveedor ya cobra por su cuenta', async () => {
        const { service, updates } = makeService({
            id: 'sub-1', tenantId: TENANT, provider: 'mercadopago', engine: 'provider',
            status: SubscriptionStatus.TRIALING,
            trialEndsAt: new Date(Date.now() + 86_400_000),
            chargeAmountCents: 27_690_000, chargeCurrency: 'COP',
        }, MERCADOPAGO_CAPABILITIES);

        await arm(service);

        expect(updates).toHaveLength(0);
    });

    it('no pisa una suscripción que ya está en el motor — de esa se ocupa el dunning', async () => {
        const { service, updates } = makeService({
            id: 'sub-1', tenantId: TENANT, provider: 'wompi', engine: 'internal',
            status: SubscriptionStatus.PAST_DUE,
            chargeAmountCents: 27_690_000, chargeCurrency: 'COP',
        });

        await arm(service);

        expect(updates).toHaveLength(0);
    });

    it('no arma nada sin precio congelado: adivinarlo sería inventar plata', async () => {
        const { service, updates } = makeService({
            id: 'sub-1', tenantId: TENANT, provider: 'wompi', engine: 'provider',
            status: SubscriptionStatus.TRIALING,
            trialEndsAt: new Date(Date.now() + 86_400_000),
            chargeAmountCents: null, chargeCurrency: null,
        });

        await arm(service);

        expect(updates).toHaveLength(0);
    });

    it('un fallo al armar no tumba el alta del método de pago', async () => {
        const { service, prisma } = makeService({
            id: 'sub-1', tenantId: TENANT, provider: 'wompi', engine: 'provider',
            status: SubscriptionStatus.TRIALING,
            trialEndsAt: new Date(Date.now() + 86_400_000),
            chargeAmountCents: 27_690_000, chargeCurrency: 'COP',
        });
        prisma.billingSubscription.update.mockRejectedValueOnce(new Error('db down'));

        // La tarjeta ya quedó guardada; el barrido de reconciliación recupera.
        await expect(arm(service)).resolves.toBe('pending');
        expect(prisma.billingSubscription.updateMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT },
            data: expect.objectContaining({
                dunningState: 'activation_pending',
                nextChargeAt: expect.any(Date),
            }),
        });
    });

    it('reintenta de forma durable una activación marcada activation_pending', async () => {
        const legacy = {
            id: 'sub-retry', tenantId: TENANT, provider: 'wompi', engine: 'provider',
            providerSubscriptionId: null, cancellationReason: null,
            dunningState: 'activation_pending', status: SubscriptionStatus.ACTIVE,
            trialEndsAt: null, chargeAmountCents: 27_690_000, chargeCurrency: 'COP',
            planId: 'plan-starter', metadata: { billingCycle: 'monthly' },
        };
        const { service, prisma, engine } = makeService(legacy);
        prisma.billingSubscription.findMany.mockResolvedValue([legacy]);

        await expect(service.reconcilePendingActivations()).resolves.toEqual({
            scanned: 1,
            armed: 1,
            failed: 0,
        });
        expect(prisma.billingPaymentSource.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT, provider: 'wompi' }),
        }));
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining(
            'ps.provider = s.provider',
        ));
        expect(engine.claimAttempt).toHaveBeenCalled();
    });

    it('backoffea 50 activaciones bloqueadas y alcanza una recuperable posterior', async () => {
        const base = {
            id: 'sub-base', tenantId: TENANT, provider: 'wompi', engine: 'provider',
            providerSubscriptionId: null, dunningState: 'activation_pending',
            status: SubscriptionStatus.PENDING_AUTH, metadata: {},
        };
        const { service, prisma } = makeService(base);
        const blocked = Array.from({ length: 50 }, (_, index) => ({
            ...base,
            id: `sub-blocked-${index}`,
            tenantId: `tenant-blocked-${index}`,
        }));
        const ready = { ...base, id: 'sub-ready', tenantId: 'tenant-ready' };
        prisma.$queryRawUnsafe
            .mockReset()
            .mockResolvedValueOnce(blocked.map(({ id }) => ({ id })))
            .mockResolvedValueOnce([{ id: ready.id }]);
        prisma.billingSubscription.findMany
            .mockResolvedValueOnce(blocked)
            .mockResolvedValueOnce([ready]);
        jest.spyOn(service as any, 'armEngineForNewSource')
            .mockImplementation(async (tenantId: string) =>
                tenantId === ready.tenantId ? 'armed' : 'pending');

        await expect(service.reconcilePendingActivations()).resolves.toEqual({
            scanned: 51,
            armed: 1,
            failed: 0,
        });
        expect(prisma.billingSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                metadata: expect.objectContaining({ activationNextCheckAt: expect.any(String) }),
            }),
        }));
    });
});
