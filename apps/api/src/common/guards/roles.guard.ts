import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '@parallext/shared';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredRoles) {
            return true; // No roles required
        }

        const { user } = context.switchToHttp().getRequest();
        if (!user) {
            throw new UnauthorizedException('Authentication required');
        }

        // Super admin can access everything
        if (user.role === 'super_admin') {
            return true;
        }

        return requiredRoles.includes(user.role);
    }
}
