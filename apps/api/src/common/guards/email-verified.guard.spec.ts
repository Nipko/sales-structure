import { ForbiddenException } from '@nestjs/common';
import { EMAIL_VERIFICATION_CAPABILITIES, resolveEmailVerificationState } from '@parallext/shared';
import { EmailVerifiedGuard } from './email-verified.guard';

function context(user: any): any {
    return {
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => function handler() {},
        getClass: () => class Controller {},
    };
}

describe('progressive email verification', () => {
    it('keeps the complete risk policy typed and closed', () => {
        expect(Object.keys(EMAIL_VERIFICATION_CAPABILITIES).sort()).toEqual([
            'activate_agent', 'activate_channel', 'activate_integration', 'export_tenant_data',
            'invite_user', 'manage_billing', 'manage_secrets', 'send_outbound', 'sensitive_admin',
        ]);
        expect(Object.values(EMAIL_VERIFICATION_CAPABILITIES).every((policy) => policy.requiresVerified)).toBe(true);
        expect(resolveEmailVerificationState({ emailVerified: false, emailVerificationState: 'pending_change' })).toBe('pending_change');
        expect(resolveEmailVerificationState({ emailVerified: true })).toBe('verified');
        expect(resolveEmailVerificationState({ emailVerified: true, isActive: false })).toBe('restricted');
    });

    it('blocks the exact capability with a typed repair path', () => {
        const reflector = { getAllAndOverride: jest.fn().mockReturnValue('send_outbound') };
        const guard = new EmailVerifiedGuard(reflector as any);
        try {
            guard.canActivate(context({ role: 'tenant_admin', emailVerified: false }));
            throw new Error('expected guard to block');
        } catch (error) {
            expect(error).toBeInstanceOf(ForbiddenException);
            expect((error as ForbiddenException).getResponse()).toMatchObject({
                error: 'email_not_verified', state: 'unverified', capability: 'send_outbound',
                risk: 'customer_impact', repair: '/verify-email',
            });
        }
    });

    it('allows verified users, platform admins and lets the auth guard own anonymous requests', () => {
        const guard = new EmailVerifiedGuard({ getAllAndOverride: jest.fn() } as any);
        expect(guard.canActivate(context({ role: 'tenant_admin', emailVerified: true }))).toBe(true);
        expect(guard.canActivate(context({ role: 'super_admin', emailVerified: false }))).toBe(true);
        expect(guard.canActivate(context(undefined))).toBe(true);
    });
});
