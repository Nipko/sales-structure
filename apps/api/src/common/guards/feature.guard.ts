import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';
import { TenantThrottleService } from '../../modules/throttle/tenant-throttle.service';

/**
 * Enforces plan boolean feature flags declared via @RequireFeature.
 *
 * Runs after AuthGuard('jwt') + TenantGuard, so request.tenantId is already
 * resolved (TenantGuard sets it for both tenant users and super_admin via the
 * tenantId param). Throws 403 { error: 'feature_not_available' } when the
 * tenant's plan does not include the required feature.
 *
 * Only gates HTTP routes; non-HTTP contexts and routes without @RequireFeature
 * pass through. super_admin always passes.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly throttle: TenantThrottleService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (context.getType() !== 'http') return true;

        const featureKey = this.reflector.getAllAndOverride<string>(REQUIRE_FEATURE_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!featureKey) return true; // No feature gate declared

        const request = context.switchToHttp().getRequest();
        const user = request.user;

        // super_admin bypasses plan gating
        if (user?.role === 'super_admin') return true;

        const tenantId = request.tenantId || user?.tenantId || request.params?.tenantId;
        if (!tenantId) {
            throw new ForbiddenException({
                error: 'feature_not_available',
                feature: featureKey,
                message: 'No se pudo resolver el plan del tenant para esta funcionalidad.',
            });
        }

        const enabled = await this.throttle.isFeatureEnabled(tenantId, featureKey);
        if (!enabled) {
            throw new ForbiddenException({
                error: 'feature_not_available',
                feature: featureKey,
                message: 'Tu plan actual no incluye esta funcionalidad. Actualizá tu plan para acceder.',
            });
        }

        return true;
    }
}
