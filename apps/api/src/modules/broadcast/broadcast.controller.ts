import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { BroadcastService, CreateCampaignDto } from './broadcast.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('broadcast')
@Controller('broadcast')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class BroadcastController {
    private readonly logger = new Logger(BroadcastController.name);

    constructor(
        private readonly broadcastService: BroadcastService,
        private readonly throttle: TenantThrottleService,
        private readonly prisma: PrismaService,
    ) {}

    @Post('campaigns')
    @ApiOperation({ summary: 'Create a new broadcast campaign' })
    async createCampaign(
        @CurrentTenant() tenantId: string,
        @Body() body: CreateCampaignDto,
    ) {
        // Plan gate — count campaigns created in the current calendar month
        // so the starter cap (3) resets monthly instead of being lifetime.
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const [{ cnt }] = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT COUNT(*)::int AS cnt FROM broadcast_campaigns WHERE created_at >= $1::timestamptz`,
            [monthStart],
        );
        await this.throttle.enforcePlanLimit(tenantId, 'broadcastCampaigns', Number(cnt || 0), 'campañas de broadcast este mes');

        const result = await this.broadcastService.createCampaign(tenantId, body);
        return { success: true, data: result };
    }

    @Post('campaigns/:id/launch')
    @ApiOperation({ summary: 'Launch a campaign — queues all recipients for sending' })
    async launchCampaign(
        @CurrentTenant() tenantId: string,
        @Param('id') campaignId: string,
    ) {
        const result = await this.broadcastService.launchCampaign(tenantId, campaignId);
        return { success: true, message: 'Campaign launched', data: result };
    }

    @Get('campaigns')
    @ApiOperation({ summary: 'List all campaigns with stats' })
    async getCampaigns(@CurrentTenant() tenantId: string) {
        const data = await this.broadcastService.getCampaigns(tenantId);
        return { success: true, data };
    }

    @Get('campaigns/:id/stats')
    @ApiOperation({ summary: 'Get detailed delivery stats for a campaign' })
    async getCampaignStats(
        @CurrentTenant() tenantId: string,
        @Param('id') campaignId: string,
    ) {
        const data = await this.broadcastService.getCampaignStats(tenantId, campaignId);
        return { success: true, data };
    }
}
