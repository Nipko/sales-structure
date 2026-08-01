import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AgentConsoleService } from './agent-console.service';
import { CannedResponsesService } from './canned-responses.service';
import { AgentAvailabilityService } from './agent-availability.service';
import { MacrosService } from './macros.service';
import { SnoozeService } from './snooze.service';
import { ArchiveMaintenanceService } from '../offboarding/archive-maintenance.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
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
        private archiveMaintenanceService: ArchiveMaintenanceService,
    ) { }

    // ---- Inbox ----

    @Get('inbox/:tenantId')
    async getInbox(
        @Param('tenantId') tenantId: string,
        @Query('agentId') agentId: string,
        @Query('filter') filter: 'all' | 'mine' | 'unassigned' | 'handoff' | 'resolved' | 'ai' = 'all',
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const inbox = await this.agentConsoleService.getInbox(
            tenantId, agentId, filter,
            limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50,
            offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0,
        );
        return { success: true, data: inbox, hasMore: (inbox as any).__hasMore ?? false };
    }

    @Post('conversation/:tenantId/:conversationId/reopen')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async reopenConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        await this.agentConsoleService.reopenConversation(tenantId, conversationId);
        return { success: true };
    }

    // ---- Conversation ----

    @Get('conversation/:tenantId/:conversationId')
    async getConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Query('limit') limit?: string,
        @Query('before') before?: string,
    ) {
        const conversation = await this.agentConsoleService.getConversation(
            tenantId, conversationId,
            limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50,
            before || undefined,
        );
        return { success: true, data: conversation };
    }

    @Get('conversation/:tenantId/:conversationId/archives')
    async getArchivedMessages(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        const archive = await this.archiveMaintenanceService.getArchivedMessages(tenantId, conversationId);
        return { success: true, data: archive };
    }

    @Post('conversation/:tenantId/:conversationId/message')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async sendMessage(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { agentId: string; content: string; type?: string; mediaUrl?: string; caption?: string; filename?: string },
    ) {
        const message = await this.agentConsoleService.sendAgentMessage(
            tenantId,
            conversationId,
            body.agentId,
            body.content,
            body.type,
            body.mediaUrl,
            body.caption,
            body.filename,
        );
        return { success: true, data: message };
    }

    @Put('conversation/:tenantId/:conversationId/assign')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async assignConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { agentId: string },
    ) {
        await this.agentConsoleService.assignConversation(tenantId, conversationId, body.agentId);
        return { success: true, message: 'Conversation assigned' };
    }

    @Put('conversation/:tenantId/:conversationId/resolve')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async resolveConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { agentId: string },
    ) {
        await this.agentConsoleService.resolveConversation(tenantId, conversationId, body.agentId);
        return { success: true, message: 'Conversation resolved' };
    }

    @Put('conversation/:tenantId/:conversationId/return-to-ai')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async returnToAI(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        await this.agentConsoleService.returnToAI(tenantId, conversationId);
        return { success: true, message: 'Conversation returned to AI' };
    }

    @Post('conversation/:tenantId/:conversationId/note')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
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

    // ---- AI Utilities ----

    /** Translate any text to the target language using the LLM router. */
    @Post('translate/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async translateText(
        @Param('tenantId') tenantId: string,
        @Body() body: { text: string; targetLanguage?: string },
    ) {
        const translation = await this.agentConsoleService.translateText(
            tenantId, body.text, body.targetLanguage || 'es',
        );
        return { success: true, data: { translation } };
    }

    /** Scan a business card image (base64) and extract contact fields. */
    @Post('scan-card/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async scanBusinessCard(
        @Param('tenantId') tenantId: string,
        @Body() body: { imageBase64: string; mimeType?: string },
    ) {
        const contact = await this.agentConsoleService.scanBusinessCard(
            tenantId, body.imageBase64, body.mimeType || 'image/jpeg',
        );
        return { success: true, data: contact };
    }

    /** Suggest the single next best sales action for a conversation (AI coach). */
    @Get('conversation/:tenantId/:conversationId/next-action')
    async nextBestAction(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        const action = await this.agentConsoleService.nextBestAction(tenantId, conversationId);
        return { success: true, data: { action } };
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
    @Roles('tenant_admin', 'tenant_supervisor')
    async createCannedResponse(
        @Param('tenantId') tenantId: string,
        @Body() body: { shortcode: string; title: string; content: string; category?: string },
    ) {
        const response = await this.cannedResponsesService.create(tenantId, body);
        return { success: true, data: response };
    }

    @Put('canned/:tenantId/:id')
    @Roles('tenant_admin', 'tenant_supervisor')
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
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
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
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async snoozeConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { snoozeUntil: string },
    ) {
        await this.snoozeService.snooze(tenantId, conversationId, new Date(body.snoozeUntil));
        return { success: true, message: 'Conversation snoozed' };
    }

    @Put('conversation/:tenantId/:conversationId/unsnooze')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
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
    @Roles('tenant_admin', 'tenant_supervisor')
    async createMacro(@Param('tenantId') tenantId: string, @Body() body: any) {
        const data = await this.macrosService.createMacro(tenantId, body);
        return { success: true, data };
    }

    @Put('macros/:tenantId/:macroId')
    @Roles('tenant_admin', 'tenant_supervisor')
    async updateMacro(
        @Param('tenantId') tenantId: string,
        @Param('macroId') macroId: string,
        @Body() body: any,
    ) {
        const data = await this.macrosService.updateMacro(tenantId, macroId, body);
        return { success: true, data };
    }

    @Post('macros/:tenantId/:macroId/execute')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
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
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async archiveConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { agentId: string },
    ) {
        await this.agentConsoleService.archiveConversation(tenantId, conversationId, body.agentId);
        return { success: true, message: 'Conversation archived' };
    }

    @Delete('conversation/:tenantId/:conversationId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async deleteConversation(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        await this.agentConsoleService.deleteConversation(tenantId, conversationId);
        return { success: true, message: 'Conversation deleted' };
    }

    @Delete('conversation/:tenantId/:conversationId/message/:messageId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async deleteMessage(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Param('messageId') messageId: string,
    ) {
        await this.agentConsoleService.deleteMessage(tenantId, messageId);
        return { success: true, message: 'Message deleted' };
    }

    @Post('conversations/:tenantId/bulk-archive')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async bulkArchive(
        @Param('tenantId') tenantId: string,
        @Body() body: { conversationIds: string[] },
    ) {
        await this.agentConsoleService.bulkArchive(tenantId, body.conversationIds);
        return { success: true, message: 'Conversations archived' };
    }

    @Post('conversations/:tenantId/bulk-delete')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async bulkDelete(
        @Param('tenantId') tenantId: string,
        @Body() body: { conversationIds: string[] },
    ) {
        await this.agentConsoleService.bulkDelete(tenantId, body.conversationIds);
        return { success: true, message: 'Conversations deleted' };
    }
}
