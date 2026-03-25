import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AgentConsoleService } from './agent-console.service';
import { CannedResponsesService } from './canned-responses.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@Controller('agent-console')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class AgentConsoleController {

    constructor(
        private agentConsoleService: AgentConsoleService,
        private cannedResponsesService: CannedResponsesService,
    ) { }

    // ---- Inbox ----

    @Get('inbox/:tenantId')
    async getInbox(
        @Param('tenantId') tenantId: string,
        @Query('agentId') agentId: string,
        @Query('filter') filter: 'all' | 'mine' | 'unassigned' | 'handoff' = 'all',
    ) {
        const inbox = await this.agentConsoleService.getInbox(tenantId, agentId, filter);
        return { success: true, data: inbox };
    }

    // ---- Conversation ----

    @Get('conversation/:tenantId/:conversationId')
    async getConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        const conversation = await this.agentConsoleService.getConversation(tenantId, conversationId);
        return { success: true, data: conversation };
    }

    @Post('conversation/:tenantId/:conversationId/message')
    async sendMessage(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { agentId: string; content: string; type?: string },
    ) {
        const message = await this.agentConsoleService.sendAgentMessage(
            tenantId,
            conversationId,
            body.agentId,
            body.content,
            body.type,
        );
        return { success: true, data: message };
    }

    @Put('conversation/:tenantId/:conversationId/assign')
    async assignConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { agentId: string },
    ) {
        await this.agentConsoleService.assignConversation(tenantId, conversationId, body.agentId);
        return { success: true, message: 'Conversation assigned' };
    }

    @Put('conversation/:tenantId/:conversationId/resolve')
    async resolveConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { agentId: string },
    ) {
        await this.agentConsoleService.resolveConversation(tenantId, conversationId, body.agentId);
        return { success: true, message: 'Conversation resolved' };
    }

    @Post('conversation/:tenantId/:conversationId/note')
    async addNote(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { agentId: string; content: string },
    ) {
        const note = await this.agentConsoleService.addNote(tenantId, conversationId, body.agentId, body.content);
        return { success: true, data: note };
    }

    @Get('conversation/:tenantId/:conversationId/suggest')
    async getAISuggestion(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        const suggestion = await this.agentConsoleService.getAISuggestion(tenantId, conversationId);
        return { success: true, data: { suggestion } };
    }

    // ---- Agent Stats ----

    @Get('stats/:tenantId/:agentId')
    async getAgentStats(
        @Param('tenantId') tenantId: string,
        @Param('agentId') agentId: string,
    ) {
        const stats = await this.agentConsoleService.getAgentStats(tenantId, agentId);
        return { success: true, data: stats };
    }

    // ---- Canned Responses ----

    @Get('canned/:tenantId')
    async getCannedResponses(@Param('tenantId') tenantId: string) {
        const responses = await this.cannedResponsesService.getAll(tenantId);
        return { success: true, data: responses };
    }

    @Post('canned/:tenantId')
    async createCannedResponse(
        @Param('tenantId') tenantId: string,
        @Body() body: { shortcode: string; title: string; content: string; category?: string },
    ) {
        const response = await this.cannedResponsesService.create(tenantId, body);
        return { success: true, data: response };
    }

    @Put('canned/:tenantId/:id')
    async updateCannedResponse(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: { shortcode?: string; title?: string; content?: string; category?: string },
    ) {
        await this.cannedResponsesService.update(tenantId, id, body);
        return { success: true, message: 'Canned response updated' };
    }
}
