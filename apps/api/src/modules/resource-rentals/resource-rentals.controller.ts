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
    @ApiOperation({ summary: 'Reserve a vehicle or a pet boarding place' })
    async create(
        @Param('tenantId') tenantId: string,
        @Body() body: CreateResourceRentalInput,
        @CurrentUser() user: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.create(schemaName, body, user?.id || user?.sub);
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
        const data = await this.service.transition(schemaName, rentalId, body?.status, user?.role);
        return { success: true, data };
    }
}
