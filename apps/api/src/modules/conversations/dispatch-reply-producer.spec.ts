import { ConversationsService } from './conversations.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const contactId = '33333333-3333-4333-8333-333333333333';
const inboundMessageId = '44444444-4444-4444-8444-444444444444';
const agentId = '55555555-5555-4555-8555-555555555555';
const schemaName = 'tenant_dispatch_producer';

const scope = { kind: 'agent' as const, tenantId, schemaName, agentId, version: 3,
    operationalHash: 'a'.repeat(64) };
const inboundMsg: any = { tenantId, conversationId, channelType: 'whatsapp',
    channelAccountId: 'phone-1', contactId: '+573000000000', direction: 'inbound',
    content: { type: 'text', text: 'Hola' } };

describe('ConversationsService durable reply producer', () => {
    function harness(options: { enabled?: boolean; prepareFails?: boolean; publishFails?: boolean } = {}) {
        const service: any = Object.create(ConversationsService.prototype);
        const rows = [
            { id: 'd-0', itemIndex: 0, messageId: 'm-0' },
            { id: 'd-1', itemIndex: 1, messageId: 'm-1' },
        ];
        const dispatchOutbox = {
            prepare: jest.fn(async (_tenantId: string, _input: any) => {
                if (options.prepareFails) throw new Error('outbox unavailable');
                return { schemaName, batchId: 'b-1', rows };
            }),
            markQueued: jest.fn(async () => rows.length),
        };
        const dispatchRollout = { enabledFor: jest.fn(async () => options.enabled === true) };
        const outboundQueue = { enqueueDispatch: jest.fn(async () => {
            if (options.publishFails) throw new Error('redis unavailable');
        }) };
        Object.assign(service, {
            dispatchOutbox, dispatchRollout, outboundQueue,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        return { service, dispatchOutbox, dispatchRollout, outboundQueue };
    }

    const run = (service: any, over: any = {}) => service.dispatchReplyThroughOutbox({
        tenantId, conversation: { id: conversationId, contact_id: contactId },
        inboundMsg, inboundMessageId, chunks: ['Primero', 'Después'],
        operationalScope: scope, gapMs: 1200, ...over,
    });

    it('takes the durable path only when the switch names this tenant and channel', async () => {
        const off = harness();
        await expect(run(off.service)).resolves.toBe(false);
        expect(off.dispatchOutbox.prepare).not.toHaveBeenCalled();
        expect(off.dispatchRollout.enabledFor).toHaveBeenCalledWith(tenantId, 'whatsapp');

        const on = harness({ enabled: true });
        await expect(run(on.service)).resolves.toBe(true);
        expect(on.dispatchOutbox.prepare).toHaveBeenCalledTimes(1);
    });

    it('records the bubbles as items bound to the persisted inbound', async () => {
        const h = harness({ enabled: true });
        await run(h.service);
        expect(h.dispatchOutbox.prepare).toHaveBeenCalledWith(tenantId, expect.objectContaining({
            binding: { conversationId, contactId, inboundMessageId, channelType: 'whatsapp',
                channelAccountId: 'phone-1', recipient: '+573000000000' },
            operationalScope: scope,
            // Messaging turns collect no learning provenance yet. Claiming an
            // empty footprint is honest; inventing one would make release-scoped
            // erasure look like it had applied to these words.
            learningFootprints: [],
        }));
        const items = (h.dispatchOutbox.prepare.mock.calls[0] as any[])[1].items;
        expect(items.map((item: any) => [item.kind, item.payload.text]))
            .toEqual([['text', 'Primero'], ['text', 'Después']]);
    });

    it('publishes each item on its own, staggered, and marks them only afterwards', async () => {
        const h = harness({ enabled: true });
        await run(h.service);
        expect(h.outboundQueue.enqueueDispatch.mock.calls).toEqual([
            [tenantId, 'd-0', 0], [tenantId, 'd-1', 1200],
        ]);
        const publishOrder = h.outboundQueue.enqueueDispatch.mock.invocationCallOrder;
        expect(Math.max(...publishOrder)).toBeLessThan(h.dispatchOutbox.markQueued.mock.invocationCallOrder[0]);
    });

    it('keeps the batch when publishing fails, leaving recovery to republish it', async () => {
        const h = harness({ enabled: true, publishFails: true });
        // Committed rows own the reply. Falling back now would send it twice.
        await expect(run(h.service)).resolves.toBe(true);
        expect(h.dispatchOutbox.prepare).toHaveBeenCalledTimes(1);
    });

    it('leaves the reply to the existing path when nothing was committed', async () => {
        const h = harness({ enabled: true, prepareFails: true });
        await expect(run(h.service)).resolves.toBe(false);
        expect(h.outboundQueue.enqueueDispatch).not.toHaveBeenCalled();
    });

    it('declines without a persisted inbound, a contact or an operational scope', async () => {
        const h = harness({ enabled: true });
        for (const over of [
            { inboundMessageId: undefined },
            { inboundMessageId: 'provider-message-1' },
            { conversation: { id: conversationId, contact_id: null } },
            { operationalScope: undefined },
            { chunks: [] },
        ]) {
            await expect(run(h.service, over)).resolves.toBe(false);
        }
        expect(h.dispatchOutbox.prepare).not.toHaveBeenCalled();
    });

    it('declines when the outbox or the switch is not wired at all', async () => {
        const h = harness({ enabled: true });
        (h.service as any).dispatchOutbox = undefined;
        await expect(run(h.service)).resolves.toBe(false);
        (h.service as any).dispatchOutbox = h.dispatchOutbox;
        (h.service as any).dispatchRollout = undefined;
        await expect(run(h.service)).resolves.toBe(false);
    });

    it('declines rather than throwing when the switch itself cannot be read', async () => {
        const h = harness({ enabled: true });
        h.dispatchRollout.enabledFor.mockRejectedValue(new Error('settings unavailable'));
        await expect(run(h.service)).resolves.toBe(false);
    });
});
