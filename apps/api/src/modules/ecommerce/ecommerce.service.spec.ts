import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { EcommerceService } from './ecommerce.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('EcommerceService Agent Test read-only search', () => {
    // The catalog SELECT now runs through executeInTenantSchema (which validates
    // the schema name), so read-only-ness is asserted over both query primitives.
    //
    // Each primitive carries the SQL at a different argument index —
    // $queryRawUnsafe(sql, ...params) vs executeInTenantSchema(schema, sql, params).
    // The index is declared per mock rather than sniffed from the value: keying
    // off a literal schema name meant a test using any other schema would have
    // silently collected the schema name AS the SQL, and the read-only
    // assertion would then pass while inspecting nothing.
    const collectSql = (sources: Array<{ mock: jest.Mock; sqlIndex: number }>) =>
        sources
            .flatMap(({ mock, sqlIndex }) => mock.mock.calls.map((call) => String(call[sqlIndex])))
            .join('\n');

    it('returns an empty catalog without creating tables when ecommerce is not provisioned', async () => {
        const prisma = {
            assertTenantSchemaName: jest.fn(),
            $queryRawUnsafe: jest.fn().mockResolvedValueOnce([]),
            executeInTenantSchema: jest.fn(),
        };
        const service = new EcommerceService(
            prisma as any,
            {} as any,
            {} as any,
            new TenantSecretCryptoService(),
        );

        const result = await service.searchProductsForAI(
            'tenant_test',
            { search: 'camisa' },
            { createTablesIfMissing: false },
        );

        expect(result).toEqual([]);
        expect(prisma.assertTenantSchemaName).toHaveBeenCalledWith('tenant_test');
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        const sqlCalls = collectSql([
            { mock: prisma.$queryRawUnsafe, sqlIndex: 0 },
            { mock: prisma.executeInTenantSchema, sqlIndex: 1 },
        ]);
        expect(sqlCalls).toMatch(/information_schema\.tables/i);
        expect(sqlCalls).not.toMatch(/\b(create|insert|update|delete|alter|drop|truncate)\b/i);
    });

    it('uses SELECT-only queries when the ecommerce table already exists', async () => {
        const prisma = {
            assertTenantSchemaName: jest.fn(),
            $queryRawUnsafe: jest.fn().mockResolvedValueOnce([{ exists: 1 }]),
            executeInTenantSchema: jest.fn().mockResolvedValueOnce([{ external_id: 'sku-1', title: 'Camisa' }]),
        };
        const service = new EcommerceService(
            prisma as any,
            {} as any,
            {} as any,
            new TenantSecretCryptoService(),
        );

        const result = await service.searchProductsForAI(
            'tenant_test',
            { search: 'camisa' },
            { createTablesIfMissing: false },
        );

        expect(result).toHaveLength(1);
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        expect(prisma.executeInTenantSchema.mock.calls[0][0]).toBe('tenant_test');
        const sqlCalls = collectSql([
            { mock: prisma.$queryRawUnsafe, sqlIndex: 0 },
            { mock: prisma.executeInTenantSchema, sqlIndex: 1 },
        ]);
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
    let storedSettings: Record<string, any>;

    beforeEach(() => {
        storedSettings = {};
        const transactionClient = {
            $queryRawUnsafe: jest.fn(async () => [{ value: storedSettings.ecommerce ?? null }]),
            $executeRawUnsafe: jest.fn(async (_sql: string, ...params: any[]) => {
                storedSettings.ecommerce = JSON.parse(params[2]);
                return 1;
            }),
        };
        prisma = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue({ settings: {} }),
                update: jest.fn().mockResolvedValue({}),
            },
            $transaction: jest.fn(async (callback: any) => callback(transactionClient)),
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: 1 }]),
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
            // The product sync upserts a whole page inside ONE transaction.
            transactionInTenantSchema: jest.fn(async (_schema: string, cb: any) => cb(jest.fn().mockResolvedValue([]))),
            assertTenantSchemaName: jest.fn(),
        };
        redis = { del: jest.fn().mockResolvedValue(undefined) };
        http = { axiosRef: { get: jest.fn().mockResolvedValue({ data: { products: [] } }) } };
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.20', family: 4 },
        ] as any);
        process.env.TENANT_SECRET_KEY = 'a'.repeat(64);
        service = new EcommerceService(prisma, redis, http, new TenantSecretCryptoService());
    });

    afterEach(() => {
        lookupSpy.mockRestore();
    });

    it('rejects non-HTTPS, path-bearing and lookalike Shopify origins before persisting', async () => {
        await expect(service.updateConfig(TENANT_ID, {
            provider: 'shopify',
            shopUrl: 'http://store.myshopify.com',
        })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.updateConfig(TENANT_ID, {
            provider: 'shopify',
            shopUrl: 'https://store.myshopify.com/admin',
        })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.updateConfig(TENANT_ID, {
            provider: 'shopify',
            shopUrl: 'https://store.myshopify.com.attacker.example',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(lookupSpy).not.toHaveBeenCalled();
    });

    it('rejects a WooCommerce hostname that resolves to a private address', async () => {
        lookupSpy.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any);

        await expect(service.updateConfig(TENANT_ID, {
            provider: 'woocommerce',
            shopUrl: 'https://commerce.example.com',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('normalizes and persists an official public Shopify origin', async () => {
        await service.updateConfig(TENANT_ID, {
            provider: 'shopify',
            shopUrl: 'https://store-name.myshopify.com/',
        });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(storedSettings.ecommerce).toEqual(expect.objectContaining({
            provider: 'shopify',
            shopUrl: 'https://store-name.myshopify.com',
        }));
        expect(prisma.tenant.update).not.toHaveBeenCalled();
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

        await service.syncShopifyProducts(TENANT_ID);

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
