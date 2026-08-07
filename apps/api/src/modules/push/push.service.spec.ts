import { BadRequestException, ConflictException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { prepareTrustedWebPushTarget, PushService } from './push.service';

describe('PushService outbound endpoint policy', () => {
    let lookupSpy: jest.SpyInstance;

    beforeEach(() => {
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.50', family: 4 },
        ] as any);
    });

    afterEach(() => {
        lookupSpy.mockRestore();
    });

    it.each([
        'https://fcm.googleapis.com/fcm/send/subscription-id',
        'https://updates.push.services.mozilla.com/wpush/v2/subscription-id',
        'https://web.push.apple.com/subscription-id',
        'https://wns2-bl2p.notify.windows.com/w/?token=subscription-id',
        'https://standards-compliant-push.example/subscription-id',
    ])('accepts and pins a public HTTPS push endpoint: %s', async (endpoint) => {
        const target = await prepareTrustedWebPushTarget(endpoint);
        expect(target.url.toString()).toBe(endpoint);
        expect(target.address).toBe('203.0.114.50');
        target.httpsAgent.destroy();
    });

    it.each([
        'http://fcm.googleapis.com/fcm/send/id',
        'https://fcm.googleapis.com:8443/fcm/send/id',
        'https://127.0.0.1/push',
        'https://metadata.google.internal/latest/meta-data',
    ])('rejects unsafe push endpoint syntax before delivery: %s', async (endpoint) => {
        await expect(prepareTrustedWebPushTarget(endpoint)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a hostname with any private DNS answer', async () => {
        lookupSpy.mockResolvedValue([
            { address: '203.0.114.50', family: 4 },
            { address: '169.254.169.254', family: 4 },
        ] as any);

        await expect(prepareTrustedWebPushTarget('https://push.example/subscription-id'))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('normalizes and validates the endpoint before persistence', async () => {
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ endpoint: 'https://push.example/subscription-id' }]) } as any;
        const service = new PushService(prisma, { get: jest.fn() } as any);

        await service.subscribe('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', {
            endpoint: 'https://PUSH.EXAMPLE/subscription-id',
            keys: { p256dh: 'public-key', auth: 'auth-secret' },
        });

        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
            expect.any(String),
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            'https://push.example/subscription-id',
            JSON.stringify({ p256dh: 'public-key', auth: 'auth-secret' }),
        );
    });

    it('fails closed instead of reassigning an endpoint owned by another account', async () => {
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any;
        const service = new PushService(prisma, { get: jest.fn() } as any);

        await expect(service.subscribe(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            {
                endpoint: 'https://push.example/subscription-id',
                keys: { p256dh: 'public-key', auth: 'auth-secret' },
            },
        )).rejects.toBeInstanceOf(ConflictException);
    });

    it('scopes unsubscribe by endpoint, user and tenant', async () => {
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any;
        const service = new PushService(prisma, { get: jest.fn() } as any);

        await service.unsubscribe(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            'https://push.example/subscription-id',
        );

        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
            expect.stringContaining('user_id = $2::uuid AND tenant_id = $3::uuid'),
            'https://push.example/subscription-id',
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
        );
    });
});
