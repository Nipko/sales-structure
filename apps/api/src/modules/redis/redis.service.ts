import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly client: Redis;

    constructor(private configService: ConfigService) {
        this.client = new Redis({
            host: this.configService.get<string>('redis.host', 'localhost'),
            port: this.configService.get<number>('redis.port', 6379),
            maxRetriesPerRequest: null, // Required for BullMQ
        });
    }

    getClient(): Redis {
        return this.client;
    }

    async onModuleDestroy() {
        await this.client.quit();
    }

    // ---- Key-Value Operations ----

    async get(key: string): Promise<string | null> {
        return this.client.get(key);
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        if (ttlSeconds) {
            await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
            await this.client.set(key, value);
        }
    }

    async del(key: string): Promise<void> {
        await this.client.del(key);
    }

    // ---- JSON Operations ----

    async getJson<T>(key: string): Promise<T | null> {
        const value = await this.client.get(key);
        if (!value) return null;
        return JSON.parse(value) as T;
    }

    async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        await this.set(key, JSON.stringify(value), ttlSeconds);
    }

    // ---- Tenant-scoped operations ----

    tenantKey(tenantId: string, key: string): string {
        return `tenant:${tenantId}:${key}`;
    }

    async getTenantData<T>(tenantId: string, key: string): Promise<T | null> {
        return this.getJson<T>(this.tenantKey(tenantId, key));
    }

    async setTenantData<T>(tenantId: string, key: string, value: T, ttlSeconds?: number): Promise<void> {
        await this.setJson(this.tenantKey(tenantId, key), value, ttlSeconds);
    }

    // ---- Conversation Context Cache ----

    async getConversationContext(tenantId: string, conversationId: string): Promise<any | null> {
        return this.getJson(this.tenantKey(tenantId, `conv:${conversationId}:context`));
    }

    async setConversationContext(tenantId: string, conversationId: string, context: any, ttlSeconds = 3600): Promise<void> {
        await this.setJson(this.tenantKey(tenantId, `conv:${conversationId}:context`), context, ttlSeconds);
    }

    // ---- Counter Operations ----

    async incr(key: string): Promise<number> {
        return this.client.incr(key);
    }

    async incrByFloat(key: string, increment: number): Promise<string> {
        return this.client.incrbyfloat(key, increment);
    }

    async expire(key: string, seconds: number): Promise<void> {
        await this.client.expire(key, seconds);
    }

    // ---- Rate Limiting ----

    async incrementRateLimit(key: string, windowSeconds: number): Promise<number> {
        const multi = this.client.multi();
        multi.incr(key);
        multi.expire(key, windowSeconds);
        const results = await multi.exec();
        return (results?.[0]?.[1] as number) || 0;
    }

    async isRateLimited(tenantId: string, limit: number, windowSeconds: number): Promise<boolean> {
        const key = `ratelimit:${tenantId}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
        const current = await this.incrementRateLimit(key, windowSeconds);
        return current > limit;
    }
}
