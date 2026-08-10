import { AgentConsoleService } from './agent-console.service';

/**
 * Regression cover for the "Mías" inbox filter returning a 500.
 *
 * `conversations.assigned_to` is VARCHAR(255) (it stores a user id as text — see
 * prisma/tenant-schema.sql), but the filter compared it against a parameter cast
 * to ::uuid. Postgres has no `varchar = uuid` operator, so the whole inbox query
 * failed with 42883 and the agent's own conversations were unreachable:
 *
 *   GET /agent-console/inbox/:tenantId?filter=mine&agentId=… → 500
 *   Raw query failed. Code: 42883.
 *   ERROR: operator does not exist: character varying = uuid
 *
 * The rest of the codebase already compares this column as text — see
 * agent-availability.service (`active.assigned_to = u.id::text`) and
 * automation-jobs.processor (`SET assigned_to = $1`, with an explicit comment
 * that the column is VARCHAR).
 */
describe('AgentConsoleService.getInbox — assigned_to is VARCHAR, not UUID', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const agentId = '33333333-3333-4333-8333-333333333333';
    const schemaName = 'tenant_acme';

    function makeHarness() {
        const sqls: string[] = [];
        const prisma: any = {
            transactionInTenantSchema: jest.fn().mockImplementation(async (_schema: string, cb: any) => {
                return cb(async (sql: string) => { sqls.push(sql); return []; });
            }),
            executeInTenantSchema: jest.fn().mockImplementation(async (_schema: string, sql: string) => {
                sqls.push(sql); return [];
            }),
        };
        const redis = { get: jest.fn().mockResolvedValue(schemaName) };
        const service = new AgentConsoleService(
            prisma, redis as any, {} as any, {} as any,
            {} as any, {} as any, { emit: jest.fn() } as any, {} as any,
        );
        return { service, sqls };
    }

    /** Every SQL text the call produced, joined — the filter lands in one of them. */
    const allSql = (sqls: string[]) => sqls.join('\n---\n');

    it('does not cast the agent id to uuid when filtering by "mine"', async () => {
        const h = makeHarness();

        await h.service.getInbox(tenantId, agentId, 'mine', 50, 0);

        const sql = allSql(h.sqls);
        expect(sql).toContain('assigned_to');
        // The exact shape that raised 42883 in production.
        expect(sql).not.toMatch(/assigned_to\s*=\s*\$\d+::uuid/);
    });

    it('does not cast assigned_to to uuid when counting an agent active load', async () => {
        const h = makeHarness();

        await h.service.getAgentStats(tenantId, agentId);

        const sql = allSql(h.sqls);
        expect(sql).not.toMatch(/assigned_to\s*=\s*\$\d+::uuid/);
    });

    it('still casts conversation_assignments.agent_id, which really is a UUID column', async () => {
        const h = makeHarness();

        await h.service.getAgentStats(tenantId, agentId);

        // Guards against "fixing" this by stripping every ::uuid cast in the file.
        expect(allSql(h.sqls)).toMatch(/agent_id\s*=\s*\$\d+::uuid/);
    });
});
