import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BillingWebhookController } from './webhook.controller';

describe('BillingWebhookController', () => {
    it('passes the data.id query string into signature verification', async () => {
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
            provider: 'stripe',
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
            acquireLockToken: jest.fn().mockResolvedValue('lock-token'),
            releaseLockToken: jest.fn().mockResolvedValue(undefined),
        };
        const controller = new BillingWebhookController(
            providerFactory as any,
            billingService as any,
            redis as any,
        );

        const result = await controller.receive('stripe', headers, {
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
        expect(redis.releaseLockToken).toHaveBeenCalledWith(
            'lock:billing:webhook:stripe:event-123',
            'lock-token',
        );
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

        await expect(controller.receive('stripe', {}, {
            body: {},
            query: { 'data.id': { nested: 'invalid' } },
        } as any)).rejects.toMatchObject({ status: 401 });

        expect(provider.verifyWebhookSignature).toHaveBeenCalledWith(
            '{}',
            {},
            { dataId: undefined },
        );
    });

    it('acknowledges a permanently ignored signed update with 200 semantics', async () => {
        const provider = {
            verifyWebhookSignature: jest.fn().mockReturnValue(true),
            parseWebhookEvent: jest.fn().mockRejectedValue(new BadRequestException({
                error: 'wompi_transaction_not_final',
            })),
        };
        const redis = {
            acquireLockToken: jest.fn(),
            incr: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(undefined),
        };
        const controller = new BillingWebhookController(
            { getByName: jest.fn().mockReturnValue(provider) } as any,
            { handleBillingEvent: jest.fn() } as any,
            redis as any,
        );

        await expect(controller.receive('wompi', {}, {
            rawBody: Buffer.from('{}'), body: {}, query: {},
        } as any)).resolves.toEqual({
            received: true,
            status: 'ignored',
            reason: 'wompi_transaction_not_final',
        });
        expect(redis.acquireLockToken).not.toHaveBeenCalled();
    });

    it('returns a retryable 503 when parsing was not durably completed', async () => {
        const provider = {
            verifyWebhookSignature: jest.fn().mockReturnValue(true),
            parseWebhookEvent: jest.fn().mockRejectedValue(new ServiceUnavailableException('Wompi unavailable')),
        };
        const controller = new BillingWebhookController(
            { getByName: jest.fn().mockReturnValue(provider) } as any,
            { handleBillingEvent: jest.fn() } as any,
            {
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(undefined),
            } as any,
        );

        await expect(controller.receive('wompi', {}, {
            rawBody: Buffer.from('{}'), body: {}, query: {},
        } as any)).rejects.toMatchObject({
            status: 503,
            response: expect.objectContaining({ error: 'webhook_parse_retryable' }),
        });
    });

    it('releases the processing lock and returns 503 when dispatch fails', async () => {
        const normalized = { provider: 'wompi', providerEventId: 'event-1' };
        const provider = {
            verifyWebhookSignature: jest.fn().mockReturnValue(true),
            parseWebhookEvent: jest.fn().mockResolvedValue(normalized),
        };
        const redis = {
            acquireLockToken: jest.fn().mockResolvedValue('lock-token'),
            releaseLockToken: jest.fn().mockResolvedValue(undefined),
            incr: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(undefined),
        };
        const controller = new BillingWebhookController(
            { getByName: jest.fn().mockReturnValue(provider) } as any,
            { handleBillingEvent: jest.fn().mockRejectedValue(new Error('database unavailable')) } as any,
            redis as any,
        );

        await expect(controller.receive('wompi', {}, {
            rawBody: Buffer.from('{}'), body: {}, query: {},
        } as any)).rejects.toMatchObject({
            status: 503,
            response: expect.objectContaining({ error: 'webhook_dispatch_retryable' }),
        });
        expect(redis.releaseLockToken).toHaveBeenCalledWith(
            'lock:billing:webhook:wompi:event-1',
            'lock-token',
        );
    });

    it('returns 503 rather than acknowledging a non-durable concurrent claim as duplicate', async () => {
        const normalized = { provider: 'wompi', providerEventId: 'event-2' };
        const billingService = { handleBillingEvent: jest.fn() };
        const redis = {
            acquireLockToken: jest.fn().mockResolvedValue(null),
            releaseLockToken: jest.fn(),
        };
        const controller = new BillingWebhookController(
            { getByName: jest.fn().mockReturnValue({
                verifyWebhookSignature: jest.fn().mockReturnValue(true),
                parseWebhookEvent: jest.fn().mockResolvedValue(normalized),
            }) } as any,
            billingService as any,
            redis as any,
        );

        await expect(controller.receive('wompi', {}, {
            rawBody: Buffer.from('{}'), body: {}, query: {},
        } as any)).rejects.toMatchObject({
            status: 503,
            response: expect.objectContaining({ error: 'webhook_event_in_progress' }),
        });
        expect(billingService.handleBillingEvent).not.toHaveBeenCalled();
        expect(redis.releaseLockToken).not.toHaveBeenCalled();
    });
});
