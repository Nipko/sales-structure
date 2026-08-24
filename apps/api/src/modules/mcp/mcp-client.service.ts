import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { ToolDefinition } from '@parallext/shared';
import { prepareSafeHttpsTarget, safeAxiosOptions } from '../../common/utils/safe-outbound-url.util';
import {
    approvedMcpToolNames,
    findMcpApproval,
    McpToolApproval,
    readMcpApprovals,
} from './mcp-tool-approval';
import { MCP_EFFECTS_REQUIRING_CONFIRMATION, ToolEffectDeclaration } from './mcp-approval.types';
import { mutateTenantSettingsBranchAtomic } from '../../common/utils/tenant-settings-branch.util';
import {
    isMaskedSecret,
    TENANT_SECRET_MASK,
    TenantSecretCryptoService,
} from '../../common/crypto/tenant-secret-crypto.service';

export interface McpServerConfig {
    id: string;          // short slug used in tool-name prefix
    name: string;
    url: string;         // Streamable-HTTP MCP endpoint
    authHeader?: string; // e.g. "Bearer xxx" → sent as Authorization
    enabled: boolean;
    /** Runtime-only fail-closed marker; it is never persisted or serialized. */
    _authUnavailable?: boolean;
}

interface DiscoveredTools {
    tools: ToolDefinition[];
    /** registered (prefixed) tool name → { serverId, realName } */
    map: Record<string, { serverId: string; realName: string }>;
}

/**
 * What the agent may actually be offered, separated from what a server exposes.
 * `discovered` is everything the connection reports (inspection); `tools` is the
 * approved subset (execution). Keeping both lets the dashboard show an honest
 * "connected for inspection, not authorised for the AI".
 */
export interface PublishableMcpTools {
    /** Cada tool con el efecto que una persona le revisó, cuando lo hay. */
    tools: (ToolDefinition & { reviewedEffect?: string | null })[];
    discoveredCount: number;
    approvedCount: number;
}

const DISCOVERY_TTL = 300;
const RPC_TIMEOUT = 20000;
const PROTOCOL_VERSION = '2025-03-26';
export const MCP_SECRET_FIELDS = ['authHeader'] as const;
export const MCP_SECRET_FIELD_IDS: Record<typeof MCP_SECRET_FIELDS[number], string> = {
    authHeader: 'auth_header',
};

/**
 * MCP client (T3.20) — lets a tenant connect external MCP servers (open
 * standard) so the agent gains their tools without lock-in. Tools are
 * discovered via JSON-RPC `tools/list` and invoked via `tools/call` over the
 * Streamable-HTTP transport. Registered tool names are namespaced
 * `mcp__{serverId}__{tool}` to avoid collisions with native tools.
 */
@Injectable()
export class McpClientService {
    private readonly logger = new Logger(McpClientService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly http: HttpService,
        private readonly secrets: TenantSecretCryptoService,
    ) {}

    // ── Config (tenant.settings.mcpServers) ──────────────────
    async listServers(tenantId: string): Promise<McpServerConfig[]> {
        const stored = await this.listStoredServers(tenantId);
        const runtime: McpServerConfig[] = [];
        const rewrap = new Map<string, { expected: string; envelope: string }>();

        for (const entry of stored) {
            const server: McpServerConfig = { ...entry };
            if (entry.authHeader) {
                const context = this.secretContext(tenantId, entry.id);
                try {
                    const result = this.secrets.readCompatible(entry.authHeader, context);
                    server.authHeader = result.plaintext;
                    if (result.needsRewrap) {
                        try {
                            rewrap.set(entry.id, {
                                expected: entry.authHeader,
                                envelope: this.secrets.encrypt(result.plaintext, context),
                            });
                        } catch (error: any) {
                            this.logger.warn(`[MCP] no se pudo cifrar ${entry.id}.authHeader: ${error?.code}`);
                        }
                    }
                } catch (error: any) {
                    // A configured credential that cannot be authenticated must
                    // never degrade into an unauthenticated outbound request.
                    delete server.authHeader;
                    server._authUnavailable = true;
                    this.logger.warn(`[MCP] secreto ilegible ${entry.id}.authHeader: ${error?.code || error?.message}`);
                }
            }
            runtime.push(server);
        }

        if (rewrap.size) {
            await this.persistRewrappedHeaders(tenantId, rewrap).catch((error: any) => {
                this.logger.warn(`[MCP] no se pudieron re-cifrar credenciales: ${error?.message}`);
            });
        }
        return runtime;
    }

    private async listStoredServers(tenantId: string): Promise<McpServerConfig[]> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const servers = (tenant?.settings as any)?.mcpServers;
        return Array.isArray(servers) ? servers.map((server) => ({ ...server })) : [];
    }

    async saveServer(tenantId: string, input: { id?: string; name: string; url: string; authHeader?: string; enabled?: boolean }): Promise<McpServerConfig> {
        if (!input.name?.trim() || !input.url?.trim()) throw new BadRequestException('name y url son obligatorios');
        const validatedUrl = (await prepareSafeHttpsTarget(input.url, 'servidor MCP')).url.toString();
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        let server!: McpServerConfig;
        await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'mcpServers',
            (value): McpServerConfig[] => {
                const servers: McpServerConfig[] = Array.isArray(value)
                    ? value.map(entry => ({ ...entry }))
                    : [];
                if (input.id) {
                    const existing = servers.find((entry) => entry.id === input.id);
                    if (!existing) throw new NotFoundException('Servidor MCP no encontrado');
                    const suppliedHeader = input.authHeader !== undefined
                        && !isMaskedSecret(input.authHeader);
                    server = {
                        ...existing,
                        name: input.name,
                        url: validatedUrl,
                        enabled: input.enabled ?? existing.enabled,
                    };
                    server.authHeader = suppliedHeader
                        ? this.encryptNewHeader(tenantId, server.id, input.authHeader)
                        : this.preserveStoredHeader(tenantId, server.id, existing.authHeader);
                    servers[servers.findIndex((entry) => entry.id === input.id)] = server;
                } else {
                    const id = this.slug(input.name, servers.map((entry) => entry.id));
                    server = {
                        id,
                        name: input.name,
                        url: validatedUrl,
                        authHeader: isMaskedSecret(input.authHeader)
                            ? undefined
                            : this.encryptNewHeader(tenantId, id, input.authHeader),
                        enabled: input.enabled ?? true,
                    };
                    servers.push(server);
                }
                return servers;
            },
        );
        await this.invalidateTools(tenantId);
        return { ...server, authHeader: server.authHeader ? TENANT_SECRET_MASK : undefined };
    }

    async deleteServer(tenantId: string, id: string): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) return;
        await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'mcpServers',
            (value): McpServerConfig[] => (Array.isArray(value) ? value : [])
                .filter((server: McpServerConfig) => server.id !== id),
        );
        await this.invalidateTools(tenantId);
    }

    private async invalidateTools(tenantId: string): Promise<void> {
        await this.redis.del(`mcp:tools:${tenantId}`).catch(() => {});
    }

    /** Masked view for the dashboard. */
    async listServersMasked(tenantId: string): Promise<any[]> {
        const servers = await this.listStoredServers(tenantId);
        return servers.map((s) => ({ ...s, authHeader: s.authHeader ? TENANT_SECRET_MASK : undefined }));
    }

    // ── Discovery + invocation ───────────────────────────────
    /** Aggregate tools across enabled servers (cached). Returns ToolDefinitions + resolution map. */
    async listRemoteTools(tenantId: string): Promise<DiscoveredTools> {
        const cacheKey = `mcp:tools:${tenantId}`;
        const cached = await this.redis.getJson<DiscoveredTools>(cacheKey);
        if (cached) return cached;

        const servers = (await this.listServers(tenantId)).filter((s) => s.enabled);
        const tools: ToolDefinition[] = [];
        const map: DiscoveredTools['map'] = {};

        for (const server of servers) {
            try {
                const remote = await this.fetchServerTools(server);
                for (const rt of remote) {
                    const registered = this.registeredName(server.id, rt.name);
                    tools.push({ name: registered, description: `[${server.name}] ${rt.description || rt.name}`.slice(0, 1024), parameters: rt.inputSchema || { type: 'object', properties: {} } });
                    map[registered] = { serverId: server.id, realName: rt.name };
                }
            } catch (e: any) {
                this.logger.warn(`[MCP] tools/list failed for ${server.name}: ${e.message}`);
            }
        }

        const result = { tools, map };
        await this.redis.setJson(cacheKey, result, DISCOVERY_TTL);
        return result;
    }

    /**
     * Tools the agent may be shown this turn.
     *
     * Discovery is not authorisation. Every tool a server reports used to be
     * advertised to the model while the central guard rejected all of them, so
     * the model chased a capability that could never fire. Now only tools with
     * an explicit, reviewed approval are published — which for a tenant that has
     * approved nothing means an empty list, and the agent never mentions them.
     */
    async listPublishableTools(tenantId: string): Promise<PublishableMcpTools> {
        const { tools } = await this.listRemoteTools(tenantId);
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const approved = approvedMcpToolNames(tenant?.settings);
        const approvals = readMcpApprovals(tenant?.settings);
        const effectByName = new Map(approvals.map(a => [
            `mcp__${a.serverId}__${a.toolName}`,
            a.effect,
        ]));
        // El efecto REVISADO viaja con la tool publicada.
        //
        // El nombre de una tool remota no dice nada, así que el contrato la
        // trataba a toda como comprometedora y un perfil bloqueado perdía
        // también sus consultas remotas. Lo único que sabe qué hace es lo que
        // una persona firmó al aprobarla, y eso es lo que se adjunta acá.
        const publishable = tools
            .filter(tool => approved.has(String(tool.name)))
            .map(tool => ({
                ...tool,
                reviewedEffect: effectByName.get(String(tool.name)) ?? null,
            }));
        return {
            tools: publishable,
            discoveredCount: tools.length,
            approvedCount: publishable.length,
        };
    }

    /** The approval record backing one registered tool name, if any. */
    async getApproval(tenantId: string, registeredName: string): Promise<McpToolApproval | null> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        return findMcpApproval(tenant?.settings, registeredName);
    }

    /** Approvals as stored, for the dashboard's review screen. */
    async listApprovals(tenantId: string): Promise<McpToolApproval[]> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        return readMcpApprovals(tenant?.settings);
    }

    /**
     * Record or revoke a human's approval of one remote tool.
     *
     * Approving a non-read effect without confirmation is rejected outright
     * rather than stored and quietly ignored: an owner who ticks "let the AI
     * charge my customers" and sees it saved would reasonably believe it works.
     */
    async setApproval(
        tenantId: string,
        input: {
            serverId: string;
            toolName: string;
            effect: ToolEffectDeclaration;
            requiresConfirmation: boolean;
            requiresHumanApproval?: boolean;
            approvedBy: string;
            notes?: string;
            revoke?: boolean;
        },
    ): Promise<McpToolApproval[]> {
        const serverId = String(input?.serverId || '').trim();
        const toolName = String(input?.toolName || '').trim();
        if (!serverId || !toolName) throw new BadRequestException('serverId y toolName son obligatorios');

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        if (input.revoke) {
            const revoked = await mutateTenantSettingsBranchAtomic(
                this.prisma,
                tenantId,
                'mcpToolApprovals',
                (value): McpToolApproval[] => readMcpApprovals({ mcpToolApprovals: value })
                    .filter(entry => !(entry.serverId === serverId && entry.toolName === toolName)),
            );
            await this.invalidateTools(tenantId);
            return revoked;
        }

        const servers = await this.listServers(tenantId);
        if (!servers.some(server => server.id === serverId)) {
            throw new NotFoundException('Servidor MCP no encontrado');
        }
        const effect = input.effect;
        if (!effect) throw new BadRequestException('effect es obligatorio');
        if (MCP_EFFECTS_REQUIRING_CONFIRMATION.includes(effect) && input.requiresConfirmation !== true) {
            throw new BadRequestException(
                'Una herramienta que escribe, cobra, notifica o es irreversible necesita confirmación del cliente.',
            );
        }
        if (!String(input.approvedBy || '').trim()) {
            throw new BadRequestException('approvedBy es obligatorio para auditar la aprobación');
        }

        const approval: McpToolApproval = {
            serverId,
            toolName,
            effect,
            requiresConfirmation: input.requiresConfirmation === true,
            requiresHumanApproval: input.requiresHumanApproval === true,
            approvedBy: String(input.approvedBy).slice(0, 200),
            approvedAt: new Date().toISOString(),
            notes: input.notes ? String(input.notes).slice(0, 1000) : undefined,
        };
        const next = await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'mcpToolApprovals',
            (value): McpToolApproval[] => [
                ...readMcpApprovals({ mcpToolApprovals: value })
                    .filter(entry => !(entry.serverId === serverId && entry.toolName === toolName)),
                approval,
            ],
        );
        await this.invalidateTools(tenantId);
        return next;
    }

    async callRemoteTool(tenantId: string, registeredName: string, args: Record<string, any>): Promise<any> {
        const { map } = await this.listRemoteTools(tenantId);
        const entry = map[registeredName];
        if (!entry) return { error: 'Herramienta MCP no encontrada' };
        const server = (await this.listServers(tenantId)).find((s) => s.id === entry.serverId);
        if (!server) return { error: 'Servidor MCP no encontrado' };
        try {
            const res = await this.withSession(server, (sessionId) =>
                this.rpc(server, 'tools/call', { name: entry.realName, arguments: args || {} }, sessionId),
            );
            const content = res?.content;
            if (Array.isArray(content)) {
                const text = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
                return { result: text || content, isError: !!res.isError };
            }
            return res;
        } catch (e: any) {
            this.logger.warn(`[MCP] tools/call ${registeredName} failed: ${e.message}`);
            return { error: 'La herramienta MCP falló' };
        }
    }

    async testServer(tenantId: string, id: string): Promise<{ ok: boolean; toolCount?: number; message?: string }> {
        const server = (await this.listServers(tenantId)).find((s) => s.id === id);
        if (!server) return { ok: false, message: 'No encontrado' };
        try {
            const tools = await this.fetchServerTools(server);
            return { ok: true, toolCount: tools.length };
        } catch (e: any) {
            return { ok: false, message: e?.response?.status ? `HTTP ${e.response.status}` : e.message };
        }
    }

    // ── JSON-RPC over Streamable HTTP ────────────────────────
    private async fetchServerTools(server: McpServerConfig): Promise<Array<{ name: string; description?: string; inputSchema?: any }>> {
        return this.withSession(server, async (sessionId) => {
            const res = await this.rpc(server, 'tools/list', {}, sessionId);
            return res?.tools || [];
        });
    }

    /** Initialize → capture session id → run fn → (best-effort) returns fn result. */
    private async withSession<T>(server: McpServerConfig, fn: (sessionId?: string) => Promise<T>): Promise<T> {
        const initRes = await this.postServer(
            server,
            this.envelope('initialize', {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: 'parallly', version: '1.0' },
            }),
            this.headers(server),
        );
        const sessionId = initRes.headers?.['mcp-session-id'] || initRes.headers?.['Mcp-Session-Id'];
        // Notify initialized (best effort; ignore failures)
        try {
            await this.postServer(
                server,
                { jsonrpc: '2.0', method: 'notifications/initialized' },
                this.headers(server, sessionId),
            );
        } catch { /* noop */ }
        return fn(sessionId);
    }

    private async rpc(server: McpServerConfig, method: string, params: any, sessionId?: string): Promise<any> {
        const res = await this.postServer(server, this.envelope(method, params), this.headers(server, sessionId));
        const data = this.parseResponse(res.data);
        if (data?.error) throw new Error(data.error.message || 'JSON-RPC error');
        return data?.result;
    }

    private async postServer(server: McpServerConfig, body: any, headers: Record<string, string>) {
        // Resolve and pin on every outbound call. This also protects configs
        // created before URL validation was introduced.
        const target = await prepareSafeHttpsTarget(server.url, 'servidor MCP');
        return this.http.axiosRef.post(target.url.toString(), body, {
            ...safeAxiosOptions(target, RPC_TIMEOUT),
            headers,
            validateStatus: () => true,
        });
    }

    private envelope(method: string, params: any) {
        return { jsonrpc: '2.0', id: Math.floor(Date.now() % 1e9), method, params };
    }

    private headers(server: McpServerConfig, sessionId?: string): Record<string, string> {
        if (server._authUnavailable) {
            throw new Error('La credencial MCP no se puede leer');
        }
        const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
        if (server.authHeader) h['Authorization'] = server.authHeader;
        if (sessionId) h['Mcp-Session-Id'] = sessionId;
        return h;
    }

    /** Streamable HTTP may return JSON or an SSE stream — extract the JSON-RPC payload from either. */
    private parseResponse(data: any): any {
        if (data == null) return null;
        if (typeof data === 'object') return data;
        if (typeof data === 'string') {
            // SSE framing: lines like "data: {json}"
            const dataLines = data.split('\n').filter((l) => l.startsWith('data:'));
            if (dataLines.length) {
                try { return JSON.parse(dataLines[dataLines.length - 1].slice(5).trim()); } catch { /* fall through */ }
            }
            try { return JSON.parse(data); } catch { return null; }
        }
        return null;
    }

    private registeredName(serverId: string, tool: string): string {
        return `mcp__${serverId}__${tool}`.slice(0, 64);
    }

    private slug(name: string, taken: string[]): string {
        const base = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'srv';
        let id = base;
        let n = 1;
        while (taken.includes(id)) id = `${base}${n++}`;
        return id;
    }

    private secretContext(tenantId: string, serverId: string) {
        return {
            tenantId,
            scope: 'mcp' as const,
            provider: String(serverId || '').toLowerCase(),
            field: MCP_SECRET_FIELD_IDS.authHeader,
        };
    }

    private encryptNewHeader(tenantId: string, serverId: string, value: unknown): string | undefined {
        if (value === undefined || value === null || value === '') return undefined;
        const header = String(value);
        if (this.secrets.isEnvelope(header)) {
            throw new BadRequestException('authHeader no puede contener un sobre de credencial');
        }
        return this.secrets.encrypt(header, this.secretContext(tenantId, serverId));
    }

    private preserveStoredHeader(
        tenantId: string,
        serverId: string,
        value: unknown,
    ): string | undefined {
        if (value === undefined || value === null || value === '') return undefined;
        const context = this.secretContext(tenantId, serverId);
        const result = this.secrets.readCompatible(value, context);
        return result.needsRewrap
            ? this.secrets.encrypt(result.plaintext, context)
            : String(value);
    }

    private async persistRewrappedHeaders(
        tenantId: string,
        rewrap: Map<string, { expected: string; envelope: string }>,
    ): Promise<void> {
        await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'mcpServers',
            (value): McpServerConfig[] => (Array.isArray(value) ? value : []).map((entry: McpServerConfig) => {
                const replacement = rewrap.get(entry.id);
                return replacement && entry.authHeader === replacement.expected
                    ? { ...entry, authHeader: replacement.envelope }
                    : entry;
            }),
        );
    }
}
