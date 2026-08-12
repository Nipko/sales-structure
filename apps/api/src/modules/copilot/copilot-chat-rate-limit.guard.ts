import {
    CanActivate,
    ExecutionContext,
    HttpException,
    Injectable,
} from '@nestjs/common';
import { CopilotRateLimitService, COPILOT_RATE_LIMITS } from './copilot-rate-limit.service';

export const COPILOT_CHAT_RATE_LIMITS = COPILOT_RATE_LIMITS;

@Injectable()
export class CopilotChatRateLimitGuard implements CanActivate {
    constructor(private readonly rateLimiter: CopilotRateLimitService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const http = context.switchToHttp();
        const request = http.getRequest();
        const response = http.getResponse();
        try {
            await this.rateLimiter.consume(
                request.tenantId || request.user?.tenantId,
                request.user?.id || request.user?.sub,
            );
            return true;
        } catch (error) {
            if (error instanceof HttpException) {
                const payload = error.getResponse() as any;
                if (payload?.retryAfter) response.setHeader('Retry-After', String(payload.retryAfter));
            }
            throw error;
        }
    }
}
