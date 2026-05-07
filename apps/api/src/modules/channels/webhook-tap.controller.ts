import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WebhookTapService } from './webhook-tap.service';

/**
 * super_admin live-tail viewer for the last N webhook events. Backed
 * by Redis (no DB cost). Used by /admin/webhooks in the dashboard.
 */
@ApiTags('webhook-tap')
@Controller('webhook-tap')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
export class WebhookTapController {
    constructor(private readonly tap: WebhookTapService) {}

    @Get()
    @Roles('super_admin')
    @ApiOperation({ summary: 'Recent inbound webhook events (last 200, Redis-backed)' })
    async list(
        @Query('channelType') channelType?: string,
        @Query('status') status?: string,
        @Query('limit') limit = 100,
    ) {
        const events = await this.tap.list({ channelType, status, limit: Number(limit) });
        return { success: true, data: events };
    }
}
