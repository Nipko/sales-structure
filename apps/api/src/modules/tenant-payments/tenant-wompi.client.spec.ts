import { TenantWompiClient, WompiProviderError } from './tenant-wompi.client';

const PUBLIC_KEY = 'pub_prod_abcdefghijklmnop';
const PRIVATE_KEY = 'prv_prod_abcdefghijklmnop';
const INTENT_ID = '11111111-1111-4111-8111-111111111111';
const LINK_ID = 'link-123';
const EXPIRES_AT = new Date('2026-08-17T12:00:00.000Z');

function response(data: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: jest.fn().mockResolvedValue(data),
        text: jest.fn(),
    } as unknown as Response;
}

describe('TenantWompiClient sensitive logging', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('does not read or log a provider error body', async () => {
        const client = new TenantWompiClient();
        const sensitiveBody = 'payer@example.com prv_prod_should-never-be-logged';
        const text = jest.fn().mockResolvedValue(sensitiveBody);
        jest.spyOn(global, 'fetch').mockResolvedValue({
            ok: false,
            status: 422,
            text,
        } as unknown as Response);
        const warn = jest.spyOn((client as any).logger, 'warn').mockImplementation(() => undefined);

        let caught: unknown;
        try {
            await client.createAndVerifyPaymentLink({
                publicKey: 'pub_prod_abcdefghijklmnop',
                privateKey: 'prv_prod_abcdefghijklmnop',
                environment: 'production',
                intentId: '11111111-1111-4111-8111-111111111111',
                amountCents: 100_000,
                description: 'Pago seguro',
                expiresAt: new Date(Date.now() + 60_000),
            });
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(WompiProviderError);
        expect((caught as WompiProviderError).code).toBe('wompi_link_creation_rejected');
        expect(text).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith('Wompi payment link POST failed with HTTP 422');
        expect(JSON.stringify(warn.mock.calls)).not.toContain(sensitiveBody);
    });
});

describe('TenantWompiClient hosted payment links', () => {
    afterEach(() => jest.restoreAllMocks());

    it('creates a COP-only single-use link and shares it only after canonical verification', async () => {
        const client = new TenantWompiClient();
        const fetchMock = jest.spyOn(global, 'fetch')
            .mockResolvedValueOnce(response({ data: { id: LINK_ID } }))
            .mockResolvedValueOnce(response({
                data: {
                    id: LINK_ID,
                    merchant_public_key: PUBLIC_KEY,
                    sku: INTENT_ID,
                    currency: 'COP',
                    amount_in_cents: 250_000,
                    expires_at: EXPIRES_AT.toISOString(),
                    single_use: true,
                    collect_shipping: false,
                    active: true,
                },
            }));

        const link = await client.createAndVerifyPaymentLink({
            publicKey: PUBLIC_KEY,
            privateKey: PRIVATE_KEY,
            environment: 'production',
            intentId: INTENT_ID,
            amountCents: 250_000,
            description: 'Pedido seguro',
            expiresAt: EXPIRES_AT,
        });

        expect(link).toMatchObject({
            id: LINK_ID,
            url: `https://checkout.wompi.co/l/${LINK_ID}`,
            amountCents: 250_000,
            currency: 'COP',
            sku: INTENT_ID,
            merchantPublicKey: PUBLIC_KEY,
            active: true,
        });
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            'https://production.wompi.co/v1/payment_links',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: `Bearer ${PRIVATE_KEY}` }),
            }),
        );
        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(String(request.body))).toEqual({
            name: 'Pedido seguro',
            description: 'Pedido seguro',
            single_use: true,
            collect_shipping: false,
            currency: 'COP',
            amount_in_cents: 250_000,
            sku: INTENT_ID,
            expires_at: EXPIRES_AT.toISOString(),
        });
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            `https://production.wompi.co/v1/payment_links/${LINK_ID}`,
            expect.any(Object),
        );
    });

    it.each([
        ['merchant', { merchant_public_key: 'pub_prod_othermerchantkey' }],
        ['amount', { amount_in_cents: 1 }],
        ['sku', { sku: '22222222-2222-4222-8222-222222222222' }],
    ])('keeps the known provider id for an ambiguous canonical %s mismatch', async (_label, override) => {
        const client = new TenantWompiClient();
        jest.spyOn(global, 'fetch')
            .mockResolvedValueOnce(response({ data: { id: LINK_ID } }))
            .mockResolvedValueOnce(response({
                data: {
                    id: LINK_ID,
                    merchant_public_key: PUBLIC_KEY,
                    sku: INTENT_ID,
                    currency: 'COP',
                    amount_in_cents: 250_000,
                    expires_at: EXPIRES_AT.toISOString(),
                    single_use: true,
                    collect_shipping: false,
                    active: true,
                    ...override,
                },
            }));

        await expect(client.createAndVerifyPaymentLink({
            publicKey: PUBLIC_KEY,
            privateKey: PRIVATE_KEY,
            environment: 'production',
            intentId: INTENT_ID,
            amountCents: 250_000,
            description: 'Pedido',
            expiresAt: EXPIRES_AT,
        })).rejects.toMatchObject({
            code: 'wompi_link_canonical_mismatch',
            ambiguous: true,
            providerLinkId: LINK_ID,
        });
    });

    it('classifies a network failure before receiving a link id as ambiguous', async () => {
        const client = new TenantWompiClient();
        jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('timeout'));
        jest.spyOn((client as any).logger, 'warn').mockImplementation(() => undefined);

        await expect(client.createAndVerifyPaymentLink({
            publicKey: PUBLIC_KEY,
            privateKey: PRIVATE_KEY,
            environment: 'production',
            intentId: INTENT_ID,
            amountCents: 250_000,
            description: 'Pedido',
            expiresAt: EXPIRES_AT,
        })).rejects.toMatchObject({
            code: 'wompi_link_creation_outcome_unknown',
            ambiguous: true,
            providerLinkId: undefined,
        });
    });

    it('accepts canonical merchant transactions that do not belong to a payment link', async () => {
        const client = new TenantWompiClient();
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(response({
            data: {
                id: 'transaction-1',
                status: 'APPROVED',
                amount_in_cents: 250_000,
                currency: 'COP',
                payment_link_id: null,
            },
        }));

        await expect(client.getTransaction({
            transactionId: 'transaction-1',
            publicKey: PUBLIC_KEY,
            environment: 'production',
        })).resolves.toEqual({
            id: 'transaction-1',
            status: 'APPROVED',
            amountCents: 250_000,
            currency: 'COP',
            paymentLinkId: undefined,
            environment: 'production',
        });
    });
});

describe('TenantWompiClient.findTransactionByPaymentLink', () => {
    const client = () => new TenantWompiClient();
    const tx = (over: Record<string, unknown> = {}) => ({
        id: 'txn-1',
        status: 'APPROVED',
        currency: 'COP',
        amount_in_cents: 250_000,
        payment_link_id: LINK_ID,
        ...over,
    });
    const args = {
        providerLinkId: LINK_ID,
        publicKey: PUBLIC_KEY,
        privateKey: PRIVATE_KEY,
        environment: 'production' as const,
    };

    afterEach(() => jest.restoreAllMocks());

    it('recovers the approved transaction of a link whose webhook never arrived', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(response({ data: [tx()] }));

        const found = await client().findTransactionByPaymentLink(args);

        expect(found).toMatchObject({ id: 'txn-1', status: 'APPROVED', amountCents: 250_000, paymentLinkId: LINK_ID });
    });

    it('returns null when nobody has paid the link yet', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(response({ data: [] }));
        await expect(client().findTransactionByPaymentLink(args)).resolves.toBeNull();
    });

    it('never settles a transaction belonging to a different payment link', async () => {
        // If the provider ever ignores the filter and returns the merchant's
        // whole list, trusting it would credit ANOTHER customer's payment
        // against this order.
        jest.spyOn(global, 'fetch').mockResolvedValue(response({
            data: [tx({ id: 'txn-other', payment_link_id: 'link-someone-else' })],
        }));

        await expect(client().findTransactionByPaymentLink(args)).resolves.toBeNull();
    });

    it('prefers APPROVED over an older DECLINED retry on the same link', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(response({
            data: [tx({ id: 'txn-declined', status: 'DECLINED' }), tx({ id: 'txn-approved', status: 'APPROVED' })],
        }));

        const found = await client().findTransactionByPaymentLink(args);

        expect(found).toMatchObject({ id: 'txn-approved', status: 'APPROVED' });
    });

    it('prefers an in-flight PENDING over a DECLINED attempt', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(response({
            data: [tx({ id: 'txn-declined', status: 'DECLINED' }), tx({ id: 'txn-pending', status: 'PENDING' })],
        }));

        expect(await client().findTransactionByPaymentLink(args)).toMatchObject({ id: 'txn-pending' });
    });

    it('rejects a non-list payload instead of reporting "nobody paid"', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(response({ data: { id: 'txn-1' } }));
        await expect(client().findTransactionByPaymentLink(args))
            .rejects.toThrow(WompiProviderError);
    });

    it('drops malformed entries rather than settling an unparseable amount', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(response({
            data: [tx({ amount_in_cents: 'many' }), tx({ currency: 'USD' })],
        }));
        await expect(client().findTransactionByPaymentLink(args)).resolves.toBeNull();
    });

    it('refuses to use credentials from another environment', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch');
        await expect(client().findTransactionByPaymentLink({ ...args, environment: 'sandbox' }))
            .rejects.toMatchObject({ code: 'wompi_environment_mismatch' });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('marks a 5xx as ambiguous so the caller retries instead of closing the intent', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(response(null, false, 502));
        await expect(client().findTransactionByPaymentLink(args))
            .rejects.toMatchObject({ code: 'wompi_transaction_lookup_failed', ambiguous: true });
    });

    it('authenticates the merchant-scoped lookup with the private key', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(response({ data: [] }));

        await client().findTransactionByPaymentLink(args);

        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('production.wompi.co');
        expect(url).toContain(`payment_link_id=${LINK_ID}`);
        expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${PRIVATE_KEY}`);
    });
});
