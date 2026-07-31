import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { CronLockService } from './cron-lock.service';

@Global()
@Module({
    providers: [RedisService, CronLockService],
    exports: [RedisService, CronLockService],
})
export class RedisModule { }
