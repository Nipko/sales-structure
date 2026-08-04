import { BillingWebhookController } from './webhook.controller';

describe('BillingWebhookController', () => {
    it('passes Mercado Pago data.id from the query string into signature verification', async () => {
        const rawBody = JSON.stringify({
            id: 123,
            type: 'payment',
            data: { id: 'body-id-must-not-drive-signature' },
        });
        const headers = {
            'x-signature': 'ts=1704382800,v1=abc',
            'x-request-id': 'request-123',
        };
        const normalized = {
            provider: 'mercadopago',
            providerEventId: 'event-123',
        };
        const provider = {
            verifyWebhookSignature: jest.fn().mockReturnValue(true),
            parseWebhookEvent: jest.fn().mockResolvedValue(normalized),
        };
        const providerFactory = {
            getByName: jest.fn().mockReturnValue(provider),
        };
        const billingService = {
            handleBillingEvent: jest.fn().mockResolvedValue({ processed: true }),
        };
        const redis = {
            acquireLock: jest.fn().mockResolvedValue(true),
            del: jest.fn(),
        };
        const controller = new BillingWebhookController(
            providerFactory as any,
            billingService as any,
            redis as any,
        );

        const result = await controller.receive('mercadopago', headers, {
            rawBody: Buffer.from(rawBody),
            body: JSON.parse(rawBody),
            query: { 'data.id': 'AbC-123' },
        } as any);

        expect(provider.verifyWebhookSignature).toHaveBeenCalledWith(
            rawBody,
            headers,
            { dataId: 'AbC-123' },
        );
        expect(provider.parseWebhookEvent).toHaveBeenCalledWith(rawBody, headers);
        expect(result).toEqual({
            received: true,
            status: 'processed',
            reason: undefined,
        });
    });

    it('passes no dataId when the query value is not a scalar string', async () => {
        const provider = {
            verifyWebhookSignature: jest.fn().mockReturnValue(false),
        };
        const controller = new BillingWebhookController(
            { getByName: jest.fn().mockReturnValue(provider) } as any,
            {} as any,
            { incr: jest.fn().mockResolvedValue(1), expire: jest.fn() } as any,
        );

        await expect(controller.receive('mercadopago', {}, {
            body: {},
            query: { 'data.id': { nested: 'invalid' } },
        } as any)).rejects.toMatchObject({ status: 401 });

        expect(provider.verifyWebhookSignature).toHaveBeenCalledWith(
            '{}',
            {},
            { dataId: undefined },
        );
    });
});
