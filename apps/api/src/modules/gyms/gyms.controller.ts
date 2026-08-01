import {
    Controller, Get, Post, Put, Delete, Param, Body, Query,
    UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { GymsService } from './gyms.service';
import { PrismaService } from '../prisma/prisma.service';
import { bulkImportRows } from '../../common/utils/bulk-import.util';

@ApiTags('gyms')
@Controller('gyms')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class GymsController {
    constructor(
        private readonly service: GymsService,
        private readonly prisma: PrismaService,
    ) {}

    // Plans
    @Get(':tenantId/plans')
    async listPlans(@Param('tenantId') tenantId: string, @Query('includeInactive') incl?: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listPlans(schemaName, incl === 'true');
        return { success: true, data };
    }

    @Post(':tenantId/plans')
    @Roles('tenant_admin', 'tenant_supervisor')
    async createPlan(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createPlan(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/plans/:id')
    @Roles('tenant_admin', 'tenant_supervisor')
    async updatePlan(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updatePlan(schemaName, id, body);
        return { success: true, data };
    }

    @Delete(':tenantId/plans/:id')
    @Roles('tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    async deletePlan(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.deletePlan(schemaName, id);
        return { success: true };
    }

    // Members
    @Get(':tenantId/members')
    async listMembers(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('limit') limit?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listMembers(schemaName, {
            status, search, limit: limit ? Number(limit) : undefined,
        });
        return { success: true, data };
    }

    @Get(':tenantId/members/:id')
    async getMember(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.getMemberById(schemaName, id);
        if (!data) throw new BadRequestException('Member not found');
        return { success: true, data };
    }

    @Post(':tenantId/members')
    @Roles('tenant_admin', 'tenant_supervisor')
    async createMember(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createMember(schemaName, body);
        return { success: true, data };
    }

    @Post(':tenantId/members/:id/freeze')
    @Roles('tenant_admin', 'tenant_supervisor')
    async freezeMember(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: { days: number },
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.freezeMember(schemaName, id, body.days);
        return { success: true, data };
    }

    @Post(':tenantId/members/:id/unfreeze')
    @Roles('tenant_admin', 'tenant_supervisor')
    async unfreezeMember(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.unfreezeMember(schemaName, id);
        return { success: true, data };
    }

    @Post(':tenantId/members/:id/check-in')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async checkIn(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: { classId?: string },
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.checkInMember(schemaName, id, body.classId);
        return { success: true, data };
    }

    // Classes
    @Get(':tenantId/classes')
    async listClasses(
        @Param('tenantId') tenantId: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('classType') classType?: string,
        @Query('limit') limit?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listClasses(schemaName, {
            from, to, classType, limit: limit ? Number(limit) : undefined,
        });
        return { success: true, data };
    }

    @Post(':tenantId/classes')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async createClass(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createClass(schemaName, body);
        return { success: true, data };
    }

    @Post(':tenantId/classes/:id/cancel')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async cancelClass(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: { reason?: string },
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.cancelClass(schemaName, id, body.reason);
        return { success: true, data };
    }

    @Post(':tenantId/classes/:classId/book')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async bookClass(
        @Param('tenantId') tenantId: string,
        @Param('classId') classId: string,
        @Body() body: { memberId: string },
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.bookClass(schemaName, classId, body.memberId);
        return { success: true, data };
    }

    @Delete(':tenantId/bookings/:bookingId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @HttpCode(HttpStatus.OK)
    async cancelBooking(@Param('tenantId') tenantId: string, @Param('bookingId') bookingId: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.cancelBooking(schemaName, bookingId);
        return { success: true };
    }

    /**
     * Import masivo. Cargar 40 propiedades / 200 miembros / 60 platos de a
     * uno es el punto de abandono documentado del alta; esto lo vuelve un
     * archivo. Reusa el create de siempre fila por fila, asi que la
     * validacion es exactamente la misma que por la UI.
     */
    @Post(":tenantId/members/bulk-import")
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: "Bulk-import gym members from a parsed CSV/XLSX" })
    async bulkImportMembers(@Param('tenantId') tenantId: string, @Body() body: { rows?: any[] }) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await bulkImportRows(body?.rows, row => this.service.createMemberFromRow(schemaName, row));
        return { success: true, data };
    }
}
