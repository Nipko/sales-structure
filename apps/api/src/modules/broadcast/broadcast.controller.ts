import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';

@Controller('api/v1/broadcast')
export class BroadcastController {
    constructor(private broadcastService: BroadcastService) { }

    @Get('campaigns/:tenantId')
    async getCampaigns(@Param('tenantId') tenantId: string) {
        const data = await this.broadcastService.getCampaigns(tenantId);
        return { success: true, data };
    }

    @Post('campaigns/:tenantId')
    async createCampaign(
        @Param('tenantId') tenantId: string,
        @Body() body: { name: string; channel: string; template: string; targetAudience: string }
    ) {
        const result = await this.broadcastService.createCampaign(tenantId, body);
        return { success: true, data: result };
    }

    @Post('campaigns/:tenantId/:campaignId/send')
    async sendCampaign(
        @Param('tenantId') tenantId: string,
        @Param('campaignId') campaignId: string
    ) {
        await this.broadcastService.sendCampaign(tenantId, campaignId);
        return { success: true, message: 'Campaign dispatch started' };
    }
}
