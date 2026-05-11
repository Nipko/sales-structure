import { Controller, Get, Post, Put, Delete, Body, Param, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WidgetService } from './widget.service';

@ApiTags('widgets')
@Controller('widgets')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class WidgetController {
    private readonly logger = new Logger(WidgetController.name);

    constructor(private readonly widgetService: WidgetService) {}

    @Get(':tenantId')
    @ApiOperation({ summary: 'List widgets for tenant' })
    async list(@Param('tenantId') tenantId: string) {
        const widgets = await this.widgetService.listWidgets(tenantId);
        return { success: true, data: widgets };
    }

    @Post(':tenantId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Create a widget' })
    async create(@Param('tenantId') tenantId: string, @Body() body: any) {
        const widget = await this.widgetService.createWidget(tenantId, body);
        return { success: true, data: widget };
    }

    @Put(':tenantId/:widgetId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Update widget config' })
    async update(
        @Param('tenantId') tenantId: string,
        @Param('widgetId') widgetId: string,
        @Body() body: any,
    ) {
        const widget = await this.widgetService.updateWidget(tenantId, widgetId, body);
        return { success: true, data: widget };
    }

    @Delete(':tenantId/:widgetId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Delete widget' })
    async remove(
        @Param('tenantId') tenantId: string,
        @Param('widgetId') widgetId: string,
    ) {
        await this.widgetService.deleteWidget(tenantId, widgetId);
        return { success: true };
    }

    @Get(':tenantId/:widgetId/snippet')
    @ApiOperation({ summary: 'Get embed snippet' })
    async getSnippet(
        @Param('tenantId') tenantId: string,
        @Param('widgetId') widgetId: string,
    ) {
        const widgets = await this.widgetService.listWidgets(tenantId);
        const widget = widgets.find((w: any) => w.id === widgetId);
        if (!widget) return { success: false, error: 'Widget not found' };

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.parallly-chat.cloud/api/v1';
        const snippet = this.widgetService.getEmbedSnippet(widget.widget_id, apiUrl);
        return { success: true, data: { snippet, widgetId: widget.widget_id } };
    }
}
