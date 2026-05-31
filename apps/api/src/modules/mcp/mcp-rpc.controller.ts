import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { PublicApiKeyService } from '../public-api/public-api-key.service';
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
        private readonly apiKeyService: PublicApiKeyService,
        private readonly mcpServer: McpServerService,
    ) {}

    @Post('rpc')
    async rpc(@Headers('x-api-key') apiKey: string, @Body() body: any) {
        if (!apiKey) throw new UnauthorizedException('X-API-Key header required');
        const keyData = await this.apiKeyService.validateKey(apiKey);
        if (!keyData) throw new UnauthorizedException('Invalid API key');
        return this.mcpServer.handle(keyData.tenantId, body);
    }
}
