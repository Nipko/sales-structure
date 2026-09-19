import { ServiceUnavailableException } from '@nestjs/common';
import {
    DEMO_ALLOWANCE_DEFAULTS,
    DEMO_ALLOWANCE_LIMITS,
    DEMO_ALLOWANCE_SETTINGS_KEY,
    DEMO_ALLOWANCE_UNREADABLE,
    DemoAllowanceService,
    validateDemoAllowancePatch,
} from './demo-allowance.service';

/**
 * D19: the platform pays the first N demo replies per tenant, with a cap. The
 * numbers live in `platform_settings` so the owner can move them without a
 * deploy; these tests pin what happens when that row is missing, malformed,
 * cached or unreachable, because the demo page has to keep answering in every
 * one of those cases.
 */
const CACHE_KEY = 'onboarding:demo_allowance';
const CACHE_TTL = 300;

type BuildOptions = {
    stored?: any;
    cached?: any;
    prismaFails?: boolean;
    redisFails?: boolean;
    /** The cache read works but Redis refuses to keep a value. */
    cacheWriteFails?: boolean;
};

const build = (opts: BuildOptions = {}) => {
    const prisma = {
        $queryRaw: jest.fn(async () => {
            if (opts.prismaFails) throw new Error('db unavailable');
            if (opts.stored === undefined) return [];
            const value = typeof opts.stored === 'string' ? opts.stored : JSON.stringify(opts.stored);
            return [{ value }];
        }),
        $executeRaw: jest.fn(async () => 1),
    };
    const redis = {
        getJson: jest.fn(async () => {
            if (opts.redisFails) throw new Error('redis down');
            return opts.cached ?? null;
        }),
        setJson: jest.fn(async () => {
            if (opts.cacheWriteFails) throw new Error('redis refused the write');
            return undefined;
        }),
    };
    return { service: new DemoAllowanceService(prisma as any, redis as any), prisma, redis };
};

/** Values interpolated into a tagged-template Prisma call (everything after the strings array). */
const templateValues = (call: any[]) => call.slice(1);
const templateText = (call: any[]) => (call[0] as string[]).join('?');

describe('DemoAllowanceService', () => {
    it('ships the owner decision as its defaults', () => {
        expect(DEMO_ALLOWANCE_DEFAULTS).toEqual({ enabled: true, messagesPerTenant: 200, dailyCapPerPage: 60 });
        expect(DEMO_ALLOWANCE_SETTINGS_KEY).toBe('onboarding.demoAllowance');
    });

    describe('get()', () => {
        it('returns the defaults when nothing is stored, reading the right row and warming the cache', async () => {
            const { service, prisma, redis } = build();

            const config = await service.get();

            expect(config).toEqual(DEMO_ALLOWANCE_DEFAULTS);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(templateText(prisma.$queryRaw.mock.calls[0])).toContain('FROM platform_settings WHERE key =');
            expect(templateValues(prisma.$queryRaw.mock.calls[0])).toEqual([DEMO_ALLOWANCE_SETTINGS_KEY]);
            expect(redis.setJson).toHaveBeenCalledWith(CACHE_KEY, DEMO_ALLOWANCE_DEFAULTS, CACHE_TTL);
        });

        it('takes the well-formed fields of a stored row and keeps the default for the rest', async () => {
            const { service } = build({ stored: {
                enabled: false,
                messagesPerTenant: 500,
                dailyCapPerPage: 0, // below its floor of 1
                somethingElse: 'ignored',
            } });

            expect(await service.get()).toEqual({ enabled: false, messagesPerTenant: 500, dailyCapPerPage: 60 });
        });

        it.each([
            ['a negative', -1, DEMO_ALLOWANCE_DEFAULTS.messagesPerTenant],
            ['a float', 12.5, DEMO_ALLOWANCE_DEFAULTS.messagesPerTenant],
            ['a numeric string', '300', DEMO_ALLOWANCE_DEFAULTS.messagesPerTenant],
            ['null', null, DEMO_ALLOWANCE_DEFAULTS.messagesPerTenant],
            ['Infinity', Number.POSITIVE_INFINITY, DEMO_ALLOWANCE_DEFAULTS.messagesPerTenant],
            ['NaN', Number.NaN, DEMO_ALLOWANCE_DEFAULTS.messagesPerTenant],
            ['zero (allowed: the platform pays nothing)', 0, 0],
            ['a large integer', 10_000, 10_000],
        ])('messagesPerTenant: %s stored reads back as %p', async (_label, stored, expected) => {
            const { service } = build({ stored: { messagesPerTenant: stored } });
            expect((await service.get()).messagesPerTenant).toBe(expected);
        });

        it.each([
            ['zero (below the floor of 1)', 0, DEMO_ALLOWANCE_DEFAULTS.dailyCapPerPage],
            ['a numeric string', '5', DEMO_ALLOWANCE_DEFAULTS.dailyCapPerPage],
            ['a float', 1.5, DEMO_ALLOWANCE_DEFAULTS.dailyCapPerPage],
            ['one', 1, 1],
            ['a larger integer', 120, 120],
        ])('dailyCapPerPage: %s stored reads back as %p', async (_label, stored, expected) => {
            const { service } = build({ stored: { dailyCapPerPage: stored } });
            expect((await service.get()).dailyCapPerPage).toBe(expected);
        });

        it.each([
            ['the string "yes"', 'yes', true],
            ['the number 0', 0, true],
            ['false', false, false],
        ])('enabled: %s stored reads back as %p', async (_label, stored, expected) => {
            const { service } = build({ stored: { enabled: stored } });
            expect((await service.get()).enabled).toBe(expected);
        });

        it('falls back to the defaults when the stored value is not JSON', async () => {
            const { service } = build({ stored: 'not json at all' });
            expect(await service.get()).toEqual(DEMO_ALLOWANCE_DEFAULTS);
        });

        it('serves a cache hit without touching the database or rewriting the cache', async () => {
            const { service, prisma, redis } = build({
                cached: { messagesPerTenant: 50 },
                stored: { messagesPerTenant: 999 },
            });

            expect(await service.get()).toEqual({ ...DEMO_ALLOWANCE_DEFAULTS, messagesPerTenant: 50 });
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
            expect(redis.setJson).not.toHaveBeenCalled();
        });

        it('re-validates a cached blob the same way as a stored one', async () => {
            const { service } = build({ cached: { messagesPerTenant: 'corrupt', dailyCapPerPage: 9 } });
            expect(await service.get()).toEqual({ ...DEMO_ALLOWANCE_DEFAULTS, dailyCapPerPage: 9 });
        });

        it('on a cache miss reads the row and caches the merged result for five minutes', async () => {
            const { service, prisma, redis } = build({ stored: { dailyCapPerPage: 30 } });

            const config = await service.get();

            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(redis.setJson).toHaveBeenCalledTimes(1);
            expect(redis.setJson).toHaveBeenCalledWith(CACHE_KEY, config, CACHE_TTL);
            expect(config).toEqual({ ...DEMO_ALLOWANCE_DEFAULTS, dailyCapPerPage: 30 });
        });

        it('never throws when prisma fails: the demo page keeps its defaults', async () => {
            const { service, redis } = build({ prismaFails: true });

            await expect(service.get()).resolves.toEqual(DEMO_ALLOWANCE_DEFAULTS);
            // Nothing was read, so nothing is cached as if it had been.
            expect(redis.setJson).not.toHaveBeenCalled();
        });

        it('never throws when redis fails either, and reads the row instead of inventing the defaults', async () => {
            // An unreachable cache is a miss: the database is the source of
            // truth. Answering the defaults here switched a platform-disabled
            // demo back on for as long as Redis was down.
            const { service, prisma } = build({ redisFails: true, stored: { messagesPerTenant: 5 } });
            await expect(service.get()).resolves.toEqual({ ...DEMO_ALLOWANCE_DEFAULTS, messagesPerTenant: 5 });
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('keeps a row it read when the cache refuses to store it', async () => {
            const { service } = build({ cacheWriteFails: true, stored: { enabled: false, messagesPerTenant: 5 } });
            await expect(service.get()).resolves.toEqual({ ...DEMO_ALLOWANCE_DEFAULTS, enabled: false, messagesPerTenant: 5 });
        });

        it('hands out a copy of the defaults, never the shared object', async () => {
            const { service } = build({ prismaFails: true });
            const config = await service.get();
            config.messagesPerTenant = 1;
            expect(DEMO_ALLOWANCE_DEFAULTS.messagesPerTenant).toBe(200);
        });
    });

    /**
     * F0: `get()` answers the defaults on any read failure, with nothing to
     * tell them apart from the real value. The super_admin screen showed them
     * as the value in force, and a save wrote `enabled: true` back over a
     * platform that had switched the demo off. The screen reads through this.
     */
    describe('getWithSource()', () => {
        it('says the value is the stored row when there is one', async () => {
            const { service } = build({ stored: { enabled: false, dailyCapPerPage: 30 } });
            await expect(service.getWithSource()).resolves.toEqual({
                allowance: { ...DEMO_ALLOWANCE_DEFAULTS, enabled: false, dailyCapPerPage: 30 },
                source: 'stored',
            });
        });

        it('says the defaults are in force when the database answered with no usable row', async () => {
            for (const stored of [undefined, 'not json at all', '[1,2]', 'null']) {
                const { service } = build({ stored });
                await expect(service.getWithSource()).resolves.toEqual({ allowance: DEMO_ALLOWANCE_DEFAULTS, source: 'default' });
            }
        });

        it('says the defaults are only standing in when the database could not be read, and caches nothing', async () => {
            const { service, redis } = build({ prismaFails: true });
            const reading = await service.getWithSource();
            expect(reading).toEqual({ allowance: DEMO_ALLOWANCE_DEFAULTS, source: 'fallback' });
            expect(redis.setJson).not.toHaveBeenCalled();
            reading.allowance.enabled = false;
            expect(DEMO_ALLOWANCE_DEFAULTS.enabled).toBe(true);
        });

        it('reads the row itself, not a cached copy: the screen shows what is stored', async () => {
            const { service, prisma } = build({ cached: { messagesPerTenant: 50 }, stored: { messagesPerTenant: 999 } });
            await expect(service.getWithSource()).resolves.toEqual({
                allowance: { ...DEMO_ALLOWANCE_DEFAULTS, messagesPerTenant: 999 }, source: 'stored',
            });
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('does not discard a row it read because the cache write failed', async () => {
            const { service } = build({ cacheWriteFails: true, stored: { messagesPerTenant: 5 } });
            await expect(service.getWithSource()).resolves.toEqual({
                allowance: { ...DEMO_ALLOWANCE_DEFAULTS, messagesPerTenant: 5 }, source: 'stored',
            });
        });
    });

    describe('set()', () => {
        it('refuses to save over a row it could not read, and writes nothing', async () => {
            // Merging the edit over the stand-in defaults would store
            // `enabled: true` and the default caps over whatever was there.
            const { service, prisma, redis } = build({ prismaFails: true });
            const refusal = await service.set({ dailyCapPerPage: 30 }).catch((error: unknown) => error);
            expect(refusal).toBeInstanceOf(ServiceUnavailableException);
            expect((refusal as ServiceUnavailableException).getResponse()).toMatchObject({ error: DEMO_ALLOWANCE_UNREADABLE });
            expect(prisma.$executeRaw).not.toHaveBeenCalled();
            expect(redis.setJson).not.toHaveBeenCalled();
        });

        it('merges the edit over the stored row, not over a cached copy', async () => {
            const { service, prisma } = build({ cached: { messagesPerTenant: 50 }, stored: { enabled: false, messagesPerTenant: 999 } });
            const saved = await service.set({ dailyCapPerPage: 30 });
            expect(saved).toEqual({ enabled: false, messagesPerTenant: 999, dailyCapPerPage: 30 });
            expect(JSON.parse(templateValues(prisma.$executeRaw.mock.calls[0])[1])).toEqual(saved);
        });

        it('keeps a save that reached the database when the cache refuses the new value', async () => {
            const { service, prisma } = build({ cacheWriteFails: true, stored: { enabled: false } });
            await expect(service.set({ messagesPerTenant: 10 })).resolves.toEqual({ ...DEMO_ALLOWANCE_DEFAULTS, enabled: false, messagesPerTenant: 10 });
            expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        });

        it('upserts the merged blob under the onboarding category and refreshes the cache', async () => {
            const { service, prisma, redis } = build({ stored: { enabled: false } });

            const saved = await service.set({ messagesPerTenant: 300, dailyCapPerPage: 'x' });

            expect(saved).toEqual({ enabled: false, messagesPerTenant: 300, dailyCapPerPage: 60 });
            expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
            const call = prisma.$executeRaw.mock.calls[0];
            expect(templateText(call)).toContain('INSERT INTO platform_settings (key, value, category, updated_at)');
            expect(templateText(call)).toContain('ON CONFLICT (key) DO UPDATE SET value =');
            const values = templateValues(call);
            expect(values[0]).toBe(DEMO_ALLOWANCE_SETTINGS_KEY);
            expect(JSON.parse(values[1])).toEqual(saved);
            expect(values[2]).toBe('onboarding');
            expect(JSON.parse(values[3])).toEqual(saved);
            expect(redis.setJson).toHaveBeenLastCalledWith(CACHE_KEY, saved, CACHE_TTL);
        });

        it('drops unknown fields so the stored blob only ever holds the three caps', async () => {
            const { service, prisma } = build();
            const saved = await service.set({ enabled: true, ownerPin: '1234', messagesPerTenant: 10 });
            expect(Object.keys(saved).sort()).toEqual(['dailyCapPerPage', 'enabled', 'messagesPerTenant']);
            expect(JSON.parse(templateValues(prisma.$executeRaw.mock.calls[0])[1])).not.toHaveProperty('ownerPin');
        });

        it('lets the write failure surface: a person is watching, unlike get()', async () => {
            const { service, prisma } = build();
            prisma.$executeRaw.mockRejectedValueOnce(new Error('db unavailable'));
            await expect(service.set({ messagesPerTenant: 1 })).rejects.toThrow('db unavailable');
        });
    });

    /**
     * The super_admin screen's edits (audit #47). `merge()` keeps the base for
     * a malformed field, which would let the screen say "guardado" while
     * nothing changed; an edit is refused whole instead, field by field.
     */
    describe('validateDemoAllowancePatch()', () => {
        it('bounds the numbers the platform pays for', () => {
            expect(DEMO_ALLOWANCE_LIMITS).toEqual({
                messagesPerTenant: { min: 0, max: 10_000 },
                dailyCapPerPage: { min: 1, max: 1_000 },
            });
        });

        it('passes a clean edit through, and only the fields it names', () => {
            expect(validateDemoAllowancePatch({ enabled: false, messagesPerTenant: 0, dailyCapPerPage: 1_000 }))
                .toEqual({ patch: { enabled: false, messagesPerTenant: 0, dailyCapPerPage: 1_000 }, errors: [] });
            expect(validateDemoAllowancePatch({ dailyCapPerPage: 30 })).toEqual({ patch: { dailyCapPerPage: 30 }, errors: [] });
        });

        it.each([
            ['a string where a switch goes', { enabled: 'false' }, [{ path: 'enabled', constraint: 'boolean' }]],
            ['a numeric string', { messagesPerTenant: '300' }, [{ path: 'messagesPerTenant', constraint: 'integer' }]],
            ['a float', { dailyCapPerPage: 1.5 }, [{ path: 'dailyCapPerPage', constraint: 'integer' }]],
            ['below the floor', { dailyCapPerPage: 0 }, [{ path: 'dailyCapPerPage', constraint: 'min' }]],
            ['a negative', { messagesPerTenant: -1 }, [{ path: 'messagesPerTenant', constraint: 'min' }]],
            ['two zeros too many', { messagesPerTenant: 20_000 }, [{ path: 'messagesPerTenant', constraint: 'max' }]],
            ['a field nobody owns', { ownerPin: '1234' }, [{ path: 'ownerPin', constraint: 'unknown_field' }]],
            ['nothing at all', {}, [{ path: '', constraint: 'empty' }]],
            ['not an object', null, [{ path: '', constraint: 'empty' }]],
        ])('refuses %s', (_label, input, errors) => {
            expect(validateDemoAllowancePatch(input)).toEqual({ patch: {}, errors });
        });

        it('refuses the whole edit when one field is wrong, naming each one', () => {
            const result = validateDemoAllowancePatch({ enabled: true, messagesPerTenant: 50_000, dailyCapPerPage: 'x' });
            expect(result.patch).toEqual({});
            expect(result.errors).toEqual([
                { path: 'messagesPerTenant', constraint: 'max' },
                { path: 'dailyCapPerPage', constraint: 'integer' },
            ]);
        });
    });
});
