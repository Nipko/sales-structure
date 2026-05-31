import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
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

    @Get(':tenantId/tools')
    @Roles('super_admin', 'tenant_admin')
    async tools(@Param('tenantId') tenantId: string) {
        const { tools } = await this.mcpClient.listRemoteTools(tenantId);
        return { success: true, data: tools.map((t) => ({ name: t.name, description: t.description })) };
    }
}
