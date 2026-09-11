import { ChannelGatewayService } from './channel-gateway.service';
import { FlowSendFailed } from './flow-fallback';

/**
 * ═══ ONE ADMISSION, ONE POST ═══
 *
 * The gateway used to try a Flow, catch ANY error, and send the body as text.
 * On a timeout that is two messages on the customer's phone and two charges on
 * the business's account, under one reservation that can only settle once.
 *
 * These tests count POSTs. Not classifications, not log lines — how many times
 * the adapter was actually asked to send something, which is the only number
 * Meta will bill.
 */

const outbound = (over: Record<string, unknown> = {}) => ({
    tenantId: '11111111-1111-4111-8111-111111111111',
    channelType: 'whatsapp',
    channelAccountId: '15550001111',
    to: '15559998888',
    content: { type: 'text', text: 'Elegí un horario' },
    metadata: { flowId: 'flow-1', flowToken: 'tok' },
    ...over,
}) as any;

/** An adapter that records every send it is asked to perform. */
const adapterThatFailsFlow = (failure: unknown) => {
    const posts: string[] = [];
    return {
        posts,
        adapter: {
            channelType: 'whatsapp',
            sendFlowMessage: jest.fn(async () => { posts.push('flow'); throw failure; }),
            sendTextMessage: jest.fn(async () => { posts.push('text'); return 'wamid.TEXT'; }),
        } as any,
    };
};

const gatewayWith = (adapter: any) => {
    // The real service, with its real `registerAdapter` — so the double under
    // test is reached the same way a production adapter is, and nothing about
    // routing is stubbed out.
    const gateway = new ChannelGatewayService();
    gateway.registerAdapter(adapter);
    (gateway as any).logger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    return gateway;
};

describe('a Flow that times out', () => {
    it('does not become a second message', async () => {
        // The reproduction. Ten seconds of silence says nothing about whether
        // Meta queued the Flow, and the fallback assumed it did not.
        const { posts, adapter } = adapterThatFailsFlow(new FlowSendFailed('aborted',
            { cause: Object.assign(new Error('t'), { name: 'TimeoutError' }) }));
        const result = await gatewayWith(adapter).sendMessage(outbound(), 'token');

        expect(posts).toEqual(['flow']);
        expect(adapter.sendTextMessage).not.toHaveBeenCalled();
        // Null, so the caller records an uncertain outcome and RETAINS the
        // money rather than releasing it.
        expect(result).toBeNull();
    });

    it('does not become a second message on an unreadable answer either', async () => {
        const { posts, adapter } = adapterThatFailsFlow(
            new FlowSendFailed('bad gateway', { status: 502, body: '<html>edge</html>' }));
        expect(await gatewayWith(adapter).sendMessage(outbound(), 'token')).toBeNull();
        expect(posts).toEqual(['flow']);
    });
});

describe('a Flow Meta conclusively refused', () => {
    const refusal = () => new FlowSendFailed('flow is not published',
        { status: 400, body: { error: { code: 100, message: 'unpublished' } } });

    it('becomes text only when the fallback is authorised', async () => {
        const { posts, adapter } = adapterThatFailsFlow(refusal());
        const admitFallback = jest.fn(async () => true);

        const result = await gatewayWith(adapter)
            .sendMessage(outbound(), 'token', { admitFallback });

        expect(posts).toEqual(['flow', 'text']);
        expect(result).toBe('wamid.TEXT');
        // Asked, with the reason — a second effect is authorised on its own
        // terms or not at all.
        expect(admitFallback).toHaveBeenCalledWith(expect.stringContaining('100'));
    });

    it('sends nothing when the fallback is refused', async () => {
        // A ceiling reached, or a money authority that cannot be reached. The
        // customer is no worse off than if the Flow had simply failed, and
        // nobody is billed for a message nothing authorised.
        const { posts, adapter } = adapterThatFailsFlow(refusal());
        const result = await gatewayWith(adapter)
            .sendMessage(outbound(), 'token', { admitFallback: async () => false });

        expect(posts).toEqual(['flow']);
        expect(result).toBeNull();
    });

    it('still falls back for a caller that asks nothing', async () => {
        // Callers outside the metered lanes — and non-WhatsApp channels — keep
        // the old behaviour. Breaking them to protect a charge they cannot
        // produce would be the wrong trade.
        const { posts, adapter } = adapterThatFailsFlow(refusal());
        expect(await gatewayWith(adapter).sendMessage(outbound(), 'token')).toBe('wamid.TEXT');
        expect(posts).toEqual(['flow', 'text']);
    });
});

describe('the ordinary path is untouched', () => {
    it('sends one text and no Flow when there is no flowId', async () => {
        const { posts, adapter } = adapterThatFailsFlow(new Error('never called'));
        const result = await gatewayWith(adapter)
            .sendMessage(outbound({ metadata: {} }), 'token');
        expect(posts).toEqual(['text']);
        expect(result).toBe('wamid.TEXT');
    });
});
