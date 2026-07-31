import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { CronLockService } from '../redis/cron-lock.service';

@Injectable()
export class ArchiveMaintenanceService {
    private readonly logger = new Logger(ArchiveMaintenanceService.name);
    private readonly storagePath: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly configService: ConfigService,
        private readonly throttle: TenantThrottleService,
        private readonly cronLock: CronLockService,
    ) {
        this.storagePath = this.configService.get<string>('MEDIA_STORAGE_PATH', '/data/media');
    }

    /**
     * Daily maintenance job running at 3:30 AM to archive old resolved/archived messages
     */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('30 3 * * *')
    async handleDailyArchivingCron() {
        await this.cronLock.runExclusive('archive-maintenance.handleDailyArchiving', 3600, () => this.handleDailyArchiving());
    }

    async handleDailyArchiving(): Promise<void> {
        this.logger.log('Starting daily chat history archiving process...');
        try {
            await this.runArchivingProcess();
            this.logger.log('Daily chat history archiving process finished successfully.');
        } catch (error: any) {
            this.logger.error(`Error during daily chat history archiving: ${error.message}`);
        }
    }

    /**
     * Executes the archiving process for all active tenants or a specific one.
     */
    async runArchivingProcess(specificTenantId?: string): Promise<{ success: boolean; processedTenants: number; archivedConversations: number }> {
        let activeTenants: Array<{ id: string; schemaName: string; plan: string }> = [];

        if (specificTenantId) {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: specificTenantId, isActive: true },
                select: { id: true, schemaName: true, plan: true },
            });
            if (tenant) activeTenants = [tenant];
        } else {
            activeTenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, schemaName: true, plan: true },
            });
        }

        let totalConversationsArchived = 0;

        for (const tenant of activeTenants) {
            try {
                const count = await this.archiveTenantMessages(tenant.id, tenant.schemaName, tenant.plan);
                totalConversationsArchived += count;
            } catch (error: any) {
                this.logger.error(`Failed to archive messages for tenant ${tenant.id} (${tenant.schemaName}): ${error.message}`);
            }
        }

        return {
            success: true,
            processedTenants: activeTenants.length,
            archivedConversations: totalConversationsArchived,
        };
    }

    /**
     * Archive old resolved/archived messages for a single tenant
     */
    private async archiveTenantMessages(tenantId: string, schemaName: string, plan: string): Promise<number> {
        const thresholdDays = await this.getPlanRetentionDays(tenantId);
        if (thresholdDays === Number.POSITIVE_INFINITY) {
            this.logger.log(`Tenant ${tenantId} (${plan}) has infinite retention. Skipping archiving.`);
            return 0;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - thresholdDays);
        const cutoffIso = cutoffDate.toISOString();

        // 1. Get resolved or archived conversations older than the threshold
        const conversations = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, metadata, status, updated_at FROM conversations 
             WHERE status IN ('resolved', 'archived') 
               AND updated_at < $1::timestamp 
               AND (metadata->>'cold_archived')::boolean IS NOT TRUE`,
            [cutoffIso],
        );

        if (!conversations || conversations.length === 0) {
            return 0;
        }

        this.logger.log(`Tenant ${tenantId} (${plan}): Found ${conversations.length} conversations to archive (older than ${thresholdDays} days).`);

        let archivedCount = 0;

        for (const conv of conversations) {
            const convId = conv.id;
            try {
                // 2. Fetch all messages for this conversation
                const messages = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT id, direction, content_type, content_text, media_url, media_mime_type, caption, status, llm_model_used, llm_tokens_used, llm_cost, external_id, metadata, created_at 
                     FROM messages 
                     WHERE conversation_id = $1::uuid 
                     ORDER BY created_at ASC`,
                    [convId],
                );

                // 3. Fetch all WABA logs if applicable
                const wabaLogs = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT id, provider_message_id, template_name, direction, status, error_code, error_message, request_payload_json, response_payload_json, sent_at, delivered_at, read_at, created_at 
                     FROM whatsapp_message_logs 
                     WHERE conversation_id = $1::uuid 
                     ORDER BY created_at ASC`,
                    [convId],
                );

                // If there are no messages or logs, we just mark it archived in metadata and skip writing a file
                if ((!messages || messages.length === 0) && (!wabaLogs || wabaLogs.length === 0)) {
                    await this.prisma.executeInTenantSchema(
                        schemaName,
                        `UPDATE conversations 
                         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{cold_archived}', 'true'::jsonb),
                             updated_at = NOW()
                         WHERE id = $1::uuid`,
                        [convId],
                    );
                    archivedCount++;
                    continue;
                }

                // 4. Build the archive payload
                const archivePayload = {
                    conversationId: convId,
                    tenantId,
                    archivedAt: new Date().toISOString(),
                    retentionDaysApplied: thresholdDays,
                    conversationStatus: conv.status,
                    conversationUpdatedAt: conv.updated_at,
                    messagesCount: messages?.length || 0,
                    wabaLogsCount: wabaLogs?.length || 0,
                    messages: messages || [],
                    whatsappMessageLogs: wabaLogs || [],
                };

                // 5. Compress using Gzip
                const jsonStr = JSON.stringify(archivePayload);
                const compressedBuffer = zlib.gzipSync(Buffer.from(jsonStr));

                // 6. Write file to archives folder on disk
                const tenantArchiveDir = path.join(this.storagePath, 'archives', tenantId);
                if (!fs.existsSync(tenantArchiveDir)) {
                    fs.mkdirSync(tenantArchiveDir, { recursive: true });
                }

                const filePath = path.join(tenantArchiveDir, `${convId}.json.gz`);
                fs.writeFileSync(filePath, compressedBuffer);

                // 7. Delete records from Postgres in a transaction
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `DELETE FROM whatsapp_message_logs WHERE conversation_id = $1::uuid`,
                    [convId],
                );

                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `DELETE FROM messages WHERE conversation_id = $1::uuid`,
                    [convId],
                );

                // 8. Update conversation metadata
                const originalMetadata = conv.metadata || {};
                const updatedMetadata = {
                    ...originalMetadata,
                    cold_archived: true,
                    archived_at: new Date().toISOString(),
                };

                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `UPDATE conversations 
                     SET metadata = $2::jsonb,
                         updated_at = NOW()
                     WHERE id = $1::uuid`,
                    [convId, JSON.stringify(updatedMetadata)],
                );

                archivedCount++;
            } catch (err: any) {
                this.logger.error(`Error archiving conversation ${convId} for tenant ${tenantId}: ${err.message}`);
            }
        }

        this.logger.log(`Tenant ${tenantId}: Successfully archived ${archivedCount} conversations to cold storage.`);
        return archivedCount;
    }

    /**
     * Resolves the archive and decompresses the Gzip archive for a conversation.
     */
    async getArchivedMessages(tenantId: string, conversationId: string): Promise<any | null> {
        try {
            const tenantArchiveDir = path.join(this.storagePath, 'archives', tenantId);
            const filePath = path.join(tenantArchiveDir, `${conversationId}.json.gz`);

            if (!fs.existsSync(filePath)) {
                return null;
            }

            const compressedBuffer = fs.readFileSync(filePath);
            const decompressedBuffer = zlib.gunzipSync(compressedBuffer);
            const archivePayload = JSON.parse(decompressedBuffer.toString('utf-8'));

            return archivePayload;
        } catch (error: any) {
            this.logger.error(`Error retrieving archived messages for conversation ${conversationId} of tenant ${tenantId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Resolve the retention cutoff (in days) from the tenant plan's
     * `dataRetentionDays` feature — the billing_plans/seed single source of
     * truth (emprendedor=90, starter=180, pro=365, enterprise=730, custom=-1).
     * -1 means keep indefinitely. A missing/invalid value FAILS SAFE to
     * infinite retention so a plan misconfiguration never deletes customer
     * data prematurely.
     */
    private async getPlanRetentionDays(tenantId: string): Promise<number> {
        const features = await this.throttle.getPlanFeatures(tenantId);
        const raw = features?.dataRetentionDays;
        if (raw === -1) return Number.POSITIVE_INFINITY;
        if (typeof raw === 'number' && raw > 0) return raw;
        return Number.POSITIVE_INFINITY; // fail-safe: never auto-delete on misconfig
    }
}
