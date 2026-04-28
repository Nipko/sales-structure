import { Controller, Get, Post, Param, Query, Body, Req, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IdentityService } from './identity.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@ApiTags('identity')
@Controller('identity')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class IdentityController {
    private readonly logger = new Logger(IdentityController.name);

    constructor(private readonly identityService: IdentityService) {}

    @Get(':tenantId/suggestions')
    @ApiOperation({ summary: 'List merge suggestions for a tenant' })
    async getSuggestions(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
    ) {
        const data = await this.identityService.getMergeSuggestions(tenantId, status || 'pending');
        return { success: true, data };
    }

    @Post(':tenantId/suggestions/:suggestionId/approve')
    @ApiOperation({ summary: 'Approve a merge suggestion' })
    async approveMerge(
        @Param('tenantId') tenantId: string,
        @Param('suggestionId') suggestionId: string,
        @Req() req: any,
    ) {
        const userId = req.user?.sub || req.user?.id;
        await this.identityService.approveMerge(tenantId, suggestionId, userId);
        return { success: true, message: 'Merge approved' };
    }

    @Post(':tenantId/suggestions/:suggestionId/reject')
    @ApiOperation({ summary: 'Reject a merge suggestion' })
    async rejectMerge(
        @Param('tenantId') tenantId: string,
        @Param('suggestionId') suggestionId: string,
        @Req() req: any,
    ) {
        const userId = req.user?.sub || req.user?.id;
        await this.identityService.rejectMerge(tenantId, suggestionId, userId);
        return { success: true, message: 'Merge rejected' };
    }

    @Get(':tenantId/profiles/:profileId')
    @ApiOperation({ summary: 'Get unified customer profile with all linked contacts' })
    async getProfile(
        @Param('tenantId') tenantId: string,
        @Param('profileId') profileId: string,
    ) {
        const data = await this.identityService.getCustomerProfile(tenantId, profileId);
        return { success: true, data };
    }

    @Post(':tenantId/manual-merge')
    @ApiOperation({ summary: 'Manually merge two contacts into one unified profile' })
    async manualMerge(
        @Param('tenantId') tenantId: string,
        @Body() body: { contactIdA: string; contactIdB: string },
        @Req() req: any,
    ) {
        const userId = req.user?.sub || req.user?.id;
        await this.identityService.manualMerge(tenantId, body.contactIdA, body.contactIdB, userId);
        return { success: true, message: 'Contacts merged' };
    }
}
