import { Controller, Get, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { WhiteLabelService, WhiteLabelConfig } from './white-label.service';

@ApiTags('white-label')
@Controller('white-label')
export class WhiteLabelController {
    constructor(private readonly wlService: WhiteLabelService) {}

    @Get('config')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get white-label config for current tenant' })
    async getConfig(@CurrentUser() user: any) {
        const config = await this.wlService.getConfig(user.tenantId);
        return { success: true, data: config };
    }

    @Put('config')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update white-label config' })
    async updateConfig(@CurrentUser() user: any, @Body() body: Partial<WhiteLabelConfig>) {
        const config = await this.wlService.updateConfig(user.tenantId, body);
        return { success: true, data: config };
    }

    @Get('public/slug/:slug')
    @ApiOperation({ summary: 'Get public branding by tenant slug' })
    async getBySlug(@Param('slug') slug: string) {
        const result = await this.wlService.getConfigBySlug(slug);
        return { success: true, data: result.config };
    }

    @Get('public/domain')
    @ApiOperation({ summary: 'Get public branding by custom domain' })
    async getByDomain(@Query('domain') domain: string) {
        const result = await this.wlService.getConfigByDomain(domain);
        return { success: true, data: result?.config || null };
    }
}
