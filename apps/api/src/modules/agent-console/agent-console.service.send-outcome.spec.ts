import { AgentConsoleService } from './agent-console.service';
import { permissiveSpendGate, resolvingChannelToken, openPauseStore }
    from '../channels/__fixtures__/spend-gate-double';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';

/**
 * Every certified conversational channel has one durable console route. The
 * remaining inline route is limited to the internal email adapter and legacy
 * one-way SMS product. Durable provider outcomes are exercised against the
 * real outbox in `agent-console-durable-lane.postgres.spec.ts`.
 */
describe('the legacy console delivery boundary', () => {
    function harness(options: {
        channel?: string; sendReturnsNull?: boolean; noConversation?: boolean;
    } = {}) {
        const channel = options.channel ?? 'email';
        const statements: Array<{ sql: string; params: any[] }> = [];
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string,
            params: any[] = []) => {
            statements.push({ sql, params });
            if (sql.includes('SELECT channel_type FROM conversations WHERE')) {
                return options.noConversation ? [] : [{ channel_type: channel }];
            }
            if (sql.includes('INSERT INTO messages')) {
                return [{ id: MESSAGE, content_text: 'Ya lo reviso', content_type: 'text',
                    direction: 'outbound', status: 'pending', created_at: new Date(), metadata: {} }];
            }
            if (sql.includes('FROM conversations c')) {
                return options.noConversation ? [] : [{ channel_type: channel,
                    phone: 'cliente@example.test', channel_account_id: 'acc-1' }];
            }
            return [];
        });
        const prisma: any = {
            $queryRaw: jest.fn(async () => [{ schema_name: 'tenant_test' }]),
            getTenantSchemaName: jest.fn(async () => 'tenant_test'),
            executeInTenantSchema,
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) =>
                work(executeInTenantSchema)),
        };
        const channelGateway: any = {
            getStrictTransport: jest.fn(() => undefined),
            sendMessage: jest.fn(async () => options.sendReturnsNull ? null : 'mail.receipt'),
        };
        const service = new AgentConsoleService(
            prisma, { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
            channelGateway,
            resolvingChannelToken({ getChannelToken: jest.fn(async () => ({
                accessToken: 'token', accountId: 'acc-1',
            })) }),
            {} as any, {} as any, { emit: jest.fn() } as any, {} as any,
            permissiveSpendGate(), openPauseStore(), undefined, undefined,
        );
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        return { service, statements, channelGateway };
    }

    afterEach(() => jest.restoreAllMocks());

    it('refuses WhatsApp before writing history or making an inline POST', async () => {
        const { service, statements, channelGateway } = harness({ channel: 'whatsapp' });
        await expect(service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso'))
            .rejects.toThrow(/transporte durable/);
        expect(statements.some(entry => entry.sql.includes('INSERT INTO messages'))).toBe(false);
        expect(channelGateway.sendMessage).not.toHaveBeenCalled();
    });

    it.each(['instagram', 'messenger', 'telegram'])(
        'does not downgrade certified %s delivery to the inline path', async (channel) => {
            const { service, channelGateway } = harness({ channel });
            await expect(service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso'))
                .rejects.toThrow(/transporte durable/);
            expect(channelGateway.sendMessage).not.toHaveBeenCalled();
        });

    it('keeps email pending until its internal adapter returns a receipt', async () => {
        const { service, statements, channelGateway } = harness();
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        const insert = statements.find(entry => entry.sql.includes('INSERT INTO messages'))!;
        expect(insert.sql).toContain("'pending'");
        expect(insert.sql).not.toContain("'delivered'");
        expect(channelGateway.sendMessage).toHaveBeenCalledTimes(1);
        expect(message.status).toBe('sent');
    });

    it('does not call an inline adapter refusal sent', async () => {
        const { service, statements } = harness({ sendReturnsNull: true });
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        const settlements = statements.filter(entry => entry.sql.startsWith('UPDATE messages SET status'));
        expect(settlements.map(entry => entry.params[1])).toContain('failed');
        expect(message.status).toBe('failed');
    });

    it('refuses an unknown conversation before creating an orphan reply', async () => {
        const { service, statements, channelGateway } = harness({ noConversation: true });
        await expect(service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso'))
            .rejects.toThrow(/transporte durable/);
        expect(statements.some(entry => entry.sql.includes('INSERT INTO messages'))).toBe(false);
        expect(channelGateway.sendMessage).not.toHaveBeenCalled();
    });
});
