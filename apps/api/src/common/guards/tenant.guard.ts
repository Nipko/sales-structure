import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';

/**
 * Ensures that a user can only access data belonging to their tenant.
 * Super admins can optionally specify a tenant via route/query param.
 */
@Injectable()
export class TenantGuard implements CanActivate {
    private readonly logger = new Logger(TenantGuard.name);

    /** Loose UUID v4 check to prevent injection via tenantId param */
    private isValidUuid(value: string): boolean {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    }

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
                // Validate UUID format to prevent SQL injection
                if (!this.isValidUuid(tenantIdParam)) {
                    throw new ForbiddenException('Invalid tenant ID format');
                }
                request.tenantId = tenantIdParam;
                this.logger.log(`[AUDIT] super_admin ${user.email || user.id} accessing tenant ${tenantIdParam}`);
            }
            // If no tenantId provided, request.tenantId stays undefined.
            // Controllers must handle this case (e.g., reject or show tenant picker).
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
