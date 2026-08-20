import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { McpClientService } from './mcp-client.service';

/**
 * Dashboard config for external MCP servers the agent consumes (T3.20).
 */
@Controller('mcp')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class McpController {
    constructor(private readonly mcpClient: McpClientService) {}

    @Get(':tenantId/servers')
    @Roles('super_admin', 'tenant_admin')
    async list(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.mcpClient.listServersMasked(tenantId) };
    }

    @Post(':tenantId/servers')
    @Roles('super_admin', 'tenant_admin')
    async save(@Param('tenantId') tenantId: string, @Body() body: any) {
        const server = await this.mcpClient.saveServer(tenantId, body);
        return { success: true, data: { ...server, authHeader: server.authHeader ? '***' : undefined } };
    }

    @Delete(':tenantId/servers/:id')
    @Roles('super_admin', 'tenant_admin')
    async remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        await this.mcpClient.deleteServer(tenantId, id);
        return { success: true };
    }

    @Post(':tenantId/servers/:id/test')
    @Roles('super_admin', 'tenant_admin')
    async test(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return { success: true, data: await this.mcpClient.testServer(tenantId, id) };
    }

    /**
     * Every tool the connected servers expose, each labelled with whether the
     * agent may actually run it.
     *
     * The dashboard used to show this list as the agent's capabilities while
     * the runtime refused all of them. `authorizedForAgent` is what makes
     * "connected for inspection, not authorised for the AI" visible instead of
     * something the owner discovers from a customer complaint.
     */
    @Get(':tenantId/tools')
    @Roles('super_admin', 'tenant_admin')
    async tools(@Param('tenantId') tenantId: string) {
        const [{ tools }, approvals] = await Promise.all([
            this.mcpClient.listRemoteTools(tenantId),
            this.mcpClient.listApprovals(tenantId),
        ]);
        const byName = new Map(
            approvals.map((approval) => [`mcp__${approval.serverId}__${approval.toolName}`, approval]),
        );
        const data = tools.map((t) => {
            const approval = byName.get(String(t.name));
            const authorized = !!approval && (approval.effect === 'read' || approval.requiresConfirmation);
            return {
                name: t.name,
                description: t.description,
                authorizedForAgent: authorized,
                effect: approval?.effect ?? null,
                requiresConfirmation: approval?.requiresConfirmation ?? null,
                requiresHumanApproval: approval?.requiresHumanApproval ?? null,
                approvedBy: approval?.approvedBy ?? null,
                approvedAt: approval?.approvedAt ?? null,
            };
        });
        return {
            success: true,
            data,
            meta: {
                discovered: data.length,
                authorizedForAgent: data.filter((t) => t.authorizedForAgent).length,
            },
        };
    }

    @Get(':tenantId/tool-approvals')
    @Roles('super_admin', 'tenant_admin')
    async listApprovals(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.mcpClient.listApprovals(tenantId) };
    }

    /**
     * Record or revoke the human review that authorises one remote tool.
     * `approvedBy` comes from the authenticated user, never from the body: an
     * audit trail a caller can forge is not an audit trail.
     */
    @Put(':tenantId/tool-approvals')
    @Roles('super_admin', 'tenant_admin')
    async setApproval(@Param('tenantId') tenantId: string, @Body() body: any, @Req() req: any) {
        const approvedBy = req?.user?.email || req?.user?.id || 'unknown';
        const data = await this.mcpClient.setApproval(tenantId, { ...body, approvedBy });
        return { success: true, data };
    }
}
