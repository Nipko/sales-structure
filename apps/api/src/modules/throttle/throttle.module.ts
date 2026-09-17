import { Global, Module } from '@nestjs/common';
import { TenantThrottleService } from './tenant-throttle.service';
import { FeatureFlagsService } from './feature-flags.service';
import { DemoAllowanceService } from './demo-allowance.service';

/**
 * Global module for plan-based rate limiting + feature flags.
 * Available everywhere without explicit imports — uses PrismaService and
 * RedisService which are also @Global().
 *
 * DemoAllowanceService (D19, platform-paid demo replies) lives here for the
 * same reason: the widget, the onboarding and a super_admin panel all read it,
 * and none of them should have to import a module to do so.
 */
@Global()
@Module({
    providers: [TenantThrottleService, FeatureFlagsService, DemoAllowanceService],
    exports: [TenantThrottleService, FeatureFlagsService, DemoAllowanceService],
})
export class ThrottleModule {}
