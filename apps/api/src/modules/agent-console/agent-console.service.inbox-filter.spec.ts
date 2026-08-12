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

    it('scopes an agent default inbox to own plus unassigned conversations', async () => {
        const h = makeHarness();

        await h.service.getInbox(tenantId, agentId, 'all', 50, 0, 'tenant_agent');

        expect(allSql(h.sqls)).toMatch(/assigned_to IS NULL OR c\.assigned_to = \$\d+/);
    });

    it.each(['tenant_admin', 'tenant_supervisor'])(
        'does not hide peer conversations from elevated role %s',
        async (role) => {
            const h = makeHarness();

            await h.service.getInbox(tenantId, agentId, 'all', 50, 0, role);

            expect(allSql(h.sqls)).not.toContain('assigned_to IS NULL OR c.assigned_to');
        },
    );

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

/**
 * The conversation detail endpoint never returned who holds the conversation.
 *
 * `ConversationScreen` decides "am I the one handling this?" with
 * `conv.assignedAgentId === user.id`. The detail payload simply had no such field
 * (the interface declared a nested `assignedAgent` that nothing ever populated), so
 * the check was always false: right after tapping "Tomar control" the optimistic
 * state was overwritten by the reload and the banner fell back to "waiting for a
 * human", with the take-control button still offered. That banner exists precisely
 * to remove takeover ambiguity.
 */
describe('AgentConsoleService.getConversation — exposes who holds the conversation', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const agentId = '33333333-3333-4333-8333-333333333333';

    function makeHarness(assignedTo: string | null) {
        const prisma: any = {
            executeInTenantSchema: jest.fn().mockImplementation(async (_s: string, sql: string) => {
                if (sql.includes('FROM conversations c')) {
                    return [{
                        id: conversationId, contact_id: 'c1', status: 'with_human',
                        assigned_to: assignedTo, channel_type: 'telegram', metadata: {},
                    }];
                }
                if (sql.includes('COUNT(*) as total')) return [{ total: 1 }];
                return [];
            }),
        };
        const redis = { get: jest.fn().mockResolvedValue('tenant_acme') };
        return new AgentConsoleService(
            prisma, redis as any, {} as any, {} as any,
            {} as any, {} as any, { emit: jest.fn() } as any, {} as any,
        );
    }

    it('returns the holding agent id so the client can recognise its own conversation', async () => {
        const detail = await makeHarness(agentId).getConversation(tenantId, conversationId);
        expect(detail?.assignedAgentId).toBe(agentId);
    });

    it('returns null when the AI still holds it', async () => {
        const detail = await makeHarness(null).getConversation(tenantId, conversationId);
        expect(detail?.assignedAgentId).toBeNull();
    });
});
