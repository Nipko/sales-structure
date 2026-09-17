import { DelayedError } from 'bullmq';
import { OutboundQueueProcessor } from './outbound-queue.processor';
import { DispatchOutboxError, type DispatchRow } from './agent-dispatch-outbox';
import type { StrictDispatchOutcome } from './strict-dispatch-transport';
import { ConnectionRefusedError } from './connection-refusal';
import { permissiveSpendGate, resolvingChannelToken, openPauseStore } from './__fixtures__/spend-gate-double';

const tenantId = '11111111-1111-4111-8111-111111111111';
const dispatchId = '22222222-2222-4222-8222-222222222222';

function row(over: Partial<DispatchRow> = {}): DispatchRow {
    return {
        id: dispatchId, batchId: '33333333-3333-4333-8333-333333333333',
        itemIndex: 0, itemKind: 'text', state: 'queued', attempts: 0,
        receipt: null, errorCode: null, redacted: false, availableAt: new Date(Date.now() + 30_000),
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
        rateAllowed?: boolean;
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
            reserveActionUsage: jest.fn(async () => ({ allowed: options.rateAllowed !== false, count: 1, adopted: false })),
            commitActionUsage: jest.fn(async () => undefined),
            releaseActionUsage: jest.fn(async () => undefined),
        };
        const channelToken = resolvingChannelToken({
            getChannelToken: jest.fn(async () => {
                if (options.credentials === false) throw new Error('token expired');
                return { accessToken: 'token' };
            }) });
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
            recordLateAcceptance: jest.fn(async () => {
                if (options.settleFails) throw new Error('late receipt write failed');
                return row({ state: 'sent', receipt: 'wamid.OK', attempts: 1 });
            }),
            failPreflight: jest.fn(async (_t: string, _d: string, input: any) =>
                row({ state: input.permanent ? 'suppressed' : 'failed', attempts: 1, errorCode: input.errorCode })),
        };
        const prisma = { tenant: { findUnique: jest.fn(async () => ({
            isInternal: false, subscriptionStatus: options.entitled === false ? 'cancelled' : 'active',
            subscription: { status: options.entitled === false ? 'cancelled' : 'active', trialEndsAt: null,
                cancelAtPeriodEnd: false, currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
        })) },
            getTenantSchemaName: jest.fn(async () => 'tenant_spec') };
        const processor = new OutboundQueueProcessor(channelGateway as any, throttle as any, channelToken as any,
            { get: jest.fn(), set: jest.fn() } as any, { send: jest.fn() } as any, prisma as any,
            permissiveSpendGate(), openPauseStore(), undefined, undefined, dispatchOutbox as any);
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
        expect(h.throttle.commitActionUsage).toHaveBeenCalledWith(
            tenantId, 'outbound', `dispatch:${dispatchId}`,
        );
    });

    it('loses the final concurrent slot before crossing the provider boundary', async () => {
        const h = harness({ rateAllowed: false });

        await expect(h.processor.process(h.job, 'worker-token')).rejects.toBeInstanceOf(DelayedError);
        expect(h.sendStrict).not.toHaveBeenCalled();
        expect(h.dispatchOutbox.settle).toHaveBeenCalledWith(
            tenantId, dispatchId, 'lease-1',
            { kind: 'failed', errorCode: 'plan_outbound_rate_limited', retryInSeconds: 60 },
        );
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

    it('parks a retryable refusal on the durable date, and never on its own clock', async () => {
        const retryable = harness({ outcome: { kind: 'rejected', errorCode: 'http_503', retryable: true } });
        // A thrown Error here would hand the schedule to BullMQ, whose retry can
        // arrive before the row is available — the loss this replaced.
        await expect(retryable.processor.process(retryable.job, 'worker-token')).rejects.toBeInstanceOf(DelayedError);
        expect(retryable.dispatchOutbox.settle).toHaveBeenCalledWith(tenantId, dispatchId, 'lease-1',
            { kind: 'failed', errorCode: 'http_503' });
        expect(retryable.job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'worker-token');
        expect(retryable.throttle.releaseActionUsage).toHaveBeenCalledWith(
            tenantId, 'outbound', `dispatch:${dispatchId}`,
        );

        const permanent = harness({ outcome: { kind: 'rejected', errorCode: 'wa_131047', retryable: false } });
        await expect(permanent.processor.process(permanent.job)).resolves.toBe('dispatch:suppressed:wa_131047');
        expect(permanent.job.moveToDelayed).not.toHaveBeenCalled();
    });

    it('waits for the durable date when admission says the row is not due yet', async () => {
        const h = harness({ admit: async () => { throw new DispatchOutboxError('dispatch_not_available_yet'); } });
        await expect(h.processor.process(h.job, 'worker-token')).rejects.toBeInstanceOf(DelayedError);
        expect(h.job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'worker-token');
        expect(h.sendStrict).not.toHaveBeenCalled();
    });

    it('keeps a failed queue move observable instead of turning it into DelayedError', async () => {
        const h = harness({ rateAllowed: false });
        const error = new Error('Missing lock for job. moveToDelayed');
        h.job.moveToDelayed.mockRejectedValueOnce(error);
        await expect(h.processor.process(h.job, 'worker-token')).rejects.toBe(error);
        expect(h.sendStrict).not.toHaveBeenCalled();
    });

    it('keeps a receipt it observed but could not write, without sending again', async () => {
        const h = harness({ settleFails: true });
        // The row keeps its live permission, so no other worker can take it; the
        // lapse turns it into a reconciliation, which is the honest state.
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:outcome_unrecorded:accepted');
        expect(h.sendStrict).toHaveBeenCalledTimes(1);
        expect(h.dispatchOutbox.recordLateAcceptance).toHaveBeenCalledWith(
            tenantId, dispatchId, 'lease-1', 'wamid.OK');
    });

    it('closes reconciliation when expiry races a positive provider receipt', async () => {
        const h = harness();
        h.dispatchOutbox.settle.mockRejectedValueOnce(new DispatchOutboxError('dispatch_lease_lost'));
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:sent:wamid.OK');
        expect(h.sendStrict).toHaveBeenCalledTimes(1);
        expect(h.dispatchOutbox.recordLateAcceptance).toHaveBeenCalledWith(
            tenantId, dispatchId, 'lease-1', 'wamid.OK');
        expect(h.throttle.commitActionUsage).toHaveBeenCalledTimes(1);
    });

    it('refuses a channel whose adapter is not migrated instead of using the loose gateway', async () => {
        const h = harness({ strict: false });
        await expect(h.processor.process(h.job)).resolves.toContain('transport_not_migrated:whatsapp');
        expect(h.dispatchOutbox.failPreflight).toHaveBeenCalledWith(tenantId, dispatchId,
            expect.objectContaining({ permanent: true }));
        expect(h.channelGateway.sendMessage).not.toHaveBeenCalled();
        expect(h.dispatchOutbox.admit).not.toHaveBeenCalled();
    });

    it('spends an attempt on a preflight that cannot reach the provider, then waits', async () => {
        const noCredentials = harness({ credentials: false });
        // Retryable preflight keeps its job, parked on the durable date; letting
        // it complete is how a pending effect used to be abandoned.
        await expect(noCredentials.processor.process(noCredentials.job, 'worker-token'))
            .rejects.toBeInstanceOf(DelayedError);
        expect(noCredentials.dispatchOutbox.failPreflight).toHaveBeenCalledWith(tenantId, dispatchId,
            expect.objectContaining({ errorCode: expect.stringContaining('channel_credentials_unavailable') }));
        expect(noCredentials.sendStrict).not.toHaveBeenCalled();

        const notEntitled = harness({ entitled: false });
        await expect(notEntitled.processor.process(notEntitled.job)).resolves.toContain('dispatch:');
        expect(notEntitled.sendStrict).not.toHaveBeenCalled();
    });

    it('lets the atomic authority adopt a slot even when a stale read says the window is full', async () => {
        const h = harness({ overLimit: true, outcome: { kind: 'accepted', receipt: 'wamid.ADOPTED' } });
        await expect(h.processor.process(h.job, 'worker-token')).resolves.toBe('dispatch:sent:wamid.ADOPTED');
        expect(h.throttle.isOverLimit).not.toHaveBeenCalled();
        expect(h.throttle.reserveActionUsage).toHaveBeenCalledWith(
            tenantId, 'outbound', `dispatch:${dispatchId}`,
        );
        expect(h.sendStrict).toHaveBeenCalledTimes(1);
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

    describe('a refusal that arrives after the row already ended', () => {
        it('ends the job like the early terminal check instead of failing it into Sentry', async () => {
            // Production, 2026-09-17: `dispatch_terminal:suppressed` thrown out of
            // the preflight. The row ended between the processor's read and the
            // refusal, so there was nothing left to record — the throw only
            // failed the job and paged somebody about a decision already made.
            const h = harness({ credentials: false });
            h.dispatchOutbox.failPreflight.mockRejectedValueOnce(
                new DispatchOutboxError('dispatch_terminal:suppressed'));
            await expect(h.processor.process(h.job, 'worker-token')).resolves.toBe('dispatch:suppressed');
            expect(h.dispatchOutbox.failPreflight).toHaveBeenCalledTimes(1);
            expect(h.dispatchOutbox.admit).not.toHaveBeenCalled();
            expect(h.sendStrict).not.toHaveBeenCalled();
            // A terminal row keeps no job: parking it would only bring the same
            // answer back later.
            expect(h.job.moveToDelayed).not.toHaveBeenCalled();
        });

        it('does the same for every terminal state, not only suppressed', async () => {
            for (const state of ['sent', 'stored', 'reconciliation_required'] as const) {
                const h = harness({ strict: false });
                h.dispatchOutbox.failPreflight.mockRejectedValueOnce(
                    new DispatchOutboxError(`dispatch_terminal:${state}`));
                await expect(h.processor.process(h.job)).resolves.toBe(`dispatch:${state}`);
                expect(h.sendStrict).not.toHaveBeenCalled();
            }
        });

        it('keeps a live or lapsed permission somebody else holds an error, as before', async () => {
            // Not the same problem. `admitted` is not a decision that was made:
            // the holder's outcome is still missing, and completing this job
            // would close the work with nobody knowing whether it was sent.
            const h = harness({ credentials: false });
            h.dispatchOutbox.failPreflight.mockRejectedValueOnce(new DispatchOutboxError('dispatch_lease_active'));
            await expect(h.processor.process(h.job)).rejects.toMatchObject({ code: 'dispatch_lease_active' });
            expect(h.sendStrict).not.toHaveBeenCalled();
        });

        it('keeps any other failure to record the refusal an error, as before', async () => {
            const h = harness({ credentials: false });
            const broken = new Error('could not write the refusal');
            h.dispatchOutbox.failPreflight.mockRejectedValueOnce(broken);
            await expect(h.processor.process(h.job)).rejects.toBe(broken);
        });

        it('does not record a second refusal over the suppression admission already committed', async () => {
            // The deterministic way to reach the production throw, with no race
            // at all: the agent was edited (or the reminder cancelled, or the
            // operator removed) while the reply waited. `admit` suppresses the
            // row in its own transaction, commits, and says
            // `dispatch_effect_superseded`. That code used to fall through to the
            // generic permanent preflight, which re-opened the row, found it
            // suppressed and threw `dispatch_terminal:suppressed`.
            const h = harness({ admit: async () => { throw new DispatchOutboxError('dispatch_effect_superseded'); } });
            h.dispatchOutbox.read
                .mockResolvedValueOnce(row())
                .mockResolvedValueOnce(row({ state: 'suppressed', attempts: 1,
                    errorCode: 'agent_agent_operational_revision_changed' }));
            await expect(h.processor.process(h.job))
                .resolves.toBe('dispatch:suppressed:agent_agent_operational_revision_changed');
            expect(h.dispatchOutbox.failPreflight).not.toHaveBeenCalled();
            expect(h.dispatchOutbox.settle).not.toHaveBeenCalled();
            expect(h.sendStrict).not.toHaveBeenCalled();
        });
    });

    it('suppresses a row erasure emptied while its job waited, instead of crashing on the binding', async () => {
        // A `failed` row keeps a delayed job. Erasure redacts rows in every
        // state, so when that job fires the binding is null — and reading
        // `binding.channelType` threw a TypeError before admission, which is
        // the one step that knows a redacted row can never be sent.
        const h = harness({ current: row({ state: 'failed', attempts: 1, redacted: true,
            binding: null, payload: null }) });
        await expect(h.processor.process(h.job)).resolves.toBe('dispatch:suppressed:dispatch_redacted');
        expect(h.dispatchOutbox.failPreflight).toHaveBeenCalledWith(tenantId, dispatchId,
            { errorCode: 'dispatch_redacted', permanent: true });
        expect(h.channelGateway.getStrictTransport).not.toHaveBeenCalled();
        expect(h.sendStrict).not.toHaveBeenCalled();
    });

    it('records WHICH connection refusal stopped the credential, not the first words of its prose', async () => {
        // The message is "Could not resolve a whatsapp connection for tenant …",
        // and the sixty characters kept of it end inside the tenant id. The code
        // — `credential_not_client_scoped`, `connection_disconnected`,
        // `connection_state_unreadable` — was the part an operator needed.
        const h = harness();
        (h as any).processor.channelToken.getChannelToken = jest.fn(async () => {
            throw new ConnectionRefusedError('credential_not_client_scoped',
                { tenantId, channelType: 'whatsapp', requestedAccountId: 'phone-1', detail: 'provider_system_user' });
        });
        await expect(h.processor.process(h.job, 'worker-token')).rejects.toBeInstanceOf(DelayedError);
        expect(h.dispatchOutbox.failPreflight).toHaveBeenCalledWith(tenantId, dispatchId,
            { errorCode: 'channel_credentials_unavailable:credential_not_client_scoped' });
    });
});
