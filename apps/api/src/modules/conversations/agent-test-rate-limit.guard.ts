import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
} from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export const AGENT_TEST_RATE_LIMIT = 20;
export const AGENT_TEST_RATE_WINDOW_SECONDS = 60;

@Injectable()
export class AgentTestRateLimitGuard implements CanActivate {
    constructor(private readonly redis: RedisService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const http = context.switchToHttp();
        const request = http.getRequest();
        const response = http.getResponse();
        const tenantId = String(request.params?.tenantId || 'unknown').slice(0, 64);
        const userId = String(request.user?.id || request.user?.sub || 'unknown').slice(0, 64);

        // Authenticated user + effective tenant is stable behind Cloudflare and
        // cannot be bypassed by rotating/spoofing forwarded IP headers.
        const key = `agent_test:rate:${tenantId}:${userId}`;
        const count = await this.redis.incrementRateLimit(key, AGENT_TEST_RATE_WINDOW_SECONDS);
        if (count <= AGENT_TEST_RATE_LIMIT) return true;

        response.setHeader('Retry-After', String(AGENT_TEST_RATE_WINDOW_SECONDS));
        throw new HttpException(
            {
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                error: 'agent_test_rate_limit',
                message: 'Demasiadas pruebas del agente. Intenta de nuevo en un minuto.',
                retryAfter: AGENT_TEST_RATE_WINDOW_SECONDS,
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }
}
