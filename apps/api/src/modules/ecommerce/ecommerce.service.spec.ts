import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { EcommerceService } from './ecommerce.service';

describe('EcommerceService Agent Test read-only search', () => {
    it('returns an empty catalog without creating tables when ecommerce is not provisioned', async () => {
        const prisma = {
            $queryRawUnsafe: jest.fn().mockResolvedValueOnce([]),
        };
        const service = new EcommerceService(prisma as any, {} as any, {} as any);

        const result = await service.searchProductsForAI(
            'tenant_test',
            { search: 'camisa' },
            { createTablesIfMissing: false },
        );

        expect(result).toEqual([]);
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        const sqlCalls = prisma.$queryRawUnsafe.mock.calls.map((call) => String(call[0])).join('\n');
        expect(sqlCalls).toMatch(/information_schema\.tables/i);
        expect(sqlCalls).not.toMatch(/\b(create|insert|update|delete|alter|drop|truncate)\b/i);
    });

    it('uses SELECT-only queries when the ecommerce table already exists', async () => {
        const prisma = {
            $queryRawUnsafe: jest.fn()
                .mockResolvedValueOnce([{ exists: 1 }])
                .mockResolvedValueOnce([{ external_id: 'sku-1', title: 'Camisa' }]),
        };
        const service = new EcommerceService(prisma as any, {} as any, {} as any);

        const result = await service.searchProductsForAI(
            'tenant_test',
            { search: 'camisa' },
            { createTablesIfMissing: false },
        );

        expect(result).toHaveLength(1);
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
        const sqlCalls = prisma.$queryRawUnsafe.mock.calls.map((call) => String(call[0])).join('\n');
        expect(sqlCalls).toMatch(/select external_id/i);
        expect(sqlCalls).not.toMatch(/\b(create|insert|update|delete|alter|drop|truncate)\b/i);
    });
});

describe('EcommerceService outbound URL security', () => {
    let prisma: any;
    let redis: any;
    let http: any;
    let service: EcommerceService;
    let lookupSpy: jest.SpyInstance;

    beforeEach(() => {
        prisma = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue({ settings: {} }),
                update: jest.fn().mockResolvedValue({}),
            },
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: 1 }]),
        };
        redis = { del: jest.fn().mockResolvedValue(undefined) };
        http = { axiosRef: { get: jest.fn().mockResolvedValue({ data: { products: [] } }) } };
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.20', family: 4 },
        ] as any);
        service = new EcommerceService(prisma, redis, http);
    });

    afterEach(() => {
        lookupSpy.mockRestore();
    });

    it('rejects non-HTTPS, path-bearing and lookalike Shopify origins before persisting', async () => {
        await expect(service.updateConfig('tenant-1', {
            provider: 'shopify',
            shopUrl: 'http://store.myshopify.com',
        })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.updateConfig('tenant-1', {
            provider: 'shopify',
            shopUrl: 'https://store.myshopify.com/admin',
        })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.updateConfig('tenant-1', {
            provider: 'shopify',
            shopUrl: 'https://store.myshopify.com.attacker.example',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(lookupSpy).not.toHaveBeenCalled();
    });

    it('rejects a WooCommerce hostname that resolves to a private address', async () => {
        lookupSpy.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any);

        await expect(service.updateConfig('tenant-1', {
            provider: 'woocommerce',
            shopUrl: 'https://commerce.example.com',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('normalizes and persists an official public Shopify origin', async () => {
        await service.updateConfig('tenant-1', {
            provider: 'shopify',
            shopUrl: 'https://store-name.myshopify.com/',
        });

        expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
            data: {
                settings: {
                    ecommerce: expect.objectContaining({
                        provider: 'shopify',
                        shopUrl: 'https://store-name.myshopify.com',
                    }),
                },
            },
        }));
    });

    it('pins Shopify DNS and enforces redirects, proxy and body-size limits on sync', async () => {
        const ecommerce = {
            provider: 'shopify',
            shopUrl: 'https://store-name.myshopify.com',
            apiKey: '',
            apiSecret: '',
            accessToken: 'token',
            syncProducts: true,
        };
        prisma.tenant.findUnique
            .mockResolvedValueOnce({ settings: { ecommerce } })
            .mockResolvedValueOnce({ schemaName: 'tenant_abc' });

        await service.syncShopifyProducts('tenant-1');

        expect(http.axiosRef.get).toHaveBeenCalledWith(
            'https://store-name.myshopify.com/admin/api/2024-01/products.json?limit=250',
            expect.objectContaining({
                maxRedirects: 0,
                maxContentLength: 8 * 1024 * 1024,
                maxBodyLength: 1024 * 1024,
                proxy: false,
                httpsAgent: expect.any(Object),
            }),
        );

        const requestConfig = http.axiosRef.get.mock.calls[0][1];
        lookupSpy.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
        const callback = jest.fn();
        requestConfig.httpsAgent.options.lookup('store-name.myshopify.com', { all: false }, callback);
        expect(callback).toHaveBeenCalledWith(null, '203.0.114.20', 4);
        expect(lookupSpy).toHaveBeenCalledTimes(1);
    });
});
