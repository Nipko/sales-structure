import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { StaffSchedulingService } from './staff-scheduling.service';
import { StaffOperationsModelService } from './staff-operations-model.service';

@ApiTags('staff')
@Controller('staff')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard, FeatureGuard)
@RequireFeature('staffScheduling')
@ApiBearerAuth()
export class StaffSchedulingController {
    constructor(
        private readonly staffService: StaffSchedulingService,
        private readonly operationsModel: StaffOperationsModelService,
    ) {}

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

    @Post(':tenantId/locations')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Create an explicit operational location' })
    async createLocation(
        @CurrentTenant() schema: string,
        @Body() body: { name: string; timezone: string },
    ) {
        const data = await this.requireOperationsModel().createLocation(schema, body);
        return { success: true, data };
    }

    @Post(':tenantId/resources')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Create a capacity-bearing operational resource' })
    async createResource(
        @CurrentTenant() schema: string,
        @Body() body: { locationId?: string | null; resourceType: string; name: string; capacity: number },
    ) {
        const data = await this.requireOperationsModel().createResource(schema, body);
        return { success: true, data };
    }

    @Get(':tenantId/:staffId/operational-binding')
    @ApiOperation({ summary: 'Read explicit staff/user/location/calendar/resource links' })
    async getOperationalBinding(
        @CurrentTenant() schema: string,
        @Param('staffId') staffId: string,
    ) {
        const data = await this.requireOperationsModel().getBinding(schema, staffId);
        return { success: true, data };
    }

    @Put(':tenantId/:staffId/operational-binding')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Link distinct staff/user/location/calendar/resource entities' })
    async upsertOperationalBinding(
        @Param('tenantId') tenantId: string,
        @CurrentTenant() schema: string,
        @Param('staffId') staffId: string,
        @Body() body: {
            userId?: string | null;
            locationId?: string | null;
            calendarIntegrationId?: string | null;
            resourceIds?: string[];
        },
    ) {
        const data = await this.requireOperationsModel().upsertBinding(
            tenantId,
            schema,
            staffId,
            body,
        );
        return { success: true, data };
    }

    private requireOperationsModel(): StaffOperationsModelService {
        if (!this.operationsModel) throw new Error('StaffOperationsModelService is not configured');
        return this.operationsModel;
    }
}
