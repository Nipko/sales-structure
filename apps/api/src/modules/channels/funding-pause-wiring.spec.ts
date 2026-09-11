import { AccountPauseStore } from './account-pause-store';
import { applyFundingSignal } from './account-send-pause';
import { fundingSignalFrom } from './meta-funding-signals';
import { WhatsappSendAdmissionService } from '../billing/whatsapp-spend/whatsapp-send-admission.service';

/**
 * ═══ THE PAUSE HAS TO ACTUALLY STOP SOMETHING ═══
 *
 * The model and the store are proved on their own. What is left is the part
 * that is easy to get wrong and invisible when it is: whether the gate READS
 * the pause, and whether it stops a message even in `observe` mode.
 *
 * That last point is the one worth a test of its own. Everything else the gate
 * refuses, it refuses only under `enforce`, because `observe` exists to avoid
 * silencing messages that would otherwise have gone out. A funding pause is the
 * exception, and it is an exception for a reason that is not a preference: those
 * messages would NOT have gone out. Meta refuses them. Letting them through in
 * `observe` buys nothing and fills a queue with identical failures.
 */

const NOW = new Date('2026-10-05T12:00:00.000Z');

const pausedStore = (paused: boolean) => ({
    current: jest.fn(async () => paused
        ? applyFundingSignal(null, fundingSignalFrom(
            { source: 'http_response', code: 131042, at: NOW })!)
        : null),
}) as unknown as AccountPauseStore;

/** A tenant that has NOT opted into enforcement — the default everywhere. */
const observingPrisma = () => ({
    tenant: { findUnique: jest.fn(async () => ({ settings: {} })) },
    channelAccount: { findFirst: jest.fn(async () => ({ wabaTimezone: 'America/Bogota', metadata: {} })) },
}) as any;

const request = () => ({
    schema: 'tenant_demo',
    connection: { tenantId: '11111111-1111-4111-8111-111111111111',
        channelType: 'whatsapp', channelAccountId: '15550001111' },
    recipientRef: 'abc123',
    producer: 'outbound_queue',
    contentDigest: 'digest',
    admissionReason: 'inbound_reply',
});

describe('a number Meta refuses to bill', () => {
    it('is refused by the gate even in observe mode', async () => {
        const spend = { effectKey: () => 'key', authorize: jest.fn() } as any;
        const service = new WhatsappSendAdmissionService(
            observingPrisma(), spend, pausedStore(true));

        const admission = await service.admit(request() as any);

        expect({ permitted: admission.permitted, code: admission.block?.code })
            .toEqual({ permitted: false, code: 'account_paused' });
        // And nothing was priced or reserved: there is no point costing a
        // message the provider will not carry.
        expect(spend.authorize).not.toHaveBeenCalled();
    });

    it('says what to do, and that customers are still being heard', async () => {
        const service = new WhatsappSendAdmissionService(
            observingPrisma(), { effectKey: () => 'key', authorize: jest.fn() } as any,
            pausedStore(true));
        const admission = await service.admit(request() as any);
        expect(admission.block?.detail).toContain('Meta charges the business directly');
        expect(admission.block?.detail).toContain('Incoming messages are still being received');
        // Scoped to the account, never to the tenant: a second number on a
        // funded WABA has to keep working.
        expect(admission.block?.scope).toBe('account');
    });

    it('does not stand in the way when there is no pause', async () => {
        const spend = {
            effectKey: () => 'key',
            authorize: jest.fn(async () => ({
                outcome: 'reserved', reservation: { id: 'r1', state: 'held' }, pressure: 'clear',
            })),
        } as any;
        const service = new WhatsappSendAdmissionService(
            observingPrisma(), spend, pausedStore(false));
        const admission = await service.admit(request() as any);
        expect(admission.permitted).toBe(true);
        expect(spend.authorize).toHaveBeenCalled();
    });

    it('is not consulted at all for a channel nobody bills per message', async () => {
        // Instagram, Messenger, Telegram and the widget. Reading a WhatsApp
        // pause for them would be a lookup that can only ever say "no".
        const store = pausedStore(true);
        const service = new WhatsappSendAdmissionService(
            observingPrisma(), { effectKey: () => 'key', authorize: jest.fn() } as any, store);
        const admission = await service.admit({
            ...request(), connection: { ...request().connection, channelType: 'telegram' },
        } as any);
        expect({ permitted: admission.permitted, notBilled: admission.notBilled })
            .toEqual({ permitted: true, notBilled: true });
        expect(store.current).not.toHaveBeenCalled();
    });

    it('lets the message through when the pause store itself is broken', async () => {
        // A money gate that silences a platform because its own dependency
        // threw is worse than the bill it prevents.
        const broken = { current: jest.fn(async () => { throw new Error('down'); }) } as any;
        const spend = {
            effectKey: () => 'key',
            authorize: jest.fn(async () => ({
                outcome: 'reserved', reservation: { id: 'r1', state: 'held' }, pressure: 'clear',
            })),
        } as any;
        const service = new WhatsappSendAdmissionService(observingPrisma(), spend, broken);
        expect((await service.admit(request() as any)).permitted).toBe(true);
    });
});

describe('the store, against a doubled account row', () => {
    const account = { id: 'acc-1', metadata: {} as Record<string, unknown> };
    const prisma = {
        channelAccount: {
            findFirst: jest.fn(async () => account),
            update: jest.fn(async ({ data }: any) => {
                account.metadata = data.metadata;
                return account;
            }),
        },
    } as any;

    beforeEach(() => { account.metadata = {}; jest.clearAllMocks(); });

    it('writes the pause where the gate will read it', async () => {
        const store = new AccountPauseStore(prisma);
        const pause = await store.observeFunding('t1', '15550001111',
            { source: 'status_webhook', code: 'whatsapp:131042', detail: 'no payment method' });
        expect(pause?.code).toBe(131042);
        expect((account.metadata as any).sendPause.reason).toBe('funding_not_ready');
        expect(await store.isPaused('t1', '15550001111')).toBe(true);
    });

    it('ignores a failure that has nothing to do with money', async () => {
        const store = new AccountPauseStore(prisma);
        const pause = await store.observeFunding('t1', '15550001111', {
            source: 'status_webhook', code: 'whatsapp:470',
            detail: 'title="" details="more than 24 hours have passed"',
        });
        expect(pause).toBeNull();
        expect(prisma.channelAccount.update).not.toHaveBeenCalled();
    });

    it('resumes immediately when the provider accepts again', async () => {
        // Written through rather than invalidated: a clear that only dropped the
        // cache entry would leave the account silent for the rest of the window,
        // after the thing that fixed it already happened.
        const store = new AccountPauseStore(prisma);
        await store.observeFunding('t1', '15550001111', { source: 'http_response', code: 131042 });
        expect(await store.isPaused('t1', '15550001111')).toBe(true);
        await store.clear('t1', '15550001111', { by: 'provider_accepted' });
        expect(await store.isPaused('t1', '15550001111')).toBe(false);
    });
});
