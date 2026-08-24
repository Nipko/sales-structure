import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';

describe('TenantGuard', () => {
    const ownTenant = '11111111-1111-4111-8111-111111111111';
    const otherTenant = '22222222-2222-4222-8222-222222222222';

    function context(
        user: Record<string, unknown> | undefined,
        tenantId?: string,
        queryTenantId?: unknown,
    ): ExecutionContext {
        const request: any = {
            user,
            params: tenantId ? { tenantId } : {},
            query: queryTenantId !== undefined ? { tenantId: queryTenantId } : {},
        };
        return {
            switchToHttp: () => ({ getRequest: () => request }),
        } as unknown as ExecutionContext;
    }

    it.each(['tenant_admin', 'tenant_supervisor', 'tenant_agent'])(
        'rejects cross-tenant access for %s',
        (role) => {
            expect(() => new TenantGuard().canActivate(context({ role, tenantId: ownTenant }, otherTenant)))
                .toThrow(ForbiddenException);
        },
    );

    it('rejects an invalid tenant identifier from a super admin', () => {
        expect(() => new TenantGuard().canActivate(context({ role: 'super_admin', email: 'root@test' }, '../public')))
            .toThrow(ForbiddenException);
    });

    it.each(['tenant_admin', 'tenant_supervisor', 'tenant_agent'])(
        'allows %s to access its own tenant only',
        (role) => {
            expect(new TenantGuard().canActivate(context({ role, tenantId: ownTenant }, ownTenant))).toBe(true);
        },
    );

    it('allows a super admin to access an explicitly identified valid tenant', () => {
        expect(new TenantGuard().canActivate(context({ role: 'super_admin', email: 'root@test' }, otherTenant))).toBe(true);
    });

    it.each(['tenant_admin', 'tenant_supervisor', 'tenant_agent'])(
        'rejects a cross-tenant query selector for %s before the controller reads it',
        (role) => {
            expect(() => new TenantGuard().canActivate(
                context({ role, tenantId: ownTenant }, undefined, otherTenant),
            )).toThrow(ForbiddenException);
        },
    );

    it('rejects array-valued and conflicting tenant selectors', () => {
        const guard = new TenantGuard();
        expect(() => guard.canActivate(
            context({ role: 'super_admin', email: 'root@test' }, undefined, [otherTenant]),
        )).toThrow(ForbiddenException);
        expect(() => guard.canActivate(
            context({ role: 'super_admin', email: 'root@test' }, ownTenant, otherTenant),
        )).toThrow(ForbiddenException);
    });
});

