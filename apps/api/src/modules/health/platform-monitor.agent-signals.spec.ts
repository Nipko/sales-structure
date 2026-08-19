import { PlatformMonitorService } from './platform-monitor.service';

/**
 * The Ops Center watched whether the platform was UP. It had no way to see the
 * agent lying to a customer or answering nobody, because a turn that invents a
 * booking or dies in silence completes its queue job perfectly — green
 * everywhere, wrong in the only place that matters.
 *
 * These counters existed but nothing read them, which is the same as not having
 * them. This is the check that reads them, and this is what keeps its thresholds
 * and its key layout honest.
 */

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

function createMonitor(counters: Record<string, number>, tenantsBySignal: Record<string, string[]> = {}) {
    const alerts: Array<{ key: string; subject: string; html: string; value: number }> = [];
    const resolved: string[] = [];

    const redis = {
        get: jest.fn(async (key: string) => {
            const v = counters[key];
            return v === undefined ? null : String(v);
        }),
        smembers: jest.fn(async (key: string) => {
            for (const [signal, ids] of Object.entries(tenantsBySignal)) {
                if (key === `agent:signal:${signal}:tenants:${TODAY}`) return ids;
            }
            return [];
        }),
    };
    const prisma = {
        tenant: { findMany: jest.fn(async () => [{ id: 'tenant-a', name: 'Hotel Amazonas' }]) },
    };
    const incidents = { resolveByKey: jest.fn(async (key: string) => { resolved.push(key); }) };

    const monitor = new PlatformMonitorService(
        redis as any, {} as any, prisma as any, {} as any, {} as any,
        incidents as any, {} as any, {} as any, {} as any, {} as any,
        {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        {} as any, {} as any,
    );
    // The alert pipeline (incident + email + Telegram + SMS cooldown) is exercised
    // by the checks that already ship; here we only care about WHAT fires.
    (monitor as any).alert = jest.fn(async (key: string, subject: string, html: string, value: number) => {
        alerts.push({ key, subject, html, value });
    });

    return { monitor, alerts, resolved };
}

const total = (signal: string, todayValue: number, yesterdayValue = 0) => ({
    [`agent:signal:${signal}:${TODAY}`]: todayValue,
    [`agent:signal:${signal}:${YESTERDAY}`]: yesterdayValue,
});

describe('PlatformMonitorService — agent reliability signals', () => {
    it('stays quiet when the agent is behaving', async () => {
        const { monitor, alerts } = createMonitor({
            ...total('claim_unbacked', 1),
            ...total('silent_turn', 2),
            ...total('commit_then_failure', 0),
            ...total('concurrent_turn_deferred', 10),
            ...total('pending_confirmation_executed', 40),
        });

        await monitor.checkAgentReliability();
        expect(alerts).toEqual([]);
    });

    it('alerts once a stream of unbacked claims appears, and says which tenant', async () => {
        const { monitor, alerts } = createMonitor(
            { ...total('claim_unbacked', 4, 3) },
            { claim_unbacked: ['tenant-a'] },
        );

        await monitor.checkAgentReliability();

        const claim = alerts.find(a => a.key === 'agent:claim_unbacked');
        expect(claim).toBeDefined();
        expect(claim!.value).toBe(7);
        // An alert nobody can act on is noise: it must name where to look.
        expect(claim!.html).toContain('Hotel Amazonas');
    });

    it('treats a single commit-then-failure as worth waking someone up', async () => {
        // Something real was created and the customer was never told the details.
        // There is no volume threshold that makes that acceptable.
        const { monitor, alerts } = createMonitor({ ...total('commit_then_failure', 1) });

        await monitor.checkAgentReliability();
        expect(alerts.map(a => a.key)).toContain('agent:commit_then_failure');
    });

    it('classifies that one as critical, not as a warning', () => {
        const { monitor } = createMonitor({});
        expect((monitor as any).severityFromKey('agent:commit_then_failure')).toBe('critical');
        expect((monitor as any).severityFromKey('agent:claim_unbacked')).toBe('warning');
    });

    it('reports silent turns, which no other check can see', async () => {
        const { monitor, alerts } = createMonitor({ ...total('silent_turn', 12) });

        await monitor.checkAgentReliability();
        const silent = alerts.find(a => a.key === 'agent:silent_turn');
        expect(silent?.value).toBe(12);
    });

    it('closes its own incidents when a signal goes quiet again', async () => {
        const { monitor, resolved } = createMonitor({});

        await monitor.checkAgentReliability();
        expect(resolved).toEqual(expect.arrayContaining([
            'agent:claim_unbacked',
            'agent:commit_then_failure',
            'agent:silent_turn',
            'agent:concurrent_turn_deferred',
        ]));
    });

    it('reads a bounded set of keys instead of scanning the whole namespace', async () => {
        // The per-tenant keys grow with the customer base. If this check ever
        // scans them on every tick it becomes slow, and a slow check gets turned
        // off — so the totals it polls must be platform-wide and fixed in number.
        const { monitor } = createMonitor({});
        const redisGet = (monitor as any).redis.get as jest.Mock;

        await monitor.checkAgentReliability();

        const polled = redisGet.mock.calls.map((c: any[]) => String(c[0]));
        expect(polled).toHaveLength(10); // 5 signals × 2 days
        expect(polled.every((k: string) => /^agent:signal:[a-z_]+:\d{4}-\d{2}-\d{2}$/.test(k))).toBe(true);
    });

    it('never lets a Redis failure break the monitor', async () => {
        const { monitor } = createMonitor({});
        (monitor as any).redis.get = jest.fn(async () => { throw new Error('redis down'); });

        await expect(monitor.checkAgentReliability()).resolves.toBeUndefined();
    });
});
