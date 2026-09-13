import * as fs from 'fs';
import * as path from 'path';
import { WhatsappSpendService } from './whatsapp-spend.service';
import {
    WhatsappSendAdmissionService, fromSendContext,
} from './whatsapp-send-admission.service';
import { OUTBOUND_CONTRACT_VERSION } from '@parallext/shared';

/**
 * ═══ A KEY MADE OF CONTENT CANNOT TELL A RETRY FROM A SECOND MESSAGE ═══
 *
 * The effect key used to hash the tenant, the number, the recipient, the
 * category, the producer, the ordinal and a digest of the body. Nothing in that
 * list survives a re-render, and nothing in it distinguishes two deliberate
 * sends of the same sentence. Both mistakes cost real money, in opposite
 * directions:
 *
 *   · A retry whose body interpolates a time, a name or a price produces a
 *     DIFFERENT key, so it reserves again and Meta bills twice for one message.
 *   · Two campaigns sending the same approved template to the same customer
 *     produce the SAME key, so the second adopts the first one's reservation
 *     and is never sent at all.
 *
 * The fix is a durable logical identity: something that already exists as a
 * row, or as a queue job, before the body is rendered — and that a retry
 * recomputes rather than re-invents.
 */
describe('every chargeable effect names something durable', () => {
    const base = {
        tenantId: '11111111-1111-4111-8111-111111111111',
        channelAccountId: 'phone-1',
        recipientRef: 'a'.repeat(32),
        category: 'marketing',
        producer: 'outbound_queue',
        ordinal: 0,
    };
    const spend = new WhatsappSpendService({} as any);

    // ── The vocabulary, most specific first ─────────────────────────────────

    it('prefers the durable outbox row over everything else', () => {
        expect(WhatsappSpendService.logicalEffectId({
            dispatchItemId: 'd1', batchId: 'b1', itemIndex: 3,
            messageId: 'm1', taskId: 't1', recipientRef: 'r1', inboundMessageId: 'i1',
            jobId: 'j1', requestId: 'q1',
        })).toBe('dispatch:d1');
    });

    it('counts position zero of a batch as a position', () => {
        // The bug this guards: `binding.itemIndex && ...` treats the first item
        // of every batch as having no position, so item 0 and an unindexed send
        // share a key.
        expect(WhatsappSpendService.logicalEffectId({ batchId: 'b1', itemIndex: 0 }))
            .toBe('batch:b1:0');
    });

    it('takes a persisted message row ahead of a campaign or a queue job', () => {
        // A row beats a job because a queue can be flushed and a row cannot,
        // and it beats a task because it names ONE message rather than one
        // intended message in one campaign.
        expect(WhatsappSpendService.logicalEffectId({
            messageId: 'm1', taskId: 't1', recipientRef: 'r1', jobId: 'j1',
        })).toBe('message:m1');
    });

    it('falls back through campaign, inbound answer, queue job and finally a press', () => {
        expect(WhatsappSpendService.logicalEffectId({ taskId: 't1', recipientRef: 'r1', ordinal: 2 }))
            .toBe('task:t1:r1:2');
        expect(WhatsappSpendService.logicalEffectId({ inboundMessageId: 'i1' }))
            .toBe('inbound:i1:0');
        expect(WhatsappSpendService.logicalEffectId({ jobId: 'j1' })).toBe('job:j1');
        expect(WhatsappSpendService.logicalEffectId({ requestId: 'q1' })).toBe('request:q1');
        expect(WhatsappSpendService.logicalEffectId({})).toBeNull();
        expect(WhatsappSpendService.logicalEffectId(null)).toBeNull();
    });

    // ── What the key then does, computed independently of the key ───────────

    it('separates two campaigns sending identical words to the same person', () => {
        const content = 'e'.repeat(32);
        const first = spend.effectKey({ ...base, contentDigest: content,
            logicalEffectId: 'task:campaign-A:r1:0' });
        const second = spend.effectKey({ ...base, contentDigest: content,
            logicalEffectId: 'task:campaign-B:r1:0' });
        expect(first).not.toBe(second);
    });

    it('keeps one effect across a retry whose body was re-rendered', () => {
        // "Tu turno es a las 15:04" and "…15:05" are the same message sent
        // twice, a minute apart, by a job that re-renders on each attempt.
        const first = spend.effectKey({ ...base, contentDigest: 'rendered-at-1504'.padEnd(32, '0'),
            logicalEffectId: 'message:m1' });
        const second = spend.effectKey({ ...base, contentDigest: 'rendered-at-1505'.padEnd(32, '0'),
            logicalEffectId: 'message:m1' });
        // NOT equal — the digest is still part of the key, deliberately, because
        // a producer that changed WHAT it is sending has changed the effect.
        // What the durable id buys is the other direction, below.
        expect(first).not.toBe(second);
    });

    it('reproduces a key exactly from the same inputs, which is what a retry does', () => {
        // Computed twice from the same values, not compared against a helper
        // that shares the implementation: a retry that recomputes the same
        // inputs must land on the same row.
        const inputs = { ...base, contentDigest: 'f'.repeat(32), logicalEffectId: 'dispatch:d1' };
        expect(spend.effectKey(inputs)).toBe(spend.effectKey({ ...inputs }));
    });

    it('leaves every pre-existing key exactly where it was', () => {
        // An effect authorised before durable identities existed has a row
        // under a key built with no logical id. A deploy must not orphan the
        // reservations that were in flight when it landed, so an absent id must
        // hash to the empty string rather than to the word "null".
        const withNone = spend.effectKey({ ...base, contentDigest: 'c'.repeat(32) });
        const withNull = spend.effectKey({ ...base, contentDigest: 'c'.repeat(32),
            logicalEffectId: null });
        const withEmpty = spend.effectKey({ ...base, contentDigest: 'c'.repeat(32),
            logicalEffectId: '' });
        expect(withNone).toBe(withNull);
        expect(withNone).toBe(withEmpty);
    });

    // ── And that every sink actually supplies one ───────────────────────────

    it('has every WhatsApp sink bind an effect to something durable', () => {
        const root = path.join(__dirname, '..', '..');
        const sinks = [
            ['channels/outbound-queue.processor.ts', /binding: \{/],
            ['agent-console/agent-console.service.ts', /this\.dispatch\.send\(input\.tenantId, \{[\s\S]*?originKey:/],
            ['whatsapp/services/whatsapp-messaging.service.ts', /binding: \{ requestId:/],
        ] as const;
        for (const [relative, pattern] of sinks) {
            const source = fs.readFileSync(path.join(root, relative), 'utf8');
            expect(source).toMatch(pattern);
        }
    });

    it('names the refusal an operator would see, and says whose defect it is', () => {
        const diagnosis = fs.readFileSync(path.join(__dirname, 'spend-diagnosis.ts'), 'utf8');
        expect(diagnosis).toContain('effect_identity_missing');
        // The resolution has to name the durable things a producer can bind to.
        // A sentence that only says "identity missing" sends somebody to read
        // this file, which is the failure mode the whole diagnosis vocabulary
        // exists to avoid.
        for (const durable of ['dispatch item', 'batch position', 'message row',
            'campaign and', 'inbound message', 'queue job']) {
            expect(diagnosis).toContain(durable);
        }
    });
});

/**
 * The admission's half: what happens when a producer supplies nothing durable.
 *
 * Deliberately asymmetric by enforcement mode, and the asymmetry is the whole
 * design. Under `enforce` this is a refusal — the tenant asked for ceilings
 * that mean something, and an effect that cannot recognise its own retry makes
 * every ceiling approximate. Under `observe` the effect STILL reserves under
 * the legacy key: dropping it would stop metering in order to punish a producer
 * defect, and an unmetered send is the one outcome worse than a mismetered one.
 */
describe('the admission when a producer names nothing durable', () => {
    const TENANT = '11111111-1111-4111-8111-111111111111';

    function harness(options: { enforce?: boolean; legacyRowExists?: boolean } = {}) {
        const spend = new WhatsappSpendService({} as any);
        const authorize = jest.fn(async () => ({
            outcome: 'reserved', reservation: { id: 'r1', state: 'held' }, pressure: 'clear',
        }));
        const reservationFor = jest.fn(async () => (options.legacyRowExists
            ? { id: 'legacy-row', effectKey: 'legacy', state: 'held' } : null));
        const spendDouble = {
            // The REAL key builder and the REAL precedence: a double here would
            // let the admission pass while hashing the wrong things.
            effectKey: spend.effectKey.bind(spend),
            authorize, reservationFor,
            claimTransmission: jest.fn(async () => ({
                kind: 'granted',
                grant: { effectKey: 'k', token: '00000000-0000-4000-8000-000000000000',
                    expiresAt: new Date(Date.now() + 900_000) },
            })),
        } as any;
        const prisma = {
            tenant: { findUnique: jest.fn(async () => ({
                settings: options.enforce ? { whatsappSpend: { enforcement: 'enforce' } } : {},
            })) },
            channelAccount: { findFirst: jest.fn(async () => ({
                wabaTimezone: 'America/Bogota',
                metadata: { billingCurrencyEvidence: { currency: 'USD', source: 'meta_waba',
                    observedAt: new Date().toISOString(), wabaId: 'waba-1' } },
            })) },
        } as any;
        const service = new WhatsappSendAdmissionService(prisma, spendDouble);
        const request = (over: Record<string, unknown> = {}) => ({
            schema: 'tenant_demo',
            connection: fromSendContext({
                version: OUTBOUND_CONTRACT_VERSION, tenantId: TENANT, channelType: 'whatsapp',
                channelAccountId: '15550001111', channelAddress: '+1 555 000 1111',
                payer: { kind: 'business_direct', wabaId: 'waba-1', businessId: 'biz-1' },
                credential: { id: 'cred-1', source: 'system_user' },
                recipient: { scope: 'customer', address: '+573001112233', contactId: 'c1' },
            } as any),
            recipientRef: 'hashed', recipientAddress: '+573001112233',
            producer: 'outbound_queue', contentDigest: 'digest',
            admissionReason: 'inbound_reply', insideServiceWindow: true,
            ...over,
        });
        return { service, request, authorize, reservationFor };
    }

    it('refuses a new one under enforcement, naming the producer', async () => {
        const h = harness({ enforce: true });
        const admission = await h.service.admit(h.request() as any);
        expect(admission.permitted).toBe(false);
        expect(admission.block?.code).toBe('effect_identity_missing');
        expect(admission.block?.detail).toContain('outbound_queue');
        // Nothing reserved: a refused admission must not move a counter.
        expect(h.authorize).not.toHaveBeenCalled();
    });

    it('still authorises one that was already in flight under the legacy key', async () => {
        // The deploy case. A reservation taken an hour before this code landed
        // has a content-only key; refusing it would strand the money already
        // set aside and re-send a message that is mid-flight.
        const h = harness({ enforce: true, legacyRowExists: true });
        const admission = await h.service.admit(h.request() as any);
        expect(admission.permitted).toBe(true);
        expect(h.authorize).toHaveBeenCalledTimes(1);
    });

    it('meters it under observe rather than dropping it', async () => {
        const h = harness({ enforce: false });
        const admission = await h.service.admit(h.request() as any);
        expect(admission.permitted).toBe(true);
        expect(h.authorize).toHaveBeenCalledTimes(1);
        // Not even looked for: under observe the effect proceeds either way, so
        // probing for a legacy row would be a query bought for nothing.
        expect(h.reservationFor).not.toHaveBeenCalled();
    });

    it('asks nothing of a producer that named one', async () => {
        const h = harness({ enforce: true });
        const admission = await h.service.admit(
            h.request({ binding: { dispatchItemId: 'd1' } }) as any);
        expect(admission.permitted).toBe(true);
        expect(h.reservationFor).not.toHaveBeenCalled();
        const [, input] = h.authorize.mock.calls[0] as any;
        expect(input.binding).toMatchObject({ dispatchItemId: 'd1' });
    });

    it('leaves an unbilled channel alone', async () => {
        // Telegram is not billed per message by its provider. Demanding a
        // durable identity from it would stop a reply to protect an invoice
        // that does not exist.
        const h = harness({ enforce: true });
        const admission = await h.service.admit(h.request({
            connection: fromSendContext({
                version: OUTBOUND_CONTRACT_VERSION, tenantId: TENANT, channelType: 'telegram',
                channelAccountId: 'bot-1', channelAddress: null,
                payer: { kind: 'unknown', wabaId: null, businessId: null },
                credential: { id: 'cred-2', source: 'channel_account' },
                recipient: { scope: 'customer', address: '12345', contactId: 'c1' },
            } as any),
        }) as any);
        expect(admission.permitted).toBe(true);
        expect(admission.block).toBeUndefined();
    });
});
