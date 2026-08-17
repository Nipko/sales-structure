import { createHash } from 'crypto';
import { TenantWompiWebhookService } from './tenant-wompi-webhook.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'opaque-callback-token';
const EVENTS_SECRET = 'prod_events_abcdefghijklmnop';

function event(transactionId = 'transaction-1') {
    const timestamp = 1_781_000_001;
    const checksum = createHash('sha256')
        .update(`${transactionId}${timestamp}${EVENTS_SECRET}`)
        .digest('hex');
    return {
        body: {
            event: 'transaction.updated',
            environment: 'prod',
            data: { transaction: { id: transactionId } },
            timestamp,
            signature: {
                properties: ['transaction.id'],
                checksum,
            },
        },
        checksum,
    };
}

function harness() {
    const tenantPayments = {
        getWompiCredentials: jest.fn().mockResolvedValue({
            publicKey: 'pub_prod_abcdefghijklmnop',
            privateKey: 'prv_prod_abcdefghijklmnop',
            eventsSecret: EVENTS_SECRET,
            environment: 'production',
        }),
    };
    const wompi = {
        getTransaction: jest.fn().mockResolvedValue({
            id: 'transaction-1',
            status: 'APPROVED',
            amountCents: 250_000,
            currency: 'COP',
            paymentLinkId: 'link-1',
            environment: 'production',
        }),
    };
    const store = {
        settleWompiTransaction: jest.fn().mockResolvedValue({
            intent: {
                canonicalReference: 'order:22222222-2222-4222-8222-222222222222',
            },
            status: 'paid',
            transitioned: true,
            duplicate: false,
            kind: 'order',
            entityId: '22222222-2222-4222-8222-222222222222',
        }),
    };
    const events = { emit: jest.fn() };
    const service = new TenantWompiWebhookService(
        tenantPayments as any,
        wompi as any,
        store as any,
        events as any,
    );
    return { service, tenantPayments, wompi, store, events };
}

describe('TenantWompiWebhookService', () => {
    afterEach(() => jest.restoreAllMocks());

    it('settles only the canonical transaction read with the tenant public key', async () => {
        const { service, wompi, store, events } = harness();
        const signed = event();

        await service.process(TENANT, TOKEN, signed.body, signed.checksum);

        expect(wompi.getTransaction).toHaveBeenCalledWith({
            transactionId: 'transaction-1',
            publicKey: 'pub_prod_abcdefghijklmnop',
            environment: 'production',
        });
        expect(store.settleWompiTransaction).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: TENANT,
            eventKey: signed.checksum,
            source: 'webhook',
            transaction: expect.objectContaining({ id: 'transaction-1', status: 'APPROVED' }),
        }));
        expect(events.emit).toHaveBeenCalledWith(
            'tenant_payment.succeeded',
            expect.objectContaining({
                tenantId: TENANT,
                provider: 'wompi',
                providerPaymentId: 'transaction-1',
                providerLinkId: 'link-1',
            }),
        );
    });

    it('acknowledges an unrelated merchant transaction without payment_link_id', async () => {
        const { service, wompi, store, events } = harness();
        wompi.getTransaction.mockResolvedValueOnce({
            id: 'transaction-1',
            status: 'APPROVED',
            amountCents: 250_000,
            currency: 'COP',
            paymentLinkId: undefined,
            environment: 'production',
        });
        const signed = event();

        await expect(service.process(TENANT, TOKEN, signed.body)).resolves.toBeUndefined();

        expect(store.settleWompiTransaction).not.toHaveBeenCalled();
        expect(events.emit).not.toHaveBeenCalled();
    });

    it('durably audits an unknown link and emits a review signal without settling success', async () => {
        const { service, store, events } = harness();
        store.settleWompiTransaction.mockResolvedValueOnce({
            intent: null,
            status: 'ambiguous',
            transitioned: false,
            duplicate: false,
            validationError: 'unknown_payment_link',
        });
        const signed = event();

        await service.process(TENANT, TOKEN, signed.body);

        expect(events.emit).toHaveBeenCalledWith(
            'tenant_payment.validation_failed',
            expect.objectContaining({ reason: 'unknown_payment_link' }),
        );
        expect(events.emit).not.toHaveBeenCalledWith('tenant_payment.succeeded', expect.anything());
    });

    it.each([
        ['duplicate', { status: 'paid', transitioned: false, duplicate: true }],
        ['late approval after refund', { status: 'refunded', transitioned: false, duplicate: false }],
        ['pending', { status: 'pending', transitioned: false, duplicate: false }],
    ])('does not emit a fulfillment event for %s deliveries', async (_label, result) => {
        const { service, store, events } = harness();
        store.settleWompiTransaction.mockResolvedValueOnce({ intent: {}, ...result });
        const signed = event();

        await service.process(TENANT, TOKEN, signed.body);

        expect(events.emit).not.toHaveBeenCalled();
    });

    it('returns a retryable 5xx when canonical lookup or durable persistence fails', async () => {
        const canonical = harness();
        canonical.wompi.getTransaction.mockRejectedValueOnce(new Error('provider down'));
        const signed = event();
        await expect(canonical.service.process(TENANT, TOKEN, signed.body)).rejects.toMatchObject({ status: 503 });

        const persistence = harness();
        persistence.store.settleWompiTransaction.mockRejectedValueOnce(new Error('database down'));
        await expect(persistence.service.process(TENANT, TOKEN, signed.body)).rejects.toMatchObject({ status: 503 });
        expect(persistence.events.emit).not.toHaveBeenCalled();
    });

    it('rejects an invalid callback token, environment or signature before provider reads', async () => {
        const invalidToken = harness();
        invalidToken.tenantPayments.getWompiCredentials.mockResolvedValueOnce(null);
        const signed = event();
        await expect(invalidToken.service.process(TENANT, 'wrong', signed.body)).rejects.toMatchObject({ status: 401 });
        expect(invalidToken.wompi.getTransaction).not.toHaveBeenCalled();

        const invalidEnvironment = harness();
        await expect(invalidEnvironment.service.process(
            TENANT,
            TOKEN,
            { ...signed.body, environment: 'test' },
        )).rejects.toMatchObject({ status: 401 });
        expect(invalidEnvironment.wompi.getTransaction).not.toHaveBeenCalled();

        const invalidSignature = harness();
        await expect(invalidSignature.service.process(
            TENANT,
            TOKEN,
            {
                ...signed.body,
                data: { transaction: { id: 'tampered' } },
            },
        )).rejects.toMatchObject({ status: 401 });
        expect(invalidSignature.wompi.getTransaction).not.toHaveBeenCalled();
    });
});
