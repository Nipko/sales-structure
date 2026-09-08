import { DispatchRolloutService } from './dispatch-rollout.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

describe('DispatchRolloutService', () => {
    function harness(stored?: any, options: { redisFails?: boolean; dbFails?: boolean } = {}) {
        const redis = {
            getJson: jest.fn(async () => { if (options.redisFails) throw new Error('redis down'); return null; }),
            setJson: jest.fn(async () => undefined),
        };
        const prisma = { $queryRaw: jest.fn(async () => {
            if (options.dbFails) throw new Error('settings unavailable');
            return stored === undefined ? [] : [{ value: typeof stored === 'string' ? stored : JSON.stringify(stored) }];
        }) };
        return { service: new DispatchRolloutService(prisma as any, redis as any), redis, prisma };
    }

    it('is off when nothing was ever written', async () => {
        const h = harness();
        await expect(h.service.config()).resolves.toEqual({ enabled: false, tenantIds: [], channels: [] });
        await expect(h.service.enabledFor(tenantId, 'whatsapp')).resolves.toBe(false);
    });

    it('stays off when the switch is on but no channel was named', async () => {
        // Turning the master switch on alone must change nothing: a channel has
        // to be listed deliberately, and only migrated ones can work anyway.
        const h = harness({ enabled: true });
        await expect(h.service.enabledFor(tenantId, 'whatsapp')).resolves.toBe(false);
    });

    it('limits the new path to the named channels and the pilot tenants', async () => {
        const h = harness({ enabled: true, channels: ['whatsapp'], tenantIds: [tenantId] });
        await expect(h.service.enabledFor(tenantId, 'whatsapp')).resolves.toBe(true);
        await expect(h.service.enabledFor(other, 'whatsapp')).resolves.toBe(false);
        await expect(h.service.enabledFor(tenantId, 'messenger')).resolves.toBe(false);
    });

    it('treats an empty pilot list as every tenant, once a channel is named', async () => {
        const h = harness({ enabled: true, channels: ['whatsapp', 'messenger'] });
        await expect(h.service.enabledFor(other, 'messenger')).resolves.toBe(true);
    });

    it('stays off for anything malformed rather than failing open', async () => {
        for (const stored of ['not json', { enabled: 'yes' }, { enabled: true, channels: 'whatsapp' },
            { enabled: true, channels: [7, ' ', null] }]) {
            const h = harness(stored);
            await expect(h.service.enabledFor(tenantId, 'whatsapp')).resolves.toBe(false);
        }
    });

    it('stays off when the setting cannot be read at all', async () => {
        // Failing open here would put untested delivery in front of customers.
        await expect(harness(undefined, { dbFails: true }).service.enabledFor(tenantId, 'whatsapp'))
            .resolves.toBe(false);
        await expect(harness({ enabled: true, channels: ['whatsapp'] }, { redisFails: true })
            .service.enabledFor(tenantId, 'whatsapp')).resolves.toBe(false);
    });

    it('caches what it read so a turn does not query the setting every time', async () => {
        const h = harness({ enabled: true, channels: ['whatsapp'] });
        await h.service.config();
        expect(h.redis.setJson).toHaveBeenCalledWith('dispatch:rollout',
            { enabled: true, tenantIds: [], channels: ['whatsapp'] }, 60);
    });
});
