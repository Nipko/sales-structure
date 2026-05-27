import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_SCOPE_KEY } from '../decorators/api-scope.decorator';

@Injectable()
export class ApiScopeGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredScope = this.reflector.get<string>(API_SCOPE_KEY, context.getHandler());
        if (!requiredScope) return true;

        const request = context.switchToHttp().getRequest();
        const scopes: string[] = request.apiKeyScopes || [];
        if (!scopes.includes(requiredScope)) {
            throw new ForbiddenException(`API key missing required scope: ${requiredScope}`);
        }
        return true;
    }
}
