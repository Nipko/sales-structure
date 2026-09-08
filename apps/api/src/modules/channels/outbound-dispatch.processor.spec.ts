import { DelayedError } from 'bullmq';
import { OutboundQueueProcessor } from './outbound-queue.processor';
import { DispatchOutboxError, type DispatchRow } from './agent-dispatch-outbox';
import type { StrictDispatchOutcome } from './strict-dispatch-transport';

const tenantId = '11111111-1111-4111-8111-111111111111';
const dispatchId = '22222222-2222-4222-8222-222222222222';

function row(over: Partial<DispatchRow> = {}): DispatchRow {
    return {
        id: dispatchId, batchId: '33333333-3333-4333-8333-333333333333',
        itemIndex: 0, itemKind: 'text', state: 'queued', attempts: 0,
        receipt: null, errorCode: null, redacted: false,
        binding: { conversationId: '44444444-4444-4444-8444-444444444444',
            contactId: '55555555-5555-4555-8555-555555555555',
            inboundMessageId: '66666666-6666-4666-8666-666666666666',
            channelType: 'whatsapp', channelAccountId: 'phone-1', recipient: '+573000000000' },
        payload: { text: 'La respuesta' }, operationalScope: {}, learningFootprint: [],
        ...over,
    } as DispatchRow;
}

describe('OutboundQueueProcessor durable dispatch', () => {
    function harness(options: {
        current?: DispatchRow | null;
        outcome?: StrictDispatchOutcome;
        admit?: () => Promise<any>;
        settleFails?: boolean;
        strict?: boolean;
        overLimit?: boolean;
        entitled?: boolean;
        credentials?: boolean;
    } = {}) {
        const sendStrict = jest.fn(async () => options.outcome ?? { kind: 'accepted', receipt: 'wamid.OK' });
        const channelGateway = {
            sendMessage: jest.fn(),
            getStrictTransport: jest.fn(() => (options.strict === false ? undefined : { channelType: 'whatsapp', sendStrict })),
        };
        const throttle = {
            isOverLimit: jest.fn(async () => options.overLimit === true),
            recordUsage: jest.fn(async () => undefined),
        };
        const channelToken = { getChannelToken: jest.fn(async () => {
            if (options.credentials === false) throw new Error('token expired');
            return { accessToken: 'token' };
        }) };
        const settle = jest.fn(async (_t: string, _d: string, _l: string, outcome: any) => {
            if (options.settleFails) throw new Error('settle write failed');
            return row({ state: outcome.kind === 'sent' ? 'sent'
                : outcome.kind === 'failed' ? 'failed' : outcome.kind as any, attempts: 1 });
        });
        const dispatchOutbox = {
            read: jest.fn(async () => (options.current === undefined ? row() : options.current)),
            admit: options.admit
                ? jest.fn(options.admit)
                : jest.fn(async () => ({ schemaName: 'tenant_x', leaseToken: 'lease-1', row: row({ state: 'admitted', attempts: 1 }) })),
            settle,
            failPreflight: jest.fn(async (_t: string, _d: string, input: any) =>
                row({ state: input.permanent ? 'suppressed' : 'failed', attempts: 1, errorCode: input.errorCode })),
        };
        const prisma = { tenant: { findUnique: jest.fn(async () => ({
            isInternal: false, subscriptionStatus: options.entitled === false ? 'cancelled' : 'active',
            subscription: { status: options.entitled === false ? 'cancelled' : 'active', trialEndsAt: null,
                cancelAtPeriodEnd: false, currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
        })) } };
        const processor = new OutboundQueueProcessor(channelGateway as any, throttle as any, channelToken as any,
            { get: jest.fn(), set: jest.fn() } as any, { send: jest.fn() } as any, prisma as any,
            undefined, undefined, dispatchOutbox as any);
        const job: any = { id: 'dispatch-1', data: { dispatch: { tenantId, dispatchId } },
            moveToDelayed: jest.fn(async () => undefined) };
        return { processor, job, dispatchOutbox, sendStrict, throttle, channelGateway };
    }

    it('records the provider receipt against the lease that authorized the attempt', async () => {
        const h = harness();
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:sent:wamid.OK');
        expect(h.sendStrict).toHaveBeenCalledTimes(1);
        expect(h.sendStrict).toHaveBeenCalledWith({ itemKind: 'text', to: '+573000000000',
            channelAccountId: 'phone-1', payload: { text: 'La respuesta' } }, 'token');
        expect(h.dispatchOutbox.settle).toHaveBeenCalledWith(tenantId, dispatchId, 'lease-1',
            { kind: 'sent', receipt: 'wamid.OK' });
        expect(h.throttle.recordUsage).toHaveBeenCalled();
    });

    it('never produces a second effect for a row that already reached a terminal state', async () => {
        for (const state of ['sent', 'suppressed', 'reconciliation_required', 'stored'] as const) {
            const h = harness({ current: row({ state, receipt: 'wamid.OLD' }) });
            await expect(h.processor.process(h.job)).resolves.toBe(`dispatch:${state}`);
            expect(h.sendStrict).not.toHaveBeenCalled();
            expect(h.dispatchOutbox.admit).not.toHaveBeenCalled();
        }
    });

    it('leaves an unknown outcome to reconciliation and does not ask for a retry', async () => {
        const h = harness({ outcome: { kind: 'unknown', errorCode: 'provider_timeout' } });
        // Returning rather than throwing is the point: a thrown error would make
        // BullMQ re-run the job, and the provider may already have delivered it.
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:reconciliation_required:provider_timeout');
        expect(h.dispatchOutbox.settle).toHaveBeenCalledWith(tenantId, dispatchId, 'lease-1',
            { kind: 'reconciliation_required', errorCode: 'provider_timeout' });
        expect(h.sendStrict).toHaveBeenCalledTimes(1);
    });

    it('asks for a retry only when the provider said it did not act', async () => {
        const retryable = harness({ outcome: { kind: 'rejected', errorCode: 'http_503', retryable: true } });
        await expect(retryable.processor.process(retryable.job)).rejects.toThrow('dispatch_retryable:http_503');
        expect(retryable.dispatchOutbox.settle).toHaveBeenCalledWith(tenantId, dispatchId, 'lease-1',
            { kind: 'failed', errorCode: 'http_503' });

        const permanent = harness({ outcome: { kind: 'rejected', errorCode: 'wa_131047', retryable: false } });
        await expect(permanent.processor.process(permanent.job)).resolves.toBe('dispatch:suppressed:wa_131047');
    });

    it('keeps a receipt it observed but could not write, without sending again', async () => {
        const h = harness({ settleFails: true });
        // The row keeps its live permission, so no other worker can take it; the
        // lapse turns it into a reconciliation, which is the honest state.
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:outcome_unrecorded:accepted');
        expect(h.sendStrict).toHaveBeenCalledTimes(1);
    });

    it('refuses a channel whose adapter is not migrated instead of using the loose gateway', async () => {
        const h = harness({ strict: false });
        await expect(h.processor.process(h.job)).resolves.toContain('transport_not_migrated:whatsapp');
        expect(h.dispatchOutbox.failPreflight).toHaveBeenCalledWith(tenantId, dispatchId,
            expect.objectContaining({ permanent: true }));
        expect(h.channelGateway.sendMessage).not.toHaveBeenCalled();
        expect(h.dispatchOutbox.admit).not.toHaveBeenCalled();
    });

    it('spends an attempt on a preflight that cannot reach the provider', async () => {
        const noCredentials = harness({ credentials: false });
        await expect(noCredentials.processor.process(noCredentials.job))
            .resolves.toContain('channel_credentials_unavailable');
        expect(noCredentials.sendStrict).not.toHaveBeenCalled();

        const notEntitled = harness({ entitled: false });
        await expect(notEntitled.processor.process(notEntitled.job)).resolves.toContain('dispatch:');
        expect(notEntitled.sendStrict).not.toHaveBeenCalled();
    });

    it('re-schedules a throttled tenant without spending an attempt', async () => {
        const h = harness({ overLimit: true });
        await expect(h.processor.process(h.job, 'worker-token')).rejects.toBeInstanceOf(DelayedError);
        expect(h.job.moveToDelayed).toHaveBeenCalled();
        expect(h.dispatchOutbox.failPreflight).not.toHaveBeenCalled();
        expect(h.sendStrict).not.toHaveBeenCalled();
    });

    it('suppresses a payload whose authority or sources no longer hold', async () => {
        const h = harness({ admit: async () => { throw new DispatchOutboxError('agent_operational_revision_changed'); } });
        await expect(h.processor.process(h.job)).resolves.toContain('agent_operational_revision_changed');
        expect(h.dispatchOutbox.failPreflight).toHaveBeenCalledWith(tenantId, dispatchId,
            { errorCode: 'agent_operational_revision_changed', permanent: true });
        expect(h.sendStrict).not.toHaveBeenCalled();
    });

    it('stands down when another worker already holds the permission', async () => {
        const h = harness({ admit: async () => { throw new DispatchOutboxError('dispatch_lease_active'); } });
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:lease_held_elsewhere');
        expect(h.dispatchOutbox.failPreflight).not.toHaveBeenCalled();
        expect(h.sendStrict).not.toHaveBeenCalled();
    });
});
