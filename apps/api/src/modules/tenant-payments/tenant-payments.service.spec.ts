import { TenantPaymentsService } from './tenant-payments.service';
import { TenantPaymentCredentialCryptoService } from './tenant-payment-credential-crypto.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';

function credentialCryptoHarness(legacyCrypto: { decryptToken(value: string): string }) {
    const values = new Map<string, string>();
    let sequence = 0;
    return {
        encrypt: jest.fn((plaintext: string) => {
            const envelope = `tpc:v2:test-key:iv-${++sequence}:tag-${sequence}:cipher-${sequence}`;
            values.set(envelope, plaintext);
            return envelope;
        }),
        readCompatible: jest.fn((value: string, _context: unknown, legacyDecrypt: (value: string) => string) => {
            if (values.has(value)) {
                return { plaintext: values.get(value), format: 'v2', needsRewrap: false };
            }
            return {
                plaintext: legacyDecrypt(value),
                format: 'legacy-v1',
                needsRewrap: true,
            };
        }),
    };
}

function harness() {
    const prisma = {
        tenant: {
            findUnique: jest.fn().mockResolvedValue({
                isActive: true,
                isInternal: true,
                settings: {
                    tenantPayments: {
                        accessTokenEnc: 'access-enc',
                        webhookSecretEnc: 'secret-enc',
                        accountId: '123456789',
                    },
                },
            }),
            update: jest.fn(),
        },
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_schema'),
        executeInTenantSchema: jest.fn(),
        $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('tenant_payment_provider_configs')) {
                return [{ config: {
                    accessTokenEnc: 'access-enc',
                    webhookSecretEnc: 'secret-enc',
                    accountId: '123456789',
                }}];
            }
            return [];
        }),
    };
    const redis = {
        set: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue(null),
        del: jest.fn().mockResolvedValue(undefined),
        acquireLockToken: jest.fn().mockResolvedValue('lock-token'),
        releaseLockToken: jest.fn().mockResolvedValue(true),
    };
    const crypto = {
        decryptToken: jest.fn((value: string) => value === 'access-enc' ? 'APP_USR-token' : 'webhook-secret'),
        encryptToken: jest.fn((value: string) => `encrypted:${value}`),
    };
    const credentialCrypto = credentialCryptoHarness(crypto);
    const throttle = { isFeatureEnabled: jest.fn().mockResolvedValue(true) };
    return {
        service: new TenantPaymentsService(
            prisma as any,
            redis as any,
            crypto as any,
            undefined,
            undefined,
            throttle as any,
            credentialCrypto as any,
        ),
        prisma,
        redis,
        crypto,
        credentialCrypto,
        throttle,
    };
}

function wompiHarness() {
    const settings = {
        tenantPayments: {
            version: 2,
            activeProvider: 'wompi',
            providers: {
                wompi: {
                    revision: 3,
                    publicKey: 'pub_prod_abcdefghijklmnop',
                    privateKeyEnc: 'private-enc',
                    eventsSecretEnc: 'events-enc',
                    webhookTokenEnc: 'callback-enc',
                    environment: 'production',
                    merchantName: 'Merchant',
                    verifiedAt: '2026-08-16T00:00:00.000Z',
                    webhookAcknowledgedAt: '2026-08-16T00:01:00.000Z',
                },
            },
        },
    };
    const prisma = {
        tenant: { findUnique: jest.fn().mockResolvedValue({ settings, isActive: true, isInternal: true }) },
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_schema'),
        executeInTenantSchema: jest.fn().mockResolvedValue([{
            amount: '2500.00',
            currency: 'COP',
            contact_id: CONTACT,
            status: 'open',
            payment_status: 'pending',
        }]),
        $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('tenant_payment_provider_configs')) {
                return [{ config: settings.tenantPayments }];
            }
            return [];
        }),
    };
    const redis = {
        set: jest.fn(),
        get: jest.fn(),
        del: jest.fn(),
        acquireLockToken: jest.fn().mockResolvedValue('lock-token'),
        releaseLockToken: jest.fn().mockResolvedValue(true),
    };
    const crypto = {
        decryptToken: jest.fn((value: string) => ({
            'private-enc': 'prv_prod_abcdefghijklmnop',
            'events-enc': 'prod_events_abcdefghijklmnop',
            'callback-enc': 'opaque-callback-token',
        } as Record<string, string>)[value]),
        encryptToken: jest.fn(),
    };
    const credentialCrypto = credentialCryptoHarness(crypto);
    const store = {
        isAvailable: jest.fn().mockResolvedValue(true),
        findByProviderLink: jest.fn(),
        findLatestOwned: jest.fn(),
        markCreationState: jest.fn().mockResolvedValue(undefined),
        attachProviderLink: jest.fn(),
        settleWompiTransaction: jest.fn(),
    };
    const wompi = {
        environmentForKeys: jest.fn().mockReturnValue('production'),
        getAndValidatePaymentLink: jest.fn(),
        getTransaction: jest.fn(),
    };
    const throttle = { isFeatureEnabled: jest.fn().mockResolvedValue(true) };
    const service = new TenantPaymentsService(
        prisma as any,
        redis as any,
        crypto as any,
        store as any,
        wompi as any,
        throttle as any,
        credentialCrypto as any,
    );
    return { service, prisma, redis, crypto, credentialCrypto, store, wompi, throttle };
}

function configHarness(options: {
    duplicateMerchant?: boolean;
    duplicateMpAccount?: boolean;
    entitled?: boolean;
    unresolved?: boolean;
    initialSettings?: Record<string, unknown>;
    crypto?: any;
    credentialCrypto?: any;
} = {}) {
    let currentSettings: Record<string, unknown> = options.initialSettings
        ? JSON.parse(JSON.stringify(options.initialSettings))
        : {};
    let currentProviderConfig: Record<string, unknown> | null = (currentSettings as any).tenantPayments
        ? JSON.parse(JSON.stringify((currentSettings as any).tenantPayments))
        : null;
    const transaction = {
        $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('pg_advisory_xact_lock')) return [{ locked: true }];
            if (sql.includes('FROM tenant_payment_provider_configs') && sql.includes('LIMIT 1')) {
                if (sql.includes('mercadopago_account_id')) {
                    return options.duplicateMpAccount ? [{ id: 'other-tenant' }] : [];
                }
                return options.duplicateMerchant ? [{ id: 'other-tenant' }] : [];
            }
            if (sql.includes('SELECT settings FROM tenants')) return [{ settings: currentSettings }];
            if (sql.includes('SELECT config') && sql.includes('tenant_payment_provider_configs')) {
                return currentProviderConfig ? [{ config: currentProviderConfig }] : [];
            }
            return [];
        }),
        $executeRawUnsafe: jest.fn().mockImplementation((sql: string, _tenantId: string, json?: string) => {
            if (sql.includes('INSERT INTO tenant_payment_provider_configs')) {
                currentProviderConfig = JSON.parse(String(json));
            }
            if (sql.includes('settings = jsonb_set')) {
                currentSettings = {
                    ...currentSettings,
                    tenantPayments: JSON.parse(String(json)),
                };
            }
            if (sql.includes("settings = settings - 'tenantPayments'")) {
                const next = { ...currentSettings };
                delete (next as any).tenantPayments;
                currentSettings = next;
            }
            return 1;
        }),
    };
    const prisma = {
        tenant: {
            findUnique: jest.fn().mockImplementation(() => ({
                settings: currentSettings,
                isActive: true,
                isInternal: true,
            })),
        },
        $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('tenant_payment_provider_configs')) {
                return currentProviderConfig ? [{ config: currentProviderConfig }] : [];
            }
            return [];
        }),
        $transaction: jest.fn(async (callback: any) => callback(transaction)),
    };
    const redis = {
        del: jest.fn().mockResolvedValue(undefined),
        acquireLockToken: jest.fn().mockResolvedValue('lock-token'),
        releaseLockToken: jest.fn().mockResolvedValue(true),
    };
    const crypto = options.crypto || {
        encryptToken: jest.fn((value: string) => `enc:${value}`),
        decryptToken: jest.fn((value: string) => String(value).replace(/^enc:/, '')),
    };
    const credentialCrypto = options.credentialCrypto || credentialCryptoHarness(crypto);
    const store = {
        hasCredentialBoundHistoryForProvider: jest.fn().mockResolvedValue(options.unresolved === true),
    };
    const wompi = {
        environmentForKeys: jest.fn().mockReturnValue('production'),
        verifyMerchant: jest.fn().mockResolvedValue({ id: 'merchant-1', name: 'Merchant One' }),
    };
    const throttle = {
        isFeatureEnabled: jest.fn().mockResolvedValue(options.entitled !== false),
    };
    const service = new TenantPaymentsService(
        prisma as any,
        redis as any,
        crypto as any,
        store as any,
        wompi as any,
        throttle as any,
        credentialCrypto as any,
    );
    return {
        service,
        prisma,
        redis,
        crypto,
        credentialCrypto,
        store,
        wompi,
        throttle,
        transaction,
        settings: () => currentSettings,
        paymentConfig: () => currentProviderConfig,
    };
}

describe('TenantPaymentsService', () => {
    const originalApiUrl = process.env.API_PUBLIC_URL;
    const originalEncryptionKey = process.env.ENCRYPTION_KEY;
    const originalCredentialKey = process.env.TENANT_PAYMENT_CREDENTIAL_KEY;
    const originalCredentialKeyId = process.env.TENANT_PAYMENT_CREDENTIAL_KEY_ID;
    const originalPreviousKeys = process.env.TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS;

    beforeEach(() => {
        process.env.API_PUBLIC_URL = 'https://api.parallly.test/api/v1';
        process.env.ENCRYPTION_KEY = '11'.repeat(32);
        process.env.TENANT_PAYMENT_CREDENTIAL_KEY = '22'.repeat(32);
        process.env.TENANT_PAYMENT_CREDENTIAL_KEY_ID = 'test-current';
        delete process.env.TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (originalApiUrl === undefined) delete process.env.API_PUBLIC_URL;
        else process.env.API_PUBLIC_URL = originalApiUrl;
        if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalEncryptionKey;
        if (originalCredentialKey === undefined) delete process.env.TENANT_PAYMENT_CREDENTIAL_KEY;
        else process.env.TENANT_PAYMENT_CREDENTIAL_KEY = originalCredentialKey;
        if (originalCredentialKeyId === undefined) delete process.env.TENANT_PAYMENT_CREDENTIAL_KEY_ID;
        else process.env.TENANT_PAYMENT_CREDENTIAL_KEY_ID = originalCredentialKeyId;
        if (originalPreviousKeys === undefined) delete process.env.TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS;
        else process.env.TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS = originalPreviousKeys;
    });

    it('resolves only a purchase owned by the current contact and returns canonical money', async () => {
        const { service, prisma } = harness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([{ amount: '276900.00', currency: 'cop' }]);

        const result = await service.resolveOwnedReference(TENANT, CONTACT, `order:${ORDER}`);

        expect(result).toEqual({
            canonicalReference: `order:${ORDER}`,
            amountCents: 27_690_000,
            currency: 'COP',
            description: 'Pago de pedido 33333333',
            paymentStatus: 'pending',
        });
        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(
            'tenant_schema',
            expect.stringContaining('target.contact_id = $2::uuid'),
            [ORDER, CONTACT],
        );
    });

    it('rejects a malformed or unsupported reference before querying a tenant schema', async () => {
        const { service, prisma } = harness();

        // 'appointment' dejó de servir como ejemplo de tipo no soportado: las
        // citas ahora se cobran (son la venta más común de la plataforma y eran
        // la única entidad vendible sin riel de pago). Se usa uno que de verdad
        // no existe.
        await expect(service.resolveOwnedReference(TENANT, CONTACT, `membership:${ORDER}`)).resolves.toBeNull();
        await expect(service.resolveOwnedReference(TENANT, CONTACT, 'order:not-a-uuid')).resolves.toBeNull();

        expect(prisma.getTenantSchemaName).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('acepta una cita como referencia pagable', async () => {
        const { service, prisma } = harness();

        await service.resolveOwnedReference(TENANT, CONTACT, `appointment:${ORDER}`);

        // Lo que importa es que llegue a consultar el schema: el tipo existe.
        expect(prisma.getTenantSchemaName).toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(
            'tenant_schema',
            expect.stringContaining('appointments'),
            [ORDER, CONTACT],
        );
    });

    it('creates a tenant-owned Checkout Pro preference with a recoverable operation id', async () => {
        const { service, redis } = harness();
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                id: 'preference-1',
                init_point: 'https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=preference-1',
            }),
        }) as any;

        const link = await service.createPaymentLink(TENANT, {
            amountCents: 27_690_000,
            currency: 'COP',
            description: 'Pedido 3333',
            externalReference: `order:${ORDER}`,
            idempotencyKey: '44444444-4444-4444-8444-444444444444',
        });

        expect(link).toMatchObject({ id: 'preference-1', amountCents: 27_690_000, currency: 'COP' });
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.mercadopago.com/checkout/preferences',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: 'Bearer APP_USR-token' }),
            }),
        );
        const request = (global.fetch as jest.Mock).mock.calls[0][1];
        expect(JSON.parse(request.body)).toMatchObject({
            items: [{ unit_price: 276900, currency_id: 'COP' }],
            external_reference: `order:${ORDER}`,
            notification_url: `https://api.parallly.test/api/v1/tenant-payments/webhook/${TENANT}`,
        });
        expect(redis.set).toHaveBeenCalledWith(
            `tenant_payment_link:idem:${TENANT}:44444444-4444-4444-8444-444444444444`,
            'preference-1',
            7 * 86400,
        );
    });

    it('fails before calling Mercado Pago when a COP amount has fractional pesos', async () => {
        const { service } = harness();
        global.fetch = jest.fn() as any;

        await expect(service.createPaymentLink(TENANT, {
            amountCents: 10_001,
            currency: 'COP',
            description: 'Pedido',
            externalReference: `order:${ORDER}`,
        })).rejects.toMatchObject({ response: { error: 'invalid_zero_decimal_amount' } });

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('never exposes the stored webhook secret in config reads', async () => {
        const { service } = harness();

        const config = await service.getConfig(TENANT);

        expect(config).toMatchObject({ connected: true, webhookConfigured: true, webhookSecret: '***' });
        expect(JSON.stringify(config)).not.toContain('secret-enc');
        expect(JSON.stringify(config)).not.toContain('webhook-secret');
    });

    it('fails every legacy creation path closed when the plan entitlement is disabled', async () => {
        const { service, throttle } = harness();
        throttle.isFeatureEnabled.mockResolvedValueOnce(false);
        global.fetch = jest.fn() as any;

        await expect(service.createPaymentLink(TENANT, {
            amountCents: 25_000,
            currency: 'COP',
            description: 'Pedido',
            externalReference: `order:${ORDER}`,
        })).rejects.toMatchObject({
            response: { error: 'customer_payments_not_available_on_plan' },
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('never shares an expired Wompi URL and keeps an inactive lost-webhook link under review', async () => {
        const { service, store, wompi } = wompiHarness();
        const expiredIntent = {
            id: '44444444-4444-4444-8444-444444444444',
            provider: 'wompi',
            idempotencyKey: 'idem-1',
            canonicalReference: `order:${ORDER}`,
            contactId: CONTACT,
            amountCents: 250_000,
            currency: 'COP',
            description: 'Pago de pedido',
            resourceSnapshot: {},
            providerLinkId: 'link-expired',
            checkoutUrl: 'https://checkout.wompi.co/l/link-expired',
            status: 'pending',
            expiresAt: new Date(Date.now() - 60_000),
        };
        store.findByProviderLink.mockResolvedValueOnce(expiredIntent);
        wompi.getAndValidatePaymentLink.mockResolvedValue({
            id: 'link-expired',
            url: expiredIntent.checkoutUrl,
            amountCents: 250_000,
            currency: 'COP',
            sku: expiredIntent.id,
            expiresAt: expiredIntent.expiresAt,
            merchantPublicKey: 'pub_prod_abcdefghijklmnop',
            active: false,
        });

        const result = await service.reconcilePaymentLinkCreation(TENANT, 'link-expired');

        expect(result).toEqual({ status: 'pending' });
        expect(result).not.toHaveProperty('url');
        expect(store.attachProviderLink).not.toHaveBeenCalled();
        expect(store.markCreationState).toHaveBeenCalledWith(
            TENANT,
            expiredIntent.id,
            'requires_review',
            'wompi_inactive_link_requires_provider_evidence',
            'link-expired',
        );
        expect(store.markCreationState).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            'failed',
            expect.anything(),
            expect.anything(),
        );
    });

    it('never shares an expired Wompi URL even when the provider still reports active', async () => {
        const { service, store, wompi } = wompiHarness();
        const expiredIntent = {
            id: '44444444-4444-4444-8444-444444444444',
            provider: 'wompi',
            idempotencyKey: 'idem-1',
            canonicalReference: `order:${ORDER}`,
            contactId: CONTACT,
            amountCents: 250_000,
            currency: 'COP',
            description: 'Pago de pedido',
            resourceSnapshot: {},
            providerLinkId: 'link-expired',
            checkoutUrl: 'https://checkout.wompi.co/l/link-expired',
            status: 'pending',
            expiresAt: new Date(Date.now() - 60_000),
        };
        store.findByProviderLink.mockResolvedValueOnce(expiredIntent);
        wompi.getAndValidatePaymentLink.mockResolvedValueOnce({
            id: 'link-expired',
            url: expiredIntent.checkoutUrl,
            amountCents: 250_000,
            currency: 'COP',
            sku: expiredIntent.id,
            expiresAt: expiredIntent.expiresAt,
            merchantPublicKey: 'pub_prod_abcdefghijklmnop',
            active: true,
        });

        await expect(service.reconcilePaymentLinkCreation(TENANT, 'link-expired'))
            .resolves.toEqual({ status: 'pending' });
        expect(store.attachProviderLink).not.toHaveBeenCalled();
    });

    it('surfaces ledger review over a domain row that is already paid', async () => {
        const { service, prisma, store } = wompiHarness();
        prisma.executeInTenantSchema.mockResolvedValueOnce([{
            amount: '2500.00',
            currency: 'COP',
            contact_id: CONTACT,
            status: 'open',
            payment_status: 'paid',
        }]);
        store.findLatestOwned.mockResolvedValueOnce({
            id: '44444444-4444-4444-8444-444444444444',
            provider: 'wompi',
            idempotencyKey: 'idem-1',
            canonicalReference: `order:${ORDER}`,
            contactId: CONTACT,
            amountCents: 250_000,
            currency: 'COP',
            description: 'Pago de pedido',
            resourceSnapshot: {},
            providerLinkId: 'link-1',
            status: 'requires_review',
            lastError: 'multiple_approved_transactions',
        });

        await expect(service.getPaymentStatus({
            tenantId: TENANT,
            contactId: CONTACT,
            payableReference: `order:${ORDER}`,
        })).resolves.toMatchObject({
            canonicalReference: `order:${ORDER}`,
            status: 'requires_review',
            amountCents: 250_000,
            currency: 'COP',
        });
    });

    it('saves Wompi inactive, masks secrets, and requires explicit webhook acknowledgement to activate', async () => {
        const { service, paymentConfig } = configHarness();

        const saved = await service.setConfig(TENANT, {
            provider: 'wompi',
            activate: true,
            publicKey: 'pub_prod_abcdefghijklmnop',
            privateKey: 'prv_prod_abcdefghijklmnop',
            eventsSecret: 'prod_events_abcdefghijklmnop',
            environment: 'production',
        });

        expect(saved).toMatchObject({
            activeProvider: null,
            providers: {
                wompi: {
                    connected: true,
                    verified: true,
                    activationReady: true,
                    webhookAcknowledged: false,
                    ready: false,
                    privateKey: '***',
                    eventsSecret: '***',
                },
            },
        });
        expect(saved.providers.wompi.webhookUrl).toMatch(
            new RegExp(`/tenant-payments/webhook/wompi/${TENANT}/[A-Za-z0-9_-]{40,}`),
        );
        expect(JSON.stringify(saved)).not.toContain('prv_prod_');
        expect(JSON.stringify(saved)).not.toContain('prod_events_');
        expect((paymentConfig() as any).activeProvider).toBeNull();

        const activated = await service.activateProvider(TENANT, 'wompi');
        expect(activated).toMatchObject({
            activeProvider: 'wompi',
            ready: true,
            webhookAcknowledged: true,
        });
    });

    it('tombstones Wompi without erasing the credentials required by late webhooks, then reactivates it', async () => {
        const { service, paymentConfig, store } = configHarness();
        const saved = await service.setConfig(TENANT, {
            provider: 'wompi',
            publicKey: 'pub_prod_abcdefghijklmnop',
            privateKey: 'prv_prod_abcdefghijklmnop',
            eventsSecret: 'prod_events_abcdefghijklmnop',
            environment: 'production',
        });
        await service.activateProvider(TENANT, 'wompi');
        store.hasCredentialBoundHistoryForProvider.mockClear();
        store.hasCredentialBoundHistoryForProvider.mockResolvedValue(true);
        const callbackToken = decodeURIComponent(
            new URL(saved.providers.wompi.webhookUrl!).pathname.split('/').pop()!,
        );
        const encryptedBefore = (paymentConfig() as any).providers.wompi.eventsSecretEnc;

        const disconnected = await service.disconnectProvider(TENANT, 'wompi');

        expect(disconnected).toMatchObject({
            activeProvider: null,
            providers: {
                wompi: {
                    connected: false,
                    ready: false,
                    activationReady: true,
                },
            },
        });
        expect((paymentConfig() as any).providers.wompi.disabledAt).toEqual(expect.any(String));
        expect((paymentConfig() as any).providers.wompi.eventsSecretEnc).toBe(encryptedBefore);
        expect(store.hasCredentialBoundHistoryForProvider).not.toHaveBeenCalled();

        const rewrapped = await service.rewrapProviderCredentials(TENANT, 'wompi');
        expect(rewrapped).toMatchObject({
            activeProvider: null,
            providers: { wompi: { connected: false, activationReady: true } },
        });
        expect((paymentConfig() as any).providers.wompi.disabledAt).toEqual(expect.any(String));
        await expect(service.getWompiCredentials(TENANT, callbackToken)).resolves.toMatchObject({
            publicKey: 'pub_prod_abcdefghijklmnop',
            eventsSecret: 'prod_events_abcdefghijklmnop',
        });

        const reactivated = await service.activateProvider(TENANT, 'wompi');
        expect(reactivated).toMatchObject({ activeProvider: 'wompi', connected: true, ready: true });
        expect((paymentConfig() as any).providers.wompi.disabledAt).toBeUndefined();
    });

    it('tombstones Mercado Pago while retaining the token and webhook secret for historical settlement', async () => {
        const { service, paymentConfig, store } = configHarness();
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ id: 123456789, email: 'owner@example.test' }),
        }) as any;
        await service.setConfig(TENANT, {
            provider: 'mercadopago',
            activate: true,
            accessToken: 'APP_USR-tenant-token',
            webhookSecret: 'a-valid-webhook-secret-123',
        });
        store.hasCredentialBoundHistoryForProvider.mockResolvedValue(true);

        const disconnected = await service.disconnectProvider(TENANT, 'mercadopago');

        expect(disconnected).toMatchObject({
            activeProvider: null,
            providers: {
                mercadopago: {
                    connected: false,
                    ready: false,
                    activationReady: true,
                },
            },
        });
        expect((paymentConfig() as any).providers.mercadopago.disabledAt).toEqual(expect.any(String));
        await expect(service.getMercadoPagoAccessToken(TENANT)).resolves.toBe('APP_USR-tenant-token');
        await expect(service.getWebhookSecret(TENANT)).resolves.toBe('a-valid-webhook-secret-123');
    });

    it('blocks config and activation server-side when the plan is not entitled', async () => {
        const { service, redis, wompi } = configHarness({ entitled: false });

        await expect(service.setConfig(TENANT, {
            provider: 'wompi',
            publicKey: 'pub_prod_abcdefghijklmnop',
            privateKey: 'prv_prod_abcdefghijklmnop',
            eventsSecret: 'prod_events_abcdefghijklmnop',
        })).rejects.toMatchObject({
            response: { error: 'customer_payments_not_available_on_plan' },
        });
        await expect(service.activateProvider(TENANT, 'wompi')).rejects.toMatchObject({
            response: { error: 'customer_payments_not_available_on_plan' },
        });
        expect(redis.acquireLockToken).not.toHaveBeenCalled();
        expect(wompi.verifyMerchant).not.toHaveBeenCalled();
    });

    it.each([
        ['TEST-tenant-token', 'sandbox'],
        ['APP_USR-tenant-token', 'production'],
    ] as const)('derives and persists Mercado Pago %s credentials as %s v2 envelopes', async (
        accessToken,
        environment,
    ) => {
        const { service, paymentConfig, credentialCrypto } = configHarness();
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ id: 123456789, email: 'owner@example.test' }),
        }) as any;

        const saved = await service.setConfig(TENANT, {
            provider: 'mercadopago',
            activate: true,
            accessToken,
            webhookSecret: 'a-valid-webhook-secret-123',
            environment,
        });

        const stored = (paymentConfig() as any).providers.mercadopago;
        expect(stored.environment).toBe(environment);
        expect(stored.accountId).toBe('123456789');
        expect(stored.accessTokenEnc).toMatch(/^tpc:v2:/);
        expect(stored.webhookSecretEnc).toMatch(/^tpc:v2:/);
        expect(stored.revision).toBe(1);
        expect(saved).toMatchObject({
            activeProvider: 'mercadopago',
            environment,
            ready: true,
        });
        expect(credentialCrypto.encrypt).toHaveBeenCalledWith(accessToken, {
            tenantId: TENANT,
            provider: 'mercadopago',
            environment,
            field: 'access_token',
        });
        expect(credentialCrypto.encrypt).toHaveBeenCalledWith('a-valid-webhook-secret-123', {
            tenantId: TENANT,
            provider: 'mercadopago',
            environment,
            field: 'webhook_secret',
        });
    });

    it('rejects a Mercado Pago environment that disagrees with the credential prefix', async () => {
        const { service } = configHarness();
        global.fetch = jest.fn() as any;

        await expect(service.setConfig(TENANT, {
            provider: 'mercadopago',
            accessToken: 'APP_USR-tenant-token',
            webhookSecret: 'a-valid-webhook-secret-123',
            environment: 'sandbox',
        })).rejects.toMatchObject({ response: { error: 'mp_environment_mismatch' } });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rewraps every legacy Wompi field under the provider lock without a revision bump or unresolved guard', async () => {
        const legacyCrypto = new WhatsappCryptoService();
        const credentialCrypto = new TenantPaymentCredentialCryptoService();
        const initialSettings = {
            tenantPayments: {
                version: 2,
                activeProvider: 'wompi',
                providers: {
                    wompi: {
                        revision: 7,
                        publicKey: 'pub_prod_abcdefghijklmnop',
                        privateKeyEnc: legacyCrypto.encryptToken('prv_prod_abcdefghijklmnop'),
                        eventsSecretEnc: legacyCrypto.encryptToken('prod_events_abcdefghijklmnop'),
                        webhookTokenEnc: legacyCrypto.encryptToken('legacy-callback-token'),
                        environment: 'production',
                        merchantId: 'merchant-1',
                        merchantName: 'Merchant One',
                        verifiedAt: '2026-08-16T00:00:00.000Z',
                        webhookAcknowledgedAt: '2026-08-16T00:01:00.000Z',
                    },
                },
            },
        };
        const { service, paymentConfig, store, wompi, throttle } = configHarness({
            initialSettings,
            unresolved: true,
            entitled: false,
            crypto: legacyCrypto,
            credentialCrypto,
        });

        const result = await service.rewrapProviderCredentials(TENANT, 'wompi');

        const stored = (paymentConfig() as any).providers.wompi;
        expect(result).toMatchObject({ activeProvider: 'wompi', ready: true });
        expect(stored.revision).toBe(7);
        expect(stored.privateKeyEnc).toMatch(/^tpc:v2:test-current:/);
        expect(stored.eventsSecretEnc).toMatch(/^tpc:v2:test-current:/);
        expect(stored.webhookTokenEnc).toMatch(/^tpc:v2:test-current:/);
        expect(store.hasCredentialBoundHistoryForProvider).not.toHaveBeenCalled();
        expect(throttle.isFeatureEnabled).not.toHaveBeenCalled();
        expect(wompi.verifyMerchant).not.toHaveBeenCalled();
        expect(credentialCrypto.decrypt(stored.privateKeyEnc, {
            tenantId: TENANT,
            provider: 'wompi',
            environment: 'production',
            field: 'private_key',
        })).toBe('prv_prod_abcdefghijklmnop');
        expect(credentialCrypto.decrypt(stored.eventsSecretEnc, {
            tenantId: TENANT,
            provider: 'wompi',
            environment: 'production',
            field: 'events_secret',
        })).toBe('prod_events_abcdefghijklmnop');
        expect(credentialCrypto.decrypt(stored.webhookTokenEnc, {
            tenantId: TENANT,
            provider: 'wompi',
            environment: 'production',
            field: 'callback_token',
        })).toBe('legacy-callback-token');
    });

    it('derives legacy Mercado Pago environment and rewraps both fields without activating or changing revision', async () => {
        const legacyCrypto = new WhatsappCryptoService();
        const credentialCrypto = new TenantPaymentCredentialCryptoService();
        const initialSettings = {
            tenantPayments: {
                version: 2,
                activeProvider: null,
                providers: {
                    mercadopago: {
                        revision: 5,
                        accessTokenEnc: legacyCrypto.encryptToken('APP_USR-legacy-token'),
                        webhookSecretEnc: legacyCrypto.encryptToken('legacy-webhook-secret-123'),
                        accountEmail: 'legacy@example.test',
                        verifiedAt: '2026-08-16T00:00:00.000Z',
                    },
                },
            },
        };
        const { service, paymentConfig, store } = configHarness({
            initialSettings,
            unresolved: true,
            crypto: legacyCrypto,
            credentialCrypto,
        });

        const result = await service.rewrapProviderCredentials(TENANT, 'mercadopago');

        const root = paymentConfig() as any;
        const stored = root.providers.mercadopago;
        expect(result).toMatchObject({
            activeProvider: null,
            providers: {
                mercadopago: {
                    environment: 'production',
                    ready: false,
                    activationReady: false,
                },
            },
        });
        expect(root.activeProvider).toBeNull();
        expect(stored.environment).toBe('production');
        expect(stored.revision).toBe(5);
        expect(stored.accessTokenEnc).toMatch(/^tpc:v2:test-current:/);
        expect(stored.webhookSecretEnc).toMatch(/^tpc:v2:test-current:/);
        expect(store.hasCredentialBoundHistoryForProvider).not.toHaveBeenCalled();
        expect(credentialCrypto.decrypt(stored.accessTokenEnc, {
            tenantId: TENANT,
            provider: 'mercadopago',
            environment: 'production',
            field: 'access_token',
        })).toBe('APP_USR-legacy-token');
        expect(credentialCrypto.decrypt(stored.webhookSecretEnc, {
            tenantId: TENANT,
            provider: 'mercadopago',
            environment: 'production',
            field: 'webhook_secret',
        })).toBe('legacy-webhook-secret-123');
    });

    it('never opens plaintext or base64 Mercado Pago values through the legacy bridge', async () => {
        const legacyCrypto = new WhatsappCryptoService();
        const decryptSpy = jest.spyOn(legacyCrypto, 'decryptToken');
        const { service } = configHarness({
            initialSettings: {
                tenantPayments: {
                    accessTokenEnc: Buffer.from('APP_USR-raw-token').toString('base64'),
                    webhookSecretEnc: Buffer.from('raw-webhook-secret').toString('base64'),
                },
            },
            crypto: legacyCrypto,
            credentialCrypto: new TenantPaymentCredentialCryptoService(),
        });

        await expect(service.getMercadoPagoAccessToken(TENANT)).resolves.toBeNull();
        await expect(service.rewrapProviderCredentials(TENANT, 'mercadopago')).rejects.toMatchObject({
            status: 503,
        });
        expect(decryptSpy).not.toHaveBeenCalled();
    });

    it('preserves previous Wompi credential generation in history during rotation and enforces limit', async () => {
        const { service, paymentConfig } = configHarness();
        await service.setConfig(TENANT, {
            provider: 'wompi',
            publicKey: 'pub_prod_abcdefghijklmnop',
            privateKey: 'prv_prod_abcdefghijklmnop',
            eventsSecret: 'prod_events_abcdefghijklmnop',
        });

        await service.setConfig(TENANT, {
            provider: 'wompi',
            publicKey: 'pub_prod_abcdefghijklmnop',
            privateKey: 'prv_prod_replacementkey123',
            eventsSecret: 'prod_events_abcdefghijklmnop',
        });

        const stored = (paymentConfig() as any).providers.wompi;
        expect(stored.history).toHaveLength(1);
        expect(stored.history[0].publicKey).toBe('pub_prod_abcdefghijklmnop');

        for (let i = 1; i < 16; i++) {
            await service.setConfig(TENANT, {
                provider: 'wompi',
                publicKey: 'pub_prod_abcdefghijklmnop',
                privateKey: `prv_prod_rotation_${i}`,
                eventsSecret: 'prod_events_abcdefghijklmnop',
            });
        }

        await expect(service.setConfig(TENANT, {
            provider: 'wompi',
            publicKey: 'pub_prod_abcdefghijklmnop',
            privateKey: 'prv_prod_too_many_rotations',
            eventsSecret: 'prod_events_abcdefghijklmnop',
        })).rejects.toMatchObject({
            response: { error: 'payment_provider_credential_history_limit', provider: 'wompi' },
        });
    });

    it('rejects the same Wompi merchant key across tenants under the global claim lock', async () => {
        const { service, transaction } = configHarness({ duplicateMerchant: true });

        await expect(service.setConfig(TENANT, {
            provider: 'wompi',
            publicKey: 'pub_prod_abcdefghijklmnop',
            privateKey: 'prv_prod_abcdefghijklmnop',
            eventsSecret: 'prod_events_abcdefghijklmnop',
        })).rejects.toMatchObject({
            response: { error: 'wompi_merchant_already_connected', provider: 'wompi' },
        });
        expect(transaction.$queryRawUnsafe).toHaveBeenCalledWith(
            expect.stringContaining('pg_advisory_xact_lock'),
            'tenant-wompi-merchant:pub_prod_abcdefghijklmnop',
        );
        expect(transaction.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('rejects the same Mercado Pago collector account across tenants under the global claim lock', async () => {
        const { service, transaction } = configHarness({ duplicateMpAccount: true });
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ id: 123456789, email: 'owner@example.test' }),
        }) as any;

        await expect(service.setConfig(TENANT, {
            provider: 'mercadopago',
            accessToken: 'APP_USR-tenant-token',
            webhookSecret: 'a-valid-webhook-secret-123',
        })).rejects.toMatchObject({
            response: { error: 'mercadopago_account_already_connected', provider: 'mercadopago' },
        });
        expect(transaction.$queryRawUnsafe).toHaveBeenCalledWith(
            expect.stringContaining('pg_advisory_xact_lock'),
            'tenant-mercadopago-account:123456789',
        );
        expect(transaction.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('rejects arbitrary provider route values at runtime', async () => {
        const { service, redis } = configHarness();

        await expect(service.setConfig(TENANT, {
            provider: 'stripe' as any,
            privateKey: 'irrelevant',
        })).rejects.toMatchObject({ response: { error: 'unsupported_payment_provider' } });
        expect(redis.acquireLockToken).not.toHaveBeenCalled();
    });
});
