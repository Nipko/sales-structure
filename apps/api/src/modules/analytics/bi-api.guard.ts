import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

/**
 * Resolves the BI API key before global interceptors run.
 *
 * Doing this inside the controller handler is too late: subscription enforcement
 * is an interceptor and therefore needs request.tenantId to be populated by a
 * guard. This keeps pending_auth/expired/cancelled tenants from bypassing the
 * product lock through the non-JWT BI surface.
 */
@Injectable()
export class BiApiGuard implements CanActivate {
    constructor(
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const raw = request?.headers?.['x-api-key'];
        const apiKey = Array.isArray(raw) ? raw[0] : raw;
        if (typeof apiKey !== 'string' || !apiKey) {
            throw new UnauthorizedException('X-API-Key header required');
        }

        const tenant = await this.prisma.tenant.findFirst({
            where: {
                isActive: true,
                settings: { path: ['biApiKey'], equals: apiKey },
            },
            select: { id: true },
        });
        if (!tenant) throw new UnauthorizedException('Invalid API key');

        const enabled = await this.throttle.isFeatureEnabled(tenant.id, 'biApi');
        if (!enabled) {
            throw new ForbiddenException(
                'BI API is not available on your current plan. Upgrade to access this feature.',
            );
        }

        request.tenantId = tenant.id;
        request.apiKeyKind = 'bi';
        return true;
    }
}
