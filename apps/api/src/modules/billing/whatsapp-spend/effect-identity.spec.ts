import { WhatsappSpendService } from './whatsapp-spend.service';
import { WhatsappSendAdmissionService, fromSendContext } from './whatsapp-send-admission.service';
import { OUTBOUND_CONTRACT_VERSION } from '@parallext/shared';

/**
 * ═══ ONE KEY PER LOGICAL EFFECT, AND ONE POST PER KEY ═══
 *
 * Two defects with one shape.
 *
 * The key hashed who, what and how — tenant, number, recipient, category,
 * producer, ordinal, content — and nothing durable. Two DIFFERENT campaigns
 * sending the same approved template to the same customer from the same number
 * produced the SAME key, so the second adopted the first one's reservation and
 * sent on a permission never granted to it.
 *
 * And adoption granted permission whatever state it found. `mayTransmit`
 * existed; no sink applied it. A retry that adopted a `settled` row was told to
 * go ahead: a second copy of a message already delivered and charged, with
 * nothing left to settle it against.
 */

const service = () => new WhatsappSpendService({} as any);

const base = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    channelAccountId: '15550001111',
    recipientRef: 'hashed-contact',
    category: 'marketing',
    producer: 'outbound_queue',
    ordinal: 0,
    contentDigest: 'same-approved-template',
};

describe('the key an effect gets', () => {
    it('separates two campaigns that send the same thing to the same person', () => {
        // The collision. Everything about the message is identical; only the
        // campaign differs, and the campaign is the effect.
        const first = service().effectKey({
            ...base,
            logicalEffectId: WhatsappSpendService.logicalEffectId(
                { taskId: 'campaign-a', recipientRef: base.recipientRef }),
        });
        const second = service().effectKey({
            ...base,
            logicalEffectId: WhatsappSpendService.logicalEffectId(
                { taskId: 'campaign-b', recipientRef: base.recipientRef }),
        });
        expect(first).not.toBe(second);
    });

    it('gives a retry of the SAME effect the same key', () => {
        // The other half: recomputable from durable facts, so a worker that
        // crashed finds its own row instead of minting a second one.
        const id = WhatsappSpendService.logicalEffectId({ dispatchItemId: 'item-1' });
        expect(service().effectKey({ ...base, logicalEffectId: id }))
            .toBe(service().effectKey({ ...base, logicalEffectId: id }));
    });

    it('leaves an effect with nothing durable exactly where it was', () => {
        // A deploy must not orphan the reservations in flight when it lands.
        expect(service().effectKey({ ...base, logicalEffectId: null }))
            .toBe(service().effectKey(base));
    });

    it('separates two items of one batch', () => {
        const first = WhatsappSpendService.logicalEffectId({ batchId: 'b1', itemIndex: 0 });
        const second = WhatsappSpendService.logicalEffectId({ batchId: 'b1', itemIndex: 1 });
        expect(first).not.toBe(second);
        expect(service().effectKey({ ...base, logicalEffectId: first }))
            .not.toBe(service().effectKey({ ...base, logicalEffectId: second }));
    });

    it('separates the second reply to one inbound message from the first', () => {
        expect(WhatsappSpendService.logicalEffectId({ inboundMessageId: 'm1', ordinal: 0 }))
            .not.toBe(WhatsappSpendService.logicalEffectId({ inboundMessageId: 'm1', ordinal: 1 }));
    });
});

describe('which durable identity wins', () => {
    it('prefers the most specific one available', () => {
        // A dispatch item names one row in the outbox; a batch position names
        // one position; a campaign and a recipient name one intended message.
        expect(WhatsappSpendService.logicalEffectId({
            dispatchItemId: 'item-1', batchId: 'b1', itemIndex: 3, taskId: 't1',
            recipientRef: 'r', inboundMessageId: 'm1',
        })).toBe('dispatch:item-1');
        expect(WhatsappSpendService.logicalEffectId({
            batchId: 'b1', itemIndex: 3, taskId: 't1', recipientRef: 'r', inboundMessageId: 'm1',
        })).toBe('batch:b1:3');
    });

    it('is nothing when the producer has nothing durable', () => {
        // Not a failure — a one-off proactive message genuinely has no durable
        // identity, and the content is then what identifies it.
        expect(WhatsappSpendService.logicalEffectId({})).toBeNull();
        expect(WhatsappSpendService.logicalEffectId(null)).toBeNull();
        // A batch with no index is not a position, so it does not count.
        expect(WhatsappSpendService.logicalEffectId({ batchId: 'b1' })).toBeNull();
        // A task with no recipient names a campaign, not a message.
        expect(WhatsappSpendService.logicalEffectId({ taskId: 't1' })).toBeNull();
    });

    it('treats index zero as a position, not as absent', () => {
        // The falsy-zero trap: the FIRST item of every batch would otherwise
        // fall through to a weaker identity.
        expect(WhatsappSpendService.logicalEffectId({ batchId: 'b1', itemIndex: 0 }))
            .toBe('batch:b1:0');
    });
});

describe('adopting a reservation that is already resolved', () => {
    const prisma = {
        tenant: { findUnique: jest.fn(async () => ({ settings: {} })) },
        channelAccount: { findFirst: jest.fn(async () => ({
            wabaTimezone: 'America/Bogota', metadata: { billingCurrency: 'USD' } })) },
    } as any;

    const admitAdopting = async (state: string) => {
        const spend = {
            effectKey: () => 'key',
            authorize: jest.fn(async () => ({
                outcome: 'adopted', reservation: { id: 'r1', state }, pressure: 'clear',
            })),
            // The exclusive right to POST. A spend double without it cannot say
            // whether the sink asked for one: 'reserved' alone never meant
            // 'you may send'.
            claimTransmission: jest.fn(async () => ({
                kind: 'granted',
                grant: { effectKey: 'key', token: '00000000-0000-4000-8000-000000000000',
                    expiresAt: new Date(Date.now() + 900000) },
            })),
        } as any;
        const admission = new WhatsappSendAdmissionService(prisma, spend);
        return admission.admit({
            schema: 'tenant_demo',
            connection: fromSendContext({
                version: OUTBOUND_CONTRACT_VERSION,
                tenantId: '11111111-1111-4111-8111-111111111111',
                channelType: 'whatsapp', channelAccountId: '15550001111', channelAddress: null,
                payer: { kind: 'business_direct', wabaId: 'waba-1', businessId: 'biz-1' },
                credential: { id: 'cred-1', source: 'system_user' },
                recipient: { scope: 'customer', address: '+573001234567' },
            } as any),
            recipientRef: 'hashed', recipientAddress: '+573001234567',
            producer: 'outbound_queue', contentDigest: 'd', admissionReason: 'retry',
            insideServiceWindow: true,
        } as any);
    };

    it('authorises another POST only while the reservation is held', async () => {
        const held = await admitAdopting('held');
        expect(held.permitted).toBe(true);
    });

    it('refuses to resend something already delivered and charged', async () => {
        const settled = await admitAdopting('settled');
        expect({ permitted: settled.permitted, code: settled.block?.code })
            .toEqual({ permitted: false, code: 'effect_already_resolved' });
        expect(settled.block?.detail).toContain('delivered and charged');
    });

    it('refuses to resend something whose outcome nobody knows', async () => {
        // The dangerous one. The provider may have acted, and another POST is
        // the duplicate the outbox exists to prevent.
        for (const state of ['pending_reconciliation', 'indeterminate']) {
            const result = await admitAdopting(state);
            expect({ state, permitted: result.permitted }).toEqual({ state, permitted: false });
            expect(result.block?.detail).toContain('reconcil');
        }
    });

    it('refuses to resend something that was refused and refunded', async () => {
        const released = await admitAdopting('released');
        expect(released.permitted).toBe(false);
        expect(released.block?.detail).toContain('money returned');
    });

    it('still names the reservation, so the caller can report it', async () => {
        const settled = await admitAdopting('settled');
        expect(settled.reservationId).toBe('r1');
    });
});
