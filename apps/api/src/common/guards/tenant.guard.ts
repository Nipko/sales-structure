import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Ensures that a user can only access data belonging to their tenant.
 * Super admins can optionally specify a tenant via query param.
 */
@Injectable()
export class TenantGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user) {
            return false;
        }

        // Super admin can access any tenant via query param
        if (user.role === 'super_admin') {
            const tenantIdParam = request.params.tenantId || request.query.tenantId;
            if (tenantIdParam) {
                request.tenantId = tenantIdParam;
            }
            return true;
        }

        // Regular users can only access their own tenant
        if (!user.tenantId) {
            throw new ForbiddenException('No tenant assigned to this user');
        }

        // If a tenantId is in the route, verify it matches
        const routeTenantId = request.params.tenantId;
        if (routeTenantId && routeTenantId !== user.tenantId) {
            throw new ForbiddenException('Access denied: tenant mismatch');
        }

        request.tenantId = user.tenantId;
        return true;
    }
}
