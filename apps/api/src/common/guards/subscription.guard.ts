import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RedisService } from '../../modules/redis/redis.service';

const CACHE_TTL = 300; // 5 min
const HARD_LOCK_STATUSES = ['expired', 'cancelled'];
const EXEMPT_PATHS = ['/billing/', '/billing-admin/', '/auth/', '/health', '/billing/webhook'];
const SOFT_LOCK_ALLOWED_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const GRACE_DAYS_SOFT_LOCK = 3;
const GRACE_DAYS_HARD_LOCK = 7;

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
        if (!user) return true;
        if (user.role === 'super_admin') return true;

        const tenantId = request.tenantId || user.tenantId;
        if (!tenantId) return true;

        const status = await this.getSubscriptionStatus(tenantId);
        if (!status) return true;

        if (HARD_LOCK_STATUSES.includes(status)) {
            throw new ForbiddenException({
                error: 'subscription_expired',
                restrictionLevel: 'hard_lock',
                message: 'Tu suscripción ha expirado. Reactiva tu plan desde la página de facturación.',
            });
        }

        if (status === 'past_due') {
            const graceDays = await this.getGraceDays(tenantId);

            if (graceDays >= GRACE_DAYS_HARD_LOCK) {
                throw new ForbiddenException({
                    error: 'subscription_expired',
                    restrictionLevel: 'hard_lock',
                    message: 'Tu período de gracia expiró. Reactiva tu plan desde la página de facturación.',
                });
            }

            if (graceDays >= GRACE_DAYS_SOFT_LOCK) {
                const method = request.method?.toUpperCase();
                if (!SOFT_LOCK_ALLOWED_METHODS.includes(method)) {
                    throw new ForbiddenException({
                        error: 'subscription_restricted',
                        restrictionLevel: 'soft_lock',
                        daysRemaining: GRACE_DAYS_HARD_LOCK - graceDays,
                        message: 'Tu cuenta está en modo solo lectura. Realiza un pago para restaurar el acceso completo.',
                    });
                }
            }
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

    private async getGraceDays(tenantId: string): Promise<number> {
        try {
            const pastDueSince = await this.redis.get(`offboard:past_due:${tenantId}`);
            if (!pastDueSince) return 0;
            return Math.floor((Date.now() - new Date(pastDueSince).getTime()) / 86_400_000);
        } catch {
            return 0;
        }
    }
}
