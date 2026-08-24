import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ThrottleModule } from '../throttle/throttle.module';
import { PublicApiKeyService } from './public-api-key.service';

/**
 * Narrow authentication module shared by the public API and the BI surface.
 *
 * Keeping this provider separate prevents analytics from importing the full
 * PublicApiModule, whose appointment controllers eventually depend on analytics
 * again through WhatsApp.
 */
@Module({
    imports: [PrismaModule, RedisModule, ThrottleModule],
    providers: [PublicApiKeyService],
    exports: [PublicApiKeyService],
})
export class PublicApiKeyModule {}
