jest.mock('bcrypt', () => ({
    hash: () => { throw new Error('Unexpected password hashing in token-type tests'); },
    compare: () => { throw new Error('Unexpected password comparison in token-type tests'); },
}));

import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('validateUser accepts only access tokens', () => {
    const userId = '11111111-1111-4111-8111-111111111111';

    function setup() {
        // findUnique resolving null makes a payload that passes the type check
        // fail later with a different message, so the two outcomes stay distinct.
        const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
        const service = Object.assign(Object.create(AuthService.prototype), { prisma }) as AuthService;
        return { service, prisma };
    }

    it('rejects the 2FA-pending token handed out after the password step', async () => {
        const { service, prisma } = setup();
        await expect(service.validateUser({ sub: userId, purpose: '2fa' } as any))
            .rejects.toThrow(new UnauthorizedException('Invalid token type'));
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects the customer-portal token', async () => {
        const { service, prisma } = setup();
        await expect(service.validateUser({ sub: userId, type: 'customer', tenantId: 't' } as any))
            .rejects.toThrow('Invalid token type');
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a token without a role claim', async () => {
        const { service } = setup();
        await expect(service.validateUser({ sub: userId, email: 'a@b.test' } as any)).rejects.toThrow('Invalid token type');
    });

    it('lets an access-shaped token reach the user lookup', async () => {
        const { service, prisma } = setup();
        await expect(service.validateUser({ sub: userId, email: 'a@b.test', role: 'tenant_admin', sid: 's' }))
            .rejects.toThrow('User not found or inactive');
        expect(prisma.user.findUnique).toHaveBeenCalled();
    });
});
