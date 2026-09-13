import { OutboundQueueProcessor } from './outbound-queue.processor';
import { FlowSendFailed } from './flow-fallback';

/**
 * ═══ A REFUSAL NOBODY COULD REPLACE IS STILL A REFUSAL ═══
 *
 * Meta refuses a Flow definitively — unpublished, wrong id, a 400 that says so.
 * Nothing was delivered. The gateway offers the caller a text as a SECOND
 * effect, which needs its own authorisation, and sometimes that authorisation
 * is refused: the ceiling is full, or the money authority cannot be reached.
 *
 * The Flow is over either way. But the outcome reader only saw "no message id
 * came back" and filed it as a TIMEOUT — the outcome that means "nobody can say
 * whether it arrived" and therefore never releases. So the whole reservation
 * was retained as `indeterminate` for a message provably never sent: the
 * ceiling filled with it, the exposure report showed it, and a person was
 * eventually asked to decide by hand something whose answer was in a log line
 * from twenty minutes earlier.
 *
 * These tests are about WHICH OUTCOME is recorded, so they watch the outcome
 * writer rather than the ledger — the ledger's own rules for each outcome are
 * proven beside it against real PostgreSQL.
 */
describe('what a conclusively refused Flow does to the money', () => {
    const outbound = (over: Record<string, unknown> = {}) => ({
        tenantId: '11111111-1111-4111-8111-111111111111',
        channelType: 'whatsapp',
        channelAccountId: '15550001111',
        to: '15559998888',
        content: { type: 'text', text: 'Elegí un horario' },
        metadata: { flowId: 'flow-1', flowToken: 'tok', conversationId: 'conv-1' },
        ...over,
    }) as any;

    function harness(options: { fallbackAuthorised?: boolean } = {}) {
        const outcomes: Array<{ admission: any; outcome: any }> = [];
        const processor: any = Object.create(OutboundQueueProcessor.prototype);
        Object.assign(processor, {
            prisma: { getTenantSchemaName: async () => 'tenant_acme' },
            spendGate: {
                record: jest.fn(async (_schema: string, admission: any, outcome: any) => {
                    outcomes.push({ admission, outcome });
                }),
            },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            fallbackAdmissions: new WeakMap(),
            conclusivelyRefusedFlows: new WeakSet(),
        });
        // The real hook builder, with the fallback's own admission stubbed at
        // the one place the money authority answers.
        processor.admitFlowFallback = jest.fn(async () => {
            if (!options.fallbackAuthorised) return false;
            processor.fallbackAdmissions.set(current, { effectKey: 'fallback-effect' });
            return true;
        });
        let current: any;
        return {
            processor, outcomes,
            hooksFor: (message: any) => {
                current = message;
                return OutboundQueueProcessor.prototype['flowHooks']
                    .call(processor, message, 'outbound_queue', 'reactive', { jobId: 'job-1' });
            },
        };
    }

    const admission = { effectKey: 'flow-effect', permitted: true };

    it('releases the reservation when no fallback could be authorised', async () => {
        // THE DEFECT. Meta said no; nothing went out; the money goes back.
        const h = harness({ fallbackAuthorised: false });
        const message = outbound();
        const hooks = h.hooksFor(message);

        expect(await hooks.admitFallback('flow_not_published')).toBe(false);
        await h.processor.recordSpend(message, admission, null);

        expect(h.outcomes).toHaveLength(1);
        expect(h.outcomes[0].outcome).toEqual({
            kind: 'rejected', errorCode: 'flow_rejected_without_fallback',
        });
    });

    it('does not call it a timeout, which would never release', async () => {
        const h = harness({ fallbackAuthorised: false });
        const message = outbound();
        await h.hooksFor(message).admitFallback('flow_not_published');
        await h.processor.recordSpend(message, admission, null);
        expect(h.outcomes.map(entry => entry.outcome.kind)).not.toContain('timeout');
    });

    it('still records two effects when the fallback WAS authorised', async () => {
        // The existing shape, unchanged: the Flow is rejected and the text
        // carries the receipt.
        const h = harness({ fallbackAuthorised: true });
        const message = outbound();
        expect(await h.hooksFor(message).admitFallback('flow_not_published')).toBe(true);
        await h.processor.recordSpend(message, admission, 'wamid.TEXT');

        expect(h.outcomes.map(entry => entry.outcome)).toEqual([
            { kind: 'rejected', errorCode: 'flow_rejected' },
            { kind: 'accepted', providerMessageId: 'wamid.TEXT' },
        ]);
    });

    it('keeps calling an ambiguous failure a timeout, because it is one', async () => {
        // The mark is only set by `admitFallback`, and the gateway only calls
        // that after classifying the failure as CONCLUSIVE. A timeout never
        // reaches the hook, so nothing is marked and nothing is released —
        // which is the whole point: a request whose answer was lost may well
        // have put a message on a phone.
        const h = harness();
        const message = outbound();
        h.hooksFor(message); // built, never invoked
        await h.processor.recordSpend(message, admission, null);
        expect(h.outcomes[0].outcome).toEqual({ kind: 'timeout' });
    });

    it('does not leak the mark from one message to the next', async () => {
        // `recordSpend` clears it. Two sends of the same job object — a retry
        // that reuses the payload — must not make the second one release on the
        // strength of the first one's refusal.
        const h = harness({ fallbackAuthorised: false });
        const message = outbound();
        await h.hooksFor(message).admitFallback('flow_not_published');
        await h.processor.recordSpend(message, admission, null);
        h.outcomes.length = 0;

        await h.processor.recordSpend(message, admission, null);
        expect(h.outcomes[0].outcome).toEqual({ kind: 'timeout' });
    });

    it('passes the funding observer through, so a 131042 on a Flow still pauses', async () => {
        // The hooks are built in one place now; this pins that the second one
        // did not get lost in the move.
        const h = harness();
        const message = outbound();
        h.processor.observeFunding = jest.fn(async () => undefined);
        const hooks = h.hooksFor(message);
        await hooks.observeFailure(new FlowSendFailed('payment', { status: 400 }));
        expect(h.processor.observeFunding).toHaveBeenCalled();
    });
});
