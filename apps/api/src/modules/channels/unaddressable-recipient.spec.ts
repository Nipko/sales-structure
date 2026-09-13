import { ChannelGatewayService, UnaddressableRecipient } from './channel-gateway.service';
import { WhatsappSendAdmissionService } from '../billing/whatsapp-spend/whatsapp-send-admission.service';
import { SCOPED_ADDRESS_PREFIX } from '@parallext/shared';
import { OutboundQueueProcessor } from './outbound-queue.processor';
import {
    openPauseStore, permissiveSpendGate, resolvingChannelToken, schemaNamingPrisma,
} from './__fixtures__/spend-gate-double';

/**
 * ═══ A CUSTOMER WE CAN HEAR AND CANNOT ANSWER ═══
 *
 * The ingress accepts somebody who wrote without a phone number: their
 * `contacts.external_id` is `bsuid:<portfolio>:<id>`, and that string is what
 * every producer carries as the recipient. It is not a destination — Meta's
 * `/messages` takes a phone in `to` — and the outbound half does not exist.
 *
 * The refusal was originally reachable only through `sendStrict`. Durable
 * delivery is now mandatory, and the gateway retains the same invariant so a
 * new producer cannot bypass it by reaching a lower-level sender.
 *
 * These cases pin the three places that now answer, each of which is reached by
 * a different caller.
 */
const SCOPED = `${SCOPED_ADDRESS_PREFIX}102290129340398:BSU_abc123XYZ`;

describe('the gateway refuses what no endpoint can address', () => {
    const gateway = () => {
        const g = new ChannelGatewayService();
        const sent: any[] = [];
        g.registerAdapter({
            channelType: 'whatsapp',
            sendTextMessage: async (to: string) => { sent.push(to); return 'wamid.SENT'; },
        } as any);
        return { g, sent };
    };

    const outbound = (to: string, channelType = 'whatsapp') => ({
        tenantId: '11111111-1111-1111-1111-111111111111',
        channelType, channelAccountId: '15550001111', to,
        content: { type: 'text', text: 'hola' },
    }) as any;

    it('throws rather than returning null, and posts nothing', async () => {
        // The asymmetry is the whole point. This gateway turns every transport
        // failure into `null`, and the processor reads a `null` as "no
        // answer came back": it records the reservation as a TIMEOUT — which
        // RETAINS the money for a message provably never posted — and then
        // throws, burning the job's attempts. Nothing was sent here, and
        // nothing can be.
        const { g, sent } = gateway();
        await expect(g.sendMessage(outbound(SCOPED), 'token', {} as any))
            .rejects.toBeInstanceOf(UnaddressableRecipient);
        expect(sent).toEqual([]);
    });

    it('refuses on a channel that never mints such a key either', async () => {
        // Telegram would not know what to do with one. The guard is not gated
        // on the channel, because "is this a destination" has the same answer
        // everywhere and the next ingress to mint one is not this file's to
        // predict.
        const g = new ChannelGatewayService();
        const sent: any[] = [];
        g.registerAdapter({
            channelType: 'telegram',
            sendTextMessage: async (to: string) => { sent.push(to); return 'tg.1'; },
        } as any);
        await expect(g.sendMessage(outbound(SCOPED, 'telegram'), 'token', {} as any))
            .rejects.toBeInstanceOf(UnaddressableRecipient);
        expect(sent).toEqual([]);
    });

    it('still sends to a real phone number', async () => {
        // The guard must not be a blanket refusal. `bsuid:` is a prefix, and a
        // phone, a PSID, an IGSID, a Telegram chat id and a widget session key
        // can none of them begin with it.
        const { g, sent } = gateway();
        expect(await g.sendMessage(outbound('573001112233'), 'token', {} as any))
            .toBe('wamid.SENT');
        expect(sent).toEqual(['573001112233']);
    });
});

describe('unaddressable is not a billing question', () => {
    /**
     * The refusal used to sit BELOW the `PROVIDER_BILLED_CHANNELS` early
     * return, so "no provider bills this channel" answered a question it was
     * never asked: a scoped key on Telegram, Instagram or Messenger came back
     * `permitted: true, notBilled: true` and went on to the gateway.
     */
    const admission = () => {
        const svc: any = Object.create(WhatsappSendAdmissionService.prototype);
        Object.assign(svc, {
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            spend: {
                effectKey: () => 'effect-key',
                authorize: async () => { throw new Error('must not reach the money path'); },
            },
            enforcementFor: async () => 'observe',
        });
        return svc;
    };

    const request = (channelType: string, recipientAddress: string) => ({
        connection: {
            tenantId: '11111111-1111-1111-1111-111111111111',
            schema: 'tenant_x', channelType,
            channelAccountId: '15550001111', wabaId: 'waba-1',
        },
        schema: 'tenant_x',
        recipientAddress,
        logicalEffectId: 'effect-1',
        category: 'service',
    }) as any;

    it.each(['telegram', 'instagram', 'messenger', 'whatsapp'])(
        'refuses a scoped recipient on %s', async channelType => {
            const verdict = await admission().admit(request(channelType, SCOPED));
            expect(verdict.permitted).toBe(false);
            expect(verdict.block?.code).toBe('recipient_not_addressable');
            // And it never reached `authorize`, which throws in this double:
            // nothing reserved means nothing to release.
        });

    it('says whether enforcement is on, rather than claiming observe', async () => {
        // The verdict carries the mode on every path. Hardcoding 'observe' here
        // to avoid one memoised read would tell an operator enforcement was off
        // while it was on.
        const svc = admission();
        svc.enforcementFor = async () => 'enforce';
        const verdict = await svc.admit(request('whatsapp', SCOPED));
        expect(verdict.enforcement).toBe('enforce');
    });
});

describe('the busiest lane stops before the credential, and says why', () => {
    /**
     * The loose `outbound_queue` lane carries every AI reply today, because
     * `DispatchRolloutService` leaves the durable lane off by default.
     *
     * The spend authority already refuses a scoped recipient, so nothing was
     * being POSTed — but it came back as `skipped:spend_refused`, and that is
     * the only thing an operator reads afterwards. It says a BUDGET stopped
     * the message, which sends somebody to look at a ceiling that is not the
     * problem, on a conversation that looks entirely ordinary.
     */
    const TENANT = '11111111-1111-1111-1111-111111111111';

    const harness = () => {
        const channelGateway = { sendMessage: jest.fn(async () => 'wamid.SENT') };
        const channelToken = resolvingChannelToken();
        const processor = new OutboundQueueProcessor(
            channelGateway as any,
            { isOverLimit: jest.fn(async () => false), recordUsage: jest.fn(async () => undefined) } as any,
            channelToken as any,
            { get: jest.fn(async () => null), set: jest.fn(async () => undefined) } as any,
            { send: jest.fn() } as any,
            schemaNamingPrisma({
                tenant: { findUnique: jest.fn(async () => ({
                    isInternal: false, subscriptionStatus: 'active',
                    subscription: { status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                        currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
                })) },
            }),
            permissiveSpendGate(), openPauseStore(),
        );
        const job = (to: string): any => ({ id: 'job-1', data: { outbound: {
            tenantId: TENANT, channelType: 'whatsapp', channelAccountId: 'phone-1',
            to, content: { type: 'text', text: 'hola' },
            metadata: { conversationId: 'conv-1' },
        } } });
        return { processor, job, channelGateway, channelToken };
    };

    it('completes the job once, names the real reason, and never reaches the gateway', async () => {
        const h = harness();
        // Completes rather than throws. An exception burns one of the job's
        // attempts, and at the end of them the reply is dropped with nothing
        // saying why — while waiting changes nothing about a destination that
        // does not exist.
        await expect(h.processor.process(h.job(SCOPED))).resolves.toBe('skipped:recipient_not_addressable');
        expect(h.channelGateway.sendMessage).not.toHaveBeenCalled();
    });

    it('does not even fetch the access token for it', async () => {
        // Before the credential, deliberately: resolving a token is a network
        // call and a decrypt for a send that cannot happen.
        const h = harness();
        await h.processor.process(h.job(SCOPED));
        expect(h.channelToken.getChannelToken).not.toHaveBeenCalled();
    });

    it('still sends an ordinary message', async () => {
        const h = harness();
        await expect(h.processor.process(h.job('+573001112233'))).resolves.toBe('wamid.SENT');
        expect(h.channelGateway.sendMessage).toHaveBeenCalled();
    });
});
