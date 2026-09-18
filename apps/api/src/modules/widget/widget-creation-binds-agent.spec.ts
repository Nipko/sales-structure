import { WidgetService } from './widget.service';
import { ensureDemoWidget } from './widget-demo-link';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';

const tenantId = '11111111-1111-4111-8111-111111111111';

/**
 * A real web chat widget is a connection, so creating one assigns the default
 * agent to `web_widget` — the agent is born with no channels (D16) and Agent
 * Quality counts an active non-demo widget as a connected web chat, so without
 * the assignment `channel_assignment` stayed a critical failure after the
 * owner had done exactly what the setup card asked.
 *
 * The public link ("El enlace de {Nombre}", `is_demo`) is the opposite case: a
 * place to show the agent, never an activation, and it must assign nothing.
 *
 * The real `bindDefaultAgentToChannel` runs; the double answers its statement.
 */
function harness(options: { inserted?: Record<string, unknown>; bindThrows?: boolean; emitThrows?: boolean } = {}) {
    const prisma: any = {
        $queryRawUnsafe: jest.fn(async (sql: string) => {
            if (sql.includes('INSERT INTO public.widget_configs')) {
                return [options.inserted ?? { id: 'cfg-1', widget_id: 'wgt_abc', is_demo: false }];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }),
        tenant: { findUnique: jest.fn(async () => ({ language: 'es-CO' })) },
        getTenantSchemaName: jest.fn(async () => 'tenant_acme'),
        executeInTenantSchema: jest.fn(async () => {
            if (options.bindThrows) throw new Error('pgbouncer unavailable');
            return [{ id: 'agent-1' }];
        }),
    };
    const config = { get: jest.fn(() => 'widget-secret-long-enough'), getOrThrow: jest.fn(() => 'widget-secret-long-enough') };
    const events = {
        emit: jest.fn(() => {
            if (options.emitThrows) throw new Error('listener exploded');
            return true;
        }),
    };
    const service = new WidgetService(prisma, {} as any, config as any, {} as any, undefined, events as any);
    (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { service, prisma, events };
}

function bindCalls(prisma: any): any[][] {
    return prisma.executeInTenantSchema.mock.calls
        .filter(([, sql]: any[]) => String(sql).includes('UPDATE agent_personas'));
}

describe('creating a web chat widget assigns the default agent', () => {
    it('assigns web_widget for a real widget and tells Agent Quality', async () => {
        const { service, prisma, events } = harness();

        const widget = await service.createWidget(tenantId, { name: 'Sitio' });

        expect(widget).toEqual(expect.objectContaining({ widget_id: 'wgt_abc' }));
        expect(bindCalls(prisma)).toHaveLength(1);
        expect(bindCalls(prisma)[0][0]).toBe('tenant_acme');
        expect(bindCalls(prisma)[0][2]).toEqual(['web_widget']);
        expect(events.emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
            tenantId, source: 'channel_connection',
        });
    });

    it('assigns nothing for a demo row, even if one ever comes through this path', async () => {
        const { service, prisma, events } = harness({ inserted: { id: 'cfg-2', widget_id: 'wgt_demo', is_demo: true } });

        await service.createWidget(tenantId, {});

        expect(bindCalls(prisma)).toHaveLength(0);
        expect(events.emit).not.toHaveBeenCalled();
    });

    it.each([
        ['the assignment fails', { bindThrows: true }],
        ['the quality event fails', { emitThrows: true }],
    ])('still returns the created widget when %s', async (_label, options) => {
        const { service } = harness(options);

        await expect(service.createWidget(tenantId, {})).resolves.toEqual(expect.objectContaining({ widget_id: 'wgt_abc' }));
    });
});

describe('the public demo link never assigns the agent', () => {
    it('provisions "El enlace de {Nombre}" without touching agent_personas channels', async () => {
        const statements: string[] = [];
        const prisma: any = {
            $queryRawUnsafe: jest.fn(async (sql: string) => {
                statements.push(sql);
                if (sql.includes('FROM public.widget_configs') && sql.includes('SELECT widget_id, agent_name, locale')) return [];
                if (sql.includes('FROM public.tenants')) return [{ language: 'es', schema_name: 'tenant_acme' }];
                if (sql.includes('agent_personas')) return [{ name: 'Valentina' }];
                if (sql.includes('INSERT INTO public.widget_configs')) return [{ widget_id: 'wgt_demo', agent_name: 'Valentina' }];
                return [];
            }),
            executeInTenantSchema: jest.fn(),
            getTenantSchemaName: jest.fn(),
        };

        await expect(ensureDemoWidget(prisma, tenantId)).resolves.toEqual(expect.objectContaining({ widgetId: 'wgt_demo' }));

        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(statements.some(sql => /UPDATE\s+[^;]*agent_personas/i.test(sql))).toBe(false);
    });
});
