import { Module } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { RedisModule } from '../redis/redis.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
    imports: [RedisModule, ChannelsModule],
    controllers: [BroadcastController],
    providers: [BroadcastService],
    exports: [BroadcastService],
})
export class BroadcastModule { }
