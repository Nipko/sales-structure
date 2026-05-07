import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Lightweight Redis-backed tap that captures the last N inbound webhook
 * events from every channel. Powers the super_admin /admin/webhooks live
 * tail console — useful for debugging integrations without SSH access
 * to container logs.
 *
 * Storage: a single Redis list keyed `webhook:tap` capped at MAX_EVENTS
 * via LTRIM. Each entry is JSON with channel/timestamp/status/summary.
 * No raw payload bodies are stored — only an extracted summary — to
 * avoid leaking PII into a key that all super_admins can read.
 */

const KEY = 'webhook:tap';
const MAX_EVENTS = 200;
const TTL_SECONDS = 7 * 24 * 3600;

export interface WebhookEvent {
    channelType: string;
    timestamp: string;
    status: 'received' | 'parsed' | 'rejected' | 'ignored' | 'error';
    accountId?: string;
    summary?: string;
    error?: string;
}

@Injectable()
export class WebhookTapService {
    private readonly logger = new Logger(WebhookTapService.name);

    constructor(private readonly redis: RedisService) {}

    async record(event: Omit<WebhookEvent, 'timestamp'>): Promise<void> {
        try {
            const entry: WebhookEvent = {
                ...event,
                timestamp: new Date().toISOString(),
            };
            const client = (this.redis as any).getClient();
            await client.lpush(KEY, JSON.stringify(entry));
            await client.ltrim(KEY, 0, MAX_EVENTS - 1);
            await client.expire(KEY, TTL_SECONDS);
        } catch (e: any) {
            // Never let a tap failure break a webhook handler
            this.logger.warn(`Webhook tap failed: ${e.message}`);
        }
    }

    async list(opts: { channelType?: string; limit?: number; status?: string }): Promise<WebhookEvent[]> {
        try {
            const client = (this.redis as any).getClient();
            const raw = await client.lrange(KEY, 0, MAX_EVENTS - 1);
            const events = raw.map((s: string) => {
                try { return JSON.parse(s) as WebhookEvent; } catch { return null; }
            }).filter(Boolean) as WebhookEvent[];

            let filtered = events;
            if (opts.channelType) filtered = filtered.filter(e => e.channelType === opts.channelType);
            if (opts.status) filtered = filtered.filter(e => e.status === opts.status);
            return filtered.slice(0, Math.min(opts.limit || 100, MAX_EVENTS));
        } catch (e: any) {
            this.logger.warn(`Webhook tap list failed: ${e.message}`);
            return [];
        }
    }
}
