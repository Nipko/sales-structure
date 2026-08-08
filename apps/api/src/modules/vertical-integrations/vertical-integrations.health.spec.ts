import { VerticalIntegrationsService } from './vertical-integrations.service';
import { reduceIntegrationHealth } from './integration-health';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

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
            $executeRawUnsafe: jest.fn(async (_sql: string, _tenantId: string, provider: string, json: string) => {
                settings.verticalIntegrationHealth[provider] = JSON.parse(json);
                return 1;
            }),
        };
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
        const listItems = jest.spyOn(service, 'listItems').mockResolvedValue([]);

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
        const listItems = jest.spyOn(service, 'listItems').mockResolvedValue([{
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

        expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
        expect(settings.verticalIntegrationHealth.toast.consecutiveFailures).toBe(1);
        expect(JSON.stringify(settings.verticalIntegrationHealth.toast)).not.toContain('do-not-store');
        expect(redis.del).toHaveBeenCalledWith(`vi:connected:${TENANT_ID}`);
    });
});
