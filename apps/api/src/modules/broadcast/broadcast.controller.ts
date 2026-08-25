import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    Logger,
    ForbiddenException,
    Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { BroadcastService, CreateCampaignDto } from './broadcast.service';
import { AbTestService } from './ab-test.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PrismaService } from '../prisma/prisma.service';
import { RequiresVerifiedEmail } from '../../common/decorators/requires-verified-email.decorator';

@ApiTags('broadcast')
@Controller('broadcast')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class BroadcastController {
    private readonly logger = new Logger(BroadcastController.name);

    constructor(
        private readonly broadcastService: BroadcastService,
        private readonly abTestService: AbTestService,
        private readonly throttle: TenantThrottleService,
        private readonly prisma: PrismaService,
    ) {}

    @Post('campaigns')
    @Roles('tenant_admin', 'tenant_supervisor')
    @RequiresVerifiedEmail('send_outbound')
    @ApiOperation({ summary: 'Create a new broadcast campaign' })
    async createCampaign(
        @CurrentTenant() tenantId: string,
        @Body() body: CreateCampaignDto,
        @Req() req: any,
    ) {
        // Plan gate — count campaigns created in the current calendar month
        // so the starter cap (3) resets monthly instead of being lifetime.
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const countRows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT COUNT(*)::int AS cnt FROM campaigns WHERE created_at >= $1::timestamptz`,
            [monthStart],
        );
        await this.throttle.enforcePlanLimit(tenantId, 'broadcastCampaigns', Number(countRows?.[0]?.cnt || 0), 'campañas de broadcast este mes');

        // Plan gate for A/B testing
        if (body.variants && body.variants.length >= 2) {
            const abEnabled = await this.throttle.isFeatureEnabled(tenantId, 'abTestBroadcasts');
            if (!abEnabled) {
                const plan = await this.throttle.getTenantPlan(tenantId);
                throw new ForbiddenException({
                    error: 'plan_limit_reached',
                    limitKey: 'abTestBroadcasts',
                    resource: 'A/B testing de broadcasts',
                    plan,
                    message: `Tu plan ${plan} no incluye A/B testing para broadcasts. Actualizá tu plan.`,
                });
            }
        }

        const result = await this.broadcastService.createCampaign(
            tenantId,
            body,
            req.user?.sub || req.user?.id,
        );
        return { success: true, data: result };
    }

    @Post('campaigns/:id/launch')
    @Roles('tenant_admin', 'tenant_supervisor')
    @RequiresVerifiedEmail('send_outbound')
    @ApiOperation({ summary: 'Launch a campaign — queues all recipients for sending' })
    async launchCampaign(
        @CurrentTenant() tenantId: string,
        @Param('id') campaignId: string,
        @Req() req: any,
    ) {
        const result = await this.broadcastService.launchCampaign(
            tenantId,
            campaignId,
            req.user?.sub || req.user?.id,
        );
        return { success: true, message: 'Campaign launched', data: result };
    }

    @Get('campaigns')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'List all campaigns with stats' })
    async getCampaigns(@CurrentTenant() tenantId: string) {
        const data = await this.broadcastService.getCampaigns(tenantId);
        return { success: true, data };
    }

    @Get('campaigns/:id/stats')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Get detailed delivery stats for a campaign' })
    async getCampaignStats(
        @CurrentTenant() tenantId: string,
        @Param('id') campaignId: string,
    ) {
        const data = await this.broadcastService.getCampaignStats(tenantId, campaignId);
        return { success: true, data };
    }

    @Get('campaigns/:id/variants')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Get A/B test variant stats with significance' })
    async getAbVariants(
        @CurrentTenant() tenantId: string,
        @Param('id') campaignId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.abTestService.getVariantStats(schemaName, campaignId);
        return { success: true, data };
    }

    @Post('campaigns/:id/winner')
    @Roles('tenant_admin', 'tenant_supervisor')
    @RequiresVerifiedEmail('send_outbound')
    @ApiOperation({ summary: 'Manually select A/B test winner' })
    async selectAbWinner(
        @CurrentTenant() tenantId: string,
        @Param('id') campaignId: string,
        @Body() body: { variantId: string },
    ) {
        const abEnabled = await this.throttle.isFeatureEnabled(tenantId, 'abTestBroadcasts');
        if (!abEnabled) {
            const plan = await this.throttle.getTenantPlan(tenantId);
            throw new ForbiddenException({
                error: 'plan_limit_reached',
                limitKey: 'abTestBroadcasts',
                resource: 'A/B testing de broadcasts',
                plan,
                message: `Tu plan ${plan} no incluye A/B testing para broadcasts. Actualizá tu plan.`,
            });
        }
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.abTestService.selectWinner(schemaName, campaignId, body.variantId);
        return { success: true, message: 'Winner selected' };
    }
}
