import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TenantsService } from './tenants.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';

class CreateTenantDto {
    name: string;
    slug: string;
    industry: string;
    language?: string;
    plan?: string;
}

class UpdateTenantDto {
    name?: string;
    industry?: string;
    language?: string;
    isActive?: boolean;
    settings?: any;
}

@ApiTags('tenants')
@Controller('tenants')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
export class TenantsController {
    constructor(private tenantsService: TenantsService) { }

    @Post()
    @Roles('super_admin')
    @ApiOperation({ summary: 'Create a new tenant' })
    async create(@Body() dto: CreateTenantDto) {
        const tenant = await this.tenantsService.create(dto);
        return { success: true, data: tenant };
    }

    // ── Super Admin Platform Endpoints (static routes BEFORE :id) ────

    @Get('stats')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Platform KPIs — tenant counts, users, channels, signups' })
    async getPlatformStats() {
        const data = await this.tenantsService.getPlatformStats();
        return { success: true, data };
    }

    @Get('platform-billing')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Billing summary — MRR, plan distribution, recent payments' })
    async getPlatformBilling() {
        const data = await this.tenantsService.getPlatformBilling();
        return { success: true, data };
    }

    @Get('platform-usage')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Usage across all active tenants' })
    async getPlatformUsage() {
        const data = await this.tenantsService.getPlatformUsage();
        return { success: true, data };
    }

    @Get('health')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Platform health — services, queues' })
    async getPlatformHealth() {
        const data = await this.tenantsService.getPlatformHealth();
        return { success: true, data };
    }

    // ── Standard CRUD ────────────────────────────────────────────────

    @Get()
    @Roles('super_admin')
    @ApiOperation({ summary: 'List all tenants' })
    async findAll(
        @Query('page') page = 1,
        @Query('limit') limit = 20,
        @Query('status') status?: string,
    ) {
        const result = await this.tenantsService.findAll(page, limit, status);
        return { success: true, data: result.tenants, meta: { page: result.page, limit: result.limit, total: result.total } };
    }

    @Get(':id')
    @Roles('super_admin', 'tenant_admin')
    @ApiOperation({ summary: 'Get tenant by ID' })
    async findById(@Param('id') id: string) {
        const tenant = await this.tenantsService.findById(id);
        return { success: true, data: tenant };
    }

    @Patch(':id')
    @Roles('super_admin', 'tenant_admin')
    @ApiOperation({ summary: 'Update tenant (super_admin or own tenant)' })
    async update(@Param('id') id: string, @Body() dto: UpdateTenantDto, @CurrentUser() currentUser: any) {
        // tenant_admin can only update their own tenant
        if (currentUser.role === 'tenant_admin' && currentUser.tenantId !== id) {
            throw new ForbiddenException('Cannot update another tenant');
        }
        const tenant = await this.tenantsService.update(id, dto);
        return { success: true, data: tenant };
    }

    @Get(':id/users')
    @Roles('super_admin')
    @ApiOperation({ summary: 'List users belonging to a tenant' })
    async getUsersByTenant(@Param('id') id: string) {
        const users = await this.tenantsService.getUsersByTenantId(id);
        return { success: true, data: users };
    }

    @Post(':id/deactivate')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Deactivate a tenant' })
    async deactivate(@Param('id') id: string) {
        const tenant = await this.tenantsService.deactivate(id);
        return { success: true, data: tenant };
    }
}
