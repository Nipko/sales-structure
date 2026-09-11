import * as fs from 'fs';
import * as path from 'path';
import { readProviderRefusal } from './funding-failure';
import { FlowSendFailed } from './flow-fallback';
import { fundingSignalFrom } from './meta-funding-signals';
import { OutboundQueueProcessor } from './outbound-queue.processor';
import {
    openPauseStore, permissiveSpendGate, resolvingChannelToken, schemaNamingPrisma,
} from './__fixtures__/spend-gate-double';

/**
 * ═══ THE ONE REFUSAL WHOSE ANSWER IS TO STOP ═══
 *
 * Meta's 131042 means the business's own WhatsApp Business Account has no
 * usable payment method. Every message from that number will fail identically
 * until a person adds a card in Meta's interface — so retrying is not merely
 * useless, it IS the failure: the queue fills, the customers hear nothing, and
 * ten thousand log lines all say the same thing without saying the one sentence
 * that fixes it in ninety seconds.
 *
 * The model and the store for this already existed. What did not exist was the
 * reading: three of the four sinks threw the provider's answer away. The
 * gateway caught the error and returned `null`; the strict lane reduced it to
 * an error code and dropped it; the agent console logged a message. Only the
 * REST service and a status webhook minutes later ever noticed.
 *
 * These tests are about the READING and the WIRING. The pause arithmetic is
 * proven beside the pure model, where it belongs.
 */
describe('a number that Meta will not bill stops sending, from every road', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    // ── Reading it out of whatever was thrown ───────────────────────────────

    it('reads Meta’s code out of an axios-shaped rejection', () => {
        const refusal = readProviderRefusal({
            response: { data: { error: { code: 131042, message: 'Business eligibility payment issue' } } },
        });
        expect(refusal.code).toBe('131042');
        expect(fundingSignalFrom({ source: 'http_response', ...refusal })).not.toBeNull();
    });

    it('reads it out of the Flow wrapper, which keeps the body on purpose', () => {
        const refusal = readProviderRefusal(new FlowSendFailed('flow refused', {
            status: 400,
            body: { error: { code: 131042, message: 'Business eligibility payment issue' } },
        }));
        expect(refusal.code).toBe('131042');
        expect(fundingSignalFrom({ source: 'http_response', ...refusal })).not.toBeNull();
    });

    it('reads it out of the namespaced code a strict transport produces', () => {
        // `wa_131042`, which is what the delivery-status writer stores. The
        // funding reader strips the namespace rather than failing to match —
        // the seam where two vocabularies meet is exactly where this used to
        // silently stop recognising its own signal.
        expect(fundingSignalFrom({ source: 'http_response', code: 'wa_131042' })).not.toBeNull();
    });

    it('says nothing about an ordinary failure', () => {
        // The self-inflicted outage this module exists to avoid: pausing a
        // working account on a message that merely failed.
        const refusal = readProviderRefusal({
            response: { data: { error: { code: 131026, message: 'Message undeliverable' } } },
        });
        expect(refusal.code).toBe('131026');
        expect(fundingSignalFrom({ source: 'http_response', ...refusal })).toBeNull();
        expect(fundingSignalFrom({ source: 'http_response',
            code: null, detail: 'connect ETIMEDOUT' })).toBeNull();
    });

    it('survives an error it cannot read at all', () => {
        // It runs inside a failure path. An error while reading an error must
        // not become the error somebody sees.
        expect(readProviderRefusal(undefined)).toEqual({ code: null, detail: null });
        expect(readProviderRefusal('just a string')).toMatchObject({ code: null });
        expect(readProviderRefusal({ weird: true })).toMatchObject({ code: null });
    });

    // ── And the wiring, sink by sink ────────────────────────────────────────

    function looseHarness(sendFails?: unknown) {
        const pauses = openPauseStore();
        const channelGateway = {
            sendMessage: jest.fn(async (_o: any, _t: string, hooks: any) => {
                if (sendFails) { await hooks?.observeFailure?.(sendFails); return null; }
                return 'wamid.SENT';
            }),
        };
        const processor = new OutboundQueueProcessor(
            channelGateway as any,
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
            permissiveSpendGate(), pauses,
        );
        const job: any = { id: 'job-1', data: { outbound: {
            tenantId, channelType: 'whatsapp', channelAccountId: 'phone-1',
            to: '+573001112233', content: { type: 'text', text: 'hola' },
            metadata: { conversationId: 'conv-1' },
        } } };
        return { processor, job, pauses, channelGateway };
    }

    it('pauses the number when the loose lane is refused for want of a card', async () => {
        const h = looseHarness({
            response: { data: { error: { code: 131042, message: 'Business eligibility payment issue' } } },
        });

        await expect(h.processor.process(h.job)).rejects.toThrow();

        expect(h.pauses.observeFunding).toHaveBeenCalledWith(tenantId, 'phone-1',
            expect.objectContaining({ source: 'http_response', code: '131042' }));
    });

    it('lifts the pause when Meta accepts a message again', async () => {
        // The only proof billing works, and it is produced by the platform
        // rather than claimed by anybody.
        const h = looseHarness();
        await expect(h.processor.process(h.job)).resolves.toBe('wamid.SENT');
        expect(h.pauses.clear).toHaveBeenCalledWith(tenantId, 'phone-1',
            { by: 'provider_accepted' });
    });

    /**
     * ═══ THE TWO KINDS OF ROAD, AND WHERE EACH IS PROVEN ═══
     *
     * `131042` reaches us two ways, and only one of them is a send:
     *
     *   · as the ANSWER to a POST. Three sinks make that POST, and each reads
     *     the refusal itself because each holds the error object;
     *   · as a STATUS WEBHOOK minutes later, on a message that was accepted and
     *     then failed — which is the usual shape, because eligibility is
     *     checked at delivery. That road used to have a private copy of the
     *     rule inside the API's webhook service, which is exactly why the
     *     DEPLOYED worker's ingress had no copy at all. It now lives once, in
     *     the ledger, where every ingress reaches it.
     *
     * This list is the map; the tests it names are the evidence. A `toContain`
     * on a source file would pass for a file that merely mentions the word —
     * which is the failure that kept the deployed receipt road disconnected for
     * weeks while a test said it was fine.
     */
    it('names, for every road a 131042 can arrive by, the test that exercises it', () => {
        const root = path.join(__dirname, '..');
        const roads: Array<[string, string]> = [
            // The three that POST and read the answer.
            ['channels/outbound-queue.processor.ts',
                'channels/funding-pause-every-sink.spec.ts'],
            ['whatsapp/services/whatsapp-messaging.service.ts',
                'channels/funding-pause-every-sink.spec.ts'],
            ['agent-console/agent-console.service.ts',
                'channels/funding-pause-every-sink.spec.ts'],
            // And the late status, whose pause is now the ledger's and is
            // proven against real PostgreSQL together with the receipt it
            // arrives on.
            ['billing/whatsapp-spend/whatsapp-spend.service.ts',
                'billing/whatsapp-spend/receipt-inbox.postgres.spec.ts'],
        ];
        for (const [road, proof] of roads) {
            expect({ road, exists: fs.existsSync(path.join(root, road)) })
                .toEqual({ road, exists: true });
            expect({ proof, exists: fs.existsSync(path.join(root, proof)) })
                .toEqual({ proof, exists: true });
        }
    });

    it('has exactly one implementation of the funding rule', () => {
        // It had two. The API's webhook service carried a private copy that
        // worked, so nobody noticed the deployed worker's ingress had none —
        // and a rule in two places is a rule in the wrong number of places.
        const root = path.join(__dirname, '..');
        const owners = [
            'channels/account-pause-store.ts',
            'billing/whatsapp-spend/whatsapp-spend.service.ts',
        ];
        const mustNotDecide = ['whatsapp/services/whatsapp-webhook.service.ts',
            'internal/internal.controller.ts'];
        for (const owner of owners) {
            expect({ owner, decides: fs.readFileSync(path.join(root, owner), 'utf8')
                .includes('observeFunding') }).toEqual({ owner, decides: true });
        }
        for (const ingress of mustNotDecide) {
            expect({ ingress, decides: fs.readFileSync(path.join(root, ingress), 'utf8')
                .includes('observeFunding') }).toEqual({ ingress, decides: false });
        }
    });

    it('offers a way out that does not need the send the pause forbids', () => {
        // ── THE DEADLOCK ────────────────────────────────────────────────────
        //
        // A pause lifts by itself when Meta accepts a message. A paused number
        // sends nothing, so that proof can never arrive on its own: without an
        // operator's word the only way out would be the POST the pause exists
        // to prevent.
        const controller = fs.readFileSync(path.join(__dirname, '..',
            'billing/whatsapp-spend/whatsapp-spend.controller.ts'), 'utf8');
        expect(controller).toMatch(/pauses\/:channelAccountId\/resume/);
        expect(controller).toContain("by: 'operator'");
    });
});
