import { Controller, Get, Post, Body, Param, UseGuards, Logger, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConversationsService } from './conversations.service';
import { PreChatService } from './pre-chat.service';
import { NormalizedMessage } from '@parallext/shared';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';

@ApiTags('conversations')
@Controller('conversations')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class ConversationsController {
    private readonly logger = new Logger(ConversationsController.name);

    constructor(
        private conversationsService: ConversationsService,
        private preChatService: PreChatService,
    ) { }

    @Get('prechat-form/:tenantId')
    @ApiOperation({ summary: 'Get active pre-chat form for a tenant' })
    async getPrechatForm(@Param('tenantId') tenantId: string) {
        const form = await this.preChatService.getActiveForm(tenantId);
        return { success: true, data: form };
    }

    @Post('prechat-form/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Save pre-chat form configuration' })
    async savePrechatForm(
        @Param('tenantId') tenantId: string,
        @Body() body: { is_active: boolean; greeting_message?: string; fields: any[] },
    ) {
        const form = await this.preChatService.saveForm(tenantId, body);
        return { success: true, data: form };
    }

    @Post('test-message')
    @ApiOperation({ summary: 'Simulate an inbound message for testing' })
    async simulateMessage(
        @CurrentTenant() tenantId: string,
        @Body() body: { text: string; contactId: string; channelType: 'whatsapp' | 'instagram' }
    ) {
        if (process.env.NODE_ENV === 'production') {
            throw new ForbiddenException('This endpoint is disabled in production');
        }

        const mockMsg: NormalizedMessage = {
            id: 'mock-' + Date.now(),
            tenantId,
            channelType: body.channelType,
            contactId: body.contactId,
            channelAccountId: 'mock-account',
            conversationId: '',
            direction: 'inbound',
            content: { type: 'text', text: body.text },
            timestamp: new Date(),
            status: 'pending',
            metadata: {}
        };

        // Process asynchronously (do not await) to simulate webhook behavior
        this.conversationsService.processIncomingMessage(mockMsg).catch(err => {
            this.logger.error(`Error in simulated message: ${err}`);
        });

        return { success: true, message: 'Simulated message processing started' };
    }
}
