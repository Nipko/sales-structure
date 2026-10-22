import { ALERT_CONFIG_DEFAULTS } from './alert-config.service';
import { PlatformMonitorService } from './platform-monitor.service';

/**
 * A customer wrote, the agent decided to answer, and the POST died. The turn
 * ledger used to say `settled / send` and nothing watched the gap until the
 * one-hour reconciliation SLA. This check reads the delivery state the outbox
 * now feeds back and raises `agent:turn_unanswered` after a few minutes.
 */
type Summary = { total: number; pending: number; unknown: number; failed: number; oldest: number }
    | 'no-column' | 'unreadable';

function createMonitor(tenants: Array<{ name: string; schemaName: string; summary: Summary }>,
    config = ALERT_CONFIG_DEFAULTS) {
    const alerts: Array<{ key: string; subject: string; html: string; value: number }> = [];
    const resolved: string[] = [];
    const params: any[][] = [];
    const prisma = {
        tenant: {
            findMany: jest.fn(async () => tenants.map((t, i) => ({ id: `tenant-${i}`, name: t.name, schemaName: t.schemaName }))),
        },
        transactionInTenantSchema: jest.fn(async (schema: string, callback: any) => {
            const fixture = tenants.find(t => t.schemaName === schema)!;
            if (fixture.summary === 'unreadable') throw new Error('schema unreadable');
            const summary = fixture.summary;
            // The real readUndeliveredTurns runs against this.
            return callback(async (sql: string, values: any[] = []) => {
                params.push(values);
                if (sql.includes('information_schema.columns')) return summary === 'no-column' ? [] : [{ present: 1 }];
                if (summary === 'no-column') throw new Error('column does not exist');
                return [{ total: summary.total, pending: summary.pending, unknown: summary.unknown,
                    failed: summary.failed, oldest: summary.oldest }];
            });
        }),
    };
    const incidents = { resolveByKey: jest.fn(async (key: string) => { resolved.push(key); }) };
    const alertConfig = { get: jest.fn(async () => config) };
    const monitor = new PlatformMonitorService(
        {} as any, {} as any, prisma as any, {} as any, {} as any,
        incidents as any, {} as any, {} as any, alertConfig as any, {} as any,
        {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        {} as any, {} as any,
    );
    (monitor as any).alert = jest.fn(async (key: string, subject: string, html: string, value: number) => {
        alerts.push({ key, subject, html, value });
    });
    return { monitor, alerts, resolved, params, prisma };
}

describe('PlatformMonitorService — agent turns nobody received', () => {
    it('stays quiet and closes the incident when every answer arrived', async () => {
        const { monitor, alerts, resolved } = createMonitor([
            { name: 'Hotel Amazonas', schemaName: 'tenant_amazonas', summary: { total: 0, pending: 0, unknown: 0, failed: 0, oldest: 0 } },
            { name: 'Tenant viejo', schemaName: 'tenant_viejo', summary: 'no-column' },
        ]);
        await monitor.checkUnansweredAgentTurns();
        expect(alerts).toEqual([]);
        expect(resolved).toEqual(['agent:turn_unanswered']);
    });

    it('fires on the first unanswered turn, with the breakdown and the tenant named', async () => {
        const { monitor, alerts, params } = createMonitor([
            { name: 'Clínica Sur', schemaName: 'tenant_sur', summary: { total: 2, pending: 0, unknown: 1, failed: 1, oldest: 900 } },
            { name: 'Roto', schemaName: 'tenant_roto', summary: 'unreadable' },
            { name: 'Harness', schemaName: 'tenant_eval_x', summary: { total: 50, pending: 50, unknown: 0, failed: 0, oldest: 9000 } },
        ]);
        await monitor.checkUnansweredAgentTurns();
        expect(alerts.map(a => a.key)).toEqual(['agent:turn_unanswered']);
        expect(alerts[0].value).toBe(2);
        expect(alerts[0].html).toContain('Clínica Sur');
        expect(alerts[0].html).toContain('desconocido <b>1</b>');
        // The default threshold of five minutes reaches the SQL.
        expect(params.some(values => values[0] === 5)).toBe(true);
    });

    it('honours a configured grace period and threshold', async () => {
        const config = { ...ALERT_CONFIG_DEFAULTS, agentDelivery: { unansweredAfterMinutes: 15, unanswered: 3 } };
        const { monitor, alerts, resolved, params } = createMonitor([
            { name: 'Hotel Amazonas', schemaName: 'tenant_amazonas', summary: { total: 2, pending: 2, unknown: 0, failed: 0, oldest: 1200 } },
        ], config);
        await monitor.checkUnansweredAgentTurns();
        expect(alerts).toEqual([]);
        expect(resolved).toEqual(['agent:turn_unanswered']);
        expect(params.some(values => values[0] === 15)).toBe(true);
    });
});
