import { Module } from '@nestjs/common';
import { MetaComplianceController } from './meta-compliance.controller';
import { MetaComplianceService } from './meta-compliance.service';
import { RedisModule } from '../redis/redis.module';
import { PlatformNotificationModule } from '../platform-notifications/platform-notification.module';
import { AuthThrottleGuard } from '../../common/guards/auth-throttle.guard';

@Module({
    imports: [RedisModule, PlatformNotificationModule],
    controllers: [MetaComplianceController],
    providers: [MetaComplianceService, AuthThrottleGuard],
    exports: [MetaComplianceService],
})
export class MetaComplianceModule {}
