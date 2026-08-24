import { ChannelManagerSyncService } from './channel-manager-sync.service';
import { LodgingSourceOfTruthService } from './lodging-source-of-truth.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const LISTING_ID = '33333333-3333-4333-8333-333333333333';
const SCHEMA = 'tenant_lodging_cache';

function inMemoryRedis() {
    let generation: number | null = null;
    const values = new Map<string, unknown>();
    return {
        values,
        get: jest.fn(async () => generation === null ? null : String(generation)),
        incr: jest.fn(async () => {
            generation = (generation ?? 0) + 1;
            return generation;
        }),
        getJson: jest.fn(async (key: string) => values.get(key) ?? null),
        setJson: jest.fn(async (key: string, value: unknown) => { values.set(key, value); }),
    };
}

describe('Lodging SoR tenant cache generation', () => {
    it('makes a pre-connection local decision unreachable after Channel Manager sync', async () => {
        const redis = inMemoryRedis();
        let config: any = { provider: 'direct', syncInterval: 60 };
        let listings: any[] = [];
        const tenantSettings: any = {
            channelManager: { provider: 'direct', syncInterval: 60 },
        };
        const prisma = {
            tenant: {
                findMany: jest.fn(async () => [{
                    id: TENANT_ID,
                    schemaName: SCHEMA,
                    settings: tenantSettings,
                }]),
            },
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                if (/MAX\(last_synced_at\)/i.test(sql)) return [{ last_synced_at: null }];
                if (/FROM cm_listings/i.test(sql)) return listings;
                return [];
            }),
        };
        const channelManager = {
            getConfig: jest.fn(async () => config),
            syncHostaway: jest.fn(async () => {
                listings = [{
                    id: LISTING_ID,
                    provider: 'hostaway',
                    last_synced_at: new Date().toISOString(),
                }];
                return { listings: 1, reservations: 0 };
            }),
        };
        const lodgingSor = new LodgingSourceOfTruthService(
            prisma as any,
            redis as any,
            channelManager as any,
        );
        const sync = new ChannelManagerSyncService(
            prisma as any,
            channelManager as any,
            lodgingSor,
            {} as any,
        );

        expect(await lodgingSor.resolveForProperty(TENANT_ID, SCHEMA, PROPERTY_ID))
            .toMatchObject({ sor: 'local' });
        expect(redis.values.has(`lodging:sor:${TENANT_ID}:v0:${PROPERTY_ID}`)).toBe(true);

        // The owner connects Hostaway after the local decision was cached.
        // Until sync publishes the mapping, the v0 value is indeed still what
        // the old implementation would serve.
        config = { provider: 'hostaway', syncInterval: 60 };
        tenantSettings.channelManager = config;
        expect(await lodgingSor.resolveForProperty(TENANT_ID, SCHEMA, PROPERTY_ID))
            .toMatchObject({ sor: 'local' });

        await expect(sync.syncDueTenants()).resolves.toEqual({ tenants: 1, synced: 1, failed: 0 });
        expect(redis.incr).toHaveBeenCalledWith(`lodging:sor:version:${TENANT_ID}`);

        const afterSync = await lodgingSor.resolveForProperty(TENANT_ID, SCHEMA, PROPERTY_ID);
        expect(afterSync).toMatchObject({
            sor: 'channel_manager',
            listingId: LISTING_ID,
            writerBlockedReason: 'channel_manager_owns_calendar',
        });
        expect(redis.values.has(`lodging:sor:${TENANT_ID}:v1:${PROPERTY_ID}`)).toBe(true);
    });

    it('fences a stale resolution that finishes after invalidation', async () => {
        const redis = inMemoryRedis();
        let releaseRead!: (rows: any[]) => void;
        let signalReadStarted!: () => void;
        const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve; });
        let reads = 0;
        const prisma = {
            executeInTenantSchema: jest.fn(() => {
                reads++;
                if (reads === 1) {
                    return new Promise<any[]>((release) => {
                        releaseRead = release;
                        signalReadStarted();
                    });
                }
                return Promise.resolve([{
                    id: LISTING_ID,
                    provider: 'hostaway',
                    last_synced_at: new Date().toISOString(),
                }]);
            }),
        };
        let config: any = { provider: 'direct', syncInterval: 60 };
        const service = new LodgingSourceOfTruthService(
            prisma as any,
            redis as any,
            { getConfig: jest.fn(async () => config) } as any,
        );

        const staleResolution = service.resolveForProperty(TENANT_ID, SCHEMA, PROPERTY_ID);
        await readStarted;
        await service.invalidate(TENANT_ID);
        releaseRead([]);
        await expect(staleResolution).resolves.toMatchObject({ sor: 'local' });

        // The late writer stored only under v0. Current readers use v1 and
        // therefore cannot observe it.
        expect(redis.values.has(`lodging:sor:${TENANT_ID}:v0:${PROPERTY_ID}`)).toBe(true);
        config = { provider: 'hostaway', syncInterval: 60 };
        await expect(service.resolveForProperty(TENANT_ID, SCHEMA, PROPERTY_ID)).resolves
            .toMatchObject({ sor: 'channel_manager', listingId: LISTING_ID });
        expect(redis.getJson).toHaveBeenLastCalledWith(
            `lodging:sor:${TENANT_ID}:v1:${PROPERTY_ID}`,
        );
    });
});
