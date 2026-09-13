import { promises as dns } from 'node:dns';
import { WebhookSubscriptionService } from './webhook-subscription.service';

describe('WebhookSubscriptionService outbound URL security', () => {
    let lookupSpy: jest.SpyInstance;
    let prisma: any;
    let http: any;
    let service: WebhookSubscriptionService;

    beforeEach(() => {
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.90', family: 4 },
        ] as any);
        prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
        http = { axiosRef: { post: jest.fn().mockResolvedValue({ status: 204 }) } };
        service = new WebhookSubscriptionService(prisma, {} as any, http, {} as any);
    });

    afterEach(() => lookupSpy.mockRestore());

    it('blocks a pre-existing subscription that now resolves to private DNS', async () => {
        lookupSpy.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any);

        await (service as any).deliver({
            id: 'hook-1',
            target_url: 'https://zap.example.com/catch',
            secret: 'secret',
        }, 'lead.created', {});

        expect(http.axiosRef.post).not.toHaveBeenCalled();
    });

    it('uses a pinned, bounded request for public subscriptions', async () => {
        const result = await (service as any).deliver({
            id: 'hook-1',
            target_url: 'https://zap.example.com/catch',
            secret: 'secret',
        }, 'lead.created', { id: 'lead-1' });

        expect(http.axiosRef.post).toHaveBeenCalledWith(
            'https://zap.example.com/catch',
            JSON.stringify({ id: 'lead-1' }),
            expect.objectContaining({
                maxRedirects: 0,
                maxContentLength: 8 * 1024 * 1024,
                maxBodyLength: 1024 * 1024,
                proxy: false,
                httpsAgent: expect.any(Object),
                headers: expect.objectContaining({
                    'X-Hook-Delivery': expect.stringMatching(/^[0-9a-f-]{36}$/),
                }),
            }),
        );
        expect(result).toEqual({ outcome: 'accepted', statusCode: 204 });
    });

    it('does not project a non-2xx refusal as a successful trigger', async () => {
        http.axiosRef.post.mockResolvedValue({ status: 503 });

        const result = await (service as any).deliver({
            id: 'hook-1', target_url: 'https://zap.example.com/catch', secret: 'secret',
        }, 'lead.created', { id: 'lead-1' }, 'delivery-fixed');

        expect(result).toEqual({ outcome: 'rejected', statusCode: 503 });
        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('keeps a request with no response distinct from a refusal', async () => {
        http.axiosRef.post.mockRejectedValue(new Error('socket closed'));

        const result = await (service as any).deliver({
            id: 'hook-1', target_url: 'https://zap.example.com/catch', secret: 'secret',
        }, 'lead.created', { id: 'lead-1' }, 'delivery-fixed');

        expect(result).toEqual({ outcome: 'unknown', statusCode: null });
        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('settles a leased delivery and its subscription receipt after a confirmed 2xx', async () => {
        const deliveryId = '11111111-1111-4111-8111-111111111111';
        prisma.$queryRawUnsafe
            .mockResolvedValueOnce([{
                id: deliveryId,
                subscription_id: '22222222-2222-4222-8222-222222222222',
                event: 'lead.created',
                payload: { id: 'lead-1' },
            }])
            .mockResolvedValueOnce([{
                id: '22222222-2222-4222-8222-222222222222',
                target_url: 'https://zap.example.com/catch',
                secret: 'secret',
            }])
            .mockResolvedValueOnce([]);

        await (service as any).deliverOutboxRow(deliveryId);

        expect(http.axiosRef.post.mock.calls[0][2].headers['X-Hook-Delivery'])
            .toBe(deliveryId);
        expect(prisma.$queryRawUnsafe.mock.calls[2][0])
            .toContain("SET state = 'accepted'");
        expect(prisma.$queryRawUnsafe.mock.calls[2][0])
            .toContain('SET last_triggered_at = NOW()');
    });

    it('does not send a terminal delivery again when the domain event is replayed', async () => {
        const redis = { get: jest.fn().mockResolvedValue('1') };
        const db = { $queryRawUnsafe: jest.fn()
            .mockResolvedValueOnce([{
                id: 'hook-1', target_url: 'https://zap.example.com/catch', secret: 'secret',
            }])
            .mockResolvedValueOnce([{
                id: '11111111-1111-4111-8111-111111111111', state: 'accepted',
            }]) };
        const target = new WebhookSubscriptionService(
            db as any, redis as any, http, {} as any,
        );

        await target.dispatchEvent(
            '33333333-3333-4333-8333-333333333333',
            'lead.created',
            { id: 'lead-1' },
            'lead.created:lead-1',
        );

        expect(http.axiosRef.post).not.toHaveBeenCalled();
        expect(db.$queryRawUnsafe.mock.calls[1][0])
            .toContain('ON CONFLICT (subscription_id, event_key)');
    });
});
