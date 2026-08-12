import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { WidgetTriggersController } from './widget-triggers.controller';

describe('WidgetTriggersController authenticated tenant contract', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const widgetConfigId = '33333333-3333-4333-8333-333333333333';
    const triggerId = '44444444-4444-4444-8444-444444444444';

    function makeController() {
        const triggersService = {
            listTriggers: jest.fn().mockResolvedValue([]),
            countTriggersForWidget: jest.fn().mockResolvedValue(0),
            createTrigger: jest.fn().mockResolvedValue({
                id: triggerId,
                widget_config_id: widgetConfigId,
            }),
            updateTrigger: jest.fn().mockResolvedValue({
                id: triggerId,
                widget_config_id: widgetConfigId,
            }),
            deleteTrigger: jest.fn().mockResolvedValue({ widget_config_id: widgetConfigId }),
        };
        const throttle = { enforcePlanLimit: jest.fn() };
        const prisma = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ widget_id: 'wgt_public' }]),
        };
        const redis = { del: jest.fn() };
        return {
            controller: new WidgetTriggersController(
                triggersService as any,
                throttle as any,
                prisma as any,
                redis as any,
            ),
            triggersService,
            throttle,
            prisma,
            redis,
        };
    }

    it('keeps every authenticated CRUD route bound to CurrentTenant', () => {
        const source = readFileSync(resolve(__dirname, 'widget-triggers.controller.ts'), 'utf8');

        expect(source.match(/@CurrentTenant\(\)/g)).toHaveLength(4);
        expect(source).not.toContain('SELECT tenant_id FROM public.widget_configs');
        expect(source).not.toContain('SELECT widget_config_id FROM public.widget_triggers');
    });

    it('passes the server-derived tenant to list rather than resolving ownership from the widget id', async () => {
        const { controller, triggersService, prisma } = makeController();

        await controller.list(tenantId, widgetConfigId);

        expect(triggersService.listTriggers).toHaveBeenCalledWith(tenantId, widgetConfigId);
        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('uses the same authenticated tenant for plan count and creation', async () => {
        const { controller, triggersService, throttle } = makeController();

        await controller.create(tenantId, widgetConfigId, { name: 'Greeting' });

        expect(triggersService.countTriggersForWidget).toHaveBeenCalledWith(tenantId, widgetConfigId);
        expect(throttle.enforcePlanLimit).toHaveBeenCalledWith(
            tenantId,
            'widgetTriggers',
            0,
            'widget triggers',
        );
        expect(triggersService.createTrigger).toHaveBeenCalledWith(
            tenantId,
            widgetConfigId,
            { name: 'Greeting' },
        );
    });

    it('passes the authenticated tenant through update and scopes cache invalidation too', async () => {
        const { controller, triggersService, prisma, redis } = makeController();

        await controller.update(tenantId, triggerId, { isActive: false });

        expect(triggersService.updateTrigger).toHaveBeenCalledWith(
            tenantId,
            triggerId,
            { isActive: false },
        );
        const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
        expect(sql).toContain('tenant_id = $1::uuid');
        expect(params).toEqual([tenantId, widgetConfigId]);
        expect(redis.del).toHaveBeenCalledWith('widget:config:wgt_public');
    });

    it('deletes through the service atomically without an unscoped pre-read', async () => {
        const { controller, triggersService, prisma } = makeController();

        await controller.remove(tenantId, triggerId);

        expect(triggersService.deleteTrigger).toHaveBeenCalledWith(tenantId, triggerId);
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        expect(String(prisma.$queryRawUnsafe.mock.calls[0][0])).toContain('tenant_id = $1::uuid');
    });

    it('fails closed when a super-admin request has no explicit tenant context', async () => {
        const { controller, triggersService } = makeController();

        await expect(controller.list(undefined as any, widgetConfigId))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(triggersService.listTriggers).not.toHaveBeenCalled();
    });
});
