import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { WebhooksService, WEBHOOK_EVENTS, WebhookEventType } from './webhooks.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

@Controller('webhooks')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class WebhooksController {
    constructor(
        private readonly webhooksService: WebhooksService,
        private readonly throttle: TenantThrottleService,
    ) {}

    @Get('events')
    getAvailableEvents() {
        return { success: true, data: WEBHOOK_EVENTS };
    }

    @Get(':tenantId')
    @Roles('tenant_admin', 'super_admin')
    async list(@CurrentTenant() tenantId: string) {
        const data = await this.webhooksService.list(tenantId);
        return { success: true, data };
    }

    @Post(':tenantId')
    @Roles('tenant_admin', 'super_admin')
    async create(
        @CurrentTenant() tenantId: string,
        @Body() body: { url: string; events: WebhookEventType[]; description?: string },
    ) {
        const existing = await this.webhooksService.list(tenantId);
        await this.throttle.enforcePlanLimit(
            tenantId,
            'outboundWebhooks',
            existing.length,
            'webhook endpoints',
        );
        const data = await this.webhooksService.create(tenantId, body);
        return { success: true, data };
    }

    @Put(':tenantId/:endpointId')
    @Roles('tenant_admin', 'super_admin')
    async update(
        @CurrentTenant() tenantId: string,
        @Param('endpointId') endpointId: string,
        @Body() body: { url?: string; events?: WebhookEventType[]; description?: string; is_active?: boolean },
    ) {
        const data = await this.webhooksService.update(tenantId, endpointId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/:endpointId')
    @Roles('tenant_admin', 'super_admin')
    async remove(
        @CurrentTenant() tenantId: string,
        @Param('endpointId') endpointId: string,
    ) {
        await this.webhooksService.delete(tenantId, endpointId);
        return { success: true };
    }

    @Post(':tenantId/:endpointId/regenerate-secret')
    @Roles('tenant_admin', 'super_admin')
    async regenerateSecret(
        @CurrentTenant() tenantId: string,
        @Param('endpointId') endpointId: string,
    ) {
        const data = await this.webhooksService.regenerateSecret(tenantId, endpointId);
        return { success: true, data };
    }

    @Get(':tenantId/:endpointId/deliveries')
    @Roles('tenant_admin', 'super_admin')
    async deliveries(
        @CurrentTenant() tenantId: string,
        @Param('endpointId') endpointId: string,
        @Query('limit') limit?: string,
    ) {
        const data = await this.webhooksService.getDeliveries(tenantId, endpointId, limit ? parseInt(limit) : 50);
        return { success: true, data };
    }

    @Post(':tenantId/:endpointId/test')
    @Roles('tenant_admin', 'super_admin')
    async test(
        @CurrentTenant() tenantId: string,
        @Param('endpointId') endpointId: string,
    ) {
        await this.webhooksService.dispatch(tenantId, 'lead.created', {
            test: true,
            message: 'This is a test webhook delivery',
            timestamp: new Date().toISOString(),
        });
        return { success: true };
    }
}
