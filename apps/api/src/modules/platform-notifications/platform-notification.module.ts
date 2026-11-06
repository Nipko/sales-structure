import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { EmailModule } from '../email/email.module';
import { PlatformNotificationOutboxService } from './platform-notification-outbox.service';
import { PlatformSmsService } from '../auth/platform-sms.service';

@Module({
    imports: [PrismaModule, RedisModule, EmailModule],
    providers: [PlatformNotificationOutboxService,PlatformSmsService],
    exports: [PlatformNotificationOutboxService],
})
export class PlatformNotificationModule {}
