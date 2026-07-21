import {
    Injectable,
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RedisService } from '../../modules/redis/redis.service';
import { AUTH_THROTTLE_KEY, AuthThrottleOptions } from '../decorators/auth-throttle.decorator';

@Injectable()
export class AuthThrottleGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly redis: RedisService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const options = this.reflector.getAllAndOverride<AuthThrottleOptions>(
            AUTH_THROTTLE_KEY,
            [context.getHandler(), context.getClass()],
        );

        // No @AuthThrottle decorator → allow through
        if (!options) {
            return true;
        }

        const { limit, windowSeconds } = options;
        const request = context.switchToHttp().getRequest();
        const response = context.switchToHttp().getResponse();

        // Extract client IP. Behind the Cloudflare tunnel, CF-Connecting-IP is set
        // by Cloudflare to the real client IP and CANNOT be overwritten by the
        // client. X-Forwarded-For's first entry, by contrast, is spoofable: a
        // client can send `X-Forwarded-For: 1.2.3.4` and Cloudflare appends the
        // real IP *after* it, so XFF[0] is attacker-controlled — rotating it would
        // let an attacker walk past this limiter. Prefer CF-Connecting-IP, and
        // fall back to XFF/req.ip only for non-Cloudflare paths (dev, direct).
        const ip =
            request.headers['cf-connecting-ip']?.toString().trim() ||
            request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
            request.ip ||
            'unknown';

        // Derive a stable endpoint tag from the route path
        const endpoint = request.route?.path || request.url || 'unknown';

        const key = `auth_rl:${endpoint}:${ip}`;

        // Atomic INCR + conditional EXPIRE (only set TTL on first increment)
        const count = await this.redis.incr(key);
        if (count === 1) {
            await this.redis.expire(key, windowSeconds);
        }

        if (count > limit) {
            response.setHeader('Retry-After', String(windowSeconds));
            throw new HttpException(
                {
                    statusCode: HttpStatus.TOO_MANY_REQUESTS,
                    message: 'Too many requests. Please try again later.',
                    retryAfter: windowSeconds,
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        return true;
    }
}
