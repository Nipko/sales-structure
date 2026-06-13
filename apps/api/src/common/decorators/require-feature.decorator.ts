import { SetMetadata } from '@nestjs/common';

export const REQUIRE_FEATURE_KEY = 'requiredFeature';

/**
 * Gate every route it decorates behind a plan boolean feature flag.
 *
 * Apply at the CLASS level to gate an entire module's controller in one place
 * (preferred — avoids the "forgot to gate one method" bug class), or at the
 * METHOD level to override the class default for a specific route.
 *
 *   @RequireFeature('staffScheduling')
 *   @Controller('staff')
 *   export class StaffSchedulingController {}
 *
 * Resolved by FeatureGuard, which reads the tenant's plan via
 * TenantThrottleService.isFeatureEnabled and throws 403 feature_not_available
 * when the flag is off. super_admin always passes.
 */
export const RequireFeature = (featureKey: string) => SetMetadata(REQUIRE_FEATURE_KEY, featureKey);
