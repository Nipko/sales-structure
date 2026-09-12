import { AgentConsoleService } from './agent-console.service';
import { permissiveSpendGate, resolvingChannelToken, openPauseStore } from '../channels/__fixtures__/spend-gate-double';
import type { StrictDispatchOutcome } from '../channels/strict-dispatch-transport';

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
 *
 * ── AND THEN TWO ANSWERS WHERE THERE ARE THREE ──────────────────────────────
 *
 * The first fix read the gateway's return and stopped saying `sent` for a reply
 * it had refused. But `ChannelGatewayService.sendMessage` reports EVERY failure
 * as `null`: no adapter, unsupported content, a Flow refusal, a non-ok Graph
 * response — and a TIMEOUT. One `null` for "the provider said no" and for "no
 * answer arrived", which are opposite facts about whether the customer has the
 * message.
 *
 * The two records then disagreed from that same `null`. `recordAgentSend` filed
 * the spend outcome as a TIMEOUT — money retained, the effect indeterminate,
 * "somebody may have sent this" — while the message row said `failed`, which
 * reads as "it did not leave" and is an invitation to retype. On WhatsApp that
 * retype is a second charge for a message the customer may already have.
 *
 * So a channel Meta bills now goes through the STRICT transport, which answers
 * three ways, and both records come from that one answer. A billed channel with
 * no strict transport is refused BEFORE the admission: no reservation, no
 * intent, nothing addressed.
 */
describe('what becomes of a human agent reply', () => {
    function harness(options: {
        sendFails?: boolean; noChannel?: boolean; settleFails?: boolean;
        sendReturnsNull?: boolean;
        /** What the strict transport answers. Absent means `accepted`. */
        strict?: StrictDispatchOutcome;
        /** No strict transport for this channel at all. */
        noStrict?: boolean;
        /** The conversation's channel. `whatsapp` is the one Meta bills. */
        channel?: string;
    } = {}) {
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
                return options.noChannel ? [] : [{ channel_type: options.channel ?? 'whatsapp',
                    phone: '+573101234567', channel_account_id: 'acc-1' }];
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
        const sendStrict = jest.fn(async (): Promise<StrictDispatchOutcome> => {
            if (options.sendFails) throw new Error('token expired');
            return options.strict ?? { kind: 'accepted', receipt: 'wamid.OUT' };
        });
        const channelGateway: any = {
            sendMessage: jest.fn(async () => {
                if (options.sendFails) throw new Error('token expired');
                // The gateway reports EVERY transport failure as `null` rather
                // than by throwing. This lane is now reached only by a channel
                // Meta does NOT bill, where a conflated answer costs nothing.
                if (options.sendReturnsNull) return null;
                return { messageId: 'wamid.OUT' };
            }),
            getStrictTransport: jest.fn(() => options.noStrict
                ? undefined
                : { channelType: options.channel ?? 'whatsapp', sendStrict }),
        };
        const channelToken: any = resolvingChannelToken({
            getChannelToken: jest.fn(async () => ({ accessToken: 'token', accountId: 'acc-1' })) });

        // A complete authority, because this spec is about what the console
        // TELLS the agent, not about money. An incomplete one would refuse
        // every reply and the outcomes below would all read 'failed'.
        const spendGate = permissiveSpendGate();
        const service = new AgentConsoleService(prisma, { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
            channelGateway, channelToken, {} as any, {} as any, { emit: jest.fn() } as any, {} as any,
            spendGate,
            openPauseStore(),);
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
        return { service, statements, channelGateway, sendStrict, spendGate };
    }
    afterEach(() => jest.restoreAllMocks());

    const settleOf = (statements: Array<{ sql: string; params: any[] }>) =>
        statements.filter(entry => entry.sql.startsWith('UPDATE messages SET status'));
    /** What the money authority was told this send ended as. */
    const spendOutcome = (spendGate: any) => spendGate.record.mock.calls.at(-1)?.[2];

    it('writes the history row as pending, never as delivered before a send', async () => {
        const { service, statements } = harness();
        await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        const write = statements.find(entry => entry.sql.includes('INSERT INTO messages'))!;
        expect(write.sql).toContain("'pending'");
        expect(write.sql).not.toContain("'delivered'");
    });

    it('marks it sent only after the provider issued a receipt', async () => {
        const { service, statements, sendStrict, spendGate } = harness();
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        expect(sendStrict).toHaveBeenCalled();
        expect(settleOf(statements).map(entry => entry.params[1])).toEqual(['sent']);
        expect(message.status).toBe('sent');
        expect(spendOutcome(spendGate)).toMatchObject({ kind: 'accepted', providerMessageId: 'wamid.OUT' });
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

    it('calls a positive refusal failed, and releases the money', async () => {
        const { service, statements, spendGate } = harness({
            strict: { kind: 'rejected', errorCode: 'wa_131047', retryable: false } });
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        // The provider ANSWERED and did not act, so nothing reached the
        // customer and retyping is safe.
        expect(settleOf(statements).map(entry => entry.params[1])).toEqual(['failed']);
        expect(message.status).toBe('failed');
        expect(spendOutcome(spendGate)).toMatchObject({ kind: 'rejected', errorCode: 'wa_131047' });
    });

    it('keeps the reservation held when the provider invites the same request again', async () => {
        // `rejected` and `rejected_retryable` are not the same thing to the
        // ledger: filing a retryable refusal as final releases the money and the
        // retry then arrives with nothing reserved.
        const { service, spendGate } = harness({
            strict: { kind: 'rejected', errorCode: 'rate_limited', retryable: true } });
        await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        expect(spendOutcome(spendGate)).toMatchObject({ kind: 'rejected_retryable', errorCode: 'rate_limited' });
    });

    it('files an unknown outcome for reconciliation, and never as failed', async () => {
        // THE DEFECT. From one `null` the money was retained as indeterminate —
        // "somebody may have sent this" — while the row said `failed`, which an
        // agent reads as "it did not leave" and answers by retyping. On a
        // channel Meta bills, that retype is a second charge for a message the
        // customer may already have.
        const { service, statements, spendGate } = harness({
            strict: { kind: 'unknown', errorCode: 'timeout' } });
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');

        const settle = settleOf(statements);
        expect(settle.map(entry => entry.params[1])).toEqual(['reconciliation_required']);
        expect(JSON.parse(settle[0].params[2])).toMatchObject({ sendError: 'timeout' });
        expect(message.status).toBe('reconciliation_required');
        // Never the two words that would be a lie in opposite directions.
        expect(settle.some(entry => ['sent', 'failed'].includes(entry.params[1]))).toBe(false);
        // And the two records now tell ONE story: the row says nobody knows,
        // the ledger retains the money for the same reason.
        expect(spendOutcome(spendGate)).toMatchObject({ kind: 'timeout', errorCode: 'timeout' });
    });

    it('refuses before admitting when a billed channel has no transport that can answer', async () => {
        // A chargeable channel whose adapter cannot report an outcome. Refused
        // BEFORE the admission, so there is no reservation to leave
        // indeterminate: nothing spent, nothing addressed.
        const { service, statements, channelGateway, spendGate } = harness({ noStrict: true });
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        expect(channelGateway.sendMessage).not.toHaveBeenCalled();
        expect(spendGate.admitBySchema).not.toHaveBeenCalled();
        expect(spendGate.admit).not.toHaveBeenCalled();
        expect(spendGate.beginTransmission).not.toHaveBeenCalled();
        expect(settleOf(statements).map(entry => entry.params[1])).toEqual(['failed']);
        expect(JSON.parse(settleOf(statements)[0].params[2]))
            .toMatchObject({ sendError: 'strict_transport_unavailable' });
        expect(message.status).toBe('failed');
    });

    it('still uses the inline gateway for a channel Meta does not bill', async () => {
        // Telegram delivery costs the business nothing, so a transport that
        // conflates its failures costs nothing either — and refusing the reply
        // for want of a strict transport would silence a channel that works.
        const { service, statements, channelGateway } = harness({ channel: 'telegram', noStrict: true });
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        expect(channelGateway.sendMessage).toHaveBeenCalled();
        expect(settleOf(statements).map(entry => entry.params[1])).toEqual(['sent']);
        expect(message.status).toBe('sent');
    });

    it('does not call a reply SENT when the inline gateway answered nothing', async () => {
        // The older defect, on the lane that still uses that gateway.
        // `settle('sent')` ran unconditionally on a value nobody read, so a
        // reply the provider positively refused was stamped `sent`: the agent
        // closes the conversation and the customer has nothing. The gateway
        // signals it by RETURNING `null`, not by throwing, so the catch never
        // ran and every case here missed it.
        const { service, statements, channelGateway } = harness({
            channel: 'telegram', noStrict: true, sendReturnsNull: true });
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');

        expect(channelGateway.sendMessage).toHaveBeenCalled();
        const settle = settleOf(statements);
        expect(settle.map(entry => entry.params[1])).toEqual(['failed']);
        expect(JSON.parse(settle[0].params[2])).toMatchObject({ sendError: 'provider_no_receipt' });
        expect(message.status).toBe('failed');
        // And never the other word, on any statement.
        expect(settle.some(entry => entry.params[1] === 'sent')).toBe(false);
    });

    it('never overwrites what a provider webhook already said', async () => {
        const { service, statements } = harness();
        await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        // A `delivered` or `read` that arrived while this was settling is newer
        // evidence than anything this code knows, and `redacted` outranks all.
        expect(settleOf(statements)[0].sql).toContain("status NOT IN ('redacted','delivered','read')");
    });

    it('leaves it pending when there is no channel to send through', async () => {
        const { service, statements, channelGateway, sendStrict } = harness({ noChannel: true });
        const message = await service.sendAgentMessage(TENANT, CONVERSATION, AGENT, 'Ya lo reviso');
        expect(channelGateway.sendMessage).not.toHaveBeenCalled();
        expect(sendStrict).not.toHaveBeenCalled();
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
