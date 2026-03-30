import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    Logger,
    Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { CopilotService, CopilotChatRequest } from './copilot.service';

@ApiTags('copilot')
@Controller('copilot')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class CopilotController {
    private readonly logger = new Logger(CopilotController.name);

    constructor(private readonly copilotService: CopilotService) {}

    // ─── Platform Copilot Chat (existing) ───────────────────────────────────

    @Post('chat')
    @ApiOperation({ summary: 'Platform copilot chat (general assistant)' })
    async chat(
        @Body() body: CopilotChatRequest,
        @Req() req: any,
    ) {
        this.logger.log(`Copilot chat from user ${body.context.userName} on ${body.context.page}`);
        return this.copilotService.chat(body);
    }

    // ─── Conversation Copilot Endpoints ─────────────────────────────────────

    @Get(':conversationId/suggestions')
    @ApiOperation({ summary: 'Get 3 AI-suggested replies for a conversation' })
    async getSuggestions(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        this.logger.log(`Suggestions requested for conversation ${conversationId}`);
        const suggestions = await this.copilotService.getSuggestions(tenantId, conversationId);
        return { success: true, data: suggestions };
    }

    @Get(':conversationId/summary')
    @ApiOperation({ summary: 'Get AI-generated conversation summary' })
    async getSummary(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        this.logger.log(`Summary requested for conversation ${conversationId}`);
        const summary = await this.copilotService.getSummary(tenantId, conversationId);
        return { success: true, data: summary };
    }

    @Get(':conversationId/intent')
    @ApiOperation({ summary: 'Detect customer intent from conversation' })
    async detectIntent(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        this.logger.log(`Intent detection requested for conversation ${conversationId}`);
        const intent = await this.copilotService.detectIntent(tenantId, conversationId);
        return { success: true, data: intent };
    }

    @Post(':conversationId/ask')
    @ApiOperation({ summary: 'Agent asks Copilot a question about the conversation' })
    async askCopilot(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { query: string },
    ) {
        this.logger.log(`Agent asking copilot about conversation ${conversationId}: "${body.query}"`);
        const answer = await this.copilotService.getContextualHelp(
            tenantId,
            conversationId,
            body.query,
        );
        return { success: true, data: answer };
    }
}
