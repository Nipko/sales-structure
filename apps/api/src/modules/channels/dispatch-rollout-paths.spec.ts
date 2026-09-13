import { DispatchRolloutService } from './dispatch-rollout.service';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

/**
 * ═══ THE FIVE WAYS THE VALIDATION COHORT CAN ANSWER ═══
 *
 * `dispatch.normalOutbox` is the compatibility name of the real-provider
 * validation cohort. Durable delivery is mandatory regardless of its answer.
 * These cases prove cohort scoping and immediate operational rollback.
 *
 * A read failure and a deliberate "no" remain different operational facts;
 * neither may change the delivery lane.
 */
describe('every way the dispatch validation cohort can answer', () => {
    const TENANT = '11111111-1111-1111-1111-111111111111';
    const OTHER = '22222222-2222-2222-2222-222222222222';

    const service = (value: unknown, opts: { redisThrows?: boolean; dbThrows?: boolean } = {}) => {
        const prisma: any = {
            $queryRaw: jest.fn(async () => {
                if (opts.dbThrows) throw new Error('platform_settings unreadable');
                return value === undefined ? [] : [{ value: JSON.stringify(value) }];
            }),
            $executeRaw: jest.fn(async () => 1),
        };
        const redis: any = {
            getJson: jest.fn(async () => { if (opts.redisThrows) throw new Error('redis down'); return null; }),
            setJson: jest.fn(async () => undefined),
            del: jest.fn(async () => undefined),
        };
        // `migratedChannels` asks the gateway for a STRICT transport per channel,
        // and a channel without one is ignored however the switch names it. The
        // first stub answered `adapterFor`, which this service never calls, so
        // every 'yes' case came back false for a reason that had nothing to do
        // with the switch.
        const gateway: any = {
            getStrictTransport: (channel: string) =>
                (channel === 'whatsapp' ? { sendStrict: jest.fn() } : null),
        };
        const built: any = new DispatchRolloutService(prisma, redis, gateway);
        // Silenced by assignment: the service holds its logger as a field, and
        // a warning per case would bury the failures that matter.
        built.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        return built;
    };

    const ON_FOR_ALL = { enabled: true, tenantIds: [], channels: ['whatsapp'] };
    const ON_FOR_PILOT = { enabled: true, tenantIds: [TENANT], channels: ['whatsapp'] };

    it('is not consulted by any production delivery path', () => {
        const root = resolve(__dirname, '..');
        const files: string[] = [];
        const walk = (directory: string) => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = join(directory, entry.name);
                if (entry.isDirectory()) walk(file);
                else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
                    && file !== resolve(__dirname, 'dispatch-rollout.service.ts')) files.push(file);
            }
        };
        walk(root);
        const callers = files.filter(file => /\.enabledFor\s*\(/.test(readFileSync(file, 'utf8')));
        expect(callers).toEqual([]);
    });

    it('says YES when the switch is on for everybody', async () => {
        expect(await service(ON_FOR_ALL).enabledFor(TENANT, 'whatsapp')).toBe(true);
    });

    it('says YES to a tenant NAMED on the pilot list', async () => {
        expect(await service(ON_FOR_PILOT).enabledFor(TENANT, 'whatsapp')).toBe(true);
    });

    it('says NO to a tenant the pilot list does not name', async () => {
        // The half that makes a pilot a pilot. An empty list means everybody —
        // deliberately — so a list with one id must exclude the rest.
        expect(await service(ON_FOR_PILOT).enabledFor(OTHER, 'whatsapp')).toBe(false);
    });

    it('says NO after a rollback, without waiting for a cache to expire', async () => {
        expect(await service({ enabled: false, tenantIds: [TENANT], channels: ['whatsapp'] })
            .enabledFor(TENANT, 'whatsapp')).toBe(false);
    });

    it('says NO for a channel with no strict transport, even when named', async () => {
        // Naming a channel the transport cannot serve used to read as success:
        // the rehearsal went green while switching nothing on.
        expect(await service({ enabled: true, tenantIds: [], channels: ['telegram'] })
            .enabledFor(TENANT, 'telegram')).toBe(false);
    });

    it('refuses to choose a delivery lane when the switch cannot be read', async () => {
        await expect(service(ON_FOR_PILOT, { dbThrows: true }).enabledFor(TENANT, 'whatsapp'))
            .rejects.toMatchObject({ code: 'dispatch_rollout_authority_unavailable' });
    });

    it('distinguishes "the switch said no" from "the switch could not be read"', async () => {
        const deliberateNo = await service({ enabled: false, tenantIds: [], channels: ['whatsapp'] })
            .enabledFor(TENANT, 'whatsapp');
        expect(deliberateNo).toBe(false);
        await expect(service(ON_FOR_ALL, { dbThrows: true }).enabledFor(TENANT, 'whatsapp'))
            .rejects.toMatchObject({ code: 'dispatch_rollout_authority_unavailable' });
    });

    it('rides a Redis outage without turning the lane off', async () => {
        // The cache is a cache. Losing it must fall through to the database
        // rather than answer `false`, or a Redis blip becomes an unannounced
        // rollback for every tenant at once.
        expect(await service(ON_FOR_ALL, { redisThrows: true }).enabledFor(TENANT, 'whatsapp'))
            .toBe(true);
    });
});
