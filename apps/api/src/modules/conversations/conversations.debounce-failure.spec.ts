import { ConversationsService } from './conversations.service';

const message = {
    id: 'provider-message',
    tenantId: '11111111-1111-4111-8111-111111111111',
    contactId: 'customer',
    channelType: 'whatsapp',
    channelAccountId: 'account',
    content: { type: 'text', text: 'hola' },
} as any;

describe('burst coordination failure', () => {
    it('keeps the inbound job retryable instead of answering each fragment separately', async () => {
        const service = Object.create(ConversationsService.prototype) as ConversationsService;
        Object.assign(service as any, {
            redis: { incr: jest.fn().mockRejectedValue(new Error('redis unavailable')) },
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
        });

        await expect((service as any).debounceBurst(message))
            .rejects.toThrow('burst_coordination_unavailable');
    });

    it('does not swallow the coordination error at the turn boundary', async () => {
        const service = Object.create(ConversationsService.prototype) as ConversationsService;
        const resolveConversation = jest.fn();
        Object.assign(service as any, {
            debounceBurst: jest.fn().mockRejectedValue(new Error('burst_coordination_unavailable')),
            resolveConversation,
        });

        await expect((service as any).runTurn(structuredClone(message)))
            .rejects.toThrow('burst_coordination_unavailable');
        expect(resolveConversation).not.toHaveBeenCalled();
    });
});
