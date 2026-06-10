import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly client: Redis;

    constructor(private configService: ConfigService) {
        this.client = new Redis({
            host: this.configService.get<string>('redis.host', 'localhost'),
            port: this.configService.get<number>('redis.port', 6379),
            password: this.configService.get<string>('redis.password') || undefined,
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

    // ---- Locking ----

    /** Acquire a lock (SET NX EX). Returns true if acquired. */
    async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
        const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
        return result === 'OK';
    }

    async releaseLock(key: string): Promise<void> {
        await this.client.del(key);
    }

    // ---- Ownership-token locking (safe for locks that may outlive their TTL) ----

    /**
     * Acquire a lock with a unique ownership token. Returns the token when
     * acquired (pass it to releaseLockToken / renewLockToken), or null if the
     * lock is currently held. Unlike acquireLock, the token lets the release be
     * conditional so a holder can never delete a lock that has since been
     * re-acquired by another process after a TTL expiry.
     */
    async acquireLockToken(key: string, ttlSeconds: number): Promise<string | null> {
        const token = randomUUID();
        const result = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
        return result === 'OK' ? token : null;
    }

    /** Release a lock only if we still own it (compare-and-delete via Lua). */
    async releaseLockToken(key: string, token: string): Promise<void> {
        await this.client.eval(
            `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
            1, key, token,
        );
    }

    /**
     * Extend a lock's TTL only if we still own it. Returns true when renewed.
     * Used as a heartbeat so a long-running critical section keeps the lock
     * alive instead of letting it expire mid-flight.
     */
    async renewLockToken(key: string, token: string, ttlSeconds: number): Promise<boolean> {
        const result = await this.client.eval(
            `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`,
            1, key, token, String(ttlSeconds * 1000),
        );
        return result === 1;
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

    async incrBy(key: string, by: number): Promise<number> {
        if (by === 0) return 0;
        return this.client.incrby(key, by);
    }

    async incrByFloat(key: string, increment: number): Promise<string> {
        return this.client.incrbyfloat(key, increment);
    }

    async expire(key: string, seconds: number): Promise<void> {
        await this.client.expire(key, seconds);
    }

    // ---- Set operations ----

    async sadd(key: string, member: string): Promise<number> {
        return this.client.sadd(key, member);
    }

    async smembers(key: string): Promise<string[]> {
        return this.client.smembers(key);
    }

    async srem(key: string, member: string): Promise<number> {
        return this.client.srem(key, member);
    }

    async scard(key: string): Promise<number> {
        return this.client.scard(key);
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
