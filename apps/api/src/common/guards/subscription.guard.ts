import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RedisService } from '../../modules/redis/redis.service';

const CACHE_TTL = 300; // 5 min
const BLOCKED_STATUSES = ['expired', 'cancelled'];
const EXEMPT_PATHS = ['/billing/', '/billing-admin/', '/auth/', '/health', '/billing/webhook'];

@Injectable()
export class SubscriptionGuard implements CanActivate {
    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctxType = context.getType();
        if (ctxType !== 'http') return true;

        const request = context.switchToHttp().getRequest();
        if (!request?.url) return true;

        if (EXEMPT_PATHS.some(p => request.url.includes(p))) return true;

        const user = request.user;
        if (!user) return true; // no user = public route, other guards handle auth
        if (user.role === 'super_admin') return true;

        const tenantId = request.tenantId || user.tenantId;
        if (!tenantId) return true;

        const status = await this.getSubscriptionStatus(tenantId);
        if (status && BLOCKED_STATUSES.includes(status)) {
            throw new ForbiddenException(
                'Tu suscripción ha expirado o fue cancelada. Reactiva tu plan desde la página de facturación.',
            );
        }

        return true;
    }

    private async getSubscriptionStatus(tenantId: string): Promise<string | null> {
        const cacheKey = `sub_status:${tenantId}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached === 'none' ? null : cached;

        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { subscriptionStatus: true },
            });
            const status = tenant?.subscriptionStatus || null;
            await this.redis.set(cacheKey, status || 'none', CACHE_TTL);
            return status;
        } catch {
            return null;
        }
    }
}
