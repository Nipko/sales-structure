import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { VerticalIntegrationsService } from './vertical-integrations.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';
import { fakeSettingsTransaction, fakeSettingsWriter } from '../../common/utils/tenant-settings-branch.fixture';

// El sobre de credenciales ata el valor a su tenant, asi que el id tiene que
// ser un UUID real y no una etiqueta.
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('VerticalIntegrationsService endpoint security', () => {
    let service: VerticalIntegrationsService;
    let prisma: any;
    let redis: any;
    let http: any;
    let appConfig: any;
    let lookupSpy: jest.SpyInstance;
    let settings: Record<string, any>;

    beforeEach(() => {
        // Guardar una credencial que no se puede cifrar es exactamente lo que
        // este servicio ya no hace: sin clave, `updateConfig` falla cerrado.
        process.env.TENANT_SECRET_KEY = 'a'.repeat(64);
        settings = {};
        prisma = {
            tenant: {
                findUnique: jest.fn(async () => ({ settings })),
                update: jest.fn().mockResolvedValue({}),
                findMany: jest.fn(),
            },
        };
        prisma.$executeRawUnsafe = jest.fn(fakeSettingsWriter(
            () => settings,
            (next) => { settings = next; },
        ));
        prisma.$transaction = jest.fn(fakeSettingsTransaction(
            () => settings,
            (next) => { settings = next; },
        ));
        redis = {
            del: jest.fn().mockResolvedValue(undefined),
        };
        http = {
            axiosRef: {
                get: jest.fn().mockResolvedValue({ data: {} }),
                post: jest.fn().mockResolvedValue({ data: { token: { accessToken: 'token' } } }),
            },
        };
        appConfig = {
            get: jest.fn().mockReturnValue(''),
        };
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.10', family: 4 },
        ] as any);

        service = new VerticalIntegrationsService(
            prisma,
            redis,
            http,
            { runExclusive: jest.fn() } as any,
            appConfig,
            new TenantSecretCryptoService(),
            {
                resolve: jest.fn(async (_tenantId: string, input: any) => ({
                    version: 1, ...input, mode: 'tenant_wide_conservative', bindingId: null,
                    externalId: null, generation: 0, owner: 'external', allowExternalRead: true,
                    allowExternalWrite: false, allowLocalWrite: false,
                    reason: 'resource_binding_required', cache: 'not_cached',
                })),
            } as any,
        );
    });

    afterEach(() => {
        lookupSpy.mockRestore();
    });

    it('rejects non-HTTPS provider endpoints before persisting them', async () => {
        await expect(service.updateConfig(TENANT_ID, 'toast', {
            hostname: 'http://ws-api.toasttab.com',
        })).rejects.toBeInstanceOf(BadRequestException);

        // Un endpoint rechazado no escribe nada, por ninguna de las dos vías.
        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('rejects provider lookalike domains', async () => {
        await expect(service.updateConfig(TENANT_ID, 'cliniko', {
            baseUrl: 'https://api.au1.cliniko.com.attacker.example/v1',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(lookupSpy).not.toHaveBeenCalled();
        // Un endpoint rechazado no escribe nada, por ninguna de las dos vías.
        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it.each([
        ['private IPv4', '10.20.30.40', 4],
        ['link-local IPv4', '169.254.169.254', 4],
        ['loopback IPv6', '::1', 6],
        ['link-local IPv6', 'fe80::1', 6],
        ['IPv4-mapped loopback', '::ffff:127.0.0.1', 6],
        ['IPv4-mapped hexadecimal loopback', '::ffff:7f00:1', 6],
    ])('rejects an explicitly allowlisted hostname resolving to %s', async (_label, address, family) => {
        appConfig.get.mockImplementation((key: string) => (
            key === 'VERTICAL_INTEGRATIONS_CLINIKO_ALLOWED_HOSTS' ? 'cliniko-proxy.example.com' : ''
        ));
        lookupSpy.mockResolvedValue([{ address, family }] as any);

        await expect(service.updateConfig(TENANT_ID, 'cliniko', {
            baseUrl: 'https://cliniko-proxy.example.com/v1',
        })).rejects.toBeInstanceOf(BadRequestException);

        // Un endpoint rechazado no escribe nada, por ninguna de las dos vías.
        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('rejects a mixed DNS answer instead of selecting only its public address', async () => {
        lookupSpy.mockResolvedValue([
            { address: '203.0.114.10', family: 4 },
            { address: '10.0.0.7', family: 4 },
        ] as any);

        await expect(service.updateConfig(TENANT_ID, 'toast', {
            hostname: 'https://ws-api.toasttab.com',
        })).rejects.toBeInstanceOf(BadRequestException);

        // Un endpoint rechazado no escribe nada, por ninguna de las dos vías.
        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('accepts and normalizes an official Cliniko shard URL', async () => {
        await service.updateConfig(TENANT_ID, 'cliniko', {
            apiKey: 'secret-au1',
            baseUrl: 'https://api.au1.cliniko.com/v1/',
        });

        // Config + revision + health reset are one row-locked mutation: a
        // health response from the old credential cannot win afterwards.
        expect(settings.verticalIntegrations.cliniko).toEqual(expect.objectContaining({
            provider: 'cliniko',
            baseUrl: 'https://api.au1.cliniko.com/v1',
            configRevision: 1,
        }));

        // Guardar una credencial nunca es haberla validado: la salud se
        // reinicia en la misma operación.
        expect(settings.verticalIntegrationHealth.cliniko).toEqual(expect.objectContaining({
            credentialValidated: false,
            lastCheckedAt: null,
            configRevision: 1,
        }));
    });

    it('accepts only an exact public hostname added through the operator allowlist', async () => {
        appConfig.get.mockImplementation((key: string) => (
            key === 'VERTICAL_INTEGRATIONS_TOAST_ALLOWED_HOSTS' ? 'toast-api.partner.example' : ''
        ));

        await service.updateConfig(TENANT_ID, 'toast', {
            hostname: 'https://toast-api.partner.example',
        });

        expect(settings.verticalIntegrations.toast).toEqual(expect.objectContaining({
            hostname: 'https://toast-api.partner.example', configRevision: 1,
        }));

        await expect(service.updateConfig(TENANT_ID, 'toast', {
            hostname: 'https://sub.toast-api.partner.example',
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('disables redirects on tenant-configured Cliniko requests', async () => {
        settings = {
                verticalIntegrations: {
                    cliniko: {
                        provider: 'cliniko',
                        apiKey: 'secret-au1',
                        baseUrl: 'https://api.au1.cliniko.com/v1',
                    },
                },
        };

        await expect(service.testConnection(TENANT_ID, 'cliniko')).resolves.toEqual(expect.objectContaining({
            ok: true,
            health: expect.objectContaining({
                provider: 'cliniko',
                connected: true,
                credentialValidated: true,
                scopeStatus: 'satisfied',
                status: 'stale',
            }),
        }));
        expect(http.axiosRef.get).toHaveBeenCalledWith(
            'https://api.au1.cliniko.com/v1/appointment_types?per_page=1',
            expect.objectContaining({
                maxRedirects: 0,
                maxContentLength: 8 * 1024 * 1024,
                maxBodyLength: 1024 * 1024,
                proxy: false,
                httpsAgent: expect.any(Object),
            }),
        );
    });

    it('pins the validated public address so a later DNS rebind cannot change the connection', async () => {
        settings = {
                verticalIntegrations: {
                    cliniko: {
                        provider: 'cliniko',
                        apiKey: 'secret-au1',
                        baseUrl: 'https://api.au1.cliniko.com/v1',
                    },
                },
        };

        await service.testConnection(TENANT_ID, 'cliniko');
        const requestConfig = http.axiosRef.get.mock.calls[0][1];
        const pinnedLookup = requestConfig.httpsAgent.options.lookup;

        lookupSpy.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
        const callback = jest.fn();
        pinnedLookup('api.au1.cliniko.com', { all: false }, callback);

        expect(callback).toHaveBeenCalledWith(null, '203.0.114.10', 4);
        expect(lookupSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects an agent lookup for any hostname other than the one that was validated', async () => {
        settings = {
                verticalIntegrations: {
                    cliniko: {
                        provider: 'cliniko',
                        apiKey: 'secret-au1',
                        baseUrl: 'https://api.au1.cliniko.com/v1',
                    },
                },
        };

        await service.testConnection(TENANT_ID, 'cliniko');
        const pinnedLookup = http.axiosRef.get.mock.calls[0][1].httpsAgent.options.lookup;
        const callback = jest.fn();
        pinnedLookup('metadata.google.internal', { all: false }, callback);

        expect(callback.mock.calls[0][0]).toEqual(expect.objectContaining({ code: 'EAI_FAIL' }));
    });

    it('disables redirects when exchanging Toast credentials', async () => {
        settings = {
                verticalIntegrations: {
                    toast: {
                        provider: 'toast',
                        hostname: 'https://ws-api.toasttab.com',
                        clientId: 'client',
                        clientSecret: 'secret',
                        locationGuid: 'location',
                    },
                },
        };

        await expect(service.testConnection(TENANT_ID, 'toast')).resolves.toEqual(expect.objectContaining({
            ok: true,
            health: expect.objectContaining({
                provider: 'toast',
                connected: true,
                credentialValidated: true,
                status: 'stale',
            }),
        }));
        expect(http.axiosRef.post).toHaveBeenCalledWith(
            'https://ws-api.toasttab.com/authentication/v1/authentication/login',
            expect.any(Object),
            expect.objectContaining({
                maxRedirects: 0,
                maxContentLength: 8 * 1024 * 1024,
                maxBodyLength: 1024 * 1024,
                proxy: false,
                httpsAgent: expect.any(Object),
            }),
        );
    });

    it('records a sanitized unhealthy/missing-scope result when a provider returns 403', async () => {
        settings = {
                verticalIntegrations: {
                    cliniko: {
                        provider: 'cliniko',
                        apiKey: 'secret-au1',
                        baseUrl: 'https://api.au1.cliniko.com/v1',
                    },
                },
        };
        http.axiosRef.get.mockRejectedValue({
            response: { status: 403, data: { token: 'never-persist-this' } },
            message: 'request failed with secret-au1',
        });

        const result = await service.testConnection(TENANT_ID, 'cliniko');

        expect(result).toMatchObject({
            ok: false,
            message: 'Permisos insuficientes en el proveedor.',
            health: {
                status: 'unhealthy',
                connected: false,
                scopeStatus: 'missing',
                requiredScopes: ['appointment_types:read'],
                lastError: {
                    code: 'http_403',
                    message: 'Permisos insuficientes en el proveedor.',
                },
            },
        });
        const persistedHealth = JSON.stringify(settings.verticalIntegrationHealth.cliniko);
        expect(persistedHealth).not.toContain('never-persist-this');
        expect(persistedHealth).not.toContain('secret-au1');
    });

    it('does not interpolate untrusted Cliniko identifiers into the request path', async () => {
        settings = {
                verticalIntegrations: {
                    cliniko: {
                        provider: 'cliniko',
                        apiKey: 'secret-au1',
                        baseUrl: 'https://api.au1.cliniko.com/v1',
                        businessId: '123',
                        practitionerId: '456',
                    },
                },
                verticalIntegrationHealth: {
                    cliniko: {
                        version: 1,
                        provider: 'cliniko',
                        credentialValidated: true,
                        requiredScopes: ['appointment_types:read'],
                        grantedScopes: ['appointment_types:read'],
                        scopeStatus: 'satisfied',
                        lastCheckedAt: new Date().toISOString(),
                        lastSuccessfulSyncAt: new Date().toISOString(),
                        consecutiveFailures: 0,
                        circuitState: 'closed',
                        lastError: null,
                    },
                },
        };

        await expect(service.checkClinikoAvailability(
            TENANT_ID,
            '789/../../users?admin=true',
        )).resolves.toMatchObject({
            availableTimes: [],
            error: 'Identificador de disponibilidad inválido',
            integrationStatus: 'healthy',
        });

        expect(http.axiosRef.get).not.toHaveBeenCalled();
        expect(lookupSpy).not.toHaveBeenCalled();
    });
});
