import { ChatIdentityService } from './chat-identity.service';

describe('ChatIdentityService verification binding', () => {
    const conversationId = '33333333-3333-4333-8333-333333333333';
    const contactId = '22222222-2222-4222-8222-222222222222';

    function createService(redisGet: jest.Mock) {
        return new ChatIdentityService(
            {} as any,
            { get: redisGet } as any,
            {} as any,
            {} as any,
        );
    }

    it('accepts verification only for the contact stored with the conversation', async () => {
        const service = createService(jest.fn().mockResolvedValue(contactId));

        await expect(service.isVerified(conversationId, contactId)).resolves.toBe(true);
        await expect(service.isVerified(
            conversationId,
            '44444444-4444-4444-8444-444444444444',
        )).resolves.toBe(false);
    });

    it('fails closed when Redis is unavailable', async () => {
        const service = createService(jest.fn().mockRejectedValue(new Error('redis down')));

        await expect(service.isVerified(conversationId, contactId)).resolves.toBe(false);
    });

    it('reuses a pending code for the same contact instead of sending another one', async () => {
        const redis = {
            get: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(JSON.stringify({
                    code: '123456',
                    contactId,
                    attempts: 0,
                    via: 'email',
                    hint: 'a***@example.com',
                })),
            acquireLockToken: jest.fn().mockResolvedValue('lock-token'),
            releaseLockToken: jest.fn().mockResolvedValue(undefined),
            del: jest.fn(),
        };
        const prisma = { executeInTenantSchema: jest.fn() };
        const email = { send: jest.fn() };
        const sms = { send: jest.fn() };
        const service = new ChatIdentityService(prisma as any, redis as any, email as any, sms as any);

        await expect(service.startVerification(
            '11111111-1111-4111-8111-111111111111',
            'tenant_identity',
            contactId,
            conversationId,
            'whatsapp',
        )).resolves.toEqual({ status: 'sent', via: 'email', hint: 'a***@example.com' });

        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
        expect(sms.send).not.toHaveBeenCalled();
        expect(redis.releaseLockToken).toHaveBeenCalledWith(
            `lock:chat:idcode:${conversationId}`,
            'lock-token',
        );
    });

    it('returns pending when another sender owns the delivery fence', async () => {
        const redis = {
            get: jest.fn().mockResolvedValue(null),
            acquireLockToken: jest.fn().mockResolvedValue(null),
        };
        const prisma = { executeInTenantSchema: jest.fn() };
        const email = { send: jest.fn() };
        const sms = { send: jest.fn() };
        const service = new ChatIdentityService(prisma as any, redis as any, email as any, sms as any);

        await expect(service.startVerification(
            '11111111-1111-4111-8111-111111111111',
            'tenant_identity',
            contactId,
            conversationId,
            'whatsapp',
        )).resolves.toEqual({ status: 'pending' });

        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
        expect(sms.send).not.toHaveBeenCalled();
    });
});
