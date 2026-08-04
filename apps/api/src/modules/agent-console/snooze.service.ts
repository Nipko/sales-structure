import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CronLockService } from '../redis/cron-lock.service';

export const SNOOZE_QUEUE = 'conversation-snooze';

@Injectable()
export class SnoozeService {
    private readonly logger = new Logger(SnoozeService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private cronLock: CronLockService,
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
        // BullMQ rejects ':' in a jobId ('Custom Id cannot contain :'), so this
        // must use a separator it accepts.
        const jobId = `snooze-${conversationId}`;
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

        // 'active', no 'open'. Los estados válidos de una conversación son
        // active | waiting_human | with_human | resolved | archived
        // (tenant-schema.sql:38). 'open' no lo reconoce NADIE: ni el filtro del
        // inbox, ni las métricas de agent-analytics, ni —lo grave—
        // `resolveConversation`, que sólo reusa las tres primeras. Una
        // conversación despertada a 'open' seguía partiendo el historial en dos
        // cuando el cliente volvía a escribir.
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE conversations SET snoozed_until = NULL, status = 'active', updated_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );

        // Remove pending BullMQ job if exists
        const jobId = `snooze-${conversationId}`;
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

    /**
     * Red de seguridad: despierta lo que se le pasó a la cola.
     *
     * El job con `delay` es el camino rápido, pero es un dato que vive sólo en
     * Redis. Un flush, un `removeOnFail` agotado o —el caso real que hubo— una
     * cola sin consumidor durante meses dejan conversaciones dormidas sin nadie
     * que las despierte, y encima invisibles: nadie va a mirar el ZSET de
     * `delayed` de BullMQ para darse cuenta.
     *
     * Esto barre por BASE DE DATOS, que es la única fuente que sobrevive a
     * Redis. También es lo que va a rescatar a las que ya quedaron colgadas
     * antes de que existiera el processor.
     */
    @Cron('*/5 * * * *')
    async wakeExpiredSnoozesCron() {
        await this.cronLock.runExclusive('snooze.wakeExpired', 240, () => this.wakeExpiredSnoozes());
    }

    async wakeExpiredSnoozes(): Promise<void> {
        try {
            const tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, schemaName: true },
            });

            for (const tenant of tenants) {
                try {
                    const due = await this.prisma.executeInTenantSchema<any[]>(
                        tenant.schemaName,
                        `SELECT id FROM conversations
                          WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= NOW()
                          LIMIT 200`,
                    );
                    for (const row of due || []) {
                        await this.unsnooze(tenant.id, String(row.id));
                    }
                    if (due?.length) {
                        this.logger.log(`[Snooze] Rescatadas ${due.length} conversaciones vencidas en ${tenant.schemaName}`);
                    }
                } catch (e: any) {
                    // Un schema atrasado sin la columna no debe frenar al resto.
                    this.logger.warn(`[Snooze] Barrido falló en ${tenant.schemaName}: ${e.message}`);
                }
            }
        } catch (e: any) {
            this.logger.warn(`[Snooze] Barrido de vencidos falló: ${e.message}`);
        }
    }
}
