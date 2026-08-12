import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export const COPILOT_RATE_LIMITS = {
    userMinute: { limit: 20, windowSeconds: 60 },
    userDay: { limit: 200, windowSeconds: 86_400 },
    tenantMinute: { limit: 100, windowSeconds: 60 },
    tenantDay: { limit: 1_000, windowSeconds: 86_400 },
} as const;

@Injectable()
export class CopilotRateLimitService {
    constructor(private readonly redis: RedisService) {}

    async consume(tenantId: string, userId: string): Promise<void> {
        const tenantScope = this.readScope(tenantId);
        const userScope = this.readScope(userId);
        if (!tenantScope || !userScope) {
            throw new ForbiddenException('Authenticated tenant and user are required');
        }

        const scopes = [
            {
                key: this.bucketKey(`copilot:rate:tenant:${tenantScope}:user:${userScope}:minute`, 60),
                ...COPILOT_RATE_LIMITS.userMinute,
            },
            {
                key: this.bucketKey(`copilot:rate:tenant:${tenantScope}:user:${userScope}:day`, 86_400),
                ...COPILOT_RATE_LIMITS.userDay,
            },
            {
                key: this.bucketKey(`copilot:rate:tenant:${tenantScope}:minute`, 60),
                ...COPILOT_RATE_LIMITS.tenantMinute,
            },
            {
                key: this.bucketKey(`copilot:rate:tenant:${tenantScope}:day`, 86_400),
                ...COPILOT_RATE_LIMITS.tenantDay,
            },
        ];
        const counts = await Promise.all(
            scopes.map((scope) => this.redis.incrementRateLimit(scope.key, scope.windowSeconds)),
        );
        const blockedIndex = counts.findIndex((count, index) => count > scopes[index].limit);
        if (blockedIndex === -1) return;

        const retryAfter = scopes[blockedIndex].windowSeconds;
        throw new HttpException(
            {
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                error: 'copilot_rate_limit',
                message: 'Has alcanzado temporalmente el límite de consultas de Parallly Assist. Intenta de nuevo más tarde.',
                retryAfter,
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }

    private readScope(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const scope = value.trim();
        return /^[a-zA-Z0-9_-]{1,64}$/.test(scope) ? scope : null;
    }

    private bucketKey(prefix: string, windowSeconds: number): string {
        const bucket = Math.floor(Date.now() / (windowSeconds * 1_000));
        return `${prefix}:${bucket}`;
    }
}
