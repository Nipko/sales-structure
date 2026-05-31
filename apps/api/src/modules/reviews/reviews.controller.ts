import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReviewsService } from './reviews.service';

/** Public OAuth callback (no guards — hit by Google's redirect). */
@Controller('reviews')
export class ReviewsPublicController {
    constructor(private readonly reviews: ReviewsService, private readonly config: ConfigService) {}

    @Get('google/callback')
    async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
        const dash = this.config.get('DASHBOARD_URL', 'https://admin.parallly-chat.cloud');
        try {
            if (!code || !state) throw new Error('missing code/state');
            await this.reviews.handleCallback(code, state);
            return res.redirect(`${dash}/admin/settings/integrations/reviews?connected=1`);
        } catch {
            return res.redirect(`${dash}/admin/settings/integrations/reviews?error=1`);
        }
    }
}

/** Authenticated reviews management (T3.23). */
@Controller('reviews')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class ReviewsController {
    constructor(private readonly reviews: ReviewsService) {}

    @Get(':tenantId/config')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getConfig(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.reviews.getConfig(tenantId) };
    }

    @Put(':tenantId/config')
    @Roles('super_admin', 'tenant_admin')
    async updateConfig(@Param('tenantId') tenantId: string, @Body() body: any) {
        return { success: true, data: await this.reviews.updateConfig(tenantId, body) };
    }

    @Get(':tenantId/connect')
    @Roles('super_admin', 'tenant_admin')
    async connect(@Param('tenantId') tenantId: string) {
        return { success: true, data: { url: this.reviews.getAuthUrl(tenantId) } };
    }

    @Delete(':tenantId')
    @Roles('super_admin', 'tenant_admin')
    async disconnect(@Param('tenantId') tenantId: string) {
        await this.reviews.disconnect(tenantId);
        return { success: true };
    }

    @Post(':tenantId/sync')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async sync(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.reviews.syncReviews(tenantId) };
    }

    @Get(':tenantId/reviews')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async list(@Param('tenantId') tenantId: string, @Query('unreplied') unreplied?: string) {
        return { success: true, data: await this.reviews.listReviews(tenantId, { unreplied: unreplied === 'true' }) };
    }

    @Get(':tenantId/stats')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async stats(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.reviews.getStats(tenantId) };
    }

    @Post(':tenantId/reviews/:reviewId/generate')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async generate(@Param('tenantId') tenantId: string, @Param('reviewId') reviewId: string) {
        return { success: true, data: await this.reviews.generateReply(tenantId, reviewId) };
    }

    @Post(':tenantId/reviews/:reviewId/reply')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async reply(@Param('tenantId') tenantId: string, @Param('reviewId') reviewId: string, @Body() body: { comment: string }) {
        await this.reviews.postReply(tenantId, reviewId, body.comment);
        return { success: true };
    }
}
