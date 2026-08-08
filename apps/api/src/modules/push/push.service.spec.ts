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
        'https://standards-compliant-push.example/subscription-id',
        'https://fcm.googleapis.com.attacker.example/subscription-id',
    ])('rejects unsafe push endpoint syntax before delivery: %s', async (endpoint) => {
        await expect(prepareTrustedWebPushTarget(endpoint)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a hostname with any private DNS answer', async () => {
        lookupSpy.mockResolvedValue([
            { address: '203.0.114.50', family: 4 },
            { address: '169.254.169.254', family: 4 },
        ] as any);

        await expect(prepareTrustedWebPushTarget('https://fcm.googleapis.com/subscription-id'))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('normalizes and validates the endpoint before persistence', async () => {
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ endpoint: 'https://fcm.googleapis.com/subscription-id' }]) } as any;
        const service = new PushService(prisma, { get: jest.fn() } as any);

        await service.subscribe('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', {
            endpoint: 'https://FCM.GOOGLEAPIS.COM/subscription-id',
            keys: { p256dh: 'public-key', auth: 'auth-secret' },
        });

        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
            expect.any(String),
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            'https://fcm.googleapis.com/subscription-id',
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
                endpoint: 'https://fcm.googleapis.com/subscription-id',
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

    it('paginates tenant-role subscriptions instead of dropping a dispatch above the memory cap', async () => {
        const firstPage = Array.from({ length: 100 }, (_, index) => ({
            id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        }));
        const secondPage = [{ id: '11111111-1111-4111-8111-111111111111' }];
        const prisma = {
            $queryRawUnsafe: jest.fn()
                .mockResolvedValueOnce(firstPage)
                .mockResolvedValueOnce(secondPage),
        } as any;
        const service = new PushService(prisma, { get: jest.fn() } as any);
        const dispatch = jest.spyOn(service as any, 'dispatch')
            .mockResolvedValueOnce(100)
            .mockResolvedValueOnce(1);

        await expect(service.sendToTenantRole(
            '22222222-2222-4222-8222-222222222222',
            'tenant_agent',
            { title: 'Title', body: 'Body' },
        )).resolves.toBe(101);

        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(prisma.$queryRawUnsafe.mock.calls[1][3]).toBe(firstPage[99].id);
    });
});
