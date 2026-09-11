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
        // The refusal that became an unmeasured POST. A reservation at an
        // assumed currency and an unknown basis is visible and reconcilable; no
        // reservation at all is neither.
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: {} }), spend);

        const admission = await service.admit(request() as any);

        expect(admission.reservationId).toBe('r1');
        const [, input] = spend.authorize.mock.calls[0];
        expect(input.identity.currency).toBe('USD');
        expect(input.allowUnknownCost).toBe(true);
    });

    it('uses the account currency when it IS known, and prices for real', async () => {
        // Under ENFORCE, because observe allows an unknown cost by design —
        // the point of observing is to find out how many effects have no price.
        // Only an enforcing tenant shows whether anything was assumed.
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: { billingCurrency: 'COP' } },
                ENFORCING), spend);

        await service.admit(request({ category: 'marketing' }) as any);

        const [, input] = spend.authorize.mock.calls[0];
        expect(input.identity.currency).toBe('COP');
        // Nothing was assumed, so nothing needs the unknown-cost escape hatch.
        expect(input.allowUnknownCost).toBe(false);
    });

    it('still allows an unknown cost under enforce when the currency is missing', async () => {
        // The alternative was refusing to reserve, which is precisely how
        // `currency_unknown` turned every send into an unmeasured POST.
        const spend = spendDouble();
        const service = new WhatsappSendAdmissionService(
            prismaWith({ wabaTimezone: 'America/Bogota', metadata: {} }, ENFORCING), spend);

        const admission = await service.admit(request({ category: 'marketing' }) as any);

        expect(admission.reservationId).toBe('r1');
        expect(spend.authorize.mock.calls[0][1].allowUnknownCost).toBe(true);
    });
});

describe('the category that reaches it', () => {
    const serviceWith = (spend: any) => new WhatsappSendAdmissionService(
        prismaWith({ wabaTimezone: 'America/Bogota', metadata: { billingCurrency: 'USD' } }), spend);

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

        // In `observe` the message still goes — that is what observing is — but
        // the diagnosis is carried, which is how an operator finds out.
        expect({ permitted: admission.permitted, code: admission.block?.code })
            .toEqual({ permitted: true, code: 'payer_unknown' });
        expect(spend.authorize.mock.calls[0][1].identity.payerKind).toBe('unknown');
    });
});
