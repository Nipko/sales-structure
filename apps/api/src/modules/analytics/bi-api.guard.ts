import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PublicApiKeyService } from '../public-api/public-api-key.service';

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
        private readonly apiKeys: PublicApiKeyService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const raw = request?.headers?.['x-api-key'];
        const apiKey = Array.isArray(raw) ? raw[0] : raw;
        if (typeof apiKey !== 'string' || !apiKey) {
            throw new UnauthorizedException('X-API-Key header required');
        }

        const key = await this.apiKeys.validateKey(apiKey);
        if (!key || !key.scopes.includes('read:analytics')) {
            throw new UnauthorizedException('Invalid API key');
        }
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: key.tenantId },
            select: { id: true, isActive: true },
        });
        if (!tenant?.isActive) throw new UnauthorizedException('Invalid API key');

        const enabled = await this.throttle.isFeatureEnabled(tenant.id, 'biApi');
        if (!enabled) {
            throw new ForbiddenException(
                'BI API is not available on your current plan. Upgrade to access this feature.',
            );
        }

        request.tenantId = tenant.id;
        request.apiKeyKind = 'bi';
        request.apiKeyId = key.keyId;
        request.apiKeyRateLimitRpm = key.rateLimitRpm;
        return true;
    }
}
