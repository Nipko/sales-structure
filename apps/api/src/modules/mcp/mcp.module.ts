import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { PublicApiModule } from '../public-api/public-api.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { McpClientService } from './mcp-client.service';
import { McpServerService } from './mcp-server.service';
import { McpController } from './mcp.controller';
import { McpRpcController } from './mcp-rpc.controller';

/**
 * MCP native (T3.20). Two directions over the open Model Context Protocol:
 *  - Consume: McpClientService lets the agent use tools from external MCP servers.
 *  - Expose:  McpServerService serves the platform's tools to external MCP clients.
 * forwardRef(ConversationsModule) breaks the cycle (Conversations consumes the
 * client; the server reuses the AI tool executor that lives in Conversations).
 */
@Module({
    imports: [
        HttpModule,
        PrismaModule,
        RedisModule,
        PublicApiModule,
        forwardRef(() => ConversationsModule),
    ],
    providers: [McpClientService, McpServerService],
    controllers: [McpController, McpRpcController],
    exports: [McpClientService],
})
export class McpModule {}
