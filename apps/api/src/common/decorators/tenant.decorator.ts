import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extract the current tenant ID from the authenticated user
 * Usage: @CurrentTenant() tenantId: string
 */
export const CurrentTenant = createParamDecorator(
    (data: unknown, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        return request.user?.tenantId;
    },
);

/**
 * Extract the current authenticated user
 * Usage: @CurrentUser() user: AuthUser
 */
export const CurrentUser = createParamDecorator(
    (data: string, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user;
        return data ? user?.[data] : user;
    },
);
