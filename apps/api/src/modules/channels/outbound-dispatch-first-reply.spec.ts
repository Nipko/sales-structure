jest.mock('../../common/utils/first-reply.util', () => ({
    recordFirstReply: jest.fn(async () => 'recorded'),
}));

import { AGENT_AUTHORED_SCOPE_KINDS, OutboundQueueProcessor, isAgentAuthoredScope } from './outbound-queue.processor';
import { DISPATCH_AUTHORITY_KINDS } from './proactive-dispatch.service';
import type { DispatchRow } from './agent-dispatch-outbox';
import type { StrictDispatchOutcome } from './strict-dispatch-transport';
import { permissiveSpendGate, resolvingChannelToken, openPauseStore } from './__fixtures__/spend-gate-double';
import { recordFirstReply } from '../../common/utils/first-reply.util';

/**
 * The durable lane is where a messaging reply becomes a fact: the provider
 * accepted it. That — and only that — is the activation moment for WhatsApp,
 * Messenger, Instagram and Telegram, so it is where `recordFirstReply` is
 * called. What the writer does with it (first write wins, stage monotonic,
 * never throws) is pinned in `first-reply.util.spec.ts`; this file pins WHEN
 * it is called.
 */
const tenantId = '11111111-1111-4111-8111-111111111111';
const dispatchId = '22222222-2222-4222-8222-222222222222';
const recordFirstReplyMock = recordFirstReply as jest.MockedFunction<typeof recordFirstReply>;

/** The scope an AI turn's reply is prepared under (`servedAgentAuthority`). */
const agentScope = {
    kind: 'agent', tenantId, schemaName: 'tenant_x',
    agentId: '77777777-7777-4777-8777-777777777777', version: 2, operationalHash: 'a'.repeat(64),
};
/** The scope a person's send is prepared under (`operatorAuthority`). */
const operatorScope = (surface: 'agent_console' | 'tenant_api') => ({
    kind: 'human_operator', tenantId, schemaName: 'tenant_x',
    userId: '88888888-8888-4888-8888-888888888888', surface,
    channelType: 'whatsapp', channelAccountId: 'phone-1', actorRevision: 'b'.repeat(64), policyVersion: 1,
});

function row(over: Partial<DispatchRow> = {}): DispatchRow {
    return {
        id: dispatchId, batchId: '33333333-3333-4333-8333-333333333333',
        itemIndex: 0, itemKind: 'text', state: 'queued', attempts: 0,
        receipt: null, errorCode: null, redacted: false, availableAt: new Date(Date.now() + 30_000),
        binding: { conversationId: '44444444-4444-4444-8444-444444444444',
            contactId: '55555555-5555-4555-8555-555555555555',
            inboundMessageId: '66666666-6666-4666-8666-666666666666',
            channelType: 'whatsapp', channelAccountId: 'phone-1', recipient: '+573000000000' },
        payload: { text: 'La respuesta' }, operationalScope: agentScope, learningFootprint: [],
        disposition: 'reactive',
        ...over,
    } as DispatchRow;
}

function harness(options: {
    outcome?: StrictDispatchOutcome;
    admitted?: Partial<DispatchRow>;
    /** The provider accepted, and writing `sent` down then failed (connection reset, lease lost). */
    settleSentThrows?: boolean;
    /** What the late-acceptance recovery answers. Default: it closes the row as `sent`. */
    lateAcceptance?: 'sent' | null;
} = {}) {
    const sendStrict = jest.fn(async () => options.outcome ?? { kind: 'accepted', receipt: 'wamid.OK' });
    const channelGateway = {
        sendMessage: jest.fn(),
        getStrictTransport: jest.fn(() => ({ channelType: 'whatsapp', sendStrict })),
    };
    const throttle = {
        isOverLimit: jest.fn(async () => false),
        recordUsage: jest.fn(async () => undefined),
        reserveActionUsage: jest.fn(async () => ({ allowed: true, count: 1, adopted: false })),
        commitActionUsage: jest.fn(async () => undefined),
        releaseActionUsage: jest.fn(async () => undefined),
    };
    const channelToken = resolvingChannelToken({ getChannelToken: jest.fn(async () => ({ accessToken: 'token' })) });
    const dispatchOutbox = {
        read: jest.fn(async () => row()),
        admit: jest.fn(async () => ({ schemaName: 'tenant_x', leaseToken: 'lease-1',
            row: row({ state: 'admitted', attempts: 1, ...options.admitted }) })),
        settle: jest.fn(async (_t: string, _d: string, _l: string, outcome: any) => {
            if (outcome.kind === 'sent' && options.settleSentThrows) throw new Error('connection reset while settling');
            return row({ state: outcome.kind === 'sent' ? 'sent' : outcome.kind === 'failed' ? 'failed' : outcome.kind, attempts: 1 });
        }),
        recordLateAcceptance: jest.fn(async () => (options.lateAcceptance === null
            ? null
            : row({ state: 'sent', receipt: 'wamid.OK', attempts: 1 }))),
        failPreflight: jest.fn(async (_t: string, _d: string, input: any) =>
            row({ state: input.permanent ? 'suppressed' : 'failed', attempts: 1, errorCode: input.errorCode })),
    };
    const prisma = {
        tenant: { findUnique: jest.fn(async () => ({
            isInternal: false, subscriptionStatus: 'active',
            subscription: { status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
        })) },
        getTenantSchemaName: jest.fn(async () => 'tenant_spec'),
    };
    const processor = new OutboundQueueProcessor(channelGateway as any, throttle as any, channelToken as any,
        { get: jest.fn(), set: jest.fn() } as any, { send: jest.fn() } as any, prisma as any,
        permissiveSpendGate(), openPauseStore(), undefined, undefined, dispatchOutbox as any);
    const job: any = { id: 'dispatch-1', data: { dispatch: { tenantId, dispatchId } },
        moveToDelayed: jest.fn(async () => undefined) };
    return { processor, job, prisma, sendStrict };
}

describe('the durable lane records the first reply', () => {
    beforeEach(() => recordFirstReplyMock.mockClear());

    it('an accepted reply inside a conversation activates the account', async () => {
        const h = harness();
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:sent:wamid.OK');
        expect(recordFirstReplyMock).toHaveBeenCalledTimes(1);
        expect(recordFirstReplyMock).toHaveBeenCalledWith(h.prisma, tenantId, { source: 'dispatch' });
    });

    it('a proactive send (campaign, reminder) proves nothing about attending a customer', async () => {
        const h = harness({ admitted: { disposition: 'proactive', operationalScope: { producer: 'campaign' } } as any });
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:sent:wamid.OK');
        expect(recordFirstReplyMock).not.toHaveBeenCalled();
    });

    it('a reply the provider did not accept activates nothing', async () => {
        const unknown = harness({ outcome: { kind: 'unknown', errorCode: 'provider_timeout' } });
        await unknown.processor.process(unknown.job);
        const refused = harness({ outcome: { kind: 'rejected', errorCode: 'http_400', retryable: false } });
        await refused.processor.process(refused.job).catch(() => undefined);
        expect(recordFirstReplyMock).not.toHaveBeenCalled();
    });

    /**
     * Activation is a fact about the PROVIDER's answer, not about our own
     * bookkeeping. Two real first replies used to skip the writer because the
     * mark sat after the `sent` settle: the late-acceptance recovery (the row
     * went to reconciliation while Meta was still answering, and the receipt
     * closed it) and an acceptance whose settle threw. The customer got the
     * answer both times; the account stayed "waiting for its first reply".
     */
    it('a reply recovered as a late acceptance activates the account', async () => {
        const h = harness({ settleSentThrows: true });
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:sent:wamid.OK');
        expect(recordFirstReplyMock).toHaveBeenCalledTimes(1);
        expect(recordFirstReplyMock).toHaveBeenCalledWith(h.prisma, tenantId, { source: 'dispatch' });
    });

    it('an accepted reply whose outcome could not be written down still activates the account', async () => {
        const h = harness({ settleSentThrows: true, lateAcceptance: null });
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:outcome_unrecorded:accepted');
        expect(recordFirstReplyMock).toHaveBeenCalledTimes(1);
        expect(recordFirstReplyMock).toHaveBeenCalledWith(h.prisma, tenantId, { source: 'dispatch' });
    });

    it('a proactive send stays out of it on those paths too', async () => {
        const proactive = { disposition: 'proactive', operationalScope: { producer: 'campaign' } } as any;
        const late = harness({ settleSentThrows: true, admitted: proactive });
        await late.processor.process(late.job);
        const unrecorded = harness({ settleSentThrows: true, lateAcceptance: null, admitted: proactive });
        await unrecorded.processor.process(unrecorded.job);
        expect(recordFirstReplyMock).not.toHaveBeenCalled();
    });

    /**
     * Activation means "the AGENT answered a real customer". A person answering
     * from the inbox is a `reactive` send too — the thread has an inbound — so
     * the disposition alone let an owner who replied by hand end day 0 while her
     * agent had never answered anybody.
     */
    it.each(['agent_console', 'tenant_api'] as const)(
        'a reply a person sent (%s) activates nothing, although it answers a customer',
        async (surface) => {
            const h = harness({ admitted: { disposition: 'reactive', operationalScope: operatorScope(surface) } as any });
            await expect(h.processor.process(h.job)).resolves.toBe('dispatch:sent:wamid.OK');
            expect(recordFirstReplyMock).not.toHaveBeenCalled();
        },
    );

    it('a person\'s reply stays out of it on the recovery paths too', async () => {
        const human = { disposition: 'reactive', operationalScope: operatorScope('agent_console') } as any;
        const late = harness({ settleSentThrows: true, admitted: human });
        await late.processor.process(late.job);
        const unrecorded = harness({ settleSentThrows: true, lateAcceptance: null, admitted: human });
        await unrecorded.processor.process(unrecorded.job);
        expect(recordFirstReplyMock).not.toHaveBeenCalled();
    });

    it('a policy send that happens to be reactive is not the agent answering either', async () => {
        const h = harness({ admitted: { disposition: 'reactive',
            operationalScope: { kind: 'proactive_policy', producer: 'appointment_reminder' } } as any });
        await h.processor.process(h.job);
        expect(recordFirstReplyMock).not.toHaveBeenCalled();
    });

    it('the legacy persona of a tenant with no durable agent is still its agent answering', async () => {
        const h = harness({ admitted: { operationalScope: { kind: 'legacy', legacyConfigHash: 'c'.repeat(64) } } as any });
        await h.processor.process(h.job);
        expect(recordFirstReplyMock).toHaveBeenCalledTimes(1);
    });

    it('a row whose authority cannot be read never activates an account', async () => {
        const h = harness({ admitted: { operationalScope: {} } as any });
        await h.processor.process(h.job);
        expect(recordFirstReplyMock).not.toHaveBeenCalled();
    });

    /**
     * Pinned against the outbox's own list, so a fifth authority has to be
     * classified here on purpose instead of silently activating (or not).
     */
    it('classifies every authority the outbox accepts, and only agent and legacy are the agent', () => {
        expect([...AGENT_AUTHORED_SCOPE_KINDS].sort()).toEqual(['agent', 'legacy']);
        const verdicts = Object.fromEntries(DISPATCH_AUTHORITY_KINDS.map((kind) => [kind, isAgentAuthoredScope({ kind })]));
        expect(verdicts).toEqual({ agent: true, legacy: true, proactive_policy: false, human_operator: false });
        for (const value of [null, undefined, 'agent', ['agent'], { kind: 7 }]) expect(isAgentAuthoredScope(value)).toBe(false);
    });

    it('a writer that fails can never cost the delivery its receipt', async () => {
        // The real writer never rejects; this proves the lane would not care if it did.
        recordFirstReplyMock.mockImplementationOnce(() => Promise.reject(new Error('settings row locked')));
        const h = harness();
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:sent:wamid.OK');
        await new Promise(resolve => setImmediate(resolve));
    });
});
