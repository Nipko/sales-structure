import { ChatIdentityService } from './chat-identity.service';

describe('ChatIdentityService verification binding',()=>{
    const conversationId='33333333-3333-4333-8333-333333333333';
    const contactId='22222222-2222-4222-8222-222222222222';

    it('accepts only the contact stored in durable verification state',async()=>{
        const prisma={$queryRawUnsafe:jest.fn().mockResolvedValue([{contact_id:contactId}])};
        const service=new ChatIdentityService(prisma as any,{} as any,{} as any);
        await expect(service.isVerified(conversationId,contactId)).resolves.toBe(true);
        await expect(service.isVerified(conversationId,'44444444-4444-4444-8444-444444444444')).resolves.toBe(false);
    });

    it('fails closed when PostgreSQL is unavailable or the identifier is malformed',async()=>{
        const prisma={$queryRawUnsafe:jest.fn().mockRejectedValue(new Error('database down'))};
        const service=new ChatIdentityService(prisma as any,{} as any,{} as any);
        await expect(service.isVerified(conversationId,contactId)).resolves.toBe(false);
        await expect(service.isVerified('bad-id',contactId)).resolves.toBe(false);
    });
});
