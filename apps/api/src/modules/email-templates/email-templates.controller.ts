import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { EmailTemplatesService } from './email-templates.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('email-templates')
@Controller('email-templates')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class EmailTemplatesController {
    constructor(
        private service: EmailTemplatesService,
        private throttle: TenantThrottleService,
        private prisma: PrismaService,
    ) {}

    @Get(':tenantId')
    @ApiOperation({ summary: 'List all email templates' })
    async list(@Param('tenantId') tenantId: string, @CurrentUser() user: any) {
        const data = await this.service.list(user.schemaName);
        return { success: true, data };
    }

    @Get(':tenantId/:templateId')
    @ApiOperation({ summary: 'Get email template by ID' })
    async getById(
        @Param('tenantId') tenantId: string,
        @Param('templateId') templateId: string,
        @CurrentUser() user: any,
    ) {
        const data = await this.service.getById(user.schemaName, templateId);
        return { success: true, data };
    }

    @Post(':tenantId')
    @ApiOperation({ summary: 'Create a new email template' })
    async create(
        @Param('tenantId') tenantId: string,
        @Body() body: { name: string; slug: string; subject: string; bodyHtml: string; bodyJson?: any; variables?: string[] },
        @CurrentUser() user: any,
    ) {
        // Count DISTINCT slugs (not rows) — a template translated to en/pt/fr is one
        // logical template across several language rows, so it must count once.
        const cnt = await this.prisma.executeInTenantSchema<any[]>(user.schemaName,
            `SELECT COUNT(DISTINCT slug)::int AS c FROM email_templates WHERE is_active = true`);
        await this.throttle.enforcePlanLimit(tenantId, 'emailTemplates', cnt?.[0]?.c || 0, 'plantillas de email');
        const data = await this.service.create(user.schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/:templateId')
    @ApiOperation({ summary: 'Update an email template' })
    async update(
        @Param('tenantId') tenantId: string,
        @Param('templateId') templateId: string,
        @Body() body: { name?: string; subject?: string; bodyHtml?: string; bodyJson?: any; variables?: string[]; isActive?: boolean },
        @CurrentUser() user: any,
    ) {
        const data = await this.service.update(user.schemaName, templateId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/:templateId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Delete an email template' })
    async delete(
        @Param('tenantId') tenantId: string,
        @Param('templateId') templateId: string,
        @CurrentUser() user: any,
    ) {
        await this.service.delete(user.schemaName, templateId);
        return { success: true };
    }

    @Post(':tenantId/:templateId/test')
    @ApiOperation({ summary: 'Send a test email with sample data' })
    async sendTest(
        @Param('tenantId') tenantId: string,
        @Param('templateId') templateId: string,
        @Body() body: { to: string },
        @CurrentUser() user: any,
    ) {
        const sent = await this.service.sendTest(user.schemaName, templateId, body.to);
        return { success: true, data: { sent } };
    }
}
