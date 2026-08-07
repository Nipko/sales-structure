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
        await (service as any).deliver({
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
            }),
        );
    });
});
