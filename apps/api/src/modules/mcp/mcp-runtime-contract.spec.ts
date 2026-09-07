import { McpClientService } from './mcp-client.service';
import { bindMcpArguments, hasExecutableMcpReview, mcpDefinitionHash, mcpRegisteredName, type McpToolApproval } from './mcp-tool-approval';
import { reviewedMcpPolicy } from './mcp-execution-policy';
import { CORE_PREREQUISITES } from '../conversations/tool-task-dependencies';
import { STATIC_TOOL_NAMES } from '../conversations/tool-policy-registry';

describe('reviewed MCP runtime contract', () => {
    const server = { id: 'erp', name: 'ERP', url: 'https://erp.example.com/mcp', enabled: true };
    const remote = { name: 'operation', description: 'Own operation', inputSchema: { type: 'object', properties: { customer: { type: 'string' } } } };
    const tool = { name: 'mcp__erp__operation', description: '[ERP] Own operation', parameters: remote.inputSchema };
    const review: McpToolApproval = {
        serverId: 'erp', toolName: 'operation', effect: 'write', definitionHash: mcpDefinitionHash(tool, server.url),
        dataClassification: 'contact', contactIdArgument: 'customer', requiresConfirmation: true,
        requiresHumanApproval: false, approvedBy: 'admin', approvedAt: '2026-09-06T00:00:00Z',
    };
    function fixture() {
        const settings = { mcpServers: [server], mcpToolApprovals: [review] };
        const service: any = new McpClientService({ tenant: { findUnique: jest.fn(async () => ({ settings })) } } as any,
            { del: jest.fn().mockResolvedValue(undefined) } as any, {} as any, {} as any);
        service.listServers = jest.fn(async () => settings.mcpServers);
        service.listRemoteTools = jest.fn(async () => ({ tools: [tool], map: { [tool.name]: { serverId: 'erp', realName: 'operation' } } }));
        service.fetchServerTools = jest.fn(async () => [remote]);
        service.withSession = jest.fn(async (_server, fn) => fn('session'));
        service.rpc = jest.fn(async () => ({ content: [{ type: 'text', text: 'Created #123' }] }));
        return { service, settings };
    }
    it('publishes and executes the same current review, stripping internal control arguments', async () => {
        const { service } = fixture();
        expect((await service.listPublishableTools('tenant')).tools).toHaveLength(1);
        const args = bindMcpArguments(review, { customer: 'another', _control: 'bad' }, 'tenant', 'contact');
        expect(await service.callRemoteTool('tenant', tool.name, args)).toMatchObject({ result: 'Created #123', isError: false });
        expect(service.rpc).toHaveBeenCalledWith(server, 'tools/call', { name: 'operation', arguments: { customer: 'contact' } }, 'session');
    });
    it.each(['endpoint', 'schema', 'revoke'])('stops a changed %s before invocation', async kind => {
        const { service, settings } = fixture();
        if (kind === 'endpoint') settings.mcpServers = [{ ...server, url: 'https://other.example.com/mcp' }];
        if (kind === 'revoke') settings.mcpToolApprovals = [];
        if (kind === 'schema') service.fetchServerTools.mockResolvedValue([{ ...remote, inputSchema: { type: 'object', properties: {} } }]);
        const result = await service.callRemoteTool('tenant', tool.name, bindMcpArguments(review, {}, 'tenant', 'contact'));
        expect(result.error).toMatch(/mcp_review_changed|mcp_contract_changed/);
        expect(service.rpc).not.toHaveBeenCalled();
    });
    it('does not report a remote writer timeout as a known failure or success', async () => {
        const { service } = fixture();
        service.rpc.mockRejectedValue(new Error('timeout'));
        await expect(service.callRemoteTool('tenant', tool.name, bindMcpArguments(review, {}, 'tenant', 'contact')))
            .rejects.toThrow('mcp_execution_outcome_unknown');
    });
    it('keeps financial identity and irreversible human approval', () => {
        expect(reviewedMcpPolicy({ ...review, effect: 'payment' })).toMatchObject({ assurance: 'A3', confirmation: 'runtime_enforced' });
        expect(hasExecutableMcpReview({ ...review, effect: 'irreversible' })).toBe(false);
        expect(reviewedMcpPolicy({ ...review, effect: 'irreversible', requiresHumanApproval: true })).toMatchObject({ assurance: 'A4', humanApproval: 'runtime_enforced' });
    });
    it('has stable collision-resistant names and only registered task prerequisites', () => {
        expect(mcpDefinitionHash(tool, server.url, 'changed-credential')).not.toBe(review.definitionHash);
        expect(mcpRegisteredName('erp', 'x'.repeat(100))).not.toBe(mcpRegisteredName('erp', `${'x'.repeat(99)}y`));
        expect(mcpRegisteredName('erp', 'x'.repeat(100)).length).toBeLessThanOrEqual(64);
        for (const [name, readers] of Object.entries(CORE_PREREQUISITES)) {
            expect(STATIC_TOOL_NAMES).toContain(name);
            for (const reader of readers) expect(STATIC_TOOL_NAMES).toContain(reader);
        }
    });
});
