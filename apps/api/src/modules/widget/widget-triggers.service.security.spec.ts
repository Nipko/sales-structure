import { NotFoundException } from '@nestjs/common';
import { WidgetTriggersService } from './widget-triggers.service';

describe('WidgetTriggersService tenant isolation', () => {
    const tenantA = '11111111-1111-4111-8111-111111111111';
    const tenantB = '22222222-2222-4222-8222-222222222222';
    const widgetConfigId = '33333333-3333-4333-8333-333333333333';
    const triggerId = '44444444-4444-4444-8444-444444444444';

    function makeService() {
        const prisma = { $queryRawUnsafe: jest.fn() };
        const redis = {
            // Skip DDL in these focused query-contract tests.
            get: jest.fn().mockResolvedValue('1'),
            set: jest.fn(),
        };
        return {
            service: new WidgetTriggersService(prisma as any, redis as any),
            prisma,
        };
    }

    it('lists only through an owned widget config and hides the ownership sentinel', async () => {
        const { service, prisma } = makeService();
        prisma.$queryRawUnsafe.mockResolvedValue([{
            owned_widget_config_id: widgetConfigId,
            id: triggerId,
            widget_config_id: widgetConfigId,
            name: 'Greeting',
        }]);

        await expect(service.listTriggers(tenantA, widgetConfigId)).resolves.toEqual([{
            id: triggerId,
            widget_config_id: widgetConfigId,
            name: 'Greeting',
        }]);

        const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
        expect(sql).toContain('LEFT JOIN public.widget_triggers');
        expect(sql).toContain('wc.tenant_id = $1::uuid');
        expect(params).toEqual([tenantA, widgetConfigId]);
    });

    it('returns an empty list for an owned widget with no triggers', async () => {
        const { service, prisma } = makeService();
        prisma.$queryRawUnsafe.mockResolvedValue([{
            owned_widget_config_id: widgetConfigId,
            id: null,
        }]);

        await expect(service.listTriggers(tenantA, widgetConfigId)).resolves.toEqual([]);
    });

    it('rejects a cross-tenant list without disclosing whether the widget exists', async () => {
        const { service, prisma } = makeService();
        prisma.$queryRawUnsafe.mockResolvedValue([]);

        await expect(service.listTriggers(tenantB, widgetConfigId))
            .rejects.toBeInstanceOf(NotFoundException);
    });

    it('cannot create a trigger unless INSERT SELECT finds a config owned by the tenant', async () => {
        const { service, prisma } = makeService();
        prisma.$queryRawUnsafe.mockResolvedValue([]);

        await expect(service.createTrigger(tenantB, widgetConfigId, { name: 'Cross tenant' }))
            .rejects.toBeInstanceOf(NotFoundException);

        const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
        expect(sql).toContain('INSERT INTO public.widget_triggers');
        expect(sql).toContain('SELECT wc.id');
        expect(sql).toContain('wc.tenant_id = $1::uuid');
        expect(params.slice(0, 2)).toEqual([tenantB, widgetConfigId]);
    });

    it('cannot update a trigger joined to another tenant widget config', async () => {
        const { service, prisma } = makeService();
        prisma.$queryRawUnsafe.mockResolvedValue([]);

        await expect(service.updateTrigger(tenantB, triggerId, { name: 'Cross tenant' }))
            .rejects.toBeInstanceOf(NotFoundException);

        const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
        expect(sql).toContain('FROM public.widget_configs AS wc');
        expect(sql).toContain('wc.id = wt.widget_config_id');
        expect(sql).toContain('wc.tenant_id = $1::uuid');
        expect(params.slice(0, 2)).toEqual([tenantB, triggerId]);
    });

    it('cannot delete or discover the config id of a cross-tenant trigger', async () => {
        const { service, prisma } = makeService();
        prisma.$queryRawUnsafe.mockResolvedValue([]);

        await expect(service.deleteTrigger(tenantB, triggerId))
            .rejects.toBeInstanceOf(NotFoundException);

        const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
        expect(sql).toContain('USING public.widget_configs AS wc');
        expect(sql).toContain('wc.tenant_id = $1::uuid');
        expect(sql).toContain('RETURNING wt.widget_config_id');
        expect(params).toEqual([tenantB, triggerId]);
    });

    it('does not count another tenant widget toward plan enforcement', async () => {
        const { service, prisma } = makeService();
        prisma.$queryRawUnsafe.mockResolvedValue([]);

        await expect(service.countTriggersForWidget(tenantB, widgetConfigId))
            .rejects.toBeInstanceOf(NotFoundException);

        const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
        expect(sql).toContain('wc.tenant_id = $1::uuid');
        expect(params).toEqual([tenantB, widgetConfigId]);
    });

    it('projects public triggers without internal trigger or config identifiers', async () => {
        const { service, prisma } = makeService();
        const publicTrigger = {
            conditions: [{ type: 'time_on_page', value: 10 }],
            condition_operator: 'AND',
            action_type: 'show_bubble_message',
            action_config: { message: 'Hello' },
            frequency_minutes: 5,
            priority: 0,
        };
        prisma.$queryRawUnsafe.mockResolvedValue([{
            id: triggerId,
            widget_config_id: widgetConfigId,
            name: 'Internal campaign label',
            created_at: new Date().toISOString(),
            ...publicTrigger,
        }]);

        await expect(service.getTriggersForWidget(tenantA, widgetConfigId))
            .resolves.toEqual([publicTrigger]);

        const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
        expect(sql).toContain('JOIN public.widget_configs wc');
        expect(sql).toContain('wc.tenant_id = $1::uuid');
        expect(sql).not.toMatch(/SELECT\s+(?:wt\.)?id\b/i);
        expect(sql).not.toMatch(/(?:wt\.)?widget_config_id\s*(?:,|FROM)/i);
        expect(params).toEqual([tenantA, widgetConfigId]);
    });
});
