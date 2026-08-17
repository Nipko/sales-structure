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
