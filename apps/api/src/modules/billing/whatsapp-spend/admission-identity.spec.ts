import {
    WhatsappSendAdmissionService, fromSendContext,
} from './whatsapp-send-admission.service';
import { OUTBOUND_CONTRACT_VERSION } from '@parallext/shared';

/**
 * ═══ AN ADMISSION THAT CANNOT NAME THE PAYER RESERVES NOTHING ═══
 *
 * The defect, exactly: `payerKind` was decided by whether an optional parameter
 * had been passed. None of the three sinks passed it, so `authorize()` answered
 * `payer_unknown` on every send — and then:
 *
 *   · under `observe`, the block became permission with NO `reservationId`, so
 *     the POST went out unmeasured;
 *   · under `enforce`, practically every message on the platform would have
 *     been stopped.
 *
 * The same shape applied to the currency, and to the market, which was read off
 * the SENDING number rather than the destination.
 *
 * These tests assert what reaches `authorize()`, because that is where the
 * money is decided. A test that only checked `permitted` would have passed
 * throughout the entire defect.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';

const sendContext = (over: Record<string, any> = {}) => ({
    version: OUTBOUND_CONTRACT_VERSION,
    tenantId: TENANT,
    channelType: 'whatsapp',
    channelAccountId: '15550001111',
    channelAddress: '+1 555 000 1111',
    payer: { kind: 'business_direct', wabaId: 'waba-1', businessId: 'biz-1' },
    credential: { id: 'cred-1', source: 'system_user' },
    recipient: { scope: 'customer', address: '+5215512345678', contactId: 'contact-1' },
    ...over,
}) as any;

const prismaWith = (account: Record<string, unknown> | null,
    settings: Record<string, unknown> = {}) => ({
    tenant: { findUnique: jest.fn(async () => ({ settings })) },
    channelAccount: { findFirst: jest.fn(async () => account) },
}) as any;

/** A tenant that has opted into enforcement, where nothing is waved through. */
const ENFORCING = { whatsappSpend: { enforcement: 'enforce' } };

/**
 * A currency Meta actually reported, with the provenance that makes it usable.
 *
 * A bare `billingCurrency: 'COP'` is deliberately NOT this: a code with no
 * source and no date is indistinguishable from something somebody typed, and
 * pricing from it produces a confident amount in money nobody established.
 */
const metaCurrency = (currency: string) => ({
    billingCurrencyEvidence: {
        currency, source: 'meta_waba', observedAt: new Date().toISOString(), wabaId: 'waba-1',
    },
});

const spendDouble = () => {
    const authorize = jest.fn(async () => ({
        // 'held' because that is what a reservation IS when it is first taken.
        // The double used to omit it, and omitting it hid whether the sink was
        // consulting the state at all.
        outcome: 'reserved', reservation: { id: 'r1', state: 'held' }, pressure: 'clear',
    }));
    return { effectKey: () => 'key', authorize,
        // The exclusive right to POST. A spend double without it cannot say
        // whether the sink asked for one, and 'reserved' alone never meant
        // 'you may send'.
        claimTransmission: jest.fn(async () => ({
            kind: 'granted',
            grant: { effectKey: 'key', token: '00000000-0000-4000-8000-000000000000',
                expiresAt: new Date(Date.now() + 900000) },
        })),
        // Asked only when a producer named nothing durable AND the tenant is
        // enforcing. Answering `null` is "no legacy row", which is the state
        // every one of these tests is in.
        reservationFor: jest.fn(async () => null),
    } as any;
};

const request = (over: Record<string, unknown> = {}) => ({
    schema: 'tenant_demo',
    connection: fromSendContext(sendContext()),
    recipientRef: 'hashed',
    recipientAddress: '+5215512345678',
    producer: 'outbound_queue',
    contentDigest: 'digest',
    admissionReason: 'inbound_reply',
    // These tests are about WHO PAYS and WHAT IT COSTS, so the effect carries a
    // durable identity like every real send does. Without one an enforcing
    // tenant refuses on identity first and the currency is never reached —
    // which would make each of these pass for the wrong reason.
    binding: { dispatchItemId: 'dispatch-1' },
    ...over,
});

describe('the identity that reaches the money authority', () => {
    it('names the payer from the resolved connection', async () => {
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: {} }), spend);

        const admission = await service.admit(request() as any);

        expect(admission.permitted).toBe(true);
        expect(admission.reservationId).toBe('r1');
        const [, input] = spend.authorize.mock.calls[0];
        expect(input.identity).toMatchObject({
            payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
            credentialId: 'cred-1', credentialSource: 'system_user',
        });
    });

    it('prices by the country being messaged, not by the sending number', async () => {
        // A Colombian number writing to a Mexican customer. The old code read a
        // fixed `billingMarket` off the sender's metadata.
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: { billingMarket: 'CO' } }), spend);

        await service.admit(request() as any);

        const [, input] = spend.authorize.mock.calls[0];
        expect(input.identity.market).toBe('MX');
    });

    it('never puts the destination number in the ledger', async () => {
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: {} }), spend);

        await service.admit(request() as any);

        const [, input] = spend.authorize.mock.calls[0];
        expect(JSON.stringify(input.identity)).not.toContain('5215512345678');
        expect(input.identity.recipientRef).toBe('hashed');
    });

    it('reserves even when the account currency is not known yet', async () => {
        // The refusal that became an unmeasured POST. A reservation whose cost
        // is structurally unknown is visible and reconcilable; no reservation at
        // all is neither.
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: {} }), spend);

        const admission = await service.admit(request() as any);

        expect(admission.reservationId).toBe('r1');
        const [, input] = spend.authorize.mock.calls[0];
        expect(input.allowUnknownCost).toBe(true);
        expect(input.costUnknowable?.reason).toContain('currency_unestablished');
    });

    it('uses the account currency when Meta reported it, and prices for real', async () => {
        // Under ENFORCE, because observe allows an unknown cost by design —
        // the point of observing is to find out how many effects have no price.
        // Only an enforcing tenant shows whether anything was assumed.
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: metaCurrency('COP') },
                ENFORCING), spend);

        await service.admit(request({ category: 'marketing' }) as any);

        const [, input] = spend.authorize.mock.calls[0];
        expect(input.identity.currency).toBe('COP');
        // Nothing was assumed, so nothing is structurally unpriceable and
        // nothing needs the unknown-cost escape hatch.
        expect(input.costUnknowable).toBeNull();
        expect(input.allowUnknownCost).toBe(false);
    });

    it('refuses a currency stored with no source and no date', async () => {
        // The shape that used to be read. Honouring it is how a price in the
        // wrong money comes to look authoritative.
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: { billingCurrency: 'COP' } }), spend);

        await service.admit(request({ category: 'marketing' }) as any);

        const [, input] = spend.authorize.mock.calls[0];
        expect(input.costUnknowable?.reason).toContain('currency_unestablished');
    });

    it('defers under enforce when the currency was never established', async () => {
        // A tenant that asked for a ceiling asked for one that MEANS something,
        // and a ceiling cannot be applied to an amount nobody can compute. So
        // enforcement defers the effect instead of sending it unpriced.
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: {} }, ENFORCING), spend);

        const admission = await service.admit(request({ category: 'marketing' }) as any);

        expect({ permitted: admission.permitted, code: admission.block?.code })
            .toEqual({ permitted: false, code: 'currency_unknown' });
        expect(spend.authorize).not.toHaveBeenCalled();
    });

    it('never asks the rate card for a price it cannot have', async () => {
        // The defect this replaced: a substituted currency plus a real market
        // and category found a genuine row and returned `basis: 'priced'` — an
        // exact amount in money nobody established. `costUnknowable` makes that
        // impossible structurally rather than by convention.
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: {} }), spend);

        await service.admit(request({ category: 'marketing' }) as any);

        expect(spend.authorize.mock.calls[0][1].costUnknowable).not.toBeNull();
    });
});

describe('the category that reaches it', () => {
    const serviceWith = (spend: any) => new WhatsappSendAdmissionService(
        prismaWith({ wabaTimezone: 'America/Bogota', metadata: metaCurrency('USD') }), spend);

    it('is what Meta approved the template as', async () => {
        const spend = spendDouble();
        await serviceWith(spend).admit(request({
            template: { name: 'promo_oct', category: 'MARKETING' },
        }) as any);
        expect(spend.authorize.mock.calls[0][1].identity.category).toBe('marketing');
    });

    it('is service for a session message', async () => {
        const spend = spendDouble();
        await serviceWith(spend).admit(request({ insideServiceWindow: true }) as any);
        expect(spend.authorize.mock.calls[0][1].identity.category).toBe('service');
    });

    it('is never the pseudo-type the REST lane used to send', async () => {
        // `'template'` matched no row in the rate card, so a campaign priced as
        // unknown and its exposure was invisible.
        const spend = spendDouble();
        await serviceWith(spend).admit(request({ category: 'template' }) as any);
        expect(spend.authorize.mock.calls[0][1].identity.category).not.toBe('template');
    });

    it('reserves at the unknown basis when nobody can classify it', async () => {
        // A template whose Meta approval never synced. It still reserves — the
        // exposure is real — but it does not price as the cheapest thing Meta
        // sells.
        const spend = spendDouble();
        const admission = await serviceWith(spend).admit(request({
            template: { name: 'promo_oct', category: null },
        }) as any);
        expect(admission.permitted).toBe(true);
        expect(spend.authorize.mock.calls[0][1].allowUnknownCost).toBe(true);
    });
});

describe('what a connection with no WABA still produces', () => {
    it('is a block with a name, not a silent pass', async () => {
        // The one case where `payer_unknown` IS the truth: nobody can say which
        // account Meta would bill.
        const spend = {
            effectKey: () => 'key',
            authorize: jest.fn(async () => ({
                outcome: 'blocked',
                block: { code: 'payer_unknown', detail: 'no waba', scope: 'account', resolution: 'x' },
            })),
        } as any;
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: {} }), spend);

        const admission = await service.admit({
            ...request(),
            connection: fromSendContext(sendContext({
                payer: { kind: 'unknown', wabaId: null, businessId: null },
            })),
        } as any);

        // ── OBSERVING MAY IGNORE A CEILING; IT MAY NOT IGNORE THIS ──────────
        //
        // This used to pass with `permitted: true`, on the reasoning that
        // observing means not stopping messages. But a ceiling and an
        // unidentifiable payer are not the same kind of refusal:
        //
        //   · a ceiling refusal knows exactly whose money it is and how much —
        //     it is a budget decision, and under `observe` the effect is
        //     reserved, allocated and recorded over the limit so the business
        //     can see what a limit WOULD have stopped;
        //   · `payer_unknown` means nobody can say which WABA is billed. There
        //     is no reservation to write, no counter to move and no receipt
        //     that could ever resolve it. Permitting it produced a chargeable
        //     POST with no accounting at all — and it did so precisely for the
        //     tenants nobody was watching yet.
        //
        // So the ceiling is observed and the identity is refused, in both
        // modes, and the log line says which of the two happened.
        expect({ permitted: admission.permitted, code: admission.block?.code })
            .toEqual({ permitted: false, code: 'payer_unknown' });
        expect(spend.authorize.mock.calls[0][1].identity.payerKind).toBe('unknown');
    });
});

describe('the market that reaches it', () => {
    const serviceWith = (spend: any, metadata: Record<string, unknown>) =>
        new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata }, {}), spend);

    it('is nothing for a NANP number, and never the sender country', async () => {
        // `+1` is the United States, Canada and twenty more. Falling back to the
        // sending number's country would price a Dominican customer at the
        // Colombian rate, and look entirely plausible doing it.
        const spend = spendDouble();
        await serviceWith(spend, { ...metaCurrency('USD'), billingMarket: 'CO' })
            .admit(request({ recipientAddress: '+13055551234', insideServiceWindow: true }) as any);

        const [, input] = spend.authorize.mock.calls[0];
        expect(input.identity.market).toBeNull();
        expect(input.costUnknowable?.reason).toContain('market_unknown');
    });

    it('is nothing for +7, which is two markets Meta prices differently', async () => {
        const spend = spendDouble();
        await serviceWith(spend, metaCurrency('USD'))
            .admit(request({ recipientAddress: '+77011234567', insideServiceWindow: true }) as any);
        expect(spend.authorize.mock.calls[0][1].identity.market).toBeNull();
    });

    it('is nothing for a number that is not a number', async () => {
        const spend = spendDouble();
        await serviceWith(spend, metaCurrency('USD'))
            .admit(request({ recipientAddress: 'not-a-phone', insideServiceWindow: true }) as any);
        expect(spend.authorize.mock.calls[0][1].identity.market).toBeNull();
    });

    it('follows the destination across three countries from ONE sending number', async () => {
        // The property in one test: same account, same everything, three
        // customers. A fixed market on the sender reports one answer for all.
        const seen: (string | null)[] = [];
        for (const address of ['+573001234567', '+5215512345678', '+5511998887766']) {
            const spend = spendDouble();
            await serviceWith(spend, { ...metaCurrency('USD'), billingMarket: 'CO' })
                .admit(request({ recipientAddress: address, insideServiceWindow: true }) as any);
            seen.push(spend.authorize.mock.calls[0][1].identity.market);
        }
        expect(seen).toEqual(['CO', 'MX', 'BR']);
    });
});
