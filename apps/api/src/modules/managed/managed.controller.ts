import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ManagedService } from './managed.service';

/**
 * Managed / done-for-you tier (T3.24) — super-admin only. Outcome guarantee
 * tracking across managed tenants.
 */
@Controller('managed')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ManagedController {
    constructor(private readonly managed: ManagedService) {}

    @Get()
    @Roles('super_admin')
    async list(@Query('start') start?: string, @Query('end') end?: string) {
        return { success: true, data: await this.managed.listManaged(start, end) };
    }

    @Get(':tenantId/config')
    @Roles('super_admin')
    async getConfig(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.managed.getConfig(tenantId) };
    }

    @Put(':tenantId/config')
    @Roles('super_admin')
    async setConfig(@Param('tenantId') tenantId: string, @Body() body: any) {
        return { success: true, data: await this.managed.setConfig(tenantId, body) };
    }

    @Get(':tenantId/report')
    @Roles('super_admin')
    async report(@Param('tenantId') tenantId: string, @Query('start') start?: string, @Query('end') end?: string) {
        return { success: true, data: await this.managed.getReport(tenantId, start, end) };
    }
}
