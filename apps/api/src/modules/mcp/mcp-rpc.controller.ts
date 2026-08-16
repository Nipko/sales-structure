import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { PublicApiGuard } from '../public-api/guards/public-api.guard';
import { McpServerService } from './mcp-server.service';

/**
 * MCP server endpoint (T3.20) — exposes the platform's tools to external MCP
 * clients via JSON-RPC over Streamable HTTP. Authenticated with the tenant's
 * public API key (X-API-Key). The tenant is derived from the key.
 *
 * POST /api/v1/mcp/rpc
 */
@Controller('mcp')
export class McpRpcController {
    constructor(
        private readonly mcpServer: McpServerService,
    ) {}

    @Post('rpc')
    @UseGuards(PublicApiGuard)
    async rpc(@Req() req: any, @Body() body: any) {
        // PublicApiGuard authenticates and resolves tenantId before the global
        // subscription interceptor runs, so locked tenants cannot use MCP.
        return this.mcpServer.handle(req.tenantId, body);
    }
}
