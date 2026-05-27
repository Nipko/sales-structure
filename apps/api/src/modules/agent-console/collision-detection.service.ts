import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const VIEWER_TTL = 60;
const STALE_THRESHOLD_MS = 30_000;

@Injectable()
export class CollisionDetectionService {
    private readonly logger = new Logger(CollisionDetectionService.name);

    constructor(private readonly redis: RedisService) {}

    private viewingKey(tenantId: string, conversationId: string): string {
        return `viewing:${tenantId}:${conversationId}`;
    }

    private reverseIndexKey(agentId: string): string {
        return `agent_viewing:${agentId}`;
    }

    async startViewing(
        tenantId: string,
        conversationId: string,
        agentId: string,
        agentName: string,
    ): Promise<void> {
        const client = this.redis.getClient();
        const viewKey = this.viewingKey(tenantId, conversationId);
        const revKey = this.reverseIndexKey(agentId);
        const member = `${agentId}::${agentName}`;
        const reverseValue = `${tenantId}::${conversationId}`;

        const pipeline = client.pipeline();
        pipeline.zadd(viewKey, Date.now(), member);
        pipeline.expire(viewKey, VIEWER_TTL);
        pipeline.sadd(revKey, reverseValue);
        pipeline.expire(revKey, VIEWER_TTL);
        await pipeline.exec();
    }

    async stopViewing(
        tenantId: string,
        conversationId: string,
        agentId: string,
    ): Promise<void> {
        const client = this.redis.getClient();
        const viewKey = this.viewingKey(tenantId, conversationId);
        const revKey = this.reverseIndexKey(agentId);
        const reverseValue = `${tenantId}::${conversationId}`;

        // Remove all members for this agent (any name variant)
        const members = await client.zrangebyscore(viewKey, 0, '+inf');
        const agentMembers = members.filter((m) => m.startsWith(`${agentId}::`));

        const pipeline = client.pipeline();
        for (const m of agentMembers) {
            pipeline.zrem(viewKey, m);
        }
        pipeline.srem(revKey, reverseValue);
        await pipeline.exec();
    }

    async heartbeat(
        tenantId: string,
        conversationId: string,
        agentId: string,
        agentName: string,
    ): Promise<void> {
        const client = this.redis.getClient();
        const viewKey = this.viewingKey(tenantId, conversationId);
        const revKey = this.reverseIndexKey(agentId);
        const member = `${agentId}::${agentName}`;

        const pipeline = client.pipeline();
        pipeline.zadd(viewKey, Date.now(), member);
        pipeline.expire(viewKey, VIEWER_TTL);
        pipeline.expire(revKey, VIEWER_TTL);
        await pipeline.exec();
    }

    async getViewers(
        tenantId: string,
        conversationId: string,
    ): Promise<{ agentId: string; agentName: string }[]> {
        const client = this.redis.getClient();
        const viewKey = this.viewingKey(tenantId, conversationId);

        const cutoff = Date.now() - STALE_THRESHOLD_MS;
        await client.zremrangebyscore(viewKey, 0, cutoff);

        const members = await client.zrangebyscore(viewKey, 0, '+inf');

        return members.map((member) => {
            const separatorIndex = member.indexOf('::');
            return {
                agentId: member.substring(0, separatorIndex),
                agentName: member.substring(separatorIndex + 2),
            };
        });
    }

    async removeAgent(
        agentId: string,
    ): Promise<{ tenantId: string; conversationId: string }[]> {
        const client = this.redis.getClient();
        const revKey = this.reverseIndexKey(agentId);

        const entries = await client.smembers(revKey);
        if (!entries.length) return [];

        const affected: { tenantId: string; conversationId: string }[] = [];

        for (const entry of entries) {
            const separatorIndex = entry.indexOf('::');
            const tenantId = entry.substring(0, separatorIndex);
            const conversationId = entry.substring(separatorIndex + 2);
            affected.push({ tenantId, conversationId });

            const viewKey = this.viewingKey(tenantId, conversationId);
            const members = await client.zrangebyscore(viewKey, 0, '+inf');
            const agentMembers = members.filter((m) =>
                m.startsWith(`${agentId}::`),
            );

            if (agentMembers.length) {
                const pipeline = client.pipeline();
                for (const m of agentMembers) {
                    pipeline.zrem(viewKey, m);
                }
                await pipeline.exec();
            }
        }

        await client.del(revKey);

        return affected;
    }
}
