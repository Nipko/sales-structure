import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
    CreateResourceRentalInput,
    RecordRentalInspectionInput,
    ReportRentalDamageInput,
    ResourceRentalsService,
} from './resource-rentals.service';

@ApiTags('resource-rentals')
@Controller('resource-rentals')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class ResourceRentalsController {
    constructor(
        private readonly service: ResourceRentalsService,
        private readonly prisma: PrismaService,
    ) {}

    @Get(':tenantId')
    @ApiOperation({ summary: 'List vehicle rentals or pet boarding stays' })
    async list(
        @Param('tenantId') tenantId: string,
        @Query('type') type?: string,
        @Query('status') status?: string,
        @Query('resourceId') resourceId?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('limit') limit?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.list(schemaName, {
            type,
            status,
            resourceId,
            from,
            to,
            limit: limit === undefined ? undefined : Number(limit),
        });
        return { success: true, data };
    }

    @Post(':tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Submit a vehicle rental request or reserve a pet boarding place' })
    async create(
        @Param('tenantId') tenantId: string,
        @Body() body: CreateResourceRentalInput,
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.create(schemaName, body, user?.id || user?.sub);
        return { success: true, data };
    }

    @Get(':tenantId/:rentalId')
    @ApiOperation({ summary: 'Get one rental with reviews, inspections, damages and history' })
    async getOne(
        @Param('tenantId') tenantId: string,
        @Param('rentalId') rentalId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.getById(schemaName, rentalId);
        if (!data) return { success: false, error: 'Resource rental not found' };
        return { success: true, data };
    }

    @Put(':tenantId/:rentalId/status')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Apply a valid rental or boarding status transition' })
    async transition(
        @Param('tenantId') tenantId: string,
        @Param('rentalId') rentalId: string,
        @Body() body: { status: string },
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.transition(
            schemaName,
            rentalId,
            body?.status,
            user?.role,
            user?.id || user?.sub,
        );
        return { success: true, data };
    }

    @Put(':tenantId/:rentalId/eligibility')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Record one human eligibility determination' })
    async reviewEligibility(
        @Param('tenantId') tenantId: string,
        @Param('rentalId') rentalId: string,
        @Body() body: any,
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.reviewEligibility(
            schemaName,
            rentalId,
            body,
            user?.id || user?.sub,
            user?.role,
        );
        return { success: true, data };
    }

    @Put(':tenantId/:rentalId/approve')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Approve an eligible vehicle rental request and reserve the vehicle' })
    async approve(
        @Param('tenantId') tenantId: string,
        @Param('rentalId') rentalId: string,
        @Body() body: { expectedVersion: number },
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.approveVehicleRental(
            schemaName,
            rentalId,
            body?.expectedVersion,
            user?.id || user?.sub,
            user?.role,
        );
        return { success: true, data };
    }

    @Put(':tenantId/:rentalId/reject')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Reject a vehicle rental request with a recorded reason' })
    async reject(
        @Param('tenantId') tenantId: string,
        @Param('rentalId') rentalId: string,
        @Body() body: { expectedVersion: number; reason: string },
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.rejectVehicleRental(
            schemaName,
            rentalId,
            body?.reason,
            body?.expectedVersion,
            user?.id || user?.sub,
            user?.role,
        );
        return { success: true, data };
    }

    @Post(':tenantId/:rentalId/inspections')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Record immutable pickup/return inspection and advance lifecycle atomically' })
    async recordInspection(
        @Param('tenantId') tenantId: string,
        @Param('rentalId') rentalId: string,
        @Body() body: RecordRentalInspectionInput,
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.recordInspection(
            schemaName,
            rentalId,
            body,
            user?.id || user?.sub,
        );
        return { success: true, data };
    }

    @Post(':tenantId/:rentalId/damages')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Report traceable vehicle damage with optional amount and media evidence' })
    async reportDamage(
        @Param('tenantId') tenantId: string,
        @Param('rentalId') rentalId: string,
        @Body() body: ReportRentalDamageInput,
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.reportDamage(
            schemaName,
            rentalId,
            body,
            user?.id || user?.sub,
        );
        return { success: true, data };
    }

    /**
     * Los datos operativos: conductor, depósito, contrato, jaula, grupo.
     *
     * Separado del estado a propósito. Registrar el kilometraje de entrada no
     * es cerrar el alquiler, y cerrarlo tiene reglas de quién puede hacerlo que
     * no aplican a anotar con quién sale al patio el perro.
     */
    @Put(':tenantId/:rentalId/details')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Update the operational details of a rental or boarding stay' })
    async updateDetails(
        @Param('tenantId') tenantId: string,
        @Param('rentalId') rentalId: string,
        @Body() body: Record<string, unknown> & { expectedVersion?: number },
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const { expectedVersion, ...details } = body || {};
        const data = await this.service.updateDetails(
            schemaName,
            rentalId,
            details,
            user?.id || user?.sub,
            user?.role,
            expectedVersion,
        );
        return { success: true, data };
    }
}
