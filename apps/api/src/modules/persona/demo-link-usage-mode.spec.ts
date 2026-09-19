import { BadRequestException } from '@nestjs/common';
import { PersonaController } from './persona.controller';

describe('the public link changes purpose only by an owner action', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function harness(widgetIncluded: boolean) {
        const query = jest.fn(async (sql: string, ...params: unknown[]) => {
            if (sql.startsWith('SELECT') && sql.includes('FROM public.widget_configs')) return [{
                widget_id: 'wgt_public', agent_name: 'Ana', locale: 'es', usage_mode: 'trial',
            }];
            if (sql.startsWith('UPDATE public.widget_configs') && sql.includes('usage_mode')) return [{
                widget_id: 'wgt_public', agent_name: 'Ana', usage_mode: params[1],
            }];
            return [];
        });
        const redis = { del: jest.fn().mockResolvedValue(1) };
        const controller: any = Object.create(PersonaController.prototype);
        Object.assign(controller, {
            prisma: { $queryRawUnsafe: query },
            redis,
            throttleService: { getPlanFeatures: jest.fn().mockResolvedValue({ widget: widgetIncluded }) },
            logger: { warn: jest.fn() },
        });
        return { controller, query, redis };
    }

    it('keeps the stable URL and persists operational mode when the plan allows it', async () => {
        const { controller, query, redis } = harness(true);
        await expect(controller.setDemoLinkMode(tenantId, { usageMode: 'operational' })).resolves.toMatchObject({
            success: true,
            data: { widgetId: 'wgt_public', path: '/w/wgt_public', usageMode: 'operational', answers: true },
        });
        const update = query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE public.widget_configs') && String(sql).includes('usage_mode'));
        expect(update?.slice(1)).toEqual([tenantId, 'operational']);
        expect(redis.del).toHaveBeenCalledWith('widget:config:wgt_public');
    });

    it('refuses operational mode without the web-chat entitlement', async () => {
        const { controller, query } = harness(false);
        const error = await controller.setDemoLinkMode(tenantId, { usageMode: 'operational' }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({ error: 'web_widget_plan_required' });
        expect(query).not.toHaveBeenCalled();
    });

    it('rejects an unknown mode instead of coercing it', async () => {
        const { controller, query } = harness(true);
        await expect(controller.setDemoLinkMode(tenantId, { usageMode: 'automatic' })).rejects.toBeInstanceOf(BadRequestException);
        expect(query).not.toHaveBeenCalled();
    });
});
