import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { StaffSchedulingService } from './staff-scheduling.service';

@ApiTags('staff')
@Controller('staff')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class StaffSchedulingController {
    constructor(private readonly staffService: StaffSchedulingService) {}

    @Get(':tenantId')
    @ApiOperation({ summary: 'List all staff members' })
    async listStaff(@CurrentTenant() schema: string) {
        const staff = await this.staffService.listStaff(schema);
        return { success: true, data: staff };
    }

    @Post(':tenantId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Create a staff member' })
    async createStaff(@CurrentTenant() schema: string, @Body() body: any) {
        const staff = await this.staffService.createStaff(schema, body);
        return { success: true, data: staff };
    }

    @Put(':tenantId/:staffId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Update a staff member' })
    async updateStaff(@CurrentTenant() schema: string, @Param('staffId') staffId: string, @Body() body: any) {
        const staff = await this.staffService.updateStaff(schema, staffId, body);
        return { success: true, data: staff };
    }

    @Delete(':tenantId/:staffId')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Deactivate a staff member' })
    async deleteStaff(@CurrentTenant() schema: string, @Param('staffId') staffId: string) {
        await this.staffService.deleteStaff(schema, staffId);
        return { success: true };
    }

    @Put(':tenantId/:staffId/schedule')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Set weekly schedule for a staff member' })
    async setSchedule(@CurrentTenant() schema: string, @Param('staffId') staffId: string, @Body() body: { schedules: any[] }) {
        await this.staffService.setSchedule(schema, staffId, body.schedules);
        return { success: true };
    }

    @Put(':tenantId/:staffId/services')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Link services to a staff member' })
    async linkServices(@CurrentTenant() schema: string, @Param('staffId') staffId: string, @Body() body: { serviceIds: string[] }) {
        await this.staffService.linkServices(schema, staffId, body.serviceIds);
        return { success: true };
    }

    @Get(':tenantId/available')
    @ApiOperation({ summary: 'Get available staff for a service/date/time' })
    async getAvailable(
        @CurrentTenant() schema: string,
        @Query('serviceId') serviceId: string,
        @Query('date') date: string,
        @Query('time') time: string,
    ) {
        const staff = await this.staffService.getAvailableStaff(schema, serviceId, date, time);
        return { success: true, data: staff };
    }

    @Post(':tenantId/:staffId/breaks')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Add a break/time-off for a staff member' })
    async addBreak(@CurrentTenant() schema: string, @Param('staffId') staffId: string, @Body() body: any) {
        const brk = await this.staffService.addBreak(schema, staffId, body);
        return { success: true, data: brk };
    }
}
