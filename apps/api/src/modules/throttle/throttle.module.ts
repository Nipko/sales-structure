import { Global, Module } from '@nestjs/common';
import { TenantThrottleService } from './tenant-throttle.service';

/**
 * Global module for plan-based rate limiting.
 * Available everywhere without explicit imports — uses PrismaService and
 * RedisService which are also @Global().
 */
@Global()
@Module({
    providers: [TenantThrottleService],
    exports: [TenantThrottleService],
})
export class ThrottleModule {}
