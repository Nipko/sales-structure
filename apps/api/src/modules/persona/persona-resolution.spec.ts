import { PersonaService, type PersonaResolution } from './persona.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const SCHEMA = 'tenant_resolution_test';

function buildHarness(options: {
    cached?: PersonaResolution | null;
    rows?: any[];
    ddlFailure?: Error;
} = {}) {
    let ddlFailure = options.ddlFailure;
    const prisma: any = {
        $queryRawUnsafe: jest.fn(async () => options.rows ?? []),
        $executeRawUnsafe: jest.fn(async () => 0),
        executeInTenantSchema: jest.fn(async () => {
            if (ddlFailure) {
                const error = ddlFailure;
                ddlFailure = undefined;
                throw error;
            }
            return 0;
        }),
        channelAccount: { findMany: jest.fn(async () => []) },
    };
    const redis: any = {
        getJson: jest.fn(async () => options.cached ?? null),
        setJson: jest.fn(async () => undefined),
        del: jest.fn(async () => 1),
    };
    const tenants: any = { getSchemaName: jest.fn(async () => SCHEMA) };
    const service = new PersonaService(
        prisma,
        redis,
        tenants,
        {} as any,
        { emit: jest.fn() } as any,
    );
    // Exercise resolution without testing unrelated persona-table bootstrap DDL.
    (service as any).initializedTenants.add(TENANT_ID);
    return { service, prisma, redis };
}

describe('PersonaService production resolution', () => {
    it('returns and caches exact agent/config version for an account binding', async () => {
        const config = { language: 'es', persona: { name: 'Maya' } } as any;
        const ctx = buildHarness({ rows: [{ id: AGENT_ID, version: 7, config_json: config }] });

        await expect(ctx.service.resolvePersonaForChannel(
            TENANT_ID, 'whatsapp', 'phone-1',
        )).resolves.toEqual({ config, agentId: AGENT_ID, version: 7 });

        expect(ctx.prisma.$queryRawUnsafe).toHaveBeenCalledWith(
            expect.stringContaining('SELECT id, config_json, version'),
            'whatsapp:phone-1',
        );
        expect(ctx.redis.setJson).toHaveBeenCalledWith(
            `persona-resolution:${TENANT_ID}:channel:whatsapp:acct:phone-1`,
            { config, agentId: AGENT_ID, version: 7 },
            600,
        );
    });

    it('keeps the config-only wrapper compatible and cache contracts separate', async () => {
        const config = { language: 'en', persona: { name: 'Ari' } } as any;
        const ctx = buildHarness({ cached: { config, agentId: AGENT_ID, version: 2 } });

        await expect(ctx.service.getPersonaForChannel(TENANT_ID, 'telegram')).resolves.toBe(config);
        expect(ctx.redis.getJson).toHaveBeenCalledWith(
            `persona-resolution:${TENANT_ID}:channel:telegram`,
        );
        expect(ctx.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('uses null attribution for legacy fallback instead of inventing an agent', async () => {
        const config = { language: 'pt', persona: { name: 'Padrão' } } as any;
        const ctx = buildHarness();
        jest.spyOn(ctx.service, 'getActivePersona').mockResolvedValue(config);

        await expect(ctx.service.resolvePersonaForChannel(TENANT_ID, 'messenger')).resolves.toEqual({
            config,
            agentId: null,
            version: null,
        });
    });

    it('does not block live resolution on DDL failure and retries next turn', async () => {
        const config = { language: 'fr', persona: { name: 'Camille' } } as any;
        const ctx = buildHarness({
            rows: [{ id: AGENT_ID, version: 1, config_json: config }],
            ddlFailure: new Error('lock timeout'),
        });

        await expect(ctx.service.resolvePersonaForChannel(TENANT_ID, 'instagram')).resolves.toEqual({
            config,
            agentId: AGENT_ID,
            version: 1,
        });
        await ctx.service.resolvePersonaForChannel(TENANT_ID, 'instagram');
        expect(ctx.prisma.executeInTenantSchema).toHaveBeenCalledTimes(4);
    });

    it('offers bounded invalidation for one account', async () => {
        const ctx = buildHarness();
        await ctx.service.invalidatePersonaResolutionCaches(TENANT_ID, {
            channelType: 'whatsapp',
            accountId: 'phone-1',
        });
        expect(ctx.redis.del.mock.calls).toEqual([
            [`persona:${TENANT_ID}:channel:whatsapp:acct:phone-1`],
            [`persona-resolution:${TENANT_ID}:channel:whatsapp:acct:phone-1`],
        ]);
    });
});
