import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { EmailModule } from '../email/email.module';
import { PlatformNotificationOutboxService } from './platform-notification-outbox.service';

@Module({
    imports: [PrismaModule, RedisModule, EmailModule],
    providers: [PlatformNotificationOutboxService],
    exports: [PlatformNotificationOutboxService],
})
export class PlatformNotificationModule {}
