import { HandoffService, UNATTENDED_HANDOFF_MINUTES } from './handoff.service';
import { hasDispatchOutbox, noHumanReplySql } from './handoff-human-reply';

/**
 * Owner decision (5-oct): when nobody from the team takes a handoff, the agent
 * resumes after 10 minutes. The sweep runs every minute under CronLockService.
 *
 * The SQL itself is exercised against a real PostgreSQL in
 * handoff-unattended-return.postgres.spec.ts; this suite pins how the service
 * drives it (what it announces, closes and asks for), with a recording stub.
 */
describe('unattended handoff return (service behavior)', () => {
    const tenant = { id: 't1', schemaName: 'tenant_t1' };
    function harness(opts: { updated?: any[]; outbox?: boolean; assignments?: boolean } = {}) {
        const calls: Array<{ sql: string; params: any[] }> = [];
        const prisma: any = {
            tenant: { findMany: jest.fn().mockResolvedValue([tenant]) },
            executeInTenantSchema: jest.fn(async (_s: string, sql: string, params: any[]) => {
                calls.push({ sql, params });
                if (sql.includes('to_regclass')) {
                    const wants = String(params[0]);
                    if (wants.endsWith('agent_dispatch_outbox')) return opts.outbox === false ? [{ t: null }] : [{ t: 'agent_dispatch_outbox' }];
                    if (wants.endsWith('conversation_assignments')) return opts.assignments === false ? [{ t: null }] : [{ t: 'conversation_assignments' }];
                }
                if (sql.startsWith('UPDATE conversations c')) return opts.updated ?? [{ id: 'c1' }];
                return [];
            }),
        };
        const redis = { del: jest.fn().mockResolvedValue(undefined) };
        const events = { emit: jest.fn() };
        const cronLock = { runExclusive: jest.fn(async (_n: string, _t: number, fn: () => Promise<void>) => { await fn(); }) };
        const service = new HandoffService(prisma, redis as any, events as any, {} as any, {} as any, {} as any, {} as any, cronLock as any);
        const sweepUpdate = () => calls.find(c => c.sql.startsWith('UPDATE conversations c'))!;
        return { service, calls, events, redis, cronLock, prisma, sweepUpdate };
    }

    it('uses a 10-minute window', async () => {
        expect(UNATTENDED_HANDOFF_MINUTES).toBe(10);
        const h = harness();
        await h.service.returnUnattendedHandoffs();
        expect(h.sweepUpdate().params).toEqual(['10']);
    });

    it('picks the rows and guards the UPDATE with the same human-reply conditions', async () => {
        const h = harness();
        await h.service.returnUnattendedHandoffs();
        const sql = h.sweepUpdate().sql;
        // The conditions appear for the picking subquery AND for the guarded UPDATE.
        expect(sql.match(/m\.metadata->>'source' = 'agent'/g)).toHaveLength(2);
        expect(sql.match(/o\.operational_scope->>'kind' = 'human_operator'/g)).toHaveLength(2);
        expect(sql.match(/COALESCE\([xc]\.metadata->'handoff'->>'returnedToAi'/g)).toHaveLength(2);
        expect(sql).toContain("c.status IN ('waiting_human', 'with_human')");
        expect(sql).toContain('assigned_to = NULL');
    });

    it('a tenant schema without the outbox table is not asked about it', async () => {
        const h = harness({ outbox: false });
        await h.service.returnUnattendedHandoffs();
        expect(h.sweepUpdate().sql).not.toContain('agent_dispatch_outbox');
        expect(h.sweepUpdate().sql).toContain("m.metadata->>'source' = 'agent'");
    });

    it('announces, closes the assignment and clears the cache only for rows the UPDATE returned', async () => {
        const h = harness({ updated: [{ id: 'c1' }, { id: 'c2' }] });
        await h.service.returnUnattendedHandoffs();
        expect(h.events.emit).toHaveBeenCalledTimes(2);
        expect(h.events.emit).toHaveBeenCalledWith('handoff.returned_unattended', { tenantId: 't1', schemaName: 'tenant_t1', conversationId: 'c2' });
        expect(h.redis.del).toHaveBeenCalledWith('handoff:t1:c1');
        const closes = h.calls.filter(c => c.sql.includes('UPDATE conversation_assignments'));
        expect(closes.map(c => c.params[0])).toEqual(['c1', 'c2']);
    });

    it('does nothing for a conversation a person answered in the meantime (UPDATE returns no row)', async () => {
        const h = harness({ updated: [] });
        await h.service.returnUnattendedHandoffs();
        expect(h.events.emit).not.toHaveBeenCalled();
        expect(h.redis.del).not.toHaveBeenCalled();
        expect(h.calls.some(c => c.sql.includes('UPDATE conversation_assignments'))).toBe(false);
    });

    it('a tenant without conversation_assignments is still returned', async () => {
        const h = harness({ assignments: false });
        await h.service.returnUnattendedHandoffs();
        expect(h.events.emit).toHaveBeenCalledTimes(1);
        expect(h.calls.some(c => c.sql.includes('UPDATE conversation_assignments'))).toBe(false);
    });

    it('the cron takes the lock, with a TTL under its 60 s interval', async () => {
        const h = harness();
        await h.service.returnUnattendedHandoffsCron();
        const [name, ttl] = h.cronLock.runExclusive.mock.calls[0] as any[];
        expect(name).toBe('handoff.returnUnattendedHandoffs');
        expect(ttl).toBeLessThan(60);
        expect(h.events.emit).toHaveBeenCalledTimes(1);
    });

    it('a lost lock means no sweep', async () => {
        const h = harness();
        h.cronLock.runExclusive.mockImplementation(async () => undefined);
        await h.service.returnUnattendedHandoffsCron();
        expect(h.prisma.tenant.findMany).not.toHaveBeenCalled();
    });
});

describe('human-reply evidence', () => {
    it('counts the console reply on every channel, not only the widget', () => {
        const sql = noHumanReplySql('c', true);
        expect(sql).toContain("m.metadata->>'source' = 'agent'");
        expect(sql).toContain('FROM agent_dispatch_outbox o');
        expect(sql).toContain("o.operational_scope->>'kind' = 'human_operator'");
        expect(sql).toContain("(c.metadata->'handoff'->>'startedAt')::timestamptz");
    });
    it('leaves the outbox out when the table is absent', async () => {
        expect(noHumanReplySql('c', false)).not.toContain('agent_dispatch_outbox');
        expect(await hasDispatchOutbox(async () => [{ t: null }], 'tenant_x')).toBe(false);
        expect(await hasDispatchOutbox(async () => [{ t: 'agent_dispatch_outbox' }], 'tenant_x')).toBe(true);
        expect(await hasDispatchOutbox(async () => { throw new Error('boom'); }, 'tenant_x')).toBe(false);
    });
});
