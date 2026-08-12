import { UnauthorizedException } from '@nestjs/common';
import { EmailWebhookController } from './email-webhook.controller';
import { EmailAdapter } from './email.adapter';
import { EmailChannelService } from './email-channel.service';
import { InboundQueueService } from '../../inbound/inbound-queue.service';

function makeResponse() {
    return {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
    };
}

function makeController() {
    const gateway = {
        processIncomingWebhook: jest.fn().mockResolvedValue({
            id: 'message-1',
            tenantId: '',
            contactId: 'customer@example.com',
            metadata: { emailSubject: 'Question' },
        }),
    };
    const redis = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        acquireLockToken: jest.fn().mockResolvedValue('lock-token'),
        releaseLockToken: jest.fn().mockResolvedValue(undefined),
    };
    const emailChannel = {
        findTenantByInboundEmail: jest.fn().mockResolvedValue('tenant-1'),
    };
    const inboundQueue = {
        enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const security = {
        protect: jest.fn().mockImplementation(async (_request, body) => body),
    };
    const controller = new EmailWebhookController(
        gateway as any,
        redis as any,
        emailChannel as any,
        inboundQueue as any,
        security as any,
    );
    return { controller, gateway, redis, emailChannel, inboundQueue, security };
}

describe('EmailWebhookController security order', () => {
    it('does not resolve a tenant, claim idempotency or enqueue when authentication fails', async () => {
        const { controller, gateway, redis, emailChannel, inboundQueue, security } = makeController();
        security.protect.mockRejectedValue(new UnauthorizedException());

        await expect(controller.receiveInboundEmail(
            { headers: {} } as any,
            { to: 'inbox@example.com' },
            makeResponse() as any,
        )).rejects.toBeInstanceOf(UnauthorizedException);

        expect(emailChannel.findTenantByInboundEmail).not.toHaveBeenCalled();
        expect(redis.acquireLockToken).not.toHaveBeenCalled();
        expect(gateway.processIncomingWebhook).not.toHaveBeenCalled();
        expect(inboundQueue.enqueue).not.toHaveBeenCalled();
    });

    it('routes only by envelope.to, queues, then marks tenant-scoped idempotency complete', async () => {
        const { controller, gateway, redis, emailChannel, inboundQueue, security } = makeController();
        const operationalLog = jest.spyOn((controller as any).logger, 'log').mockImplementation();
        const response = makeResponse();
        const body = {
            from: 'Customer <customer@example.com>',
            to: 'attacker@other-tenant.example',
            envelope: { to: ['inbox@example.com'] },
            subject: 'Question',
            text: 'Hello',
            headers: 'Message-ID: <provider-message-1@example.com>',
        };

        await controller.receiveInboundEmail(
            { headers: { 'x-email-webhook-secret': 'redacted' } } as any,
            body,
            response as any,
        );

        expect(security.protect).toHaveBeenCalledWith(expect.anything(), body);
        expect(redis.acquireLockToken).toHaveBeenCalledWith(
            expect.stringMatching(/^lock:email:tenant-1:[a-f0-9]{64}$/),
            300,
        );
        expect(emailChannel.findTenantByInboundEmail).toHaveBeenCalledWith('inbox@example.com');
        expect(gateway.processIncomingWebhook).toHaveBeenCalledWith('email', body, 'inbox@example.com');
        expect(inboundQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1' }));
        expect(redis.set).toHaveBeenCalledWith(
            expect.stringMatching(/^idem:email:tenant-1:[a-f0-9]{64}$/),
            '1',
            86400,
        );
        expect(inboundQueue.enqueue.mock.invocationCallOrder[0])
            .toBeLessThan(redis.set.mock.invocationCallOrder[0]);
        expect(redis.releaseLockToken).toHaveBeenCalledWith(
            expect.stringMatching(/^lock:email:tenant-1:[a-f0-9]{64}$/),
            'lock-token',
        );
        expect(operationalLog).toHaveBeenCalledWith(expect.stringMatching(
            /^Incoming email accepted routeHash=[a-f0-9]{16} messageHash=[a-f0-9]{16}$/,
        ));
        const logged = operationalLog.mock.calls.flat().join(' ');
        expect(logged).not.toMatch(/tenant-1|customer@example\.com|inbox@example\.com|Question/);
        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.send).toHaveBeenCalledWith('OK');
    });

    it('does not mark a failed enqueue complete and accepts the provider retry', async () => {
        const { controller, redis, inboundQueue } = makeController();
        const response = makeResponse();
        inboundQueue.enqueue.mockRejectedValueOnce(new Error('Redis unavailable'));
        const body = {
            from: 'customer@example.com',
            envelope: { to: ['inbox@example.com'] },
            text: 'Hello',
            headers: 'Message-ID: <retryable@example.com>',
        };

        await controller.receiveInboundEmail({ headers: {} } as any, body, response as any);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.send).toHaveBeenCalledWith('retry');
        expect(redis.set).not.toHaveBeenCalled();
        expect(redis.releaseLockToken).toHaveBeenCalledTimes(1);

        const retryResponse = makeResponse();
        await controller.receiveInboundEmail({ headers: {} } as any, body, retryResponse as any);

        expect(inboundQueue.enqueue).toHaveBeenCalledTimes(2);
        expect(redis.acquireLockToken).toHaveBeenCalledTimes(2);
        expect(redis.set).toHaveBeenCalledWith(
            expect.stringMatching(/^idem:email:tenant-1:[a-f0-9]{64}$/),
            '1',
            86400,
        );
        expect(retryResponse.status).toHaveBeenCalledWith(200);
    });

    it('reuses the same BullMQ identity when the completed marker fails after enqueue', async () => {
        const { gateway, redis, emailChannel, security } = makeController();
        const adapter = new EmailAdapter({} as any, {} as any, {} as any, {} as any);
        gateway.processIncomingWebhook.mockImplementation(
            async (_channel: string, payload: unknown, accountId: string) =>
                adapter.handleWebhook(payload, accountId),
        );

        const acceptedJobIds = new Set<string>();
        const bullQueue = {
            add: jest.fn().mockImplementation(async (_name, _data, options) => {
                acceptedJobIds.add(options.jobId);
            }),
        };
        const throttle = { getPriority: jest.fn().mockResolvedValue(10) };
        const durableInboundQueue = new InboundQueueService(bullQueue as any, throttle as any);
        const controller = new EmailWebhookController(
            gateway as any,
            redis as any,
            emailChannel as any,
            durableInboundQueue,
            security as any,
        );
        redis.set
            .mockRejectedValueOnce(new Error('completed marker unavailable'))
            .mockResolvedValueOnce(undefined);
        const body = {
            from: 'customer@example.com',
            envelope: { to: ['inbox@example.com'] },
            text: 'Hello',
            // No raw headers: exercises the managed JSON fallback explicitly.
            'message-id': '  <stable-json-id@example.com>  ',
        };

        const firstResponse = makeResponse();
        await controller.receiveInboundEmail({ headers: {} } as any, body, firstResponse as any);
        expect(firstResponse.status).toHaveBeenCalledWith(500);

        const retryResponse = makeResponse();
        await controller.receiveInboundEmail({ headers: {} } as any, body, retryResponse as any);

        expect(bullQueue.add).toHaveBeenCalledTimes(2);
        const jobIds = bullQueue.add.mock.calls.map(call => call[2].jobId);
        expect(jobIds[0]).toBe(jobIds[1]);
        expect(jobIds[0]).toContain('stable-json-id-example.com');
        expect(acceptedJobIds.size).toBe(1);
        const normalizedMessages = bullQueue.add.mock.calls.map(call => call[1].msg);
        expect(normalizedMessages[0].metadata.emailMessageId).toBe('<stable-json-id@example.com>');
        expect(normalizedMessages[1].metadata.emailMessageId).toBe('<stable-json-id@example.com>');
        expect(retryResponse.status).toHaveBeenCalledWith(200);
    });

    it('does not collide when two tenants use the same provider Message-ID', async () => {
        const { controller, redis, emailChannel } = makeController();
        emailChannel.findTenantByInboundEmail
            .mockResolvedValueOnce('tenant-a')
            .mockResolvedValueOnce('tenant-b');
        const common = {
            from: 'customer@example.com',
            text: 'Hello',
            headers: 'Message-ID: <same-provider-id@example.com>',
        };

        await controller.receiveInboundEmail(
            { headers: {} } as any,
            { ...common, envelope: { to: ['a@example.com'] } },
            makeResponse() as any,
        );
        await controller.receiveInboundEmail(
            { headers: {} } as any,
            { ...common, envelope: { to: ['b@example.com'] } },
            makeResponse() as any,
        );

        const keys = redis.acquireLockToken.mock.calls.map(call => call[0]);
        expect(keys[0]).toMatch(/^lock:email:tenant-a:/);
        expect(keys[1]).toMatch(/^lock:email:tenant-b:/);
        expect(keys[0]).not.toBe(keys[1]);
    });

    it('returns retry while the same tenant/message is being processed', async () => {
        const { controller, redis, inboundQueue } = makeController();
        redis.acquireLockToken.mockResolvedValue(null);
        const response = makeResponse();

        await controller.receiveInboundEmail(
            { headers: {} } as any,
            {
                envelope: { to: ['inbox@example.com'] },
                headers: 'Message-ID: <concurrent@example.com>',
            },
            response as any,
        );

        expect(response.status).toHaveBeenCalledWith(503);
        expect(response.send).toHaveBeenCalledWith('retry');
        expect(inboundQueue.enqueue).not.toHaveBeenCalled();
        expect(redis.set).not.toHaveBeenCalled();
    });

    it('does not process a recipient whose active tenant route is ambiguous', async () => {
        const { controller, gateway, emailChannel, inboundQueue } = makeController();
        emailChannel.findTenantByInboundEmail.mockResolvedValue(null);
        const response = makeResponse();

        await controller.receiveInboundEmail(
            { headers: {} } as any,
            { from: 'customer@example.com', envelope: { to: ['shared@example.com'] } },
            response as any,
        );

        expect(response.status).toHaveBeenCalledWith(200);
        expect(gateway.processIncomingWebhook).not.toHaveBeenCalled();
        expect(inboundQueue.enqueue).not.toHaveBeenCalled();
    });
});

describe('EmailChannelService inbound routing', () => {
    it('queries up to two matches and fails closed with a PII-free audit when ambiguous', async () => {
        const prisma = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([
                { tenant_id: 'tenant-a' },
                { tenant_id: 'tenant-b' },
            ]),
        };
        const redis = { get: jest.fn().mockResolvedValue('1') };
        const service = new EmailChannelService(prisma as any, redis as any);
        const audit = jest.spyOn((service as any).logger, 'error').mockImplementation();

        const result = await service.findTenantByInboundEmail('shared@example.com');

        expect(result).toBeNull();
        expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toMatch(/ORDER BY tenant_id\s+LIMIT 2/);
        expect(audit).toHaveBeenCalledWith(expect.stringMatching(
            /^\[AUDIT\] Ambiguous inbound email route rejected recipientHash=[a-f0-9]{16} matches=2$/,
        ));
        expect(audit.mock.calls[0][0]).not.toContain('shared@example.com');
    });
});
