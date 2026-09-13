import { ALERT_CONFIG_DEFAULTS } from './alert-config.service';
import { PlatformMonitorService } from './platform-monitor.service';

/**
 * The outbox parks an effect in `reconciliation_required` when it cannot say
 * whether the customer got it, and refuses to retry it so the customer does not
 * get a second copy. Nothing else on this service can see that: the queue job
 * completed, the tenant is up, no provider is down. The count sat behind an
 * endpoint with a comment calling it "for an alert to act on", and no alert.
 *
 * These tests pin the two questions the check has to keep apart — how many are
 * waiting, and how long the oldest has waited — and the fact that one broken
 * tenant cannot silence the platform.
 */

type Backlog =
    | { total: number; oldest: number; breaching: number; stalled?: number; stalledOldest?: number }
    /** Tenant never took this path: the table does not exist. */
    | 'no-table'
    /** Schema missing, mid-migration, or the connection died. */
    | 'unreadable';

interface TenantFixture { name: string; schemaName: string; backlog: Backlog }

/** Bucketed latency samples the monitor will fold, keyed exactly as production writes them. */
function latencyHashes(byOperation: Partial<Record<'admit' | 'settle', Record<string, number>>>) {
    const hgetall = jest.fn(async (key: string) => {
        const operation = key.split(':')[2] as 'admit' | 'settle';
        // Everything in the newest minute; the window folding has its own test.
        if (!key.endsWith(NOW_MINUTE)) return {};
        const buckets = byOperation[operation];
        if (!buckets) return {};
        return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, String(v)]));
    });
    return { hgetall };
}

const NOW_MINUTE = (() => {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`
        + `${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}`
        + `${String(now.getUTCMinutes()).padStart(2, '0')}`;
})();

function createMonitor(tenants: TenantFixture[], redis: any = {}) {
    const alerts: Array<{ key: string; subject: string; html: string; value: number }> = [];
    const resolved: string[] = [];
    const executedSql: string[] = [];

    const prisma = {
        tenant: {
            findMany: jest.fn(async () => tenants.map((t, i) => ({
                id: `tenant-${i}`, name: t.name, schemaName: t.schemaName,
            }))),
        },
        transactionInTenantSchema: jest.fn(async (schema: string, callback: any) => {
            const fixture = tenants.find(t => t.schemaName === schema);
            if (!fixture || fixture.backlog === 'unreadable') throw new Error('schema unreadable');
            const backlog = fixture.backlog;
            // The real readDispatchBacklog runs against this, so the test covers
            // the primitive's contract too, not just the aggregation around it.
            return callback(async (sql: string) => {
                executedSql.push(sql);
                if (sql.includes('current_schema()')) {
                    return [{
                        schema,
                        outbox: backlog === 'no-table' ? null : `${schema}.agent_dispatch_outbox`,
                    }];
                }
                if (backlog === 'no-table') throw new Error('relation does not exist');
                return [{
                    total: backlog.total, oldest: backlog.oldest, breaching: backlog.breaching,
                    stalled: backlog.stalled ?? 0, stalled_oldest: backlog.stalledOldest ?? 0,
                }];
            });
        }),
    };
    const incidents = { resolveByKey: jest.fn(async (key: string) => { resolved.push(key); }) };
    const alertConfig = { get: jest.fn(async () => ALERT_CONFIG_DEFAULTS) };

    const monitor = new PlatformMonitorService(
        redis as any, {} as any, prisma as any, {} as any, {} as any,
        incidents as any, {} as any, {} as any, alertConfig as any, {} as any,
        {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        {} as any, {} as any,
    );
    // The alert pipeline (incident + email + Telegram + SMS cooldown) already has
    // its own coverage; here only WHAT fires matters.
    (monitor as any).alert = jest.fn(async (key: string, subject: string, html: string, value: number) => {
        alerts.push({ key, subject, html, value });
    });

    return { monitor, alerts, resolved, executedSql, prisma };
}

const quiet = (name: string, schemaName: string): TenantFixture =>
    ({ name, schemaName, backlog: { total: 0, oldest: 0, breaching: 0 } });

describe('PlatformMonitorService — uncertain dispatch effects', () => {
    it('stays quiet and closes both incidents when nothing is waiting', async () => {
        const { monitor, alerts, resolved } = createMonitor([
            quiet('Hotel Amazonas', 'tenant_amazonas'),
            { name: 'Clínica Sur', schemaName: 'tenant_sur', backlog: 'no-table' },
        ]);

        await monitor.checkDispatchBacklog();

        expect(alerts).toEqual([]);
        expect(resolved).toEqual(expect.arrayContaining([
            'dispatch:reconciliation:overdue',
            'dispatch:reconciliation:backlog',
            'dispatch:outbox:stalled',
        ]));
    });

    it('treats a pile within the SLA differently from one past it', async () => {
        // Volume, all of it fresh: somebody has an afternoon of clicking ahead,
        // nobody has to be woken up.
        const piling = createMonitor([
            { name: 'Hotel Amazonas', schemaName: 'tenant_amazonas', backlog: { total: 25, oldest: 900, breaching: 0 } },
        ]);
        await piling.monitor.checkDispatchBacklog();

        expect(piling.alerts.map(a => a.key)).toEqual(['dispatch:reconciliation:backlog']);
        expect(piling.alerts[0].value).toBe(25);
        expect(piling.resolved).toContain('dispatch:reconciliation:overdue');

        // Three effects, two of them hours old. Small, and much worse.
        const stale = createMonitor([
            { name: 'Hotel Amazonas', schemaName: 'tenant_amazonas', backlog: { total: 3, oldest: 7200, breaching: 2 } },
        ]);
        await stale.monitor.checkDispatchBacklog();

        expect(stale.alerts.map(a => a.key)).toEqual(['dispatch:reconciliation:overdue']);
        expect(stale.alerts[0].value).toBe(2);
        expect(stale.alerts[0].html).toContain('2 h');
        expect(stale.resolved).toContain('dispatch:reconciliation:backlog');
    });

    it('will not page anyone about zero effects if a threshold is misconfigured to 0', async () => {
        const { monitor, alerts } = createMonitor([quiet('Hotel Amazonas', 'tenant_amazonas')]);
        (monitor as any).alertConfig.get = jest.fn(async () => ({
            ...ALERT_CONFIG_DEFAULTS, dispatchReconciliation: { backlog: 0, overdue: 0, stalled: 0 },
        }));

        await monitor.checkDispatchBacklog();
        expect(alerts).toEqual([]);
    });

    it('sees a row whose job was never published, which queue depth cannot', async () => {
        // Nothing waiting for a person, so both reconciliation incidents close —
        // and a reply the customer will never receive is still sitting there.
        // BullMQ has no job to count for it, so every queue graph reads normal.
        const { monitor, alerts, resolved } = createMonitor([
            { name: 'Hotel Amazonas', schemaName: 'tenant_amazonas',
                backlog: { total: 0, oldest: 0, breaching: 0, stalled: 3, stalledOldest: 3600 } },
        ]);

        await monitor.checkDispatchBacklog();

        expect(alerts.map(a => a.key)).toEqual(['dispatch:outbox:stalled']);
        expect(alerts[0].value).toBe(3);
        expect(alerts[0].html).toContain('1 h');
        expect(alerts[0].html).toContain('Hotel Amazonas');
        expect(resolved).toEqual(expect.arrayContaining([
            'dispatch:reconciliation:overdue', 'dispatch:reconciliation:backlog',
        ]));
    });

    it('keeps the two failures apart instead of adding them into one number', async () => {
        // One is waiting for a person to decide, the other for a worker to run.
        // Same table, opposite actions.
        const { monitor, alerts } = createMonitor([
            { name: 'Hotel Amazonas', schemaName: 'tenant_amazonas',
                backlog: { total: 2, oldest: 7200, breaching: 2, stalled: 4, stalledOldest: 900 } },
        ]);

        await monitor.checkDispatchBacklog();

        const stalled = alerts.find(a => a.key === 'dispatch:outbox:stalled')!;
        const overdue = alerts.find(a => a.key === 'dispatch:reconciliation:overdue')!;
        expect(stalled.value).toBe(4);
        expect(overdue.value).toBe(2);
        expect(stalled.html).toContain('outbound-messages');
    });

    it('adds up stalled rows across tenants and names the worst first', async () => {
        const { monitor, alerts } = createMonitor([
            { name: 'Clínica Sur', schemaName: 'tenant_sur',
                backlog: { total: 0, oldest: 0, breaching: 0, stalled: 1, stalledOldest: 700 } },
            { name: 'Hotel Amazonas', schemaName: 'tenant_amazonas',
                backlog: { total: 0, oldest: 0, breaching: 0, stalled: 6, stalledOldest: 3600 } },
            quiet('Taller Norte', 'tenant_norte'),
        ]);

        await monitor.checkDispatchBacklog();

        const stalled = alerts.find(a => a.key === 'dispatch:outbox:stalled')!;
        expect(stalled.value).toBe(7);
        expect(stalled.html.indexOf('Hotel Amazonas')).toBeLessThan(stalled.html.indexOf('Clínica Sur'));
        expect(stalled.html).not.toContain('Taller Norte');
    });

    it('asks for both numbers in one pass over the table', async () => {
        const { monitor, executedSql } = createMonitor([quiet('Hotel Amazonas', 'tenant_amazonas')]);
        await monitor.checkDispatchBacklog();
        const counting = executedSql.find(sql => sql.includes('agent_dispatch_outbox'))!;
        // A second transaction per tenant would double the PgBouncer churn to
        // ask a question the same scan already answers.
        expect(executedSql.filter(sql => sql.includes('FROM agent_dispatch_outbox'))).toHaveLength(1);
        expect(counting).toContain("state = 'reconciliation_required'");
        expect(counting).toContain("state IN ('prepared','queued','failed')");
        expect(counting).toContain('available_at <');
    });

    it('measures the two durable steps, which nothing was measuring', async () => {
        // The objective exists in the runbook and the load harness produced the
        // numbers behind it. Production produced none: PgBouncer wait time is a
        // different quantity and queue depth only rises after the fact.
        const { monitor, alerts } = createMonitor(
            [quiet('Hotel Amazonas', 'tenant_amazonas')],
            latencyHashes({ admit: { '10': 100 }, settle: { '2500': 60 } }),
        );

        await monitor.checkDispatchBacklog();

        const latency = alerts.find(a => a.key === 'dispatch:latency:p95')!;
        expect(latency).toBeDefined();
        // Only the one that crossed is named; `admit` at ≤10 ms is fine.
        expect(latency.html).toContain('settle');
        expect(latency.html).not.toMatch(/<li><b>admit<\/b>/);
        // The body has to say the number is a ceiling, not an observation.
        expect(latency.html).toContain('techo del intervalo');
    });

    it('does not close the latency incident because traffic stopped', async () => {
        // Silence is not success: a path nothing exercised has not met its SLO,
        // it has not been tested.
        const { monitor, resolved } = createMonitor(
            [quiet('Hotel Amazonas', 'tenant_amazonas')],
            latencyHashes({ admit: { '10': 3 } }),
        );

        await monitor.checkDispatchBacklog();
        expect(resolved).not.toContain('dispatch:latency:p95');
    });

    it('closes it when enough samples came back under the objective', async () => {
        const { monitor, alerts, resolved } = createMonitor(
            [quiet('Hotel Amazonas', 'tenant_amazonas')],
            latencyHashes({ admit: { '50': 80 }, settle: { '100': 90 } }),
        );

        await monitor.checkDispatchBacklog();
        expect(alerts.map(a => a.key)).not.toContain('dispatch:latency:p95');
        expect(resolved).toContain('dispatch:latency:p95');
    });

    it('classifies the overdue one as critical and the plain backlog as a warning', () => {
        const { monitor } = createMonitor([]);
        expect((monitor as any).severityFromKey('dispatch:reconciliation:overdue')).toBe('critical');
        expect((monitor as any).severityFromKey('dispatch:reconciliation:backlog')).toBe('warning');
        // A stalled row has not been sent and is still recoverable the moment a
        // worker returns; the overdue one may already have reached the customer
        // and only a person can settle it. Urgency is not the same thing.
        expect((monitor as any).severityFromKey('dispatch:outbox:stalled')).toBe('warning');
    });

    it('names the tenants behind the pile, worst first', async () => {
        const { monitor, alerts } = createMonitor([
            { name: 'Hotel Amazonas', schemaName: 'tenant_amazonas', backlog: { total: 4, oldest: 60, breaching: 0 } },
            { name: 'Clínica Sur', schemaName: 'tenant_sur', backlog: { total: 2, oldest: 9000, breaching: 2 } },
            quiet('Taller Norte', 'tenant_norte'),
        ]);

        await monitor.checkDispatchBacklog();

        const overdue = alerts.find(a => a.key === 'dispatch:reconciliation:overdue')!;
        expect(overdue).toBeDefined();
        expect(overdue.html).toContain('Clínica Sur');
        expect(overdue.html).toContain('Hotel Amazonas');
        // A tenant with nothing waiting is not "where to look".
        expect(overdue.html).not.toContain('Taller Norte');
        expect(overdue.html.indexOf('Clínica Sur')).toBeLessThan(overdue.html.indexOf('Hotel Amazonas'));
    });

    it('bounds the tenant list instead of pasting the whole platform into an email', async () => {
        const { monitor, alerts } = createMonitor(
            Array.from({ length: 9 }, (_, i) => ({
                name: `Tenant ${i}`,
                schemaName: `tenant_n${i}`,
                backlog: { total: 9 - i, oldest: 7200, breaching: 1 },
            })),
        );

        await monitor.checkDispatchBacklog();

        const html = alerts.find(a => a.key === 'dispatch:reconciliation:overdue')!.html;
        expect((html.match(/<li>/g) || [])).toHaveLength(6); // 5 named + the tail
        expect(html).toContain('4 tenant(s) más');
    });

    it('keeps sweeping when one tenant schema cannot be read', async () => {
        const { monitor, alerts } = createMonitor([
            { name: 'Roto', schemaName: 'tenant_roto', backlog: 'unreadable' },
            { name: 'Hotel Amazonas', schemaName: 'tenant_amazonas', backlog: { total: 2, oldest: 7200, breaching: 2 } },
        ]);

        await monitor.checkDispatchBacklog();

        const overdue = alerts.find(a => a.key === 'dispatch:reconciliation:overdue');
        expect(overdue?.value).toBe(2);
        expect(overdue?.html).toContain('Hotel Amazonas');
    });

    it('ignores eval namespaces, whose rows are harness fixtures', async () => {
        const { monitor, alerts, prisma } = createMonitor([
            {
                name: 'Eval', schemaName: 'tenant_eval_1111aaaa_111111111111111111111111',
                backlog: { total: 40, oldest: 86400, breaching: 40 },
            },
            quiet('Hotel Amazonas', 'tenant_amazonas'),
        ]);

        await monitor.checkDispatchBacklog();

        expect(alerts).toEqual([]);
        const visited = prisma.transactionInTenantSchema.mock.calls.map((c: any[]) => c[0]);
        expect(visited).toEqual(['tenant_amazonas']);
    });

    it('reads counts only — no recipient, payload or receipt reaches the alert', async () => {
        const { monitor, executedSql } = createMonitor([
            { name: 'Hotel Amazonas', schemaName: 'tenant_amazonas', backlog: { total: 30, oldest: 7200, breaching: 5 } },
        ]);

        await monitor.checkDispatchBacklog();

        expect(executedSql.length).toBeGreaterThan(0);
        for (const sql of executedSql) {
            expect(sql).not.toMatch(/recipient|payload|receipt|SELECT \*/i);
        }
    });

    it('never lets its own failure break the cron', async () => {
        const { monitor } = createMonitor([quiet('Hotel Amazonas', 'tenant_amazonas')]);
        (monitor as any).alertConfig.get = jest.fn(async () => { throw new Error('settings down'); });

        await expect(monitor.checkDispatchBacklog()).resolves.toBeUndefined();
    });
});
