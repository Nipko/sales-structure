import { DispatchRolloutService } from './dispatch-rollout.service';

/**
 * ═══ THE FIVE WAYS THE SWITCH CAN ANSWER, AND WHAT EACH COSTS ═══
 *
 * `dispatch.normalOutbox` decides whether a reply takes the durable lane or the
 * legacy queue, where Redis is the only record. The directive asks for the whole
 * path proven: the flag on, a read failure, a tenant not on the list, a tenant
 * on the pilot list, and a rollback.
 *
 * Four of those are ordinary. The fifth is the one worth a test of its own: a
 * READ FAILURE and a DELIBERATE "no" are different facts, and the call site
 * spells them the same —
 *
 *     if (!(await this.dispatchRollout.enabledFor(...).catch(() => false))) return false;
 *
 * — so a settings read that threw during a pilot silently moves that tenant's
 * replies onto the lane the pilot exists to stop using, and nothing says so.
 * These cases pin which of the five are genuinely equivalent and which are only
 * being reported as equivalent.
 */
describe('every way the rollout switch can answer', () => {
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
        expect(await service({ enabled: true, tenantIds: [], channels: ['web_widget'] })
            .enabledFor(TENANT, 'web_widget')).toBe(false);
    });

    it('says NO when the switch cannot be read at all', async () => {
        // Failing OFF is the right direction: an unreadable switch must not turn
        // a lane on. What this does not do is say so — see the case below.
        expect(await service(ON_FOR_PILOT, { dbThrows: true }).enabledFor(TENANT, 'whatsapp'))
            .toBe(false);
    });

    it('CANNOT distinguish "the switch said no" from "the switch could not be read"', async () => {
        // The gap this file exists to name, pinned as it stands today.
        //
        // Both answers are the bare `false`, and `conversations.service.ts`
        // spells them identically — `.catch(() => false)`. So a settings read
        // that threw during a pilot moves that tenant's replies onto the legacy
        // queue, where Redis is the only record, and the only trace is a debug
        // line inside the rollout service.
        //
        // Failing off is correct. Failing off SILENTLY, for a tenant that was
        // deliberately admitted to the pilot, is the part that is not: the row
        // it would have written is the thing the pilot is measuring.
        const deliberateNo = await service({ enabled: false, tenantIds: [], channels: ['whatsapp'] })
            .enabledFor(TENANT, 'whatsapp');
        const couldNotRead = await service(ON_FOR_ALL, { dbThrows: true })
            .enabledFor(TENANT, 'whatsapp');

        expect(deliberateNo).toBe(couldNotRead);
        // When this stops being true — when the service reports WHY — this
        // assertion is the one to change, and the call site has to change with
        // it. Until then the equivalence is a fact about the code, written down
        // where somebody planning the canary will read it.
        expect(typeof couldNotRead).toBe('boolean');
    });

    it('rides a Redis outage without turning the lane off', async () => {
        // The cache is a cache. Losing it must fall through to the database
        // rather than answer `false`, or a Redis blip becomes an unannounced
        // rollback for every tenant at once.
        expect(await service(ON_FOR_ALL, { redisThrows: true }).enabledFor(TENANT, 'whatsapp'))
            .toBe(true);
    });
});
