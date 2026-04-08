import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export const SNOOZE_QUEUE = 'conversation-snooze';

@Injectable()
export class SnoozeService {
    private readonly logger = new Logger(SnoozeService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        @InjectQueue(SNOOZE_QUEUE) private readonly snoozeQueue: Queue,
    ) {}

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
        `;
        if (tenant && tenant.length > 0) {
            const schema = tenant[0].schema_name;
            await this.redis.set(`tenant:${tenantId}:schema`, schema, 3600);
            return schema;
        }
        return null;
    }

    async snooze(tenantId: string, conversationId: string, snoozeUntil: Date) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Update conversation with snooze time
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE conversations SET snoozed_until = $1, status = 'snoozed', updated_at = NOW() WHERE id = $2::uuid`,
            [snoozeUntil.toISOString(), conversationId],
        );

        // Calculate delay in milliseconds
        const delay = snoozeUntil.getTime() - Date.now();
        if (delay <= 0) {
            this.logger.warn(`Snooze time is in the past for conversation ${conversationId}, unsnoozing immediately`);
            return this.unsnooze(tenantId, conversationId);
        }

        // Add delayed job to BullMQ
        const jobId = `snooze:${conversationId}`;
        await this.snoozeQueue.add('unsnooze', {
            tenantId,
            conversationId,
        }, {
            jobId,
            delay,
            removeOnComplete: true,
            removeOnFail: 5,
        });

        this.logger.log(`Snoozed conversation ${conversationId} until ${snoozeUntil.toISOString()}`);
        return { conversationId, snoozedUntil: snoozeUntil };
    }

    async unsnooze(tenantId: string, conversationId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Clear snooze on conversation
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE conversations SET snoozed_until = NULL, status = 'open', updated_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );

        // Remove pending BullMQ job if exists
        const jobId = `snooze:${conversationId}`;
        try {
            const job = await this.snoozeQueue.getJob(jobId);
            if (job) {
                await job.remove();
                this.logger.log(`Removed snooze job for conversation ${conversationId}`);
            }
        } catch (error) {
            this.logger.warn(`Could not remove snooze job ${jobId}: ${error.message}`);
        }

        this.logger.log(`Unsnoozed conversation ${conversationId}`);
        return { conversationId, snoozedUntil: null };
    }
}
