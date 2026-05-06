import { Controller, Get, Put, Post, Param, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RecallService } from './recall.service';

@ApiTags('recall')
@Controller('recall')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class RecallController {
    constructor(private readonly service: RecallService) {}

    @Get(':tenantId/config')
    @Roles('super_admin', 'tenant_admin')
    @ApiOperation({ summary: 'Get recall config for a tenant' })
    async getConfig(@Param('tenantId') tenantId: string) {
        const data = await this.service.getConfig(tenantId);
        return { success: true, data };
    }

    @Put(':tenantId/config')
    @Roles('super_admin', 'tenant_admin')
    @ApiOperation({ summary: 'Update recall config' })
    async setConfig(@Param('tenantId') tenantId: string, @Body() body: any) {
        const data = await this.service.setConfig(tenantId, body);
        return { success: true, data };
    }

    @Post(':tenantId/run-now')
    @HttpCode(HttpStatus.OK)
    @Roles('super_admin', 'tenant_admin')
    @ApiOperation({ summary: 'Trigger recall sweep manually for testing' })
    async runNow(@Param('tenantId') tenantId: string) {
        const result = await this.service.runNow(tenantId);
        return { success: true, data: result };
    }
}
