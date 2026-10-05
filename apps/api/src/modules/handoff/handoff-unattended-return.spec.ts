import { readFileSync } from 'fs';
import { resolve } from 'path';
import { HandoffService, UNATTENDED_HANDOFF_MINUTES } from './handoff.service';

/**
 * Owner decision (5-oct): when nobody from the team takes a handoff, the agent
 * resumes after 10 minutes. The sweep runs every minute under CronLockService.
 */
describe('unattended handoff return', () => {
    const tenant = { id: 't1', schemaName: 'tenant_t1' };
    function harness(strandedRows: any[] = [{ id: 'c1' }]) {
        const calls: Array<{ sql: string; params: any[] }> = [];
        const prisma: any = {
            tenant: { findMany: jest.fn().mockResolvedValue([tenant]) },
            executeInTenantSchema: jest.fn(async (_s: string, sql: string, params: any[]) => {
                calls.push({ sql, params });
                return sql.includes('SELECT c.id') ? strandedRows : [];
            }),
        };
        const redis = { del: jest.fn().mockResolvedValue(undefined) };
        const events = { emit: jest.fn() };
        const cronLock = { runExclusive: jest.fn(async (_n: string, _t: number, fn: () => Promise<void>) => { await fn(); }) };
        const service = new HandoffService(prisma, redis as any, events as any, {} as any, {} as any, {} as any, {} as any, cronLock as any);
        return { service, calls, events, redis, cronLock, prisma };
    }

    it('uses a 10-minute window', async () => {
        expect(UNATTENDED_HANDOFF_MINUTES).toBe(10);
        const h = harness();
        await h.service.returnUnattendedHandoffs();
        expect(h.calls[0].params).toEqual(['10']);
    });

    it('also covers an auto-assigned with_human conversation nobody has written in', async () => {
        const h = harness();
        await h.service.returnUnattendedHandoffs();
        const select = h.calls[0].sql;
        expect(select).toContain("c.status IN ('waiting_human', 'with_human')");
        // a human reply since the handoff blocks the return
        expect(select).toMatch(/NOT EXISTS[\s\S]*m\.direction = 'outbound'[\s\S]*m\.metadata->>'source' = 'agent'/);
        const update = h.calls.find(c => c.sql.includes('UPDATE conversations'))!;
        expect(update.sql).toContain("status IN ('waiting_human', 'with_human')");
        expect(update.sql).toContain("status = 'active'");
        expect(update.sql).toContain('assigned_to = NULL');
        expect(update.sql).toContain('returnNoticePending');
    });

    it('returns each stranded conversation once and emits the event', async () => {
        const h = harness([{ id: 'c1' }, { id: 'c2' }]);
        await h.service.returnUnattendedHandoffs();
        expect(h.calls.filter(c => c.sql.includes('UPDATE conversations'))).toHaveLength(2);
        expect(h.events.emit).toHaveBeenCalledWith('handoff.returned_unattended', { tenantId: 't1', conversationId: 'c2' });
        expect(h.redis.del).toHaveBeenCalledWith('handoff:t1:c1');
    });

    it('does nothing when no conversation is stranded (a human already answered)', async () => {
        const h = harness([]);
        await h.service.returnUnattendedHandoffs();
        expect(h.calls.some(c => c.sql.includes('UPDATE conversations'))).toBe(false);
        expect(h.events.emit).not.toHaveBeenCalled();
    });

    it('the cron runs every minute and takes the lock, so API and worker never both fire', async () => {
        const src = readFileSync(resolve(__dirname, 'handoff.service.ts'), 'utf8');
        expect(src).toMatch(/@Cron\('\* \* \* \* \*'\)\s+async returnUnattendedHandoffsCron/);
        const h = harness();
        await h.service.returnUnattendedHandoffsCron();
        expect(h.cronLock.runExclusive).toHaveBeenCalledTimes(1);
        const [name, ttl] = h.cronLock.runExclusive.mock.calls[0] as any[];
        expect(name).toBe('handoff.returnUnattendedHandoffs');
        // CronLockService never releases: the TTL must be below the 60s interval.
        expect(ttl).toBeLessThan(60);
    });

    it('a lost lock means no sweep', async () => {
        const h = harness();
        h.cronLock.runExclusive.mockImplementation(async () => undefined);
        await h.service.returnUnattendedHandoffsCron();
        expect(h.prisma.tenant.findMany).not.toHaveBeenCalled();
    });
});

describe('customer messaging around an unattended handoff', () => {
    const src = readFileSync(resolve(__dirname, '../conversations/conversations.service.ts'), 'utf8');

    it('a customer writing into waiting_human gets one queue notice, not silence', () => {
        const at = src.indexOf('const waitingSaved = await this.saveMessage');
        expect(at).toBeGreaterThan(0);
        expect(src.slice(at, at + 700)).toContain("conversation.status === 'waiting_human'");
        expect(src.slice(at, at + 700)).toContain('sendQueueNoticeOnce(');
        const fn = src.slice(src.indexOf('private async sendQueueNoticeOnce'), src.indexOf('private async sendReturnNoticeOnce'));
        expect(fn).toContain("queueNoticeSent', 'false') <> 'true'");
        expect(fn).toContain('queueHead');
    });

    it('after the return the agent says honestly that nobody is available, once, in four languages', () => {
        expect(src).toContain('sendReturnNoticeOnce(');
        for (const text of [
            'No hay nadie del equipo disponible ahora; sigo ayudándote yo.',
            'Nobody from the team is available right now; I will keep helping you.',
            'Não há ninguém da equipe disponível agora; eu continuo te ajudando.',
            "Personne de l'équipe n'est disponible pour le moment ; je continue de vous aider.",
        ]) expect(src).toContain(text);
        const fn = src.slice(src.indexOf('private async sendReturnNoticeOnce'), src.indexOf('Leave the short-lived'));
        expect(fn).toContain("returnNoticePending' = 'true'");
    });
});
