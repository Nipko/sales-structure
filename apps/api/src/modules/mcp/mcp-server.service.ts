import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import type { ToolDefinition } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { CATALOG_TOOLS, OFFER_TOOL } from '../conversations/tools/catalog-tools';
import { FAQ_TOOL, POLICY_TOOL, KB_TOOL } from '../conversations/tools/knowledge-tools';
import { RECOMMEND_PRODUCTS_TOOL } from '../conversations/tools/ecommerce-tools';
import {
    GET_RESTAURANT_MENU_TOOL, GET_FITNESS_SCHEDULE_TOOL, LIST_CLINIC_SERVICES_TOOL,
} from '../conversations/tools/vertical-integration-tools';

const PROTOCOL_VERSION = '2025-03-26';

/**
 * Curated, SAFE read-oriented subset of the platform's agent tools exposed over
 * MCP. Write/booking/discount tools are intentionally excluded — an external MCP
 * client must not be able to create appointments, orders or discounts.
 */
const EXPOSED_TOOLS: ToolDefinition[] = [
    ...CATALOG_TOOLS,
    OFFER_TOOL,
    FAQ_TOOL,
    POLICY_TOOL,
    KB_TOOL,
    RECOMMEND_PRODUCTS_TOOL,
    GET_RESTAURANT_MENU_TOOL,
    GET_FITNESS_SCHEDULE_TOOL,
    LIST_CLINIC_SERVICES_TOOL,
];
const EXPOSED_NAMES = new Set(EXPOSED_TOOLS.map((t) => t.name));

interface JsonRpcRequest { jsonrpc: string; id?: any; method: string; params?: any }

/**
 * MCP server (T3.20) — exposes the platform's tools to external MCP clients via
 * JSON-RPC over Streamable HTTP. Authenticated per-tenant by the public API key.
 * Maps tools/call to the existing AIToolExecutorService (open standard, no lock-in).
 */
@Injectable()
export class McpServerService {
    private readonly logger = new Logger(McpServerService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(forwardRef(() => AIToolExecutorService))
        private readonly toolExecutor: AIToolExecutorService,
    ) {}

    /** Handle a single or batched JSON-RPC request. Returns the response payload (or null for notifications). */
    async handle(tenantId: string, body: any): Promise<any> {
        if (Array.isArray(body)) {
            const out = await Promise.all(body.map((r) => this.handleOne(tenantId, r)));
            return out.filter((r) => r !== null);
        }
        return this.handleOne(tenantId, body);
    }

    private async handleOne(tenantId: string, req: JsonRpcRequest): Promise<any> {
        const id = req?.id;
        const method = req?.method;

        // Notifications (no id) get no response.
        if (id === undefined || id === null) {
            return null;
        }

        try {
            switch (method) {
                case 'initialize':
                    return this.ok(id, {
                        protocolVersion: PROTOCOL_VERSION,
                        capabilities: { tools: { listChanged: false } },
                        serverInfo: { name: 'Parallly', version: '1.0.0' },
                    });
                case 'ping':
                    return this.ok(id, {});
                case 'tools/list':
                    return this.ok(id, {
                        tools: EXPOSED_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
                    });
                case 'tools/call':
                    return this.ok(id, await this.callTool(tenantId, req.params));
                default:
                    return this.err(id, -32601, `Method not found: ${method}`);
            }
        } catch (e: any) {
            this.logger.warn(`[MCP server] ${method} failed: ${e.message}`);
            return this.err(id, -32603, e.message || 'Internal error');
        }
    }

    private async callTool(tenantId: string, params: any): Promise<any> {
        const name = params?.name;
        const args = params?.arguments || {};
        if (!name || !EXPOSED_NAMES.has(name)) {
            return { content: [{ type: 'text', text: `Tool not available: ${name}` }], isError: true };
        }
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        // El servidor MCP expone una lista curada de lecturas y esa lista ES la
        // autoridad: nada fuera de `EXPOSED_TOOLS` puede ejecutarse por acá,
        // aunque el ejecutor conozca la tool. Antes se llamaba sin autoridad
        // alguna y la única defensa era el `if` de arriba.
        const result = await this.toolExecutor.execute(
            schemaName, tenantId, '', name, args, undefined,
            {
                authority: {
                    source: 'mcp_server',
                    allowedTools: [...EXPOSED_NAMES],
                    resolvedAt: new Date().toISOString(),
                },
            },
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false };
    }

    private ok(id: any, result: any) {
        return { jsonrpc: '2.0', id, result };
    }
    private err(id: any, code: number, message: string) {
        return { jsonrpc: '2.0', id, error: { code, message } };
    }
}
