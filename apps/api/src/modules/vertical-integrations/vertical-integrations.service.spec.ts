import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { VerticalIntegrationsService } from './vertical-integrations.service';

describe('VerticalIntegrationsService endpoint security', () => {
    let service: VerticalIntegrationsService;
    let prisma: any;
    let redis: any;
    let http: any;
    let appConfig: any;
    let lookupSpy: jest.SpyInstance;

    beforeEach(() => {
        prisma = {
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
            tenant: {
                findUnique: jest.fn().mockResolvedValue({ settings: {} }),
                update: jest.fn().mockResolvedValue({}),
                findMany: jest.fn(),
            },
        };
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
        );
    });

    afterEach(() => {
        lookupSpy.mockRestore();
    });

    it('rejects non-HTTPS provider endpoints before persisting them', async () => {
        await expect(service.updateConfig('tenant-1', 'toast', {
            hostname: 'http://ws-api.toasttab.com',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('rejects provider lookalike domains', async () => {
        await expect(service.updateConfig('tenant-1', 'cliniko', {
            baseUrl: 'https://api.au1.cliniko.com.attacker.example/v1',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(lookupSpy).not.toHaveBeenCalled();
        expect(prisma.tenant.update).not.toHaveBeenCalled();
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

        await expect(service.updateConfig('tenant-1', 'cliniko', {
            baseUrl: 'https://cliniko-proxy.example.com/v1',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('rejects a mixed DNS answer instead of selecting only its public address', async () => {
        lookupSpy.mockResolvedValue([
            { address: '203.0.114.10', family: 4 },
            { address: '10.0.0.7', family: 4 },
        ] as any);

        await expect(service.updateConfig('tenant-1', 'toast', {
            hostname: 'https://ws-api.toasttab.com',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('accepts and normalizes an official Cliniko shard URL', async () => {
        await service.updateConfig('tenant-1', 'cliniko', {
            apiKey: 'secret-au1',
            baseUrl: 'https://api.au1.cliniko.com/v1/',
        });

        expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'tenant-1' },
            data: {
                settings: expect.objectContaining({
                    verticalIntegrations: {
                        cliniko: expect.objectContaining({
                            provider: 'cliniko',
                            baseUrl: 'https://api.au1.cliniko.com/v1',
                        }),
                    },
                    verticalIntegrationHealth: {
                        cliniko: expect.objectContaining({
                            credentialValidated: false,
                            lastCheckedAt: null,
                        }),
                    },
                }),
            },
        }));
    });

    it('accepts only an exact public hostname added through the operator allowlist', async () => {
        appConfig.get.mockImplementation((key: string) => (
            key === 'VERTICAL_INTEGRATIONS_TOAST_ALLOWED_HOSTS' ? 'toast-api.partner.example' : ''
        ));

        await service.updateConfig('tenant-1', 'toast', {
            hostname: 'https://toast-api.partner.example',
        });

        expect(prisma.tenant.update).toHaveBeenCalled();

        await expect(service.updateConfig('tenant-1', 'toast', {
            hostname: 'https://sub.toast-api.partner.example',
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('disables redirects on tenant-configured Cliniko requests', async () => {
        prisma.tenant.findUnique.mockResolvedValue({
            settings: {
                verticalIntegrations: {
                    cliniko: {
                        provider: 'cliniko',
                        apiKey: 'secret-au1',
                        baseUrl: 'https://api.au1.cliniko.com/v1',
                    },
                },
            },
        });

        await expect(service.testConnection('tenant-1', 'cliniko')).resolves.toEqual(expect.objectContaining({
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
        prisma.tenant.findUnique.mockResolvedValue({
            settings: {
                verticalIntegrations: {
                    cliniko: {
                        provider: 'cliniko',
                        apiKey: 'secret-au1',
                        baseUrl: 'https://api.au1.cliniko.com/v1',
                    },
                },
            },
        });

        await service.testConnection('tenant-1', 'cliniko');
        const requestConfig = http.axiosRef.get.mock.calls[0][1];
        const pinnedLookup = requestConfig.httpsAgent.options.lookup;

        lookupSpy.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
        const callback = jest.fn();
        pinnedLookup('api.au1.cliniko.com', { all: false }, callback);

        expect(callback).toHaveBeenCalledWith(null, '203.0.114.10', 4);
        expect(lookupSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects an agent lookup for any hostname other than the one that was validated', async () => {
        prisma.tenant.findUnique.mockResolvedValue({
            settings: {
                verticalIntegrations: {
                    cliniko: {
                        provider: 'cliniko',
                        apiKey: 'secret-au1',
                        baseUrl: 'https://api.au1.cliniko.com/v1',
                    },
                },
            },
        });

        await service.testConnection('tenant-1', 'cliniko');
        const pinnedLookup = http.axiosRef.get.mock.calls[0][1].httpsAgent.options.lookup;
        const callback = jest.fn();
        pinnedLookup('metadata.google.internal', { all: false }, callback);

        expect(callback.mock.calls[0][0]).toEqual(expect.objectContaining({ code: 'EAI_FAIL' }));
    });

    it('disables redirects when exchanging Toast credentials', async () => {
        prisma.tenant.findUnique.mockResolvedValue({
            settings: {
                verticalIntegrations: {
                    toast: {
                        provider: 'toast',
                        hostname: 'https://ws-api.toasttab.com',
                        clientId: 'client',
                        clientSecret: 'secret',
                        locationGuid: 'location',
                    },
                },
            },
        });

        await expect(service.testConnection('tenant-1', 'toast')).resolves.toEqual(expect.objectContaining({
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
        prisma.tenant.findUnique.mockResolvedValue({
            settings: {
                verticalIntegrations: {
                    cliniko: {
                        provider: 'cliniko',
                        apiKey: 'secret-au1',
                        baseUrl: 'https://api.au1.cliniko.com/v1',
                    },
                },
            },
        });
        http.axiosRef.get.mockRejectedValue({
            response: { status: 403, data: { token: 'never-persist-this' } },
            message: 'request failed with secret-au1',
        });

        const result = await service.testConnection('tenant-1', 'cliniko');

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
        const persistedHealth = prisma.$executeRawUnsafe.mock.calls[0][3];
        expect(persistedHealth).not.toContain('never-persist-this');
        expect(persistedHealth).not.toContain('secret-au1');
    });

    it('does not interpolate untrusted Cliniko identifiers into the request path', async () => {
        prisma.tenant.findUnique.mockResolvedValue({
            settings: {
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
            },
        });

        await expect(service.checkClinikoAvailability(
            'tenant-1',
            '789/../../users?admin=true',
        )).resolves.toEqual({
            availableTimes: [],
            error: 'Identificador de disponibilidad inválido',
            integrationStatus: 'healthy',
        });

        expect(http.axiosRef.get).not.toHaveBeenCalled();
        expect(lookupSpy).not.toHaveBeenCalled();
    });
});
