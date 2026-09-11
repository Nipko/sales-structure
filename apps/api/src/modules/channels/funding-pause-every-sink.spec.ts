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

    it('has all four sinks reading the refusal, and a way out that needs no send', () => {
        // Structural, and deliberately so: the alternative is discovering in
        // production that the road a particular tenant's messages take is the
        // one nobody connected. Each of these four can put a WhatsApp message
        // on a phone, so each of them can meet a 131042.
        const root = path.join(__dirname, '..');
        for (const [relative, needle] of [
            ['channels/outbound-queue.processor.ts', 'observeFunding'],
            ['whatsapp/services/whatsapp-messaging.service.ts', 'observeFunding'],
            ['agent-console/agent-console.service.ts', 'observeFunding'],
            ['whatsapp/services/whatsapp-webhook.service.ts', 'observeFunding'],
        ] as const) {
            expect(fs.readFileSync(path.join(root, relative), 'utf8')).toContain(needle);
        }

        // ── AND THE DEADLOCK ────────────────────────────────────────────────
        //
        // A pause lifts by itself when Meta accepts a message. A paused number
        // sends nothing, so that proof can never arrive on its own: without an
        // operator's word the only way out would be the POST the pause exists
        // to prevent.
        const controller = fs.readFileSync(
            path.join(root, 'billing/whatsapp-spend/whatsapp-spend.controller.ts'), 'utf8');
        expect(controller).toMatch(/pauses\/:channelAccountId\/resume/);
        expect(controller).toContain("by: 'operator'");
    });
});
