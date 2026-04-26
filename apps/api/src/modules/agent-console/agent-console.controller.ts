import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AgentConsoleService } from './agent-console.service';
import { CannedResponsesService } from './canned-responses.service';
import { AgentAvailabilityService } from './agent-availability.service';
import { MacrosService } from './macros.service';
import { SnoozeService } from './snooze.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@Controller('agent-console')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class AgentConsoleController {

    constructor(
        private agentConsoleService: AgentConsoleService,
        private cannedResponsesService: CannedResponsesService,
        private availabilityService: AgentAvailabilityService,
        private macrosService: MacrosService,
        private snoozeService: SnoozeService,
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

    // ---- Agent Availability ----

    @Put('status/:userId')
    async updateAgentStatus(
        @Param('userId') userId: string,
        @Body() body: { status: string },
    ) {
        await this.availabilityService.updateStatus(userId, body.status as any);
        return { success: true };
    }

    @Get('agents/:tenantId/available')
    async getAvailableAgents(@Param('tenantId') tenantId: string) {
        const data = await this.availabilityService.getAvailableAgents(tenantId);
        return { success: true, data };
    }

    @Get('agents/:tenantId/status')
    async getAgentsWithStatus(@Param('tenantId') tenantId: string) {
        const data = await this.availabilityService.getAgentsWithStatus(tenantId);
        return { success: true, data };
    }

    // ---- Snooze ----

    @Put('conversation/:tenantId/:conversationId/snooze')
    async snoozeConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { snoozeUntil: string },
    ) {
        await this.snoozeService.snooze(tenantId, conversationId, new Date(body.snoozeUntil));
        return { success: true, message: 'Conversation snoozed' };
    }

    @Put('conversation/:tenantId/:conversationId/unsnooze')
    async unsnoozeConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        await this.snoozeService.unsnooze(tenantId, conversationId);
        return { success: true, message: 'Conversation unsnoozed' };
    }

    // ---- Macros ----

    @Get('macros/:tenantId')
    async getMacros(@Param('tenantId') tenantId: string) {
        const data = await this.macrosService.getMacros(tenantId);
        return { success: true, data };
    }

    @Post('macros/:tenantId')
    async createMacro(@Param('tenantId') tenantId: string, @Body() body: any) {
        const data = await this.macrosService.createMacro(tenantId, body);
        return { success: true, data };
    }

    @Put('macros/:tenantId/:macroId')
    async updateMacro(
        @Param('tenantId') tenantId: string,
        @Param('macroId') macroId: string,
        @Body() body: any,
    ) {
        const data = await this.macrosService.updateMacro(tenantId, macroId, body);
        return { success: true, data };
    }

    @Post('macros/:tenantId/:macroId/execute')
    async executeMacro(
        @Param('tenantId') tenantId: string,
        @Param('macroId') macroId: string,
        @Body() body: { conversationId: string; agentId: string },
    ) {
        const result = await this.macrosService.executeMacro(tenantId, macroId, body.conversationId, body.agentId);
        return { success: true, data: result };
    }

    // ---- Archive & Delete ----

    @Put('conversation/:tenantId/:conversationId/archive')
    async archiveConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { agentId: string },
    ) {
        await this.agentConsoleService.archiveConversation(tenantId, conversationId, body.agentId);
        return { success: true, message: 'Conversation archived' };
    }

    @Delete('conversation/:tenantId/:conversationId')
    async deleteConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        await this.agentConsoleService.deleteConversation(tenantId, conversationId);
        return { success: true, message: 'Conversation deleted' };
    }

    @Delete('conversation/:tenantId/:conversationId/message/:messageId')
    async deleteMessage(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Param('messageId') messageId: string,
    ) {
        await this.agentConsoleService.deleteMessage(tenantId, messageId);
        return { success: true, message: 'Message deleted' };
    }

    @Post('conversations/:tenantId/bulk-archive')
    async bulkArchive(
        @Param('tenantId') tenantId: string,
        @Body() body: { conversationIds: string[] },
    ) {
        await this.agentConsoleService.bulkArchive(tenantId, body.conversationIds);
        return { success: true, message: 'Conversations archived' };
    }

    @Post('conversations/:tenantId/bulk-delete')
    async bulkDelete(
        @Param('tenantId') tenantId: string,
        @Body() body: { conversationIds: string[] },
    ) {
        await this.agentConsoleService.bulkDelete(tenantId, body.conversationIds);
        return { success: true, message: 'Conversations deleted' };
    }
}
