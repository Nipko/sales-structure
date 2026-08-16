import { TenantPaymentsService } from './tenant-payments.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';

function harness() {
    const prisma = {
        tenant: {
            findUnique: jest.fn().mockResolvedValue({
                settings: {
                    tenantPayments: {
                        accessTokenEnc: 'access-enc',
                        webhookSecretEnc: 'secret-enc',
                    },
                },
            }),
            update: jest.fn(),
        },
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_schema'),
        executeInTenantSchema: jest.fn(),
    };
    const redis = {
        set: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue(null),
        del: jest.fn().mockResolvedValue(undefined),
    };
    const crypto = {
        decryptToken: jest.fn((value: string) => value === 'access-enc' ? 'APP_USR-token' : 'webhook-secret'),
        encryptToken: jest.fn((value: string) => `encrypted:${value}`),
    };
    return {
        service: new TenantPaymentsService(prisma as any, redis as any, crypto as any),
        prisma,
        redis,
        crypto,
    };
}

describe('TenantPaymentsService', () => {
    const originalApiUrl = process.env.API_PUBLIC_URL;

    beforeEach(() => {
        process.env.API_PUBLIC_URL = 'https://api.parallly.test/api/v1';
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (originalApiUrl === undefined) delete process.env.API_PUBLIC_URL;
        else process.env.API_PUBLIC_URL = originalApiUrl;
    });

    it('resolves only a purchase owned by the current contact and returns canonical money', async () => {
        const { service, prisma } = harness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([{ amount: '276900.00', currency: 'cop' }]);

        const result = await service.resolveOwnedReference(TENANT, CONTACT, `order:${ORDER}`);

        expect(result).toEqual({
            canonicalReference: `order:${ORDER}`,
            amountCents: 27_690_000,
            currency: 'COP',
        });
        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(
            'tenant_schema',
            expect.stringContaining('target.contact_id = $2::uuid'),
            [ORDER, CONTACT],
        );
    });

    it('rejects a malformed or unsupported reference before querying a tenant schema', async () => {
        const { service, prisma } = harness();

        await expect(service.resolveOwnedReference(TENANT, CONTACT, `appointment:${ORDER}`)).resolves.toBeNull();
        await expect(service.resolveOwnedReference(TENANT, CONTACT, 'order:not-a-uuid')).resolves.toBeNull();

        expect(prisma.getTenantSchemaName).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('creates a tenant-owned Checkout Pro preference with a recoverable operation id', async () => {
        const { service, redis } = harness();
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                id: 'preference-1',
                init_point: 'https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=preference-1',
            }),
        }) as any;

        const link = await service.createPaymentLink(TENANT, {
            amountCents: 27_690_000,
            currency: 'COP',
            description: 'Pedido 3333',
            externalReference: `order:${ORDER}`,
            idempotencyKey: '44444444-4444-4444-8444-444444444444',
        });

        expect(link).toMatchObject({ id: 'preference-1', amountCents: 27_690_000, currency: 'COP' });
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.mercadopago.com/checkout/preferences',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: 'Bearer APP_USR-token' }),
            }),
        );
        const request = (global.fetch as jest.Mock).mock.calls[0][1];
        expect(JSON.parse(request.body)).toMatchObject({
            items: [{ unit_price: 276900, currency_id: 'COP' }],
            external_reference: `order:${ORDER}`,
            notification_url: `https://api.parallly.test/api/v1/tenant-payments/webhook/${TENANT}`,
        });
        expect(redis.set).toHaveBeenCalledWith(
            `tenant_payment_link:idem:${TENANT}:44444444-4444-4444-8444-444444444444`,
            'preference-1',
            7 * 86400,
        );
    });

    it('fails before calling Mercado Pago when a COP amount has fractional pesos', async () => {
        const { service } = harness();
        global.fetch = jest.fn() as any;

        await expect(service.createPaymentLink(TENANT, {
            amountCents: 10_001,
            currency: 'COP',
            description: 'Pedido',
            externalReference: `order:${ORDER}`,
        })).rejects.toMatchObject({ response: { error: 'invalid_zero_decimal_amount' } });

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('never exposes the stored webhook secret in config reads', async () => {
        const { service } = harness();

        const config = await service.getConfig(TENANT);

        expect(config).toMatchObject({ connected: true, webhookConfigured: true, webhookSecret: '***' });
        expect(JSON.stringify(config)).not.toContain('secret-enc');
        expect(JSON.stringify(config)).not.toContain('webhook-secret');
    });
});
