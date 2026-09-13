import { promises as dns } from 'node:dns';
import { WebhooksService } from './webhooks.service';

describe('WebhooksService outbound URL security', () => {
    let lookupSpy: jest.SpyInstance;
    let prisma: any;
    let http: any;
    let service: WebhooksService;

    beforeEach(() => {
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.80', family: 4 },
        ] as any);
        prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([]) };
        http = { axiosRef: { post: jest.fn().mockResolvedValue({ status: 204, data: '' }) } };
        service = new WebhooksService(prisma, {} as any, http);
    });

    afterEach(() => lookupSpy.mockRestore());

    it('skips a legacy endpoint when DNS resolves it to a private address', async () => {
        lookupSpy.mockResolvedValue([{ address: '10.0.0.8', family: 4 }] as any);

        await (service as any).deliverWithRetry('tenant_schema', {
            id: 'hook-1',
            url: 'https://hooks.example.com/events',
            secret: 'secret',
        }, 'lead.created', '{}', 1);

        expect(http.axiosRef.post).not.toHaveBeenCalled();
    });

    it('pins and bounds delivery to a public endpoint', async () => {
        await (service as any).deliverWithRetry('tenant_schema', {
            id: 'hook-1',
            url: 'https://hooks.example.com/events',
            secret: 'secret',
        }, 'lead.created', '{}', 1);

        expect(http.axiosRef.post).toHaveBeenCalledWith(
            'https://hooks.example.com/events',
            '{}',
            expect.objectContaining({
                maxRedirects: 0,
                maxContentLength: 8 * 1024 * 1024,
                maxBodyLength: 1024 * 1024,
                proxy: false,
                httpsAgent: expect.any(Object),
                headers: expect.objectContaining({
                    'X-Webhook-Delivery': expect.stringMatching(/^[0-9a-f-]{36}$/),
                }),
            }),
        );
    });

    it('reuses one delivery identity on every retry', async () => {
        http.axiosRef.post
            .mockResolvedValueOnce({ status: 503, data: 'retry' })
            .mockResolvedValueOnce({ status: 204, data: '' });
        const timer = jest.spyOn(global, 'setTimeout').mockImplementation(((callback: any) => {
            callback();
            return 0 as any;
        }) as any);

        await (service as any).deliverWithRetry('tenant_schema', {
            id: 'hook-1', url: 'https://hooks.example.com/events', secret: 'secret',
        }, 'lead.created', '{}', 2, 'delivery-fixed');

        expect(http.axiosRef.post).toHaveBeenCalledTimes(2);
        expect(http.axiosRef.post.mock.calls.map((call: any[]) =>
            call[2].headers['X-Webhook-Delivery']))
            .toEqual(['delivery-fixed', 'delivery-fixed']);
        timer.mockRestore();
    });
});
