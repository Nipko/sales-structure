import {
    assertTurnOutcome, fundingHeadline, isFundingCurrent, isOutboundSendContext, mayProceed,
    OUTBOUND_CONTRACT_VERSION, PROVIDER_BILLED_CHANNELS, retainedExposure, sameSendContext,
    SPEND_GOVERNED_CHANNELS,
    type FundingReadiness, type OutboundSendContext, type SpendAuthorization,
} from '@parallext/shared';

const TENANT = '11111111-1111-4111-8111-111111111111';

const context = (overrides: Partial<OutboundSendContext> = {}): OutboundSendContext => ({
    version: OUTBOUND_CONTRACT_VERSION,
    tenantId: TENANT,
    channelType: 'whatsapp',
    channelAccountId: '15550001111',
    channelAddress: '+1 555 000 1111',
    payer: { kind: 'business_direct', wabaId: 'waba-1', businessId: 'biz-1' },
    credential: { id: 'cred-1', source: 'channel_account' },
    recipient: { scope: 'customer', contactId: '22222222-2222-4222-8222-222222222222', address: '+573001112233' },
    ...overrides,
});

const authorization = (overrides: Partial<SpendAuthorization> = {}): SpendAuthorization => ({
    version: OUTBOUND_CONTRACT_VERSION,
    decision: 'accepted',
    reservationId: 'res-1',
    basis: 'priced',
    reserved: { currency: 'USD', minor: 8 },
    unitCeiling: { currency: 'USD', minor: 50 },
    rateVersion: '2026-10-01',
    decidedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
});

/**
 * ═══ THE FOUR RULES THE OCTOBER RELEASE RESTS ON ═══
 *
 * From 1 October every delivered WhatsApp service message spends the business's
 * money, on the business's account, at a rate that depends on where the person
 * is. Four things have to be true of every outbound effect, and each has its own
 * way of being unknown. These are the rules; the fronts build against them.
 */
describe('the outbound message contract', () => {
    describe('who is speaking, and who pays', () => {
        it('accepts a fully identified effect', () => {
            expect(isOutboundSendContext(context())).toBe(true);
        });

        it('refuses a payer that is named but not identified', () => {
            // `business_direct` with no WABA is a claim about billing with
            // nothing behind it, and it is the shape a hopeful default takes.
            expect(isOutboundSendContext(context({ payer: { kind: 'business_direct', wabaId: null } }))).toBe(false);
            // `unknown` is allowed to have no WABA: that is what unknown means.
            expect(isOutboundSendContext(context({ payer: { kind: 'unknown' } }))).toBe(true);
        });

        it('lets a customer exist without a phone number', () => {
            // Identity adaptation must not drop the customers who never gave
            // one, and several channels have no phone at all. Whether a
            // phone-shaped transport can carry it is a later decision, with a
            // reason — not a validation failure here.
            expect(isOutboundSendContext(context({
                recipient: { scope: 'customer', contactId: '22222222-2222-4222-8222-222222222222', address: null },
            }))).toBe(true);
        });

        it('names which field moved when a retry would charge somebody else', () => {
            // The one question a retry must answer. Field by field rather than by
            // hash, because "the connection changed" and "the payer changed" are
            // different human decisions.
            const before = context();
            expect(sameSendContext(before, context())).toEqual({ same: true, changed: [] });
            expect(sameSendContext(before, context({ channelAccountId: '15550002222' })))
                .toEqual({ same: false, changed: ['channelAccountId'] });
            expect(sameSendContext(before, context({ payer: { kind: 'business_direct', wabaId: 'waba-2' } })))
                .toEqual({ same: false, changed: ['payer.wabaId'] });
            expect(sameSendContext(before, context({ credential: { id: 'cred-2', source: 'tenant_credential' } })))
                .toEqual({ same: false, changed: ['credential.id'] });
        });

        it('treats a missing field and a null field as the same absence', () => {
            const withNull = context({ channelAddress: null });
            const without = context();
            delete (without as any).channelAddress;
            expect(sameSendContext(withNull as any, without as any).same).toBe(true);
        });

        it('refuses a context built for an older version of this contract', () => {
            expect(isOutboundSendContext({ ...context(), version: 0 as any })).toBe(false);
        });
    });

    describe('whether it may be paid for', () => {
        it('lets an accepted decision through and stops a rejected one', () => {
            expect(mayProceed(authorization(), { allowUnknownCost: false })).toBe(true);
            expect(mayProceed(authorization({ decision: 'rejected' }), { allowUnknownCost: true })).toBe(false);
        });

        it('refuses an unknown cost unless the caller has said it may proceed', () => {
            // The default answer to "we do not know what this costs" is no. A
            // caller that wants otherwise says so, in one place, on purpose.
            expect(mayProceed(authorization({ decision: 'unknown' }), { allowUnknownCost: false })).toBe(false);
            expect(mayProceed(authorization({ decision: 'unknown' }), { allowUnknownCost: true })).toBe(true);
        });

        it('keeps the whole reservation while a delivery has no price', () => {
            // The accounting error this prevents: a delivered message whose
            // price never came back, settled as zero, and a ceiling that
            // silently refills. Exposure is retained until somebody reconciles.
            const held = authorization();
            expect(retainedExposure(held, { state: 'pending_reconciliation' })).toEqual({ currency: 'USD', minor: 8 });
            expect(retainedExposure(held, { state: 'indeterminate' })).toEqual({ currency: 'USD', minor: 8 });
        });

        it('releases only what did not happen, and charges what did', () => {
            const held = authorization();
            expect(retainedExposure(held, { state: 'released' })).toEqual({ currency: 'USD', minor: 0 });
            expect(retainedExposure(held, { state: 'settled', charged: { currency: 'USD', minor: 5 } }))
                .toEqual({ currency: 'USD', minor: 5 });
        });

        it('never lets a settlement report less than nothing, or nothing at all by omission', () => {
            const held = authorization();
            // A provider that reports a negative price is reporting nonsense.
            expect(retainedExposure(held, { state: 'settled', charged: { currency: 'USD', minor: -3 } }))
                .toEqual({ currency: 'USD', minor: 0 });
            // Settled with no figure keeps the reservation rather than becoming free.
            expect(retainedExposure(held, { state: 'settled', charged: null }))
                .toEqual({ currency: 'USD', minor: 8 });
        });

        it('lets a genuinely free basis reserve nothing, and says why it is free', () => {
            for (const basis of ['free_allowance', 'free_entry_point'] as const) {
                const free = authorization({ basis, reserved: { currency: 'USD', minor: 0 } });
                expect(mayProceed(free, { allowUnknownCost: false })).toBe(true);
                expect(retainedExposure(free, { state: 'settled', charged: { currency: 'USD', minor: 0 } }))
                    .toEqual({ currency: 'USD', minor: 0 });
            }
        });
    });

    describe('what the turn decided', () => {
        const outcome = (kind: any, extra: any = {}) => ({
            version: OUTBOUND_CONTRACT_VERSION, kind, effects: [], ...extra,
        });

        it('accepts a send with effects and a silence with none', () => {
            expect(() => assertTurnOutcome(outcome('send', { effects: ['effect-1'] }))).not.toThrow();
            expect(() => assertTurnOutcome(outcome('suppress', { reason: 'opted_out' }))).not.toThrow();
            expect(() => assertTurnOutcome(outcome('wait', {
                reason: 'awaiting_stock_check', resumeAfter: '2026-10-01T10:00:00.000Z',
            }))).not.toThrow();
        });

        it('refuses a silence that carries a chargeable effect', () => {
            // The rule the type exists for. A `wait` with an effect is a billed
            // message wearing the label of not answering — and repeated, it is
            // the loop that turns a confused customer into a bill.
            expect(() => assertTurnOutcome(outcome('wait', {
                reason: 'awaiting_stock_check', resumeAfter: '2026-10-01T10:00:00.000Z', effects: ['effect-1'],
            }))).toThrow('turn_outcome_silence_cannot_send');
            expect(() => assertTurnOutcome(outcome('suppress', { reason: 'opted_out', effects: ['effect-1'] })))
                .toThrow('turn_outcome_silence_cannot_send');
        });

        it('refuses a wait with no deadline, which is a busy loop', () => {
            expect(() => assertTurnOutcome(outcome('wait', { reason: 'awaiting_stock_check' })))
                .toThrow('turn_outcome_wait_needs_deadline');
        });

        it('demands a reason for anything that is not a plain send', () => {
            for (const kind of ['wait', 'suppress', 'escalate']) {
                expect(() => assertTurnOutcome(outcome(kind, { resumeAfter: '2026-10-01T10:00:00.000Z' })))
                    .toThrow('turn_outcome_reason_required');
            }
        });
    });

    describe('whether the account can pay at all', () => {
        const readiness = (overrides: Partial<FundingReadiness> = {}): FundingReadiness => ({
            version: OUTBOUND_CONTRACT_VERSION, state: 'ready', source: 'provider',
            checkedAt: '2026-09-20T00:00:00.000Z', ...overrides,
        });

        it('never presents "we could not ask" as "the business has not paid"', () => {
            // Two different messages to two different people. Collapsing them
            // either alarms a customer who did nothing wrong or hides a stop.
            expect(fundingHeadline(readiness({ state: 'not_ready', reason: 'no_payment_method' })))
                .toEqual({ tone: 'blocked', code: 'no_payment_method' });
            expect(fundingHeadline(readiness({ state: 'unknown', reason: 'probe_failed' })))
                .toEqual({ tone: 'warn', code: 'funding_unknown' });
        });

        it('stops showing an answer that has gone stale', () => {
            const now = new Date('2026-10-01T00:00:00.000Z');
            const stale = readiness({ staleAfter: '2026-09-30T00:00:00.000Z' });
            expect(isFundingCurrent(stale, now)).toBe(false);
            expect(fundingHeadline(stale, now)).toEqual({ tone: 'warn', code: 'funding_answer_stale' });
            // And a fresh one is shown as what it says.
            const fresh = readiness({ staleAfter: '2026-10-02T00:00:00.000Z' });
            expect(fundingHeadline(fresh, now)).toEqual({ tone: 'ok', code: 'funding_ready' });
        });

        it('treats an unparseable expiry as stale rather than as forever', () => {
            expect(isFundingCurrent(readiness({ staleAfter: 'soon' }))).toBe(false);
        });
    });

    it('names WhatsApp as the channel a provider bills, and governs the rest anyway', () => {
        // A rate of zero is still a decision that was taken. A channel outside
        // the gate is a channel where a future price change lands silently.
        expect(PROVIDER_BILLED_CHANNELS).toEqual(['whatsapp']);
        for (const channel of PROVIDER_BILLED_CHANNELS) expect(SPEND_GOVERNED_CHANNELS).toContain(channel);
        expect(SPEND_GOVERNED_CHANNELS).toContain('web_widget');
    });
});
