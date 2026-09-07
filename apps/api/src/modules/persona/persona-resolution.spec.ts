import { PersonaService, type PersonaResolution } from './persona.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const SCHEMA = 'tenant_resolution_test';

function buildHarness(options: {
    cached?: PersonaResolution | null;
    rows?: any[];
    hasAgents?:boolean;
    legacy?:any;
    queryFailure?:Error;
    ddlFailure?: Error;
} = {}) {
    let ddlFailure = options.ddlFailure;
    const prisma: any = {
        $queryRawUnsafe: jest.fn(async () => options.rows ?? []),
        $executeRawUnsafe: jest.fn(async () => 0),
        executeInTenantSchema: jest.fn(async (_schema:string,sql:string) => {
            if(sql.startsWith('WITH ranked')){
                if(options.queryFailure)throw options.queryFailure;
                return [{matches:options.rows||[],has_agents:options.hasAgents??false,legacy_config:options.legacy||null}];
            }
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
    it('returns the current database agent/config version for an account binding', async () => {
        const config = { language: 'es', persona: { name: 'Maya' } } as any;
        const ctx = buildHarness({ rows: [{ id: AGENT_ID, version: 7, config_json: config }] });

        await expect(ctx.service.resolvePersonaForChannel(
            TENANT_ID, 'whatsapp', 'phone-1',
        )).resolves.toEqual({ config, agentId: AGENT_ID, version: 7 });

        expect(ctx.prisma.executeInTenantSchema).toHaveBeenCalledWith(
            SCHEMA,expect.stringContaining('WITH ranked'),['whatsapp:phone-1','whatsapp'],
        );
        expect(ctx.redis.setJson).not.toHaveBeenCalled();
    });

    it('keeps the config wrapper while ignoring stale instructions from Redis', async () => {
        const config = { language: 'en', persona: { name: 'Ari' } } as any;
        const ctx = buildHarness({ cached: { config:{...config,language:'es'}, agentId: AGENT_ID, version: 1 },
            rows:[{id:AGENT_ID,version:2,config_json:config}] });

        await expect(ctx.service.getPersonaForChannel(TENANT_ID, 'telegram')).resolves.toBe(config);
        expect(ctx.redis.getJson).not.toHaveBeenCalled();
    });

    it('uses null attribution for legacy fallback instead of inventing an agent', async () => {
        const config = { language: 'pt', persona: { name: 'Padrão' } } as any;
        const ctx = buildHarness({legacy:config});

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
        expect(ctx.prisma.executeInTenantSchema.mock.calls.filter((call:any[])=>!call[1].startsWith('WITH ranked'))).toHaveLength(4);
    });
    it('does not resurrect an inactive durable agent through legacy or default fallback',async()=>{
        const config={persona:{name:'Old cached agent'}} as any;
        const ctx=buildHarness({cached:{config,agentId:AGENT_ID,version:1},hasAgents:true,legacy:config});
        await expect(ctx.service.resolvePersonaForChannel(TENANT_ID,'telegram')).resolves.toEqual({config:null,agentId:null,version:null});
        expect(ctx.redis.getJson).not.toHaveBeenCalled();
    });
    it('does not invent configuration for a tenant with no configured agent',async()=>{
        const ctx=buildHarness();await expect(ctx.service.getPersonaForChannel(TENANT_ID,'telegram')).resolves.toBeNull();
    });
    it('does not convert a failed authoritative read into a fallback agent',async()=>{
        const ctx=buildHarness({queryFailure:new Error('synthetic_db_unavailable'),legacy:{persona:{name:'Legacy'}}});
        await expect(ctx.service.resolvePersonaForChannel(TENANT_ID,'telegram')).rejects.toThrow('synthetic_db_unavailable');
        expect(ctx.redis.getJson).not.toHaveBeenCalled();
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
