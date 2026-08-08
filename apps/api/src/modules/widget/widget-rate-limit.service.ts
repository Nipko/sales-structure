import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../redis/redis.service';

export interface WidgetRateLimitResult {
    allowed: boolean;
    blockedScope?: 'ip' | 'visitor' | 'session' | 'widget' | 'tenant';
    retryAfterSeconds: number;
}

interface RateRule {
    scope: NonNullable<WidgetRateLimitResult['blockedScope']>;
    key: string;
    limit: number;
    windowSeconds: number;
}

const HOUR = 60 * 60;
const MINUTE = 60;

/**
 * Abuse ceilings, independent of commercial plan quotas. Plan quota and LLM
 * budget are enforced separately immediately before provider execution.
 */
export const WIDGET_SECURITY_LIMITS = Object.freeze({
    sessionsPerIpHour: 60,
    sessionsPerVisitorHour: 10,
    sessionsPerWidgetHour: 600,
    sessionsPerTenantHour: 1_200,
    messagesPerSessionMinute: 30,
    messagesPerVisitorHour: 240,
    messagesPerIpHour: 600,
    messagesPerWidgetHour: 5_000,
    messagesPerTenantHour: 10_000,
});

@Injectable()
export class WidgetRateLimitService {
    constructor(private readonly redis: RedisService) {}

    async consumeSession(input: {
        ip: string;
        visitorId: string;
        widgetId: string;
        tenantId: string;
    }): Promise<WidgetRateLimitResult> {
        const ip = this.digest(input.ip);
        const visitor = this.digest(`${input.tenantId}:${input.widgetId}:${input.visitorId}`);
        return this.consume([
            { scope: 'ip', key: `widget:rl:session:ip:${ip}`, limit: WIDGET_SECURITY_LIMITS.sessionsPerIpHour, windowSeconds: HOUR },
            { scope: 'visitor', key: `widget:rl:session:visitor:${visitor}`, limit: WIDGET_SECURITY_LIMITS.sessionsPerVisitorHour, windowSeconds: HOUR },
            { scope: 'widget', key: `widget:rl:session:widget:${input.widgetId}`, limit: WIDGET_SECURITY_LIMITS.sessionsPerWidgetHour, windowSeconds: HOUR },
            { scope: 'tenant', key: `widget:rl:session:tenant:${input.tenantId}`, limit: WIDGET_SECURITY_LIMITS.sessionsPerTenantHour, windowSeconds: HOUR },
        ]);
    }

    async consumeMessage(input: {
        ip: string;
        visitorId: string;
        sessionId: string;
        widgetId: string;
        tenantId: string;
    }): Promise<WidgetRateLimitResult> {
        const ip = this.digest(input.ip);
        const visitor = this.digest(`${input.tenantId}:${input.widgetId}:${input.visitorId}`);
        return this.consume([
            { scope: 'session', key: `widget:rl:message:session:${input.sessionId}`, limit: WIDGET_SECURITY_LIMITS.messagesPerSessionMinute, windowSeconds: MINUTE },
            { scope: 'visitor', key: `widget:rl:message:visitor:${visitor}`, limit: WIDGET_SECURITY_LIMITS.messagesPerVisitorHour, windowSeconds: HOUR },
            { scope: 'ip', key: `widget:rl:message:ip:${ip}`, limit: WIDGET_SECURITY_LIMITS.messagesPerIpHour, windowSeconds: HOUR },
            { scope: 'widget', key: `widget:rl:message:widget:${input.widgetId}`, limit: WIDGET_SECURITY_LIMITS.messagesPerWidgetHour, windowSeconds: HOUR },
            { scope: 'tenant', key: `widget:rl:message:tenant:${input.tenantId}`, limit: WIDGET_SECURITY_LIMITS.messagesPerTenantHour, windowSeconds: HOUR },
        ]);
    }

    private async consume(rules: RateRule[]): Promise<WidgetRateLimitResult> {
        // Redis MULTI makes each INCR+EXPIRE pair atomic. Increment every scope even
        // when one blocks so rotating visitor/session identifiers cannot avoid the
        // stable IP/widget/tenant ceilings.
        const counts = await Promise.all(
            rules.map(rule => this.redis.incrementRateLimit(rule.key, rule.windowSeconds)),
        );
        const blockedIndex = counts.findIndex((count, index) => count > rules[index].limit);
        if (blockedIndex < 0) return { allowed: true, retryAfterSeconds: 0 };
        return {
            allowed: false,
            blockedScope: rules[blockedIndex].scope,
            retryAfterSeconds: rules[blockedIndex].windowSeconds,
        };
    }

    private digest(value: string): string {
        return createHash('sha256').update(value.slice(0, 512)).digest('hex').slice(0, 24);
    }
}
