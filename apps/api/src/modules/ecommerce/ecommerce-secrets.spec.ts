import { promises as dns } from 'node:dns';
import { BadRequestException } from '@nestjs/common';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceService } from './ecommerce.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const KEY = 'b'.repeat(64);
const SHOP_URL = 'https://store-name.myshopify.com';
const SECRET_FIELDS = ['apiKey', 'apiSecret', 'accessToken', 'webhookSecret'] as const;

describe('Ecommerce tenant secrets', () => {
    const originalEnv = { ...process.env };
    let settings: Record<string, any>;
    let prisma: any;
    let redis: any;
    let http: any;
    let service: EcommerceService;
    let controller: EcommerceController;
    let lookupSpy: jest.SpyInstance;

    beforeEach(() => {
        process.env.TENANT_SECRET_KEY = KEY;
        delete process.env.TENANT_SECRET_PLAINTEXT;
        settings = {};
        const tx = {
            $queryRawUnsafe: jest.fn(async () => [{ value: settings.ecommerce ?? null }]),
            $executeRawUnsafe: jest.fn(async (_sql: string, ...params: any[]) => {
                settings.ecommerce = JSON.parse(params[2]);
                return 1;
            }),
        };
        prisma = {
            tenant: {
                findUnique: jest.fn(async (args: any) => args?.select?.schemaName
                    ? { schemaName: 'tenant_secret_test' }
                    : { settings }),
            },
            $transaction: jest.fn(async (callback: any) => callback(tx)),
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: 1 }]),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) =>
                callback(jest.fn().mockResolvedValue([]))),
            assertTenantSchemaName: jest.fn(),
        };
        redis = { del: jest.fn().mockResolvedValue(undefined) };
        http = { axiosRef: { get: jest.fn().mockResolvedValue({ data: { products: [] } }) } };
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.20', family: 4 },
        ] as any);
        service = new EcommerceService(
            prisma,
            redis,
            http,
            new TenantSecretCryptoService(),
        );
        controller = new EcommerceController(service);
    });

    afterEach(() => {
        lookupSpy.mockRestore();
        process.env = { ...originalEnv };
    });

    it('encrypts every credential, masks both controller paths and preserves ***', async () => {
        const response = await controller.updateConfig({ tenantId: TENANT_ID }, {
            provider: 'shopify',
            shopUrl: SHOP_URL,
            apiKey: 'public-looking-but-secret-key',
            apiSecret: 'api-secret',
            accessToken: 'shopify-access-token',
            webhookSecret: 'webhook-secret',
            syncProducts: true,
        });

        for (const field of SECRET_FIELDS) {
            expect(settings.ecommerce[field]).toMatch(/^tsc:v1:/);
            expect(response.data![field]).toBe('***');
        }
        const listResponse = await controller.getConfig({ tenantId: TENANT_ID });
        expect(listResponse.data).toMatchObject({
            apiKey: '***',
            apiSecret: '***',
            accessToken: '***',
            webhookSecret: '***',
        });

        const envelopes = Object.fromEntries(
            SECRET_FIELDS
                .map((field) => [field, settings.ecommerce[field]]),
        );
        await controller.updateConfig({ tenantId: TENANT_ID }, {
            shopUrl: SHOP_URL,
            apiKey: '***',
            apiSecret: '***',
            accessToken: '***',
            webhookSecret: '***',
            syncProducts: false,
        });
        expect(settings.ecommerce).toEqual(expect.objectContaining(envelopes));

        const runtime = await service.getConfig(TENANT_ID);
        expect(runtime).toMatchObject({
            apiKey: 'public-looking-but-secret-key',
            apiSecret: 'api-secret',
            accessToken: 'shopify-access-token',
            webhookSecret: 'webhook-secret',
        });

        await service.syncShopifyProducts(TENANT_ID);
        expect(http.axiosRef.get).toHaveBeenCalledWith(
            `${SHOP_URL}/admin/api/2024-01/products.json?limit=250`,
            expect.objectContaining({
                headers: { 'X-Shopify-Access-Token': 'shopify-access-token' },
            }),
        );
    });

    it('rewraps legacy plaintext and reads the envelope after plaintext is rejected', async () => {
        settings.ecommerce = {
            provider: 'shopify',
            shopUrl: SHOP_URL,
            apiKey: 'legacy-key',
            apiSecret: 'legacy-secret',
            accessToken: 'legacy-token',
            webhookSecret: 'legacy-webhook',
            syncProducts: true,
        };

        expect(await service.getConfig(TENANT_ID)).toMatchObject({ accessToken: 'legacy-token' });
        for (const field of SECRET_FIELDS) {
            expect(settings.ecommerce[field]).toMatch(/^tsc:v1:/);
        }

        process.env.TENANT_SECRET_PLAINTEXT = 'reject';
        expect(await service.getConfig(TENANT_ID)).toMatchObject({
            apiKey: 'legacy-key',
            apiSecret: 'legacy-secret',
            accessToken: 'legacy-token',
            webhookSecret: 'legacy-webhook',
        });
    });

    it('fails closed after the cut and never sends an unreadable credential', async () => {
        settings.ecommerce = {
            provider: 'shopify',
            shopUrl: SHOP_URL,
            apiKey: '',
            apiSecret: '',
            accessToken: 'plaintext-after-cut',
            webhookSecret: '',
            syncProducts: true,
        };
        process.env.TENANT_SECRET_PLAINTEXT = 'reject';

        await expect(controller.updateConfig({ tenantId: TENANT_ID }, {
            shopUrl: SHOP_URL,
            accessToken: '***',
        })).rejects.toThrow('tenant_secret_plaintext_rejected');
        await expect(service.syncShopifyProducts(TENANT_ID)).rejects.toBeInstanceOf(BadRequestException);
        expect(http.axiosRef.get).not.toHaveBeenCalled();
    });
});
