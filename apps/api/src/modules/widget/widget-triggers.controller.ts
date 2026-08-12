import { BadRequestException, Controller, Get, Post, Put, Delete, Body, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { WidgetTriggersService } from './widget-triggers.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('widget-triggers')
@Controller('widget/triggers')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class WidgetTriggersController {
    constructor(
        private readonly triggersService: WidgetTriggersService,
        private readonly throttle: TenantThrottleService,
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    @Get(':widgetConfigId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'List triggers for a widget' })
    async list(
        @CurrentTenant() tenantId: string,
        @Param('widgetConfigId', ParseUUIDPipe) widgetConfigId: string,
    ) {
        const triggers = await this.triggersService.listTriggers(
            this.requireTenantId(tenantId),
            widgetConfigId,
        );
        return { success: true, data: triggers };
    }

    @Post(':widgetConfigId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Create a trigger' })
    async create(
        @CurrentTenant() tenantId: string,
        @Param('widgetConfigId', ParseUUIDPipe) widgetConfigId: string,
        @Body() body: any,
    ) {
        const currentTenantId = this.requireTenantId(tenantId);

        // Check plan limit
        const currentCount = await this.triggersService.countTriggersForWidget(currentTenantId, widgetConfigId);
        await this.throttle.enforcePlanLimit(currentTenantId, 'widgetTriggers', currentCount, 'widget triggers');

        const trigger = await this.triggersService.createTrigger(currentTenantId, widgetConfigId, body);

        // Invalidate widget config cache
        await this.invalidateWidgetCache(currentTenantId, widgetConfigId);

        return { success: true, data: trigger };
    }

    @Put(':triggerId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Update a trigger' })
    async update(
        @CurrentTenant() tenantId: string,
        @Param('triggerId', ParseUUIDPipe) triggerId: string,
        @Body() body: any,
    ) {
        const currentTenantId = this.requireTenantId(tenantId);
        const trigger = await this.triggersService.updateTrigger(currentTenantId, triggerId, body);

        // Invalidate widget config cache
        await this.invalidateWidgetCache(currentTenantId, trigger.widget_config_id);

        return { success: true, data: trigger };
    }

    @Delete(':triggerId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Delete a trigger' })
    async remove(
        @CurrentTenant() tenantId: string,
        @Param('triggerId', ParseUUIDPipe) triggerId: string,
    ) {
        const currentTenantId = this.requireTenantId(tenantId);
        const deleted = await this.triggersService.deleteTrigger(currentTenantId, triggerId);
        await this.invalidateWidgetCache(currentTenantId, deleted.widget_config_id);

        return { success: true };
    }

    private requireTenantId(tenantId: string | undefined): string {
        if (!tenantId) throw new BadRequestException('Tenant ID required');
        return tenantId;
    }

    private async invalidateWidgetCache(tenantId: string, widgetConfigId: string): Promise<void> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT widget_id
                   FROM public.widget_configs
                  WHERE tenant_id = $1::uuid AND id = $2::uuid`,
                tenantId,
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
