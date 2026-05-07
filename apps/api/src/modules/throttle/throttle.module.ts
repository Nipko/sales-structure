import { Global, Module } from '@nestjs/common';
import { TenantThrottleService } from './tenant-throttle.service';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Global module for plan-based rate limiting + feature flags.
 * Available everywhere without explicit imports — uses PrismaService and
 * RedisService which are also @Global().
 */
@Global()
@Module({
    providers: [TenantThrottleService, FeatureFlagsService],
    exports: [TenantThrottleService, FeatureFlagsService],
})
export class ThrottleModule {}
