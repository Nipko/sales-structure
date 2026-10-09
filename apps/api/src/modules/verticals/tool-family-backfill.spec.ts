/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import {
    listVerticalCapabilityConfigurations,
    resolveVerticalCapabilityManifest,
    VERTICAL_TOOL_GROUPS,
} from '@parallext/shared';
import { planVerticalToolSeed } from './vertical-tool-seed-plan';

const backfill = require('../../../scripts/tool-family-backfill.js');
const { runTenantMigrations } = require('../../../scripts/migrate-tenants.js');

const SCHEMA = 'tenant_rental_test';
const AGENT_A = '00000000-0000-4000-8000-00000000000a';
const AGENT_B = '00000000-0000-4000-8000-00000000000b';
const AGENT_C = '00000000-0000-4000-8000-00000000000c';
const AGENT_D = '00000000-0000-4000-8000-00000000000d';

interface FakeAgent { id: string; is_active: boolean; version: number; config_json: any }

/**
 * An in-memory `agent_personas` behind the three SQL shapes the backfill uses.
 * `$transaction` is real enough to matter: a throw inside restores the rows.
 */
function fakePrisma(agents: FakeAgent[], opts: { failUpdateFor?: string } = {}) {
    const sql: string[] = [];
    const updates: Array<{ id: string; config: any }> = [];
    const prisma: any = {
        agents,
        sql,
        updates,
        $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
            const snapshot = JSON.stringify(agents);
            try {
                return await fn(prisma);
            } catch (error) {
                const restored = JSON.parse(snapshot) as FakeAgent[];
                agents.splice(0, agents.length, ...restored);
                throw error;
            }
        }),
        $queryRawUnsafe: jest.fn(async (statement: string) => {
            sql.push(statement);
            if (/set_config|pg_advisory_xact_lock/.test(statement)) return [];
            if (/information_schema\.schemata/.test(statement)) return [{ schema_name: SCHEMA }];
            if (new RegExp(`FROM "${SCHEMA}"\\."agent_personas"`).test(statement)) {
                if (!/is_active = true/.test(statement) || !/FOR UPDATE/.test(statement)) {
                    throw new Error('the backfill must read active agents under a row lock');
                }
                return agents.filter((a) => a.is_active)
                    .map((a) => ({ id: a.id, config_json: JSON.parse(JSON.stringify(a.config_json)) }));
            }
            throw new Error(`Unexpected query: ${statement}`);
        }),
        $executeRawUnsafe: jest.fn(async (statement: string, json: string, id: string) => {
            sql.push(statement);
            if (/^\s*CREATE /i.test(statement)) return 0; // the schema template
            if (opts.failUpdateFor === id) throw new Error('simulated write failure');
            if (!new RegExp(`UPDATE "${SCHEMA}"\\."agent_personas"`).test(statement)) {
                throw new Error(`Unexpected execute: ${statement}`);
            }
            const agent = agents.find((a) => a.id === id)!;
            agent.config_json = JSON.parse(json);
            agent.version += 1;
            updates.push({ id, config: agent.config_json });
            return 1;
        }),
    };
    return prisma;
}

const tenant = (over: Record<string, unknown> = {}) => ({
    id: 'tenant-1',
    schema_name: SCHEMA,
    is_active: true,
    industry: 'automotriz',
    vc_industry: 'automotriz',
    vc_sub_type: 'alquiler',
    legacy_sub_type: null,
    ...over,
});

const quiet = { log: jest.fn(), logError: jest.fn() };
const lines = (fn: jest.Mock) => fn.mock.calls.map((c) => String(c[0]));

describe('planAgentToolBackfill (pure)', () => {
    const families = ['vehicleRentals'];
    const deepFreeze = <T,>(value: T): T => {
        if (value && typeof value === 'object') {
            Object.values(value as object).forEach(deepFreeze);
            Object.freeze(value);
        }
        return value;
    };

    it('enables a family that was never set and keeps every other key', () => {
        const config = deepFreeze({
            persona: { name: 'X' },
            tools: { appointments: { enabled: false, canBook: true }, catalog: { enabled: true } },
        });
        const plan = backfill.planAgentToolBackfill(config, families);
        expect(plan.changed).toBe(true);
        expect(plan.enabled).toEqual(['vehicleRentals']);
        expect(plan.config).toEqual({
            persona: { name: 'X' },
            tools: {
                appointments: { enabled: false, canBook: true },
                catalog: { enabled: true },
                vehicleRentals: { enabled: true },
            },
        });
    });

    it.each([
        ['no tools block', { persona: { name: 'X' } }],
        ['tools = null', { tools: null }],
        ['family = null', { tools: { vehicleRentals: null } }],
    ])('treats «%s» as never set', (_label, config) => {
        const plan = backfill.planAgentToolBackfill(config, families);
        expect(plan.changed).toBe(true);
        expect(plan.config.tools.vehicleRentals).toEqual({ enabled: true });
    });

    it('enables an object that never recorded a decision and keeps its other fields', () => {
        const plan = backfill.planAgentToolBackfill(
            { tools: { vehicleRentals: { emailConfirmations: true } } }, families,
        );
        expect(plan.config.tools.vehicleRentals).toEqual({ emailConfirmations: true, enabled: true });
    });

    it('PRESERVES an explicit enabled:false (the owner turned it off) byte for byte', () => {
        const config = deepFreeze({ tools: { vehicleRentals: { enabled: false, emailConfirmations: true } } });
        const plan = backfill.planAgentToolBackfill(config, families);
        expect(plan).toMatchObject({ changed: false, enabled: [], preserved: ['vehicleRentals'] });
        expect(plan.config).toBe(config);
    });

    it.each([
        ['boolean false', false],
        ['boolean true', true],
        ['string', 'off'],
        ['number', 0],
        ['array', []],
        ['enabled as a string', { enabled: 'false' }],
        ['enabled = null', { enabled: null }],
        ['enabled = 0', { enabled: 0 }],
    ])('leaves a value it cannot read alone (%s)', (_label, value) => {
        const config = { tools: { vehicleRentals: value } };
        const plan = backfill.planAgentToolBackfill(config, families);
        expect(plan.changed).toBe(false);
        expect(plan.config).toBe(config);
    });

    it('leaves an agent whose tools block is not an object untouched', () => {
        for (const tools of ['on', 7, [], true]) {
            const config = { tools };
            const plan = backfill.planAgentToolBackfill(config, families);
            expect(plan).toMatchObject({ changed: false, unreadable: true });
            expect(plan.config).toBe(config);
        }
    });

    it('reports an already-enabled family as a no-op and returns the very same config', () => {
        const config = { tools: { vehicleRentals: { enabled: true, emailConfirmations: false } } };
        const plan = backfill.planAgentToolBackfill(config, families);
        expect(plan).toMatchObject({ changed: false, alreadyOn: ['vehicleRentals'] });
        expect(plan.config).toBe(config);
    });

    it('is idempotent: applying its own output again changes nothing', () => {
        const first = backfill.planAgentToolBackfill({ tools: {} }, ['petBoarding']);
        const second = backfill.planAgentToolBackfill(first.config, ['petBoarding']);
        expect(first.changed).toBe(true);
        expect(second.changed).toBe(false);
        expect(second.config).toBe(first.config);
    });

    it('only ever writes enabled:true, never disables, and ignores families outside the allow-list', () => {
        const config = { tools: { catalog: { enabled: true }, vehicles: { enabled: true } } };
        const plan = backfill.planAgentToolBackfill(config, ['catalog', 'vehicles', 'gyms', 'vehicleRentals']);
        expect(plan.enabled).toEqual(['vehicleRentals']);
        expect(plan.config.tools).toEqual({
            catalog: { enabled: true }, vehicles: { enabled: true }, vehicleRentals: { enabled: true },
        });
        const written = JSON.stringify(plan.config);
        expect(written).not.toContain('"enabled":false');
        const none = backfill.planAgentToolBackfill({ tools: {} }, ['catalog', 'gyms', 'appointments']);
        expect(none.changed).toBe(false);
    });

    it('survives a null or non-object config_json', () => {
        expect(backfill.planAgentToolBackfill(null, families).config.tools).toEqual({ vehicleRentals: { enabled: true } });
        expect(backfill.planAgentToolBackfill('garbage', families).changed).toBe(true);
    });
});

describe('profile table', () => {
    it('maps exactly the three profiles PR #77 fixed for new signups', () => {
        expect(backfill.familiesForProfile('automotriz', 'alquiler')).toEqual(['vehicleRentals']);
        expect(backfill.familiesForProfile('pet_services', 'guarderia')).toEqual(['petBoarding']);
        expect(backfill.familiesForProfile('pet_services', 'hotel')).toEqual(['petBoarding']);
        expect(backfill.familiesForProfile(' Automotriz ', ' ALQUILER ')).toEqual(['vehicleRentals']);
    });

    it.each([
        ['automotriz', 'concesionario'], ['automotriz', 'taller'], ['automotriz', 'repuestos'],
        ['pet_services', 'peluqueria'], ['pet_services', 'paseos'], ['veterinaria', 'clinica'],
        ['turismo', 'hotel'], ['automotriz', null], [null, 'alquiler'], ['otro', null],
    ])('owes nothing to %s/%s', (industry, subType) => {
        expect(backfill.familiesForProfile(industry, subType)).toEqual([]);
    });

    it('reads the vertical with the platform precedence (published config, then legacy fields)', () => {
        expect(backfill.tenantVerticalIdentity({
            industry: 'pet_services', vc_industry: 'automotriz', vc_sub_type: 'alquiler', legacy_sub_type: 'hotel',
        })).toEqual({ industry: 'automotriz', subType: 'alquiler' });
        expect(backfill.tenantVerticalIdentity({
            industry: 'Pet_Services', vc_industry: null, vc_sub_type: null, legacy_sub_type: 'Hotel',
        })).toEqual({ industry: 'pet_services', subType: 'hotel' });
        expect(backfill.tenantVerticalIdentity({ industry: 'otro' })).toEqual({ industry: 'otro', subType: '' });
    });

    describe('stays honest against the capability manifest', () => {
        it('only offers families the manifest gives that subtype, and that new signups enable', () => {
            for (const profile of backfill.TOOL_FAMILY_BACKFILL_PROFILES) {
                const manifest = resolveVerticalCapabilityManifest(profile.industry, profile.subType);
                for (const family of profile.families) {
                    expect(backfill.BACKFILLABLE_FAMILIES).toContain(family);
                    expect(manifest.toolGroups).toContain(family);
                    expect(planVerticalToolSeed(manifest).enable).toContain(family);
                }
            }
        });

        it('has a row for every subtype whose manifest carries a backfillable family', () => {
            const owed = new Map<string, string[]>();
            for (const config of listVerticalCapabilityConfigurations()) {
                const families = config.toolGroups.filter((g: string) => backfill.BACKFILLABLE_FAMILIES.includes(g));
                if (families.length) owed.set(`${config.industry}/${config.subtype}`, families);
            }
            const tabled = new Map<string, string[]>(
                backfill.TOOL_FAMILY_BACKFILL_PROFILES.map(
                    (p: any) => [`${p.industry}/${p.subType}`, [...p.families]],
                ),
            );
            expect([...tabled.entries()].sort()).toEqual([...owed.entries()].sort());
        });

        it('every backfillable family is a real tool family', () => {
            for (const family of backfill.BACKFILLABLE_FAMILIES) expect(VERTICAL_TOOL_GROUPS).toContain(family);
        });
    });
});

describe('backfillTenantToolFamilies', () => {
    const mixedAgents = (): FakeAgent[] => [
        { id: AGENT_A, is_active: true, version: 3, config_json: { tools: { appointments: { enabled: false } } } },
        { id: AGENT_B, is_active: true, version: 5, config_json: { tools: { vehicleRentals: { enabled: false } } } },
        { id: AGENT_C, is_active: true, version: 7, config_json: { tools: { vehicleRentals: { enabled: true } } } },
        { id: AGENT_D, is_active: false, version: 1, config_json: { tools: {} } },
    ];

    it('enables the missing family on active agents, never on an owner-disabled or inactive one', async () => {
        const prisma = fakePrisma(mixedAgents());
        const log = jest.fn();
        const result = await backfill.backfillTenantToolFamilies({ prisma, tenant: tenant(), log, logError: jest.fn() });

        expect(result).toMatchObject({ status: 'ok', agentsChanged: 1, enabled: 1, alreadyOn: 1, preserved: 1 });
        const byId = Object.fromEntries(prisma.agents.map((a: FakeAgent) => [a.id, a]));
        // never set -> on, version bumped, nothing else touched
        expect(byId[AGENT_A].config_json.tools).toEqual({
            appointments: { enabled: false }, vehicleRentals: { enabled: true },
        });
        expect(byId[AGENT_A].version).toBe(4);
        // explicit false -> preserved exactly, no write, no version bump
        expect(byId[AGENT_B].config_json).toEqual({ tools: { vehicleRentals: { enabled: false } } });
        expect(byId[AGENT_B].version).toBe(5);
        // already on -> untouched
        expect(byId[AGENT_C].version).toBe(7);
        // inactive agent -> not read, not written
        expect(byId[AGENT_D].config_json).toEqual({ tools: {} });
        expect(byId[AGENT_D].version).toBe(1);
        expect(prisma.updates.map((u: any) => u.id)).toEqual([AGENT_A]);
        // logs what it changed
        expect(lines(log)).toEqual([expect.stringContaining(`[BACKFILL] ${SCHEMA} automotriz/alquiler agent=${AGENT_A}: enabled vehicleRentals`)]);
    });

    it('a second run is a no-op: no UPDATE, no version bump, no log', async () => {
        const prisma = fakePrisma(mixedAgents());
        await backfill.backfillTenantToolFamilies({ prisma, tenant: tenant(), ...quiet });
        const executeCallsAfterFirst = prisma.$executeRawUnsafe.mock.calls.length;
        const snapshot = JSON.stringify(prisma.agents);
        const log = jest.fn();

        const second = await backfill.backfillTenantToolFamilies({ prisma, tenant: tenant(), log, logError: jest.fn() });

        expect(second).toMatchObject({ status: 'ok', agentsChanged: 0, enabled: 0 });
        expect(prisma.$executeRawUnsafe.mock.calls.length).toBe(executeCallsAfterFirst);
        expect(JSON.stringify(prisma.agents)).toBe(snapshot);
        expect(log).not.toHaveBeenCalled();
    });

    it('uses the pet boarding family for guarderia and hotel', async () => {
        for (const subType of ['guarderia', 'hotel']) {
            const prisma = fakePrisma([{ id: AGENT_A, is_active: true, version: 1, config_json: { tools: {} } }]);
            await backfill.backfillTenantToolFamilies({
                prisma,
                tenant: tenant({ industry: 'pet_services', vc_industry: 'pet_services', vc_sub_type: subType }),
                ...quiet,
            });
            expect(prisma.agents[0].config_json.tools).toEqual({ petBoarding: { enabled: true } });
        }
    });

    it('does not touch a tenant of any other subtype, and does not even open a transaction', async () => {
        const prisma = fakePrisma(mixedAgents());
        for (const over of [
            { vc_sub_type: 'concesionario' },
            { industry: 'turismo', vc_industry: 'turismo', vc_sub_type: 'hotel' },
            { vc_industry: null, vc_sub_type: null, industry: 'otro' },
        ]) {
            expect(await backfill.backfillTenantToolFamilies({ prisma, tenant: tenant(over), ...quiet }))
                .toEqual({ status: 'not_applicable' });
        }
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not touch an inactive tenant or an unsafe schema name', async () => {
        const prisma = fakePrisma(mixedAgents());
        const logError = jest.fn();
        expect(await backfill.backfillTenantToolFamilies({
            prisma, tenant: tenant({ is_active: false }), log: jest.fn(), logError,
        })).toEqual({ status: 'skipped_inactive' });
        expect(await backfill.backfillTenantToolFamilies({
            prisma, tenant: tenant({ schema_name: 'public"; DROP TABLE x; --' }), log: jest.fn(), logError,
        })).toMatchObject({ status: 'error', error: 'unsafe_schema' });
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rolls the whole tenant back, reports an error and never throws when a write fails', async () => {
        const agents = [
            { id: AGENT_A, is_active: true, version: 1, config_json: { tools: {} } },
            { id: AGENT_C, is_active: true, version: 1, config_json: { tools: {} } },
        ];
        const prisma = fakePrisma(agents, { failUpdateFor: AGENT_C });
        const logError = jest.fn();
        const log = jest.fn();

        const result = await backfill.backfillTenantToolFamilies({ prisma, tenant: tenant(), log, logError });

        expect(result.status).toBe('error');
        // all-or-nothing per tenant: the first agent's write was undone too
        expect(agents.map((a) => a.config_json)).toEqual([{ tools: {} }, { tools: {} }]);
        expect(agents.map((a) => a.version)).toEqual([1, 1]);
        expect(log).not.toHaveBeenCalled();
        expect(lines(logError)).toEqual([expect.stringContaining('BACKFILL-WARN')]);
        expect(lines(logError)[0]).toContain('the next deploy retries');
    });

    it('dry run reports what it would do and writes nothing', async () => {
        const prisma = fakePrisma(mixedAgents());
        const log = jest.fn();
        const result = await backfill.backfillTenantToolFamilies({
            prisma, tenant: tenant(), dryRun: true, log, logError: jest.fn(),
        });
        expect(result).toMatchObject({ status: 'ok', agentsChanged: 1 });
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(lines(log)[0]).toContain('would enable vehicleRentals');
        expect(prisma.agents.find((a: FakeAgent) => a.id === AGENT_A).version).toBe(3);
    });

    it('reads through a short lock_timeout and locks the agent rows', async () => {
        const prisma = fakePrisma(mixedAgents());
        await backfill.backfillTenantToolFamilies({ prisma, tenant: tenant(), ...quiet });
        expect(prisma.sql[0]).toMatch(/set_config\('lock_timeout'/);
        expect(prisma.sql.join('\n')).toMatch(/is_active = true[\s\S]*FOR UPDATE/);
    });
});

describe('createToolFamilyBackfill (the hook the migration runs)', () => {
    it('totals what it did and prints one machine-readable summary line', async () => {
        const prisma = fakePrisma([
            { id: AGENT_A, is_active: true, version: 1, config_json: { tools: {} } },
            { id: AGENT_B, is_active: true, version: 1, config_json: { tools: { vehicleRentals: { enabled: false } } } },
        ]);
        const hook = backfill.createToolFamilyBackfill({ prisma, ...quiet });
        await hook.run(tenant());
        await hook.run(tenant({ vc_sub_type: 'taller' }));
        await hook.run(tenant({ is_active: false }));
        expect(hook.summaryLine()).toBe(
            'TOOL_FAMILY_BACKFILL_SUMMARY tenants=1 tenants_changed=1 agents_changed=1 families_enabled=1'
            + ' already_on=0 preserved_off=1 errors=0',
        );
        // second pass over the same data
        const again = backfill.createToolFamilyBackfill({ prisma, ...quiet });
        await again.run(tenant());
        expect(again.summaryLine()).toBe(
            'TOOL_FAMILY_BACKFILL_SUMMARY tenants=1 tenants_changed=0 agents_changed=0 families_enabled=0'
            + ' already_on=1 preserved_off=1 errors=0',
        );
    });

    it('counts errors without throwing', async () => {
        const prisma = fakePrisma(
            [{ id: AGENT_A, is_active: true, version: 1, config_json: { tools: {} } }],
            { failUpdateFor: AGENT_A },
        );
        const hook = backfill.createToolFamilyBackfill({ prisma, ...quiet });
        await expect(hook.run(tenant())).resolves.toMatchObject({ status: 'error' });
        expect(hook.summaryLine()).toContain('errors=1');
    });

    it('can be switched off or run dry from the environment', async () => {
        expect(backfill.readBackfillOptions({})).toEqual({ enabled: true, dryRun: false });
        expect(backfill.readBackfillOptions({ TOOL_FAMILY_BACKFILL: 'off' })).toEqual({ enabled: false, dryRun: false });
        expect(backfill.readBackfillOptions({ TOOL_FAMILY_BACKFILL_DRY_RUN: 'true' })).toEqual({ enabled: true, dryRun: true });

        const prisma = fakePrisma([{ id: AGENT_A, is_active: true, version: 1, config_json: { tools: {} } }]);
        const off = backfill.createToolFamilyBackfill({ prisma, enabled: false, ...quiet });
        expect(await off.run(tenant())).toEqual({ status: 'disabled' });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(off.summaryLine()).toContain('disabled=true');
    });
});

describe('wired into the deploy migration (runTenantMigrations)', () => {
    /** A prisma double that lets the schema template run and counts the hook's calls. */
    function migrationPrisma() {
        const prisma: any = {
            $queryRawUnsafe: jest.fn(async (statement: string) => (
                /information_schema\.schemata/.test(statement) ? [{ schema_name: 'present' }] : []
            )),
            $executeRawUnsafe: jest.fn(async () => 0),
            $transaction: jest.fn(async (fn: any) => fn(prisma)),
        };
        return prisma;
    }
    const tpl = 'CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."t" (id int);';
    const options = { ...require('../../../scripts/migrate-tenants.js').DEFAULT_OPTIONS, maxAttempts: 1 };

    it('runs the hook once per migrated tenant and leaves the migration counters alone', async () => {
        const hook = jest.fn(async () => ({ status: 'ok' }));
        const summary = await runTenantMigrations({
            prisma: migrationPrisma(), tpl, options, afterTenantMigrated: hook,
            tenants: [
                { id: '1', schema_name: 'tenant_one', is_active: true },
                { id: '2', schema_name: 'tenant_two', is_active: true },
            ],
            log: jest.fn(), logError: jest.fn(),
        });
        expect(summary).toEqual({ ok: 2, skipped: 0, warnings: 0, retries: 0 });
        expect(hook.mock.calls.map((c: any[]) => c[0].schema_name)).toEqual(['tenant_one', 'tenant_two']);
    });

    it('a hook that throws can neither skip the tenant nor change the counters', async () => {
        const logError = jest.fn();
        const summary = await runTenantMigrations({
            prisma: migrationPrisma(), tpl, options,
            afterTenantMigrated: async () => { throw new Error('boom'); },
            tenants: [{ id: '1', schema_name: 'tenant_one', is_active: true }],
            log: jest.fn(), logError,
        });
        expect(summary).toEqual({ ok: 1, skipped: 0, warnings: 0, retries: 0 });
        expect(lines(logError)).toEqual([expect.stringContaining('BACKFILL-WARN')]);
    });

    it('does not run the hook for a tenant whose schema migration failed', async () => {
        const prisma = migrationPrisma();
        prisma.$executeRawUnsafe = jest.fn(async () => { throw Object.assign(new Error('syntax'), { code: '42601' }); });
        const hook = jest.fn();
        const summary = await runTenantMigrations({
            prisma, tpl, options, afterTenantMigrated: hook,
            tenants: [{ id: '1', schema_name: 'tenant_one', is_active: true }],
            log: jest.fn(), logError: jest.fn(),
        });
        expect(summary.ok).toBe(0);
        expect(hook).not.toHaveBeenCalled();
    });

    it('is optional: the migration behaves as before without a hook', async () => {
        const summary = await runTenantMigrations({
            prisma: migrationPrisma(), tpl, options,
            tenants: [{ id: '1', schema_name: 'tenant_one', is_active: true }],
            log: jest.fn(), logError: jest.fn(),
        });
        expect(summary).toEqual({ ok: 1, skipped: 0, warnings: 0, retries: 0 });
    });

    it('end to end: a tenant row is backfilled after its schema migrates, then the next deploy is a no-op', async () => {
        const agents: FakeAgent[] = [
            { id: AGENT_A, is_active: true, version: 1, config_json: { tools: { faqs: { enabled: true } } } },
        ];
        const prisma = fakePrisma(agents);
        const hook = backfill.createToolFamilyBackfill({ prisma, ...quiet });
        const deploy = () => runTenantMigrations({
            prisma, tpl: 'CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."t" (id int);', options,
            tenants: [tenant({ id: 'real-1' })], afterTenantMigrated: hook.run,
            log: jest.fn(), logError: jest.fn(),
        });

        expect(await deploy()).toEqual({ ok: 1, skipped: 0, warnings: 0, retries: 0 });
        expect(agents[0].config_json.tools).toEqual({ faqs: { enabled: true }, vehicleRentals: { enabled: true } });
        expect(agents[0].version).toBe(2);

        expect(await deploy()).toEqual({ ok: 1, skipped: 0, warnings: 0, retries: 0 });
        expect(agents[0].version).toBe(2);
        expect(prisma.updates).toHaveLength(1);
    });
});
