import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AIModule } from '../ai/ai.module';
import { ReviewsService } from './reviews.service';
import { ReviewsCronService } from './reviews-cron.service';
import { ReviewsController, ReviewsPublicController } from './reviews.controller';

/**
 * Reviews & reputation (T3.23): Google Business Profile + AI replies in Spanish.
 */
@Module({
    imports: [HttpModule, PrismaModule, RedisModule, AIModule],
    providers: [ReviewsService, ReviewsCronService],
    controllers: [ReviewsController, ReviewsPublicController],
    exports: [ReviewsService],
})
export class ReviewsModule {}
