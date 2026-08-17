import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import {
    evaluateSubscriptionAccess,
    readSubscriptionEntitlement,
    type SubscriptionAccessDecision,
    type SubscriptionEntitlementSnapshot,
} from '../utils/subscription-entitlement.util';

// `pending_auth` is intentionally locked too. During two-phase onboarding the
// tenant and its requested BillingSubscription already exist so a payment
// source can be stored tenant-scoped, but no money has moved yet. Letting that
// status through would make `tenants.plan` an entitlement before APPROVED.
// Billing/auth/fiscal endpoints remain reachable through EXEMPT_PATHS below.
// Prefixes are matched against the URL *pathname* and on a segment boundary.
// Matching substrings in the raw URL would let `/contacts?next=/billing/`
// bypass the guard. Keep recovery surfaces reachable while pending/locked.
const EXEMPT_ROUTE_PREFIXES = [
    '/billing',
    '/billing-admin',
    '/billing-coupons',
    '/fiscal',
    // Existing customer payments must settle even after a plan downgrade,
    // cancellation or hard lock. Only the public callback subtree is exempt;
    // tenant payment configuration remains subject to normal entitlement.
    '/tenant-payments/webhook',
    '/auth',
    '/onboarding',
    '/health',
];
const SOFT_LOCK_ALLOWED_METHODS = ['GET', 'HEAD', 'OPTIONS'];

@Injectable()
export class SubscriptionGuard implements CanActivate {
    constructor(
        private prisma: PrismaService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctxType = context.getType();
        if (ctxType !== 'http') return true;

        const request = context.switchToHttp().getRequest();
        if (!request || (!request.url && !request.originalUrl && !request.path)) {
            throw new ServiceUnavailableException({ error: 'request_path_unavailable' });
        }

        const pathname = this.requestPathname(request);
        if (EXEMPT_ROUTE_PREFIXES.some((prefix) => this.matchesRoutePrefix(pathname, prefix))) return true;

        const user = request.user;
        if (user?.role === 'super_admin') return true;

        // API-key guards authenticate a tenant without creating a JWT `user`.
        // They run before this global interceptor and populate request.tenantId;
        // treating !user as public would bypass every subscription lock.
        const tenantId = request.tenantId || user?.tenantId;
        if (!tenantId) return true;

        const method = request.method?.toUpperCase();
        const mode = SOFT_LOCK_ALLOWED_METHODS.includes(method) ? 'read' : 'write';
        const decision = evaluateSubscriptionAccess(
            await this.getSubscriptionSnapshot(tenantId),
            mode,
        );
        this.assertAllowed(decision);

        return true;
    }

    private async getSubscriptionSnapshot(tenantId: string): Promise<SubscriptionEntitlementSnapshot> {
        try {
            // Do not cache the decisive money state. Cache invalidation is
            // necessarily best-effort; a surviving ACTIVE value must not grant
            // five extra minutes after refund, expiry or payment failure.
            return await readSubscriptionEntitlement(this.prisma, tenantId);
        } catch {
            throw new ServiceUnavailableException({
                error: 'subscription_status_unavailable',
                message: 'No fue posible validar temporalmente el estado de la suscripción.',
            });
        }
    }

    private assertAllowed(decision: SubscriptionAccessDecision): void {
        if (decision.allowed) return;
        if (decision.restrictionLevel === 'unavailable') {
            throw new ServiceUnavailableException({
                error: decision.error,
                restrictionLevel: decision.restrictionLevel,
                message: 'No fue posible validar temporalmente el estado de la suscripción.',
            });
        }
        const messages: Record<string, string> = {
            payment_method_required: 'Completa el medio de pago para activar tu plan.',
            subscription_expired: 'Tu suscripción ha expirado. Reactiva tu plan desde la página de facturación.',
            subscription_paused: 'Tu suscripción está pausada. Reanúdala desde facturación para volver a escribir.',
            subscription_restricted: 'Tu cuenta está en modo solo lectura. Realiza un pago para restaurar el acceso completo.',
        };
        throw new ForbiddenException({
            error: decision.error,
            restrictionLevel: decision.restrictionLevel,
            ...(decision.daysRemaining === undefined ? {} : { daysRemaining: decision.daysRemaining }),
            message: messages[decision.error ?? ''] ?? 'La suscripción no permite esta operación.',
        });
    }

    private requestPathname(request: { originalUrl?: string; url?: string; path?: string }): string {
        if (typeof request.path === 'string' && request.path.startsWith('/')) return request.path;
        const raw = request.originalUrl || request.url || '/';
        try {
            return new URL(raw, 'http://subscription.guard').pathname;
        } catch {
            return raw.split('?')[0] || '/';
        }
    }

    private matchesRoutePrefix(pathname: string, prefix: string): boolean {
        // Nest mounts this application either at root or below the known API
        // prefixes. A matching segment later in the route is not an exemption
        // (`/contacts/billing/export` remains protected).
        return [prefix, `/api${prefix}`, `/api/v1${prefix}`].some(
            (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
        );
    }

}
