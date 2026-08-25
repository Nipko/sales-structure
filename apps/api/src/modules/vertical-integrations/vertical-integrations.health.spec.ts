import { VerticalIntegrationsService } from './vertical-integrations.service';
import { reduceIntegrationHealth } from './integration-health';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';
import { fakeSettingsTransaction, fakeSettingsWriter } from '../../common/utils/tenant-settings-branch.fixture';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const readableBinding = {
    resolve: jest.fn(async (_tenantId: string, input: any) => ({
        version: 1, ...input, mode: 'tenant_wide_conservative', bindingId: null,
        externalId: null, generation: 0, owner: 'external', allowExternalRead: true,
        allowExternalWrite: false, allowLocalWrite: false,
        reason: 'resource_binding_required', cache: 'not_cached',
    })),
};

describe('VerticalIntegrationsService health and tool gate', () => {
    let settings: any;
    let prisma: any;
    let redis: any;
    let http: any;
    let service: VerticalIntegrationsService;

    beforeEach(() => {
        settings = {
            verticalIntegrations: {
                toast: {
                    provider: 'toast',
                    hostname: 'https://ws-api.toasttab.com',
                    clientId: 'legacy-client-id',
                    clientSecret: 'legacy-secret',
                    locationGuid: 'location',
                },
            },
            verticalIntegrationHealth: {},
        };
        prisma = {
            tenant: {
                findUnique: jest.fn(async () => ({ settings })),
            },
            getTenantSchemaName: jest.fn(async () => 'tenant_acme'),
            assertTenantSchemaName: jest.fn(),
            executeInTenantSchema: jest.fn(async () => []),
        };
        prisma.$executeRawUnsafe = jest.fn(fakeSettingsWriter(
            () => settings,
            (next) => { settings = next; },
        ));
        prisma.$transaction = jest.fn(fakeSettingsTransaction(
            () => settings,
            (next) => { settings = next; },
        ));
        redis = { del: jest.fn().mockResolvedValue(1) };
        http = {
            axiosRef: {
                get: jest.fn(() => { throw new Error('unexpected network'); }),
                post: jest.fn(() => { throw new Error('unexpected network'); }),
            },
        };
        service = new VerticalIntegrationsService(
            prisma,
            redis,
            http,
            { runExclusive: jest.fn() } as any,
            { get: jest.fn().mockReturnValue('') } as any,
            new TenantSecretCryptoService(),
            readableBinding as any,
        );
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    });

    it('fails closed for legacy credentials in the existing tool-registration method', async () => {
        await expect(service.getConnectedProviders(TENANT_ID)).resolves.toEqual({
            toast: false,
            mindbody: false,
            cliniko: false,
        });
        await expect(service.getAllConfigs(TENANT_ID)).resolves.toMatchObject({
            toast: {
                clientId: 'legacy-client-id',
                clientSecret: '***',
                connected: false,
                status: 'unavailable',
                health: {
                    credentialValidated: false,
                    status: 'unavailable',
                },
            },
        });
    });

    it('reports durable ownership independently from failed health', async () => {
        await expect(service.getConfiguredProviderBindings(TENANT_ID)).resolves.toEqual({
            toast: true,
            mindbody: false,
            cliniko: false,
        });
        const health = await service.getProviderHealth(TENANT_ID, 'toast');
        expect(health).toMatchObject({ configured: true, connected: false, status: 'unavailable' });
    });

    it('rejects Cliniko for farmacia before storing or calling the provider', async () => {
        settings.verticalConfig = { industry: 'salud', subType: 'farmacia' };
        await expect(service.updateConfig(TENANT_ID, 'cliniko', {
            provider: 'cliniko',
            apiKey: 'secret',
            baseUrl: 'https://api.au1.cliniko.com/v1',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'provider_not_applicable' }),
        });
        expect(http.axiosRef.get).not.toHaveBeenCalled();
        expect(http.axiosRef.post).not.toHaveBeenCalled();
    });

    it('registers a provider only while its durable health is fresh and healthy', async () => {
        const now = new Date();
        settings.verticalIntegrationHealth.toast = reduceIntegrationHealth(undefined, 'toast', {
            outcome: 'success',
            syncSucceeded: true,
            checkedAt: now.toISOString(),
        }, now);
        expect((await service.getConnectedProviders(TENANT_ID)).toast).toBe(true);

        const old = new Date(now.getTime() - 48 * 60 * 60 * 1000);
        settings.verticalIntegrationHealth.toast = reduceIntegrationHealth(undefined, 'toast', {
            outcome: 'success',
            syncSucceeded: true,
            checkedAt: old.toISOString(),
        }, old);
        expect((await service.getConnectedProviders(TENANT_ID)).toast).toBe(false);
        expect((await service.getProviderHealth(TENANT_ID, 'toast')).status).toBe('stale');
    });

    it('blocks AI reads before touching synced data when health is not healthy', async () => {
        const listItems = jest.spyOn(service as any, 'listItemsInSchema').mockResolvedValue([]);

        await expect(service.getMenuForAI(TENANT_ID, 'tenant_schema')).resolves.toMatchObject({
            error: 'integration_unavailable',
            provider: 'toast',
            integrationStatus: 'unavailable',
        });

        expect(listItems).not.toHaveBeenCalled();
        expect(http.axiosRef.get).not.toHaveBeenCalled();
        expect(http.axiosRef.post).not.toHaveBeenCalled();
    });

    it('allows the AI read only after a healthy sync record', async () => {
        const now = new Date();
        settings.verticalIntegrationHealth.toast = reduceIntegrationHealth(undefined, 'toast', {
            outcome: 'success',
            syncSucceeded: true,
            checkedAt: now.toISOString(),
        }, now);
        const listItems = jest.spyOn(service as any, 'listItemsInSchema').mockResolvedValue([{
            title: 'Arepa',
            subtitle: 'Desayunos',
            price_cents: 1200,
            currency: 'USD',
            data: { description: 'Asada' },
        }]);

        await expect(service.getMenuForAI(TENANT_ID, 'tenant_schema')).resolves.toMatchObject({
            source: 'toast',
            items: [{ name: 'Arepa', price: 12 }],
        });
        expect(listItems).toHaveBeenCalledWith('tenant_schema', 'toast', 'menu_item', 80);
    });

    it('fails the provider read closed when the tenant-scope binding is conflicted', async () => {
        const now = new Date();
        settings.verticalIntegrationHealth.toast = reduceIntegrationHealth(undefined, 'toast', {
            outcome: 'success', syncSucceeded: true, checkedAt: now.toISOString(),
        }, now);
        readableBinding.resolve.mockResolvedValueOnce({
            version: 1, provider: 'toast', connectionId: 'location',
            resourceType: 'location', resourceId: 'all', mode: 'conflict',
            bindingId: null, externalId: null, generation: 9, owner: 'blocked',
            allowExternalRead: false, allowExternalWrite: false, allowLocalWrite: false,
            reason: 'binding_conflict', cache: 'not_cached',
        });
        const listItems = jest.spyOn(service as any, 'listItemsInSchema').mockResolvedValue([]);

        await expect(service.getMenuForAI(TENANT_ID, 'tenant_schema')).resolves.toMatchObject({
            error: 'integration_unavailable',
            integrationProjection: { binding: { mode: 'conflict', generation: 9 } },
        });
        expect(listItems).not.toHaveBeenCalled();
    });

    // The public read takes a tenantId: the controller has no schema name to give,
    // and passing the tenantId through as one killed the endpoint with a 3F000.
    it('resolves the physical schema for the tenant-facing item read', async () => {
        redis.get = jest.fn().mockResolvedValue('1');

        await service.listItems(TENANT_ID, 'toast', 'menu_item');

        expect(prisma.getTenantSchemaName).toHaveBeenCalledWith(TENANT_ID);
        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(
            'tenant_acme',
            expect.stringContaining('FROM vi_items'),
            ['toast', 'menu_item', 100],
        );
    });

    it('persists a provider-scoped update once when the same updateId is retried', async () => {
        await service.updateHealth(TENANT_ID, 'toast', {
            outcome: 'failure',
            updateId: 'sync-attempt-1',
            error: new Error('https://provider.example?secret=do-not-store'),
        });
        await service.updateHealth(TENANT_ID, 'toast', {
            outcome: 'failure',
            updateId: 'sync-attempt-1',
            error: new Error('https://provider.example?secret=do-not-store'),
        });

        // Both retries lock and compare the live row; the second transform is
        // an explicit no-op and does not churn updated_at or invalidate cache.
        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(settings.verticalIntegrationHealth.toast.consecutiveFailures).toBe(1);
        expect(JSON.stringify(settings.verticalIntegrationHealth.toast)).not.toContain('do-not-store');
        expect(redis.del).toHaveBeenCalledWith(`vi:connected:${TENANT_ID}`);
    });

    it('ignores health returned by credentials that were replaced while the request ran', async () => {
        settings.verticalIntegrations.toast.configRevision = 7;
        settings.verticalIntegrationHealth.toast = reduceIntegrationHealth(undefined, 'toast', {
            outcome: 'success',
            syncSucceeded: true,
            configRevision: 7,
        });
        const before = JSON.stringify(settings.verticalIntegrationHealth.toast);
        prisma.$executeRawUnsafe.mockClear();
        redis.del.mockClear();

        const health = await service.updateHealth(TENANT_ID, 'toast', {
            outcome: 'failure',
            configRevision: 6,
            error: Object.assign(new Error('old credential rejected'), { status: 401 }),
        });

        expect(JSON.stringify(settings.verticalIntegrationHealth.toast)).toBe(before);
        expect(health.configRevision).toBe(7);
        expect(health.credentialValidated).toBe(true);
        expect(redis.del).not.toHaveBeenCalled();
    });

    it('separates live Cliniko availability from its stale services mirror', async () => {
        settings.verticalConfig = { industry: 'salud', subType: 'dental' };
        settings.verticalIntegrations = {
            cliniko: {
                provider: 'cliniko', apiKey: 'legacy',
                baseUrl: 'https://api.au1.cliniko.com/v1', configRevision: 1,
            },
        };
        const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
        settings.verticalIntegrationHealth.cliniko = reduceIntegrationHealth(undefined, 'cliniko', {
            outcome: 'success', syncSucceeded: true,
            checkedAt: old.toISOString(), configRevision: 1,
        }, old);

        await expect(service.getToolGate(
            TENANT_ID, 'cliniko', 'check_clinic_availability',
        )).resolves.toMatchObject({ allowed: true });
        await expect(service.getToolGate(
            TENANT_ID, 'cliniko', 'list_clinic_services',
        )).resolves.toMatchObject({ allowed: false });
    });
});
