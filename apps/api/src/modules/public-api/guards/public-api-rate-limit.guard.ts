import { Injectable, CanActivate, ExecutionContext, HttpException } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class PublicApiRateLimitGuard implements CanActivate {
    constructor(private readonly redis: RedisService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const keyId = request.apiKeyId;
        const rpm = request.apiKeyRateLimitRpm || 60;

        const client = this.redis.getClient();
        const now = Date.now();
        const windowKey = `api_rl:${keyId}`;

        const pipeline = client.pipeline();
        pipeline.zremrangebyscore(windowKey, 0, now - 60_000);
        pipeline.zadd(windowKey, now, `${now}:${Math.random()}`);
        pipeline.zcard(windowKey);
        pipeline.expire(windowKey, 120);
        const results = await pipeline.exec();

        const count = results?.[2]?.[1] as number;
        if (count > rpm) {
            const response = context.switchToHttp().getResponse();
            response.setHeader('X-RateLimit-Limit', rpm);
            response.setHeader('X-RateLimit-Remaining', 0);
            response.setHeader('Retry-After', '60');
            throw new HttpException('Rate limit exceeded', 429);
        }

        return true;
    }
}
