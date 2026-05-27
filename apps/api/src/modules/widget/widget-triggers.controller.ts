import { Controller, Get, Post, Put, Delete, Body, Param, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WidgetTriggersService } from './widget-triggers.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('widget-triggers')
@Controller('widget/triggers')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class WidgetTriggersController {
    private readonly logger = new Logger(WidgetTriggersController.name);

    constructor(
        private readonly triggersService: WidgetTriggersService,
        private readonly throttle: TenantThrottleService,
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    @Get(':widgetConfigId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'List triggers for a widget' })
    async list(@Param('widgetConfigId') widgetConfigId: string) {
        const triggers = await this.triggersService.listTriggers(widgetConfigId);
        return { success: true, data: triggers };
    }

    @Post(':widgetConfigId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Create a trigger' })
    async create(
        @Param('widgetConfigId') widgetConfigId: string,
        @Body() body: any,
    ) {
        // Resolve tenant from widget config
        const widgets: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT tenant_id FROM public.widget_configs WHERE id = $1::uuid`,
            widgetConfigId,
        );
        if (!widgets?.length) {
            return { success: false, error: 'Widget not found' };
        }
        const tenantId = widgets[0].tenant_id;

        // Check plan limit
        const currentCount = await this.triggersService.countTriggersForWidget(widgetConfigId);
        await this.throttle.enforcePlanLimit(tenantId, 'widgetTriggers', currentCount, 'widget triggers');

        const trigger = await this.triggersService.createTrigger(widgetConfigId, body);

        // Invalidate widget config cache
        await this.invalidateWidgetCache(widgetConfigId);

        return { success: true, data: trigger };
    }

    @Put(':triggerId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Update a trigger' })
    async update(
        @Param('triggerId') triggerId: string,
        @Body() body: any,
    ) {
        const trigger = await this.triggersService.updateTrigger(triggerId, body);
        if (!trigger) {
            return { success: false, error: 'Trigger not found' };
        }

        // Invalidate widget config cache
        await this.invalidateWidgetCache(trigger.widget_config_id);

        return { success: true, data: trigger };
    }

    @Delete(':triggerId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Delete a trigger' })
    async remove(@Param('triggerId') triggerId: string) {
        // Get trigger to find widget config id for cache invalidation
        const triggers: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT widget_config_id FROM public.widget_triggers WHERE id = $1::uuid`,
            triggerId,
        );

        await this.triggersService.deleteTrigger(triggerId);

        if (triggers?.length) {
            await this.invalidateWidgetCache(triggers[0].widget_config_id);
        }

        return { success: true };
    }

    private async invalidateWidgetCache(widgetConfigId: string): Promise<void> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT widget_id FROM public.widget_configs WHERE id = $1::uuid`,
                widgetConfigId,
            );
            if (rows?.length) {
                await this.redis.del(`widget:config:${rows[0].widget_id}`);
            }
        } catch {
            // Non-critical — cache will expire naturally
        }
    }
}
