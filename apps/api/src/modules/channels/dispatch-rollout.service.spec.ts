import { DispatchRolloutService } from './dispatch-rollout.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

describe('DispatchRolloutService', () => {
    function harness(stored?: any, options: { redisFails?: boolean; dbFails?: boolean;
        migrated?: string[] } = {}) {
        const redis = {
            getJson: jest.fn(async () => { if (options.redisFails) throw new Error('redis down'); return null; }),
            setJson: jest.fn(async () => undefined),
            del: jest.fn(async () => undefined),
        };
        // The fake store reflects its own writes, so `set` can read back what it
        // just wrote exactly as it does against PostgreSQL.
        let current = stored;
        const prisma: any = {
            $executeRaw: jest.fn(async (_strings: any, ...values: any[]) => {
                const written = values.find(value => typeof value === 'string' && value.startsWith('{'));
                if (written) current = written;
                return 1;
            }),
            auditLog: { create: jest.fn(async () => ({})) },
            $queryRaw: jest.fn(async () => {
                if (options.dbFails) throw new Error('settings unavailable');
                return current === undefined ? []
                    : [{ value: typeof current === 'string' ? current : JSON.stringify(current) }];
            }),
        };
        const gateway = { getStrictTransport: jest.fn((channel: string) =>
            (options.migrated ?? ['whatsapp', 'messenger']).includes(channel) ? { channelType: channel } : undefined) };
        return { service: new DispatchRolloutService(prisma as any, redis as any, gateway as any),
            redis, prisma, gateway };
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

    describe('a channel must be both requested and actually migrated', () => {
        it('refuses a channel whose adapter has no strict transport', async () => {
            // A batch created here would own a reply nothing could ever send.
            const h = harness({ enabled: true, channels: ['telegram'] }, { migrated: ['whatsapp'] });
            await expect(h.service.enabledFor(tenantId, 'telegram')).resolves.toBe(false);
        });

        it('reports what the switch really does, and why a channel was ignored', async () => {
            const h = harness({ enabled: true, channels: ['whatsapp', 'telegram'] }, { migrated: ['whatsapp'] });
            await expect(h.service.state()).resolves.toMatchObject({
                enabled: true,
                channels: ['whatsapp', 'telegram'],
                migratedChannels: ['whatsapp'],
                effectiveChannels: ['whatsapp'],
                // Silently dropping it would leave a switch that looks on and
                // does nothing, with no way to see why.
                ignoredChannels: ['telegram'],
            });
        });
    });

    describe('changing the switch', () => {
        const actor = { userId: '99999999-9999-4999-8999-999999999999', email: 'ops@example.test' };

        it('writes, audits and takes effect at once rather than after a cache expires', async () => {
            const h = harness();
            const state = await h.service.set({ enabled: true, channels: ['whatsapp'], tenantIds: [tenantId] }, actor);
            expect(h.prisma.$executeRaw).toHaveBeenCalled();
            // Dropped, not left to expire: a rollback must not take a minute.
            expect(h.redis.del).toHaveBeenCalledWith('dispatch:rollout');
            expect(h.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'dispatch.rollout.updated', userId: actor.userId }) }));
            expect(state.effectiveChannels).toEqual(['whatsapp']);
        });

        it('refuses a configuration that cannot mean what it says', async () => {
            const h = harness();
            for (const invalid of [
                { enabled: 'yes' },
                { enabled: true, channels: 'whatsapp' },
                { enabled: true, channels: ['email'] },
                { enabled: true, channels: ['NOT A CHANNEL'] },
                { enabled: true, tenantIds: ['not-a-uuid'] },
            ]) {
                await expect(h.service.set(invalid, actor)).rejects.toThrow(/dispatch_rollout_/);
            }
            expect(h.prisma.$executeRaw).not.toHaveBeenCalled();
        });

        it('turns everything off in a single call', async () => {
            const h = harness({ enabled: true, channels: ['whatsapp'] });
            const state = await h.service.disable(actor);
            expect(state).toMatchObject({ enabled: false, channels: [], effectiveChannels: [] });
            expect(h.redis.del).toHaveBeenCalled();
        });

        it('still records the change when the audit write itself fails', async () => {
            const h = harness();
            h.prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
            await expect(h.service.set({ enabled: false }, actor)).resolves.toMatchObject({ enabled: false });
        });
    });

    it('caches what it read so a turn does not query the setting every time', async () => {
        const h = harness({ enabled: true, channels: ['whatsapp'] });
        await h.service.config();
        expect(h.redis.setJson).toHaveBeenCalledWith('dispatch:rollout',
            { enabled: true, tenantIds: [], channels: ['whatsapp'] }, 60);
    });
});
