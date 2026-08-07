import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { CronLockService } from './cron-lock.service';
import { WsRelayService } from './ws-relay.service';

@Global()
@Module({
    providers: [RedisService, CronLockService, WsRelayService],
    exports: [RedisService, CronLockService, WsRelayService],
})
export class RedisModule { }
