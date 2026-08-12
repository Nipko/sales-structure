import {
    BadRequestException,
    HttpException,
    PayloadTooLargeException,
    ServiceUnavailableException,
    UnsupportedMediaTypeException,
    UnauthorizedException,
} from '@nestjs/common';
import { EmailWebhookSecurityService } from './email-webhook-security.service';

const SECRET = '8c94404f936ba13bb2757a5473f91ddc915e5a6b7fb63d9c35d373f4082ec99d';

function makeService(overrides: Record<string, string | number | undefined> = {}) {
    const values: Record<string, string | number | undefined> = {
        EMAIL_INBOUND_WEBHOOK_SECRET: SECRET,
        ...overrides,
    };
    const config = {
        get: jest.fn((key: string) => values[key]),
    };
    const redis = {
        incrementRateLimit: jest.fn().mockResolvedValue(1),
    };
    const service = new EmailWebhookSecurityService(config as any, redis as any);
    return { service, redis };
}

function request(secret = SECRET, headers: Record<string, string> = {}) {
    return {
        headers: {
            'x-email-webhook-secret': secret,
            'content-type': 'application/json',
            ...headers,
        },
    };
}

describe('EmailWebhookSecurityService', () => {
    it('fails closed when the runtime secret is absent', async () => {
        const { service, redis } = makeService({ EMAIL_INBOUND_WEBHOOK_SECRET: undefined });

        await expect(service.protect(request(), { envelope: { to: ['inbox@example.com'] } }))
            .rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(redis.incrementRateLimit).not.toHaveBeenCalled();
    });

    it('rejects a missing, wrong or too-short secret before touching Redis', async () => {
        const { service, redis } = makeService();

        await expect(service.protect({ headers: {} }, { envelope: { to: ['inbox@example.com'] } }))
            .rejects.toBeInstanceOf(UnauthorizedException);
        await expect(service.protect(request('wrong'), { envelope: { to: ['inbox@example.com'] } }))
            .rejects.toBeInstanceOf(UnauthorizedException);
        expect(redis.incrementRateLimit).not.toHaveBeenCalled();
    });

    it('supports a configured header name and forwards only bounded adapter fields', async () => {
        const { service, redis } = makeService({
            EMAIL_INBOUND_WEBHOOK_HEADER: 'X-Managed-Email-Secret',
        });
        const body = {
            from: 'Customer <customer@example.com>',
            to: 'attacker@other-tenant.example',
            subject: 'Question',
            text: 'Hello',
            envelope: JSON.stringify({ to: ['inbox@example.com'], from: 'customer@example.com' }),
            attachments: '1',
            attachment1: { arbitrary: 'blob metadata must not be forwarded' },
            unexpected: 'discard me',
        };

        const result = await service.protect(
            { headers: { 'x-managed-email-secret': SECRET, 'content-type': 'application/json; charset=utf-8' } },
            body,
        );

        expect(result).toEqual({
            from: body.from,
            to: 'inbox@example.com',
            subject: body.subject,
            text: body.text,
            envelope: { to: ['inbox@example.com'], from: 'customer@example.com' },
            attachments: '1',
        });
        expect(result).not.toHaveProperty('attachment1');
        expect(result).not.toHaveProperty('unexpected');
        expect(redis.incrementRateLimit).toHaveBeenCalledTimes(2);
    });

    it('rejects declared and actual payloads above the configured ceiling', async () => {
        const { service, redis } = makeService({ EMAIL_INBOUND_MAX_BODY_BYTES: 16_384 });

        await expect(service.protect(
            request(SECRET, { 'content-length': '16385' }),
            { envelope: { to: ['inbox@example.com'] } },
        )).rejects.toBeInstanceOf(PayloadTooLargeException);

        await expect(service.protect(
            request(),
            { envelope: { to: ['inbox@example.com'] }, text: 'x'.repeat(16_385) },
        )).rejects.toBeInstanceOf(PayloadTooLargeException);
        expect(redis.incrementRateLimit).not.toHaveBeenCalled();
    });

    it('rejects malformed or excessive fields before rate limiting', async () => {
        const { service, redis } = makeService();

        await expect(service.protect(request(), { envelope: { to: [{ nested: true }] } }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.protect(request(), { envelope: { to: ['inbox@example.com'] }, subject: 'bad\r\nheader' }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.protect(request(), { envelope: { to: ['inbox@example.com'] }, headers: `Message-ID: <${'x'.repeat(2_049)}>` }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.protect(request(), { envelope: { to: ['inbox@example.com'] }, attachments: 11 }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(redis.incrementRateLimit).not.toHaveBeenCalled();
    });

    it('rate limits authenticated traffic before tenant resolution can occur', async () => {
        const { service, redis } = makeService({
            EMAIL_INBOUND_RATE_LIMIT_PER_MINUTE: 1,
            EMAIL_INBOUND_RECIPIENT_RATE_LIMIT_PER_MINUTE: 1,
        });
        redis.incrementRateLimit.mockResolvedValue(2);

        const error = await service.protect(request(), { envelope: { to: ['inbox@example.com'] } })
            .catch(value => value);

        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(429);
    });

    it('rejects direct provider multipart and accepts authenticated JSON only', async () => {
        const { service, redis } = makeService();

        await expect(service.protect(
            request(SECRET, { 'content-type': 'multipart/form-data; boundary=provider' }),
            { envelope: JSON.stringify({ to: ['inbox@example.com'] }) },
        )).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
        expect(redis.incrementRateLimit).not.toHaveBeenCalled();
    });

    it('requires one canonical envelope recipient and ignores a conflicting display To field', async () => {
        const { service } = makeService();

        await expect(service.protect(request(), { to: 'inbox@example.com' }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.protect(request(), {
            envelope: { to: ['tenant-a@example.com', 'tenant-b@example.com'] },
        })).rejects.toBeInstanceOf(BadRequestException);

        const payload = await service.protect(request(), {
            to: 'attacker@other-tenant.example',
            envelope: { to: ['Inbox <CANONICAL@Example.com>'] },
        });
        expect(payload.envelope).toEqual({ to: ['canonical@example.com'] });
        expect(payload.to).toBe('canonical@example.com');
    });
});
