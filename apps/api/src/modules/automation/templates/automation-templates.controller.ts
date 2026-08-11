import { Controller, Get, Post, Param, Query, Body, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AutomationTemplatesService } from './automation-templates.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { Roles } from '../../../common/decorators/roles.decorator';

@ApiTags('automation-templates')
@Controller('automation/templates')
export class AutomationTemplatesController {
    private readonly logger = new Logger(AutomationTemplatesController.name);

    constructor(
        private readonly templatesService: AutomationTemplatesService,
        private readonly prisma: PrismaService,
    ) {}

    @Get()
    @ApiOperation({ summary: 'List all automation templates (public catalog)' })
    async listTemplates(
        @Query('category') category?: string,
        @Query('industry') industry?: string,
    ) {
        const templates = await this.templatesService.listTemplates({ category, industry });
        return { success: true, data: templates };
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a single automation template' })
    async getTemplate(@Param('id') id: string) {
        const template = await this.templatesService.getTemplate(id);
        return { success: true, data: template };
    }

    @Post(':tenantId/install')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiBearerAuth()
    @Roles('tenant_admin', 'tenant_supervisor', 'super_admin')
    @ApiOperation({ summary: 'Install an automation template as a new rule' })
    async installTemplate(
        @Param('tenantId') tenantId: string,
        @Body() body: { templateId: string; variables?: Record<string, any> },
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const rule = await this.templatesService.installTemplate(
            tenantId,
            schemaName,
            body.templateId,
            body.variables || {},
        );
        return { success: true, data: rule };
    }
}
