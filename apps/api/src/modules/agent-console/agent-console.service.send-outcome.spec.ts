import { AgentConsoleService } from './agent-console.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';

/**
 * What the inbox is allowed to say about a human agent's reply.
 *
 * The row was inserted as `delivered` before anything was sent, and the send
 * ran inline inside a `catch` that only warned. So a reply whose provider call
 * threw — an expired token, a 500, a timeout — appeared in the inbox as
 * delivered, the agent moved on to the next conversation, and the customer was
 * still waiting for an answer nobody knew had not left.
 */
describe('what becomes of a human agent reply', () => {
    function harness(options: { sendFails?: boolean; noChannel?: boolean; settleFails?: boolean } = {}) {
        const statements: Array<{ sql: string; params: any[] }> = [];
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
            statements.push({ sql, params });
            if (sql.includes('INSERT INTO messages')) {
                // The row answers with the status it was written with, which is
                // what makes `pending` the starting point rather than a guess.
                return [{ id: MESSAGE, content_text: 'Ya lo reviso', content_type: 'text',
                    direction: 'outbound', status: 'pending', created_at: new Date(), metadata: {} }];
            }
            if (sql.includes('FROM conversations c')) {
                return options.noChannel ? [] : [{ channel_type: 'whatsapp', phone: '+573101234567', channel_account_id: 'acc-1' }];
            }
            if (sql.startsWith('UPDATE messages SET status')) {
                if (options.settleFails) throw new Error('database unavailable');
                return [];
            }
            return [];
        });
        const prisma: any = {
            // `getTenantSchema` reads the tenants row directly, so the fake has
            // to answer the tagged template the same way the client does.
            $queryRaw: jest.fn(async () => [{ schema_name: 'tenant_test' }]),
            getTenantSchemaName: jest.fn(async () => 'tenant_test'),
            executeInTenantSchema,
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => work(executeInTenantSchema)),
        };
        const channelGateway: any = { sendMessage: jest.fn(async () => {
            if (options.sendFails) throw new Error('token expired');
            return { messageId: 'wamid.OUT' };
        }) };
        const channelToken: any = { getChannelToken: jest.fn(async () => ({ accessToken: 'token', accountId: 'acc-1' })) };
        const service = new AgentConsoleService(prisma, { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
            channelGateway, channelToken, {} as any, {} as any, { emit: jest.fn() } as any, {} as any);
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
        return { service, statements, channelGateway };
    }
    afterEach(() => jest.restoreAllMocks());

    const settleOf = (statements: Array<{ sql: string; params: any[] }>) =>
        statements.filter(entry => entry.sql.startsWith('UPDATE messages SET status'));

    it('writes the history row as pending, never as delivered before a send', async () => {
        const { service, statements } = harness();
        await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        const write = statements.find(entry => entry.sql.includes('INSERT INTO messages'))!;
        expect(write.sql).toContain("'pending'");
        expect(write.sql).not.toContain("'delivered'");
    });

    it('marks it sent only after the provider accepted it', async () => {
        const { service, statements, channelGateway } = harness();
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        expect(channelGateway.sendMessage).toHaveBeenCalled();
        expect(settleOf(statements).map(entry => entry.params[1])).toEqual(['sent']);
        expect(message.status).toBe('sent');
    });

    it('tells the agent when the reply did not leave, instead of only the server log', async () => {
        const { service, statements } = harness({ sendFails: true });
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        const settle = settleOf(statements);
        expect(settle.map(entry => entry.params[1])).toEqual(['failed']);
        expect(JSON.parse(settle[0].params[2])).toMatchObject({ sendError: 'token expired' });
        // The agent has to see it. A failure that only reaches the log leaves
        // them believing the customer was answered.
        expect(message.status).toBe('failed');
    });

    it('never overwrites what a provider webhook already said', async () => {
        const { service, statements } = harness();
        await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        // A `delivered` or `read` that arrived while this was settling is newer
        // evidence than anything this code knows, and `redacted` outranks all.
        expect(settleOf(statements)[0].sql).toContain("status NOT IN ('redacted','delivered','read')");
    });

    it('leaves it pending when there is no channel to send through', async () => {
        const { service, statements, channelGateway } = harness({ noChannel: true });
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        expect(channelGateway.sendMessage).not.toHaveBeenCalled();
        // Nothing was attempted, so nothing may be claimed either way.
        expect(settleOf(statements)).toEqual([]);
        expect(message.status).toBe('pending');
    });

    it('keeps the reply pending when the outcome itself could not be recorded', async () => {
        const { service, statements } = harness({ settleFails: true });
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        // The send happened, the write about it did not. `pending` is the honest
        // state: nothing here may claim the message left.
        expect(settleOf(statements)).toHaveLength(1);
        expect(message.status).toBe('pending');
    });
});
