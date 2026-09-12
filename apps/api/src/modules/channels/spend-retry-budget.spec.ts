import { OutboundQueueProcessor } from './outbound-queue.processor';
import { spendRetryDelaySeconds } from '../billing/whatsapp-spend/spend-diagnosis';
import {
    openPauseStore, resolvingChannelToken, schemaNamingPrisma,
} from './__fixtures__/spend-gate-double';

/**
 * ═══ THE LADDER HAS TO BE ASKED FOR, NOT JUST DEFINED ═══
 *
 * `spendRetryDelaySeconds` says how long an effect held by a condition that can
 * clear should wait before being asked about again, and its own unit tests
 * prove the arithmetic. None of that matters if the lane never passes it: the
 * outbox defaults to thirty seconds, which is the two-minute window the review
 * measured and the reason this function exists.
 *
 * A number nobody reads is the same defect as a comment nobody honours, one
 * layer down. These cases drive the real `processDispatch` with doubles and
 * read what reached `settle`.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';
const DISPATCH = '22222222-2222-2222-2222-222222222222';

describe('a refusal that can clear is held for as long as the ladder says', () => {
    const harness = (block: { code: string }, attempts: number) => {
        const settles: any[] = [];
        const row = {
            id: DISPATCH,
            state: 'pending',
            attempts,
            originKind: 'reactive',
            operationalScope: {},
            itemKind: 'text',
            itemIndex: 0,
            batchId: null,
            payload: { text: 'hola' },
            binding: {
                recipient: '+573001112233',
                channelAccountId: 'phone-1',
                contactId: null,
                inboundMessageId: null,
                conversationId: '33333333-3333-3333-3333-333333333333',
                messageId: null,
                jobId: null,
            },
        };
        const dispatchOutbox = {
            read: jest.fn(async () => row),
            admit: jest.fn(async () => ({ row, leaseToken: 'lease-1' })),
            settle: jest.fn(async (_t: string, _d: string, _l: string, outcome: any) => {
                settles.push(outcome);
                // `failed` with a future date is what sends the lane into
                // `waitUntil`, which is where the delay becomes observable.
                return {
                    state: 'failed',
                    availableAt: new Date(Date.now() + (outcome.retryInSeconds ?? 30) * 1000),
                };
            }),
        };
        const spendGate = {
            admit: jest.fn(async () => ({ permitted: false, effectKey: 'k', enforcement: 'enforce', block })),
            observe: jest.fn(async () => undefined),
        };
        const processor = new OutboundQueueProcessor(
            {
                sendMessage: jest.fn(async () => 'wamid.SENT'),
                // The strict transport is resolved before the money question is
                // asked. It must never be REACHED here — a refused effect that
                // still posts is the defect the gate exists for — so it throws.
                getStrictTransport: () => ({
                    sendStrict: jest.fn(async () => { throw new Error('must not send a refused effect'); }),
                }),
            } as any,
            { isOverLimit: jest.fn(async () => false), recordUsage: jest.fn(async () => undefined) } as any,
            resolvingChannelToken() as any,
            { get: jest.fn(async () => null), set: jest.fn(async () => undefined) } as any,
            { send: jest.fn() } as any,
            schemaNamingPrisma({
                tenant: { findUnique: jest.fn(async () => ({
                    isInternal: false, subscriptionStatus: 'active',
                    subscription: { status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                        currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
                })) },
            }),
            spendGate as any, openPauseStore(),
        );
        (processor as any).dispatchOutbox = dispatchOutbox;

        const delayedTo: number[] = [];
        const job: any = {
            id: 'job-1',
            data: { dispatch: { tenantId: TENANT, dispatchId: DISPATCH } },
            moveToDelayed: jest.fn(async (at: number) => { delayedTo.push(at); }),
        };
        return { processor, job, settles, delayedTo, dispatchOutbox };
    };

    const drive = async (h: ReturnType<typeof harness>) => {
        // The lane signals a deliberate wait by throwing `DelayedError` after
        // moving the job. Swallowed here: what is under test is what it asked
        // for on the way out, not how it announces it.
        try {
            return await (h.processor as any).processDispatch(
                { tenantId: TENANT, dispatchId: DISPATCH }, h.job, 'token');
        } catch (error: any) {
            return `threw:${error?.name}`;
        }
    };

    it('passes the ladder value instead of letting the outbox default to thirty seconds', async () => {
        const h = harness({ code: 'timezone_missing' }, 1);
        await drive(h);

        expect(h.settles).toHaveLength(1);
        expect(h.settles[0]).toMatchObject({ kind: 'failed', errorCode: 'spend_timezone_missing' });
        // The whole point. Thirty seconds here is the defect this fixes.
        expect(h.settles[0].retryInSeconds).toBe(spendRetryDelaySeconds(1));
        expect(h.settles[0].retryInSeconds).toBeGreaterThan(30);
    });

    it('grows the wait as the attempts are spent', async () => {
        // A funding pause somebody is already looking at deserves a fast second
        // ask; a template category nobody knows is missing does not deserve
        // four of them inside two minutes.
        const asked: number[] = [];
        for (const attempt of [1, 2, 3, 4]) {
            const h = harness({ code: 'payer_unknown' }, attempt);
            await drive(h);
            asked.push(h.settles[0].retryInSeconds);
        }
        expect(asked).toEqual([1, 2, 3, 4].map(spendRetryDelaySeconds));
        for (let i = 1; i < asked.length; i++) expect(asked[i]).toBeGreaterThan(asked[i - 1]);
        // And the window the docblock is entitled to claim.
        expect(asked.reduce((a, b) => a + b, 0)).toBeGreaterThan(30 * 60);
    });

    it('waits by moving the job, never by sleeping on the worker', async () => {
        // The reason a fifty-minute backoff is affordable at all. If this lane
        // slept, the same change would hold a worker slot for the duration and
        // the ladder would be a denial of service rather than a courtesy.
        const h = harness({ code: 'timezone_missing' }, 3);
        await drive(h);
        expect(h.job.moveToDelayed).toHaveBeenCalled();
        const waited = h.delayedTo[0] - Date.now();
        expect(waited).toBeGreaterThan(spendRetryDelaySeconds(3) * 1000 * 0.8);
    });

    it('hands the row back when the send right cannot be taken, instead of abandoning it', async () => {
        // `beginOrStandDown` returns false when the right was taken OR on ANY
        // exception -- after a schema lookup and a write, so a transient
        // database blip is enough. The lane used to return without settling,
        // under a comment saying the item stayed claimable.
        //
        // It did not. The row was left `admitted` holding a live lease, every
        // later admission refuses an `admitted` row, and the lease sweep then
        // moves it to `reconciliation_required` -- TERMINAL. A message that
        // provably never reached a provider became permanently undeliverable,
        // and was filed for a human to reconcile as one that MIGHT have been
        // delivered.
        const h = harness({ code: 'none' }, 1);
        // Permitted by the gate, refused by the transmission lock.
        (h.processor as any).spendGate.admit = jest.fn(async () => ({
            permitted: true, effectKey: 'k', enforcement: 'observe', transmit: true,
        }));
        (h.processor as any).beginOrStandDown = jest.fn(async () => false);

        const outcome = await drive(h);

        expect(h.settles).toHaveLength(1);
        expect(h.settles[0]).toMatchObject({ kind: 'failed', errorCode: 'transmission_not_owned' });
        // `failed`, never `suppressed`: nothing was decided about this message,
        // only that this worker could not carry it.
        expect(h.settles[0].kind).not.toBe('suppressed');
        // And it is RETRIED rather than completed: the lane moves the job to the
        // date the database chose and signals that by throwing `DelayedError`,
        // which is how a deliberate wait is expressed here. The old branch
        // returned a string, which COMPLETES the job -- so nothing ever came
        // back for the row it had just abandoned.
        expect(String(outcome)).toBe('threw:DelayedError');
        expect(h.job.moveToDelayed).toHaveBeenCalled();
    });

    it('still SUPPRESSES a refusal that cannot clear, with no wait at all', async () => {
        // The other half, and the one that must not be softened: a ceiling is a
        // decision. It does not become permissive by asking again, so asking
        // again is how a tenant's declared limit quietly stops meaning anything.
        const h = harness({ code: 'ceiling_reached' }, 1);
        const outcome = await drive(h);

        expect(h.settles).toHaveLength(1);
        expect(h.settles[0].kind).toBe('suppressed');
        expect(h.settles[0].retryInSeconds).toBeUndefined();
        expect(h.job.moveToDelayed).not.toHaveBeenCalled();
        expect(String(outcome)).toContain('suppressed');
    });
});
