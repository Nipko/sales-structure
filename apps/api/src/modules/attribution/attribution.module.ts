import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AttributionService } from './attribution.service';
import { AttributionController } from './attribution.controller';

/**
 * Attribution (T3.22): Click-to-WhatsApp ads + revenue attribution.
 * AttributionService is consumed by ConversationsModule to capture the WhatsApp
 * referral on inbound; it reads CRM data directly so it has no cross-module deps.
 */
@Module({
    imports: [PrismaModule, RedisModule],
    providers: [AttributionService],
    controllers: [AttributionController],
    exports: [AttributionService],
})
export class AttributionModule {}
