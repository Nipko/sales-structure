import { Controller, Get, Post, Patch, Put, Delete, Param, Body, Query, UseGuards, ForbiddenException, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TENANT_LANGUAGE_TAGS, TENANT_PLAN_SLUGS, TenantsService } from './tenants.service';
import { TenantThrottleService, QuotaOverrides } from '../throttle/tenant-throttle.service';
import { FeatureFlagsService, FEATURE_FLAGS_REGISTRY } from '../throttle/feature-flags.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTenantDto {
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    name: string;

    @IsString()
    @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    @MaxLength(50)
    slug: string;

    @IsString()
    @MaxLength(80)
    industry: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    subType?: string | null;

    @IsOptional()
    @IsIn([...TENANT_LANGUAGE_TAGS])
    language?: string;

    @IsOptional()
    @IsIn([...TENANT_PLAN_SLUGS])
    plan?: string;

    @IsEmail()
    @MaxLength(254)
    ownerEmail: string;

    @IsString()
    @MinLength(1)
    @MaxLength(100)
    ownerFirstName: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    ownerLastName?: string;
}

export class UpdateTenantDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    industry?: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    subType?: string | null;

    @IsOptional()
    @IsIn([...TENANT_LANGUAGE_TAGS])
    language?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsObject()
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
    async create(@Body() dto: CreateTenantDto, @CurrentUser() currentUser: any) {
        const tenant = await this.tenantsService.create(dto, currentUser?.sub);
        return { success: true, data: tenant };
    }

    // ── Super Admin Platform Endpoints (static routes BEFORE :id) ────

    @Get('provisioning-plans')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Canonical plans allowed for administrative tenant provisioning' })
    async getProvisioningPlans() {
        return { success: true, data: await this.tenantsService.getProvisioningPlans() };
    }

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

    @Get('ai-usage')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Unified AI usage — LLM + media + embeddings, monthly breakdown' })
    async getAiUsage(
        @Query('months') months = 3,
        @Query('tenantId') tenantId?: string,
    ) {
        const data = await this.llmRouter.getUnifiedAiUsage({ months: Number(months), tenantId });
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

    @Get('queue-jobs/:queueName/job/:jobId')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Full job detail with redacted payload + opts + stack trace' })
    async getQueueJobDetail(
        @Param('queueName') queueName: string,
        @Param('jobId') jobId: string,
    ) {
        const data = await this.tenantsService.getQueueJobDetail(queueName, jobId);
        return data
            ? { success: true, data }
            : { success: false, error: 'Job not found' };
    }

    @Delete('queue-jobs/:queueName/job/:jobId')
    @Roles('super_admin')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Remove a single job from the queue' })
    async removeQueueJob(
        @Param('queueName') queueName: string,
        @Param('jobId') jobId: string,
        @CurrentUser() user: any,
    ) {
        const removed = await this.tenantsService.removeQueueJob(queueName, jobId, user?.email || user?.sub);
        return { success: removed, removed };
    }

    @Post('queue-jobs/:queueName/job/:jobId/retry')
    @Roles('super_admin')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Retry a failed job (moves back to waiting)' })
    async retryQueueJob(
        @Param('queueName') queueName: string,
        @Param('jobId') jobId: string,
        @CurrentUser() user: any,
    ) {
        const retried = await this.tenantsService.retryQueueJob(queueName, jobId, user?.email || user?.sub);
        return { success: retried, retried };
    }

    @Post('queue-jobs/:queueName/clean')
    @Roles('super_admin')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Bulk clean jobs in a given state (destructive — use with caution)' })
    async cleanQueue(
        @Param('queueName') queueName: string,
        @Body() body: { state: string; olderThanMs?: number; limit?: number },
        @CurrentUser() user: any,
    ) {
        const count = await this.tenantsService.cleanQueue(
            queueName,
            body.state as any,
            body.olderThanMs || 0,
            body.limit || 1000,
            user?.email || user?.sub,
        );
        return { success: true, removed: count };
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
        // Query params arrive as strings — coerce before Prisma skip/take
        const safePage = Math.max(Number(page) || 1, 1);
        const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 500);
        const result = await this.tenantsService.findAll(safePage, safeLimit, status);

        // Enrich each tenant with vertical + healthScore from settings JSONB
        const enriched = result.tenants.map((t: any) => {
            const settings = (t as any).settings || {};
            const vertical: string | null = settings.verticalConfig?.industry || null;
            const subType: string | null = settings.verticalConfig?.subType ?? settings.subType ?? null;

            // Lightweight health score from counts already in the response
            const channelBonus = (t._count?.channelAccounts || 0) > 0 ? 20 : 0;
            // Remaining factors default to 0 for the list view (detailed via engagement endpoint)
            const healthScore = channelBonus;

            return { ...t, vertical, subType, healthScore };
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
    async findById(@Param('id') id: string, @CurrentUser() currentUser: any) {
        // Defense in depth: RolesGuard limits the endpoint roles, while this
        // resource-level check prevents tenant_admin from choosing another ID.
        if (currentUser?.role !== 'super_admin'
            && (currentUser?.role !== 'tenant_admin' || currentUser?.tenantId !== id)) {
            throw new ForbiddenException('Cannot access another tenant');
        }

        const tenant = await this.tenantsService.findById(id, {
            role: currentUser.role,
            tenantId: currentUser.tenantId,
        });
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
