import { createHmac } from 'crypto';
import { TenantPaymentsWebhookService } from './tenant-payments-webhook.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ENTITY = '22222222-2222-4222-8222-222222222222';
const PAYMENT = '987654321';
const ACCOUNT = '123456789';
const SECRET = 'a-mercadopago-webhook-secret';

function signedHeaders(dataId = PAYMENT) {
    const ts = '1781009491';
    const requestId = 'request-123';
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    const signature = createHmac('sha256', SECRET).update(manifest).digest('hex');
    return { requestId, signature: `ts=${ts},v1=${signature}` };
}

function harness(paymentOverrides: Record<string, unknown> = {}, durableStore?: Record<string, jest.Mock>) {
    const prisma = {
        tenant: {
            findUnique: jest.fn().mockResolvedValue({
                settings: { tenantPayments: { accessTokenEnc: 'encrypted-token' } },
            }),
        },
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_schema'),
        executeInTenantSchema: jest.fn().mockImplementation((_schema: string, sql: string) => {
            if (sql.includes('SELECT')) return [{ amount: '25000.00', currency: 'COP' }];
            return [{ id: ENTITY }];
        }),
    };
    const emitter = { emit: jest.fn() };
    const tenantPayments = {
        getMercadoPagoCredentialCandidates: jest.fn().mockResolvedValue([{
            revision: 1,
            accessToken: 'tenant-access-token',
            webhookSecret: SECRET,
            accountId: ACCOUNT,
            environment: 'production',
        }]),
        recordWebhookHeartbeat: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TenantPaymentsWebhookService(
        prisma as any,
        emitter as any,
        tenantPayments as any,
        durableStore as any,
    );
    const payment = {
        id: PAYMENT,
        collector_id: ACCOUNT,
        status: 'approved',
        external_reference: `order:${ENTITY}`,
        transaction_amount: 25000,
        currency_id: 'COP',
        ...paymentOverrides,
    };
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(payment),
    }) as any;
    return { service, prisma, emitter, tenantPayments };
}

describe('TenantPaymentsWebhookService', () => {
    afterEach(() => jest.restoreAllMocks());

    it('rejects an unsigned callback before reading payment state', async () => {
        const { service, prisma } = harness();

        await expect(service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
        )).rejects.toMatchObject({ status: 401 });

        expect(global.fetch).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('does not lock a pending payment, then persists its approved transition', async () => {
        const { service, prisma, emitter } = harness({ status: 'pending' });
        const headers = signedHeaders();

        await service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
            headers.signature,
            headers.requestId,
        );
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                id: PAYMENT,
                collector_id: ACCOUNT,
                status: 'approved',
                external_reference: `order:${ENTITY}`,
                transaction_amount: 25000,
                currency_id: 'COP',
            }),
        });
        await service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
            headers.signature,
            headers.requestId,
        );

        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(
            'tenant_schema',
            expect.stringContaining('RETURNING id'),
            [ENTITY, 'paid'],
        );
        expect(emitter.emit).toHaveBeenCalledWith('tenant_payment.succeeded', expect.objectContaining({
            tenantId: TENANT,
            entityId: ENTITY,
            providerPaymentId: PAYMENT,
        }));
    });

    it('persists a later refund as a distinct monotonic transition', async () => {
        const { service, prisma } = harness({ status: 'refunded' });
        const headers = signedHeaders();

        await service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
            headers.signature,
            headers.requestId,
        );

        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(
            'tenant_schema',
            expect.stringContaining("$2 = 'refunded'"),
            [ENTITY, 'refunded'],
        );
    });

    it('returns a retryable error when Mercado Pago cannot be queried', async () => {
        const { service, prisma } = harness();
        const headers = signedHeaders();
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 });

        await expect(service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
            headers.signature,
            headers.requestId,
        )).rejects.toMatchObject({ status: 503 });

        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('returns a retryable error when tenant persistence fails', async () => {
        const { service, prisma } = harness();
        const headers = signedHeaders();
        prisma.executeInTenantSchema.mockRejectedValueOnce(new Error('database down'));

        await expect(service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
            headers.signature,
            headers.requestId,
        )).rejects.toMatchObject({ status: 503 });

        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
    });

    it('does not settle or emit success when canonical money differs', async () => {
        const { service, prisma, emitter } = harness({ transaction_amount: 1 });
        const headers = signedHeaders();

        await service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
            headers.signature,
            headers.requestId,
        );

        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        expect(emitter.emit).not.toHaveBeenCalledWith('tenant_payment.succeeded', expect.anything());
        expect(emitter.emit).toHaveBeenCalledWith('tenant_payment.validation_failed', expect.objectContaining({
            providerPaymentId: PAYMENT,
            reason: 'amount_or_currency_mismatch',
        }));
    });

    it('uses a durable compare-and-set so duplicate paid deliveries emit once', async () => {
        const { service, prisma, emitter } = harness();
        const headers = signedHeaders();
        let updates = 0;
        prisma.executeInTenantSchema.mockImplementation((_schema: string, sql: string) => {
            if (sql.includes('SELECT')) return [{ amount: '25000.00', currency: 'COP' }];
            updates++;
            return updates === 1 ? [{ id: ENTITY }] : [];
        });

        await service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
            headers.signature,
            headers.requestId,
        );
        await service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
            headers.signature,
            headers.requestId,
        );

        expect(emitter.emit).toHaveBeenCalledTimes(1);
    });

    it('correlates the canonical preference and settles a new MP durable intent atomically', async () => {
        const store = {
            settleMercadoPagoPayment: jest.fn().mockResolvedValue({
                intent: { canonicalReference: `order:${ENTITY}` },
                status: 'paid',
                transitioned: true,
                duplicate: false,
                kind: 'order',
                entityId: ENTITY,
            }),
            findByProviderLink: jest.fn(),
            findUnresolvedByReference: jest.fn(),
            markCreationState: jest.fn(),
        };
        const { service, prisma, emitter } = harness({}, store);
        const headers = signedHeaders();
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    id: PAYMENT,
                    collector_id: ACCOUNT,
                    status: 'approved',
                    external_reference: `order:${ENTITY}`,
                    transaction_amount: 25000,
                    currency_id: 'COP',
                    order: { id: '123456789' },
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    preference_id: 'preference-1',
                    external_reference: `order:${ENTITY}`,
                }),
            });

        await service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
            headers.signature,
            headers.requestId,
        );

        expect(store.settleMercadoPagoPayment).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: TENANT,
            providerLinkId: 'preference-1',
            providerPaymentId: PAYMENT,
            canonicalReference: `order:${ENTITY}`,
            status: 'paid',
            amountCents: 2_500_000,
            currency: 'COP',
            eventKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        }));
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(emitter.emit).toHaveBeenCalledWith(
            'tenant_payment.succeeded',
            expect.objectContaining({
                provider: 'mercadopago',
                providerLinkId: 'preference-1',
            }),
        );
    });

    it('rejects a canonical payment owned by a different Mercado Pago account', async () => {
        const { service, prisma } = harness({ collector_id: '999999999' });
        const headers = signedHeaders();

        await expect(service.process(
            TENANT,
            { type: 'payment', data: { id: PAYMENT } },
            { type: 'payment', 'data.id': PAYMENT },
            headers.signature,
            headers.requestId,
        )).rejects.toMatchObject({ status: 401 });
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
});
