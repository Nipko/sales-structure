import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksListenerService } from './webhooks-listener.service';

@Module({
    imports: [
        PrismaModule,
        RedisModule,
        HttpModule.register({ timeout: 10_000 }),
    ],
    controllers: [WebhooksController],
    providers: [WebhooksService, WebhooksListenerService],
    exports: [WebhooksService],
})
export class WebhooksModule {}
