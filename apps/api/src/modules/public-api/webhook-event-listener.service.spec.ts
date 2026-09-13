import { WebhookEventListenerService } from './webhook-event-listener.service';

describe('WebhookEventListenerService durable event identity', () => {
    const dispatchEvent = jest.fn();
    const service = new WebhookEventListenerService(
        { dispatchEvent } as any,
        { tenant: { findFirst: jest.fn() } } as any,
    );

    beforeEach(() => dispatchEvent.mockReset().mockResolvedValue(undefined));

    it('keys an inbound hook by the committed message instead of the conversation', async () => {
        await service.handleMessageReceived({
            tenantId: 'tenant-1',
            conversationId: 'conversation-1',
            messageId: 'message-7',
            text: 'hello',
        });

        expect(dispatchEvent).toHaveBeenCalledWith(
            'tenant-1',
            'message.received',
            expect.objectContaining({ conversationId: 'conversation-1', text: 'hello' }),
            'message.received:message-7',
        );
    });

    it('does not hide a failure to commit the delivery row', async () => {
        dispatchEvent.mockRejectedValueOnce(new Error('outbox unavailable'));

        await expect(service.handleConversationClosed({
            tenantId: 'tenant-1',
            conversationId: 'conversation-1',
        })).rejects.toThrow('outbox unavailable');
    });
});
