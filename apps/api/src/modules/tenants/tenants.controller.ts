import { Controller, Get, Post, Patch, Put, Param, Body, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TenantsService } from './tenants.service';
import { TenantThrottleService, QuotaOverrides } from '../throttle/tenant-throttle.service';
import { FeatureFlagsService, FEATURE_FLAGS_REGISTRY } from '../throttle/feature-flags.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { PrismaService } from '../prisma/prisma.service';
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
    constructor(
        private tenantsService: TenantsService,
        private throttleService: TenantThrottleService,
        private llmRouter: LLMRouterService,
        private prisma: PrismaService,
        private featureFlagsService: FeatureFlagsService,
    ) { }

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

    @Get('onboarding-funnel')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Acquisition funnel — signups → onboarding → first message → first paying' })
    async getOnboardingFunnel(@Query('days') days = 30) {
        const since = new Date();
        since.setDate(since.getDate() - Number(days));
        const data = await this.tenantsService.getOnboardingFunnel(since);
        return { success: true, data };
    }

    @Get('llm-stats')
    @Roles('super_admin')
    @ApiOperation({ summary: 'LLM usage stats — by provider, by tenant, by day' })
    async getLlmStats(
        @Query('days') days = 7,
        @Query('tenantId') tenantId?: string,
    ) {
        const until = new Date();
        const since = new Date();
        since.setDate(since.getDate() - Number(days));
        const data = await this.llmRouter.getStats({ since, until, tenantId });

        // Hydrate tenant names for byTenant breakdown
        const tenantIds = data.byTenant.map(t => t.tenantId);
        const tenants = tenantIds.length
            ? await this.prisma.tenant.findMany({
                where: { id: { in: tenantIds } },
                select: { id: true, name: true },
            }).catch(() => [])
            : [];
        const nameMap = new Map(tenants.map((t: any) => [t.id, t.name]));
        return {
            success: true,
            data: {
                ...data,
                byTenant: data.byTenant.map(t => ({ ...t, tenantName: nameMap.get(t.tenantId) || '—' })),
            },
        };
    }

    @Get('queue-jobs/:queueName/:state')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Inspect actual jobs in a BullMQ queue (super_admin debug)' })
    async getQueueJobs(
        @Param('queueName') queueName: string,
        @Param('state') state: string,
        @Query('limit') limit = 50,
    ) {
        const jobs = await this.tenantsService.getQueueJobs(queueName, state, Number(limit));
        return { success: true, data: jobs };
    }

    @Get('audit-logs')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Cross-tenant audit log viewer' })
    async getAuditLogs(
        @Query('tenantId') tenantId?: string,
        @Query('action') action?: string,
        @Query('since') since?: string,
        @Query('limit') limit = 100,
        @Query('offset') offset = 0,
    ) {
        const data = await this.tenantsService.getAuditLogs({
            tenantId,
            action,
            since,
            limit: Number(limit),
            offset: Number(offset),
        });
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

        // Enrich each tenant with vertical + healthScore from settings JSONB
        const enriched = result.tenants.map((t: any) => {
            const settings = (t as any).settings || {};
            const vertical: string | null = settings.verticalConfig?.industry || null;

            // Lightweight health score from counts already in the response
            const channelBonus = (t._count?.channelAccounts || 0) > 0 ? 20 : 0;
            // Remaining factors default to 0 for the list view (detailed via engagement endpoint)
            const healthScore = channelBonus;

            return { ...t, vertical, healthScore };
        });

        return { success: true, data: enriched, meta: { page: result.page, limit: result.limit, total: result.total } };
    }

    @Get(':id/engagement')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Engagement metrics for a specific tenant' })
    async getTenantEngagement(@Param('id') id: string) {
        const data = await this.tenantsService.getTenantEngagement(id);
        return { success: true, data };
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

    @Get(':id/quota-overrides')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Get tenant quota overrides + current usage' })
    async getQuotaOverrides(@Param('id') id: string) {
        const overrides = await this.throttleService.getQuotaOverrides(id);
        const [automation, outbound, broadcast, features] = await Promise.all([
            this.throttleService.getUsage(id, 'automation'),
            this.throttleService.getUsage(id, 'outbound'),
            this.throttleService.getUsage(id, 'broadcast'),
            this.throttleService.getPlanFeatures(id),
        ]);
        return {
            success: true,
            data: {
                overrides,
                features,  // maxAgents/maxCalendars (already merged with overrides)
                usage: { automation, outbound, broadcast },
            },
        };
    }

    @Get(':id/feature-flags')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Get tenant feature flags + registry' })
    async getFeatureFlags(@Param('id') id: string) {
        const flags = await this.featureFlagsService.getFlags(id);
        return {
            success: true,
            data: {
                registry: FEATURE_FLAGS_REGISTRY,
                flags,
            },
        };
    }

    @Put(':id/feature-flags')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Replace tenant feature flags (bulk)' })
    async setFeatureFlags(
        @Param('id') id: string,
        @Body() body: { flags: Record<string, boolean> },
        @CurrentUser() user: any,
    ) {
        const result = await this.featureFlagsService.setFlags(id, body.flags || {}, user?.email || user?.sub);
        return { success: true, data: result };
    }

    @Put(':id/quota-overrides')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Set tenant quota overrides (super_admin)' })
    async setQuotaOverrides(
        @Param('id') id: string,
        @Body() body: QuotaOverrides,
        @CurrentUser() user: any,
    ) {
        const result = await this.throttleService.setQuotaOverrides(id, body, user?.email || user?.sub);
        return { success: true, data: result };
    }
}
