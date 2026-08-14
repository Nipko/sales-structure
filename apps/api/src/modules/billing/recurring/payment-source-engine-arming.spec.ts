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

    function makeService(sub: any, capabilities = WOMPI_CAPABILITIES) {
        const updates: any[] = [];
        const prisma = {
            billingSubscription: {
                findUnique: jest.fn().mockResolvedValue(sub),
                findFirst: jest.fn().mockResolvedValue(sub),
                update: jest.fn(async (args: any) => { updates.push(args); return sub; }),
            },
            billingPaymentSource: {
                findFirst: jest.fn().mockResolvedValue({
                    id: SOURCE, tenantId: TENANT, status: 'available', supportsUnattended: true,
                }),
            },
        };
        const service = new PaymentSourceService(
            prisma as any,
            {} as any,
            { emit: jest.fn() } as any,
            { capabilitiesOf: () => capabilities } as any,
            {} as any,
            {} as any,
            { add: jest.fn() } as any,
        );
        return { service, prisma, updates };
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

    it('con el trial ya vencido cobra en el próximo barrido', async () => {
        const { service, updates } = makeService({
            id: 'sub-1', tenantId: TENANT, provider: 'wompi', engine: 'provider',
            status: SubscriptionStatus.PENDING_AUTH,
            trialEndsAt: new Date(Date.now() - 86_400_000),
            chargeAmountCents: 27_690_000, chargeCurrency: 'COP',
        });

        await arm(service);

        expect(updates).toHaveLength(1);
        expect(updates[0].data.engine).toBe('internal');
        expect(updates[0].data.nextChargeAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    });

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
        await expect(arm(service)).resolves.toBeUndefined();
    });
});
