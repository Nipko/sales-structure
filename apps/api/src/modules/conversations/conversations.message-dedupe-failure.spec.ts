import { ConversationsService } from './conversations.service';

function serviceWith(executeInTenantSchema: jest.Mock) {
    const service: any = Object.create(ConversationsService.prototype);
    service.prisma = {
        executeInTenantSchema,
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_a'),
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    service.redis = {
        get: jest.fn().mockResolvedValue('tenant_a'),
        set: jest.fn().mockResolvedValue(undefined),
    };
    service.logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    service.gateway = { emitNewMessage: jest.fn() };
    service.eventEmitter = { emit: jest.fn() };
    return service;
}

const message: any = {
    channelType: 'whatsapp',
    channelAccountId: 'account-1',
    contactId: '+573001112233',
    content: { type: 'text', text: 'hola' },
    metadata: { messageId: 'wamid.inbound-1' },
};

describe('inbound message dedupe authority', () => {
    it('does not insert without dedupe when the unique index is missing', async () => {
        const execute = jest.fn().mockRejectedValueOnce({ code: '42P10' });
        const service = serviceWith(execute);

        await expect(service.saveMessage('tenant-1', 'conversation-1', message))
            .rejects.toThrow('inbound_dedupe_authority_unavailable');
        expect(execute).toHaveBeenCalledTimes(1);
        expect(service.gateway.emitNewMessage).not.toHaveBeenCalled();
        expect(service.eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('does not resume a duplicate whose durable receipt cannot be read', async () => {
        const execute = jest.fn()
            .mockResolvedValueOnce([])
            .mockRejectedValueOnce(new Error('database unavailable'));
        const service = serviceWith(execute);

        await expect(service.saveMessage('tenant-1', 'conversation-1', message))
            .rejects.toThrow('inbound_dedupe_receipt_unavailable');
        expect(execute).toHaveBeenCalledTimes(2);
    });

    it('does not attach another conversation ledger to a provider duplicate', async () => {
        const execute = jest.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: 'message-1', conversation_id: 'conversation-2' }]);
        const service = serviceWith(execute);

        await expect(service.saveMessage('tenant-1', 'conversation-1', message))
            .rejects.toThrow('inbound_dedupe_conversation_mismatch');
    });
});
