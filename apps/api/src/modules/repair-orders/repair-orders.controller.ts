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
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRepairOrderInput, RepairOrdersService } from './repair-orders.service';

@ApiTags('repair-orders')
@Controller('repair-orders')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class RepairOrdersController {
    constructor(
        private readonly service: RepairOrdersService,
        private readonly prisma: PrismaService,
    ) {}

    @Get(':tenantId')
    @ApiOperation({ summary: 'List canonical automotive repair orders' })
    async list(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
        @Query('contactId') contactId?: string,
        @Query('vehicleId') vehicleId?: string,
        @Query('search') search?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.list(schemaName, {
            status, contactId, vehicleId, search,
            limit: limit === undefined ? undefined : Number(limit),
            offset: offset === undefined ? undefined : Number(offset),
        });
        return { success: true, data };
    }

    @Get(':tenantId/summary')
    @ApiOperation({ summary: 'Get operational repair-order counts for the workshop' })
    async summary(@Param('tenantId') tenantId: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        return { success: true, data: await this.service.summary(schemaName) };
    }

    @Get(':tenantId/:repairOrderId')
    @ApiOperation({ summary: 'Get a repair order with its immutable event history' })
    async get(
        @Param('tenantId') tenantId: string,
        @Param('repairOrderId') repairOrderId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        return { success: true, data: await this.service.get(schemaName, repairOrderId) };
    }

    @Post(':tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Create a repair order without turning the reported concern into a diagnosis' })
    async create(
        @Param('tenantId') tenantId: string,
        @Body() body: CreateRepairOrderInput,
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.create(schemaName, body, {
            id: user?.id || user?.sub,
            type: 'tenant_user',
        });
        return { success: true, data };
    }

    @Put(':tenantId/:repairOrderId/estimate')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Publish a versioned estimate and request customer approval' })
    async updateEstimate(
        @Param('tenantId') tenantId: string,
        @Param('repairOrderId') repairOrderId: string,
        @Body() body: any,
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updateEstimate(
            schemaName, repairOrderId, body, user?.id || user?.sub,
        );
        return { success: true, data };
    }

    @Put(':tenantId/:repairOrderId/details')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Update technician-authored inspection, diagnosis and final totals' })
    async updateDetails(
        @Param('tenantId') tenantId: string,
        @Param('repairOrderId') repairOrderId: string,
        @Body() body: any,
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updateOperationalDetails(
            schemaName, repairOrderId, body, user?.id || user?.sub,
        );
        return { success: true, data };
    }

    @Put(':tenantId/:repairOrderId/estimate-decision')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Record a staff-witnessed customer estimate decision with evidence' })
    async recordEstimateDecision(
        @Param('tenantId') tenantId: string,
        @Param('repairOrderId') repairOrderId: string,
        @Body() body: { accepted: boolean; evidence: string },
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.decideEstimate(
            schemaName,
            repairOrderId,
            null,
            body.accepted,
            'tenant_user',
            user?.id || user?.sub,
            body.evidence,
        );
        return { success: true, data };
    }

    @Put(':tenantId/:repairOrderId/status')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Apply a valid optimistic-lock repair-order transition' })
    async transition(
        @Param('tenantId') tenantId: string,
        @Param('repairOrderId') repairOrderId: string,
        @Body() body: { status: string; expectedVersion: number; reason?: string },
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.transition(
            schemaName, repairOrderId, body, user?.id || user?.sub,
        );
        return { success: true, data };
    }
}
