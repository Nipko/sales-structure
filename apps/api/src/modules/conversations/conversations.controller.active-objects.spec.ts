import { ConversationsController } from './conversations.controller';

describe('conversation active-object authority', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const contactId = '33333333-3333-4333-8333-333333333333';

    it('does not report an empty operation list when persona authority is unavailable', async () => {
        const controller: any = Object.create(ConversationsController.prototype);
        const load = jest.fn();
        Object.assign(controller, {
            prisma: {
                getTenantSchemaName: jest.fn().mockResolvedValue('tenant_demo'),
                executeInTenantSchema: jest.fn().mockResolvedValue([{ contact_id: contactId }]),
            },
            personaService: {
                getActivePersona: jest.fn().mockRejectedValue(new Error('persona store unavailable')),
            },
            activeOperations: { load },
        });

        await expect(controller.getActiveObjects(tenantId, conversationId))
            .rejects.toThrow('persona store unavailable');
        expect(load).not.toHaveBeenCalled();
    });
});
