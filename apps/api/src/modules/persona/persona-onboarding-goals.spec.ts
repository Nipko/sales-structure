import { PersonaService } from './persona.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_goal_test';

function harness(existingAgents = 0) {
    let inserted: { name: string; templateId: string; config: any; createdBy: string } | null = null;
    const queryRaw = jest.fn(async (sql: string, ...params: any[]) => {
        if (sql.includes('COUNT(*)::int AS cnt') && sql.includes('agent_personas')) {
            return [{ cnt: existingAgents }];
        }
        if (sql.includes(`"${SCHEMA}".services`)) return [{ cnt: 1 }];
        if (sql.includes(`"${SCHEMA}".availability_slots`)) return [{ cnt: 1 }];
        throw new Error(`Unexpected query: ${sql}`);
    });
    const executeRaw = jest.fn(async (sql: string, ...params: any[]) => {
        if (sql.includes('INSERT INTO') && sql.includes('agent_personas')) {
            inserted = {
                name: params[0],
                templateId: params[1],
                config: JSON.parse(params[2]),
                createdBy: params[4],
            };
            return 1;
        }
        throw new Error(`Unexpected execute: ${sql}`);
    });
    const prisma: any = {
        tenant: { findUnique: jest.fn(async () => ({ language: 'es-CO' })) },
        $queryRawUnsafe: queryRaw,
        $executeRawUnsafe: executeRaw,
    };
    const tenants: any = { getSchemaName: jest.fn(async () => SCHEMA) };
    const service = new PersonaService(
        prisma,
        { del: jest.fn() } as any,
        tenants,
        {} as any,
        {} as any,
    );
    return { service, prisma, queryRaw, inserted: () => inserted };
}

describe('PersonaService onboarding goal selection', () => {
    it('wires a canonical vertical goal resolution into the inserted default agent', async () => {
        const ctx = harness();
        await ctx.service.createDefaultAgentFromGoals(
            TENANT_ID,
            ['support'],
            'onboarding',
            'technology',
            'saas',
        );

        expect(ctx.inserted()).toEqual(expect.objectContaining({
            templateId: 'tpl_technology_soporte',
            createdBy: 'onboarding',
            config: expect.objectContaining({
                persona: expect.objectContaining({ name: 'Diego', role: 'Soporte técnico' }),
            }),
        }));
    });

    it('returns before resolving templates or writing when an explicit agent already exists', async () => {
        const ctx = harness(1);
        await ctx.service.createDefaultAgentFromGoals(
            TENANT_ID,
            ['support'],
            'onboarding-retry',
            'technology',
            'saas',
        );

        expect(ctx.inserted()).toBeNull();
        expect(ctx.prisma.tenant.findUnique).not.toHaveBeenCalled();
        expect(ctx.queryRaw).toHaveBeenCalledTimes(1);
    });
});
