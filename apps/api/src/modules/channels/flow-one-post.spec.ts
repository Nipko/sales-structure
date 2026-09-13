import { ChannelGatewayService } from './channel-gateway.service';
import { FlowSendFailed } from './flow-fallback';
import { readFileSync } from 'fs';
import { join } from 'path';

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
        const result = await gatewayWith(adapter).sendMessage(outbound(), 'token', { admitFallback: async () => { throw new Error('this spec sends no Flow; a fallback here would be a second POST nobody asked for'); } });

        expect(posts).toEqual(['flow']);
        expect(adapter.sendTextMessage).not.toHaveBeenCalled();
        // Null, so the caller records an uncertain outcome and RETAINS the
        // money rather than releasing it.
        expect(result).toBeNull();
    });

    it('does not become a second message on an unreadable answer either', async () => {
        const { posts, adapter } = adapterThatFailsFlow(
            new FlowSendFailed('bad gateway', { status: 502, body: '<html>edge</html>' }));
        expect(await gatewayWith(adapter).sendMessage(outbound(), 'token', { admitFallback: async () => { throw new Error('this spec sends no Flow; a fallback here would be a second POST nobody asked for'); } })).toBeNull();
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

    it('has no caller that can ask nothing', () => {
        // This used to say the opposite: a caller that passed no hooks kept the
        // old behaviour and fell back anyway. That exemption WAS the hole — a
        // Flow could become a second POST with a second charge under a
        // reservation that settles once, from any sink that had not been
        // updated, and "every caller remembers" is a list somebody maintains.
        //
        // The hook is now required by the signature, so the guarantee is a
        // property of the code. Asserted structurally because the type system
        // is exactly where it is enforced, and a runtime test cannot see a
        // parameter that cannot be omitted.
        const source = readFileSync(join(__dirname, 'channel-gateway.service.ts'), 'utf8');
        expect(source).toMatch(/hooks: GatewaySendHooks\)/);
        expect(source).toMatch(/readonly admitFallback: \(errorCode: string\)/);
        // And the refusal path asks it directly, with no `?.` to fall through.
        expect(source).toContain('if (!(await hooks.admitFallback(verdict.errorCode)))');
    });
});

describe('the ordinary path is untouched', () => {
    it('sends one text and no Flow when there is no flowId', async () => {
        const { posts, adapter } = adapterThatFailsFlow(new Error('never called'));
        const result = await gatewayWith(adapter)
            .sendMessage(outbound({ metadata: {} }), 'token', { admitFallback: async () => { throw new Error('this spec sends no Flow; a fallback here would be a second POST nobody asked for'); } });
        expect(posts).toEqual(['text']);
        expect(result).toBe('wamid.TEXT');
    });
});
