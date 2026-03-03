import { Controller, Post, Body, Param, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { HandoffService } from './handoff.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';

@ApiTags('handoff')
@Controller('handoff')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class HandoffController {
    private readonly logger = new Logger(HandoffController.name);

    constructor(private handoffService: HandoffService) { }

    @Post(':conversationId/complete')
    @ApiOperation({ summary: 'Mark a handoff as complete and return to AI' })
    async completeHandoff(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        await this.handoffService.completeHandoff(tenantId, conversationId);
        return { success: true, message: 'Handoff completed, conversation returned to AI' };
    }

    @Post(':conversationId/status')
    @ApiOperation({ summary: 'Check if a conversation is in handoff' })
    async checkHandoffStatus(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        const isActive = await this.handoffService.isInHandoff(tenantId, conversationId);
        return { success: true, data: { isInHandoff: isActive } };
    }
}
