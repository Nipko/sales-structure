import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export const BROADCAST_QUEUE = 'broadcast-messages';

export interface CreateCampaignDto {
    name: string;
    channel?: string;
    templateName: string;
    templateLanguage?: string;
    templateComponents?: any[];
    /** Filter: 'all' | JSON with tags/segment filters */
    targetAudience?: string;
    /** Explicit list of phone numbers (overrides targetAudience query) */
    recipientPhones?: string[];
    scheduledAt?: string;
    metadata?: Record<string, any>;
}

export interface BroadcastJobData {
    tenantId: string;
    schemaName: string;
    campaignId: string;
    recipientId: string;
    phone: string;
    templateName: string;
    templateLanguage: string;
    templateComponents: any[];
}

export interface CampaignStats {
    campaignId: string;
    name: string;
    status: string;
    totalRecipients: number;
    queued: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    launchedAt: string | null;
    completedAt: string | null;
}

@Injectable()
export class BroadcastService {
    private readonly logger = new Logger(BroadcastService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly eventEmitter: EventEmitter2,
        @InjectQueue(BROADCAST_QUEUE) private readonly broadcastQueue: Queue,
    ) {}

    // ================================================================
    // CREATE CAMPAIGN
    // ================================================================
    async createCampaign(tenantId: string, data: CreateCampaignDto) {
        const schema = await this.getTenantSchema(tenantId);
        await this.ensureBroadcastTables(schema);

        // Build recipient list from audience filter or explicit phones
        const recipients = await this.resolveRecipients(schema, data);

        const metadata = {
            ...(data.metadata || {}),
            templateLanguage: data.templateLanguage || 'es',
            templateComponents: data.templateComponents || [],
            recipientPhones: data.recipientPhones || null,
        };

        const status = data.scheduledAt ? 'scheduled' : 'draft';
        const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt).toISOString() : null;

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO campaigns (
                id, name, channel, wa_template_name, status,
                target_audience, metadata, scheduled_at, created_at, updated_at
            ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4,
                $5, $6, $7::timestamptz, NOW(), NOW()
            ) RETURNING id`,
            [
                data.name,
                data.channel || 'whatsapp',
                data.templateName,
                status,
                data.targetAudience || 'all',
                JSON.stringify(metadata),
                scheduledAt,
            ],
        );

        const campaignId = rows?.[0]?.id;

        // Insert recipients into campaign_recipients
        if (recipients.length > 0) {
            const values = recipients.map(
                (_, i) => `(gen_random_uuid(), $1::uuid, $${i * 2 + 2}::uuid, $${i * 2 + 3}, 'pending', NOW())`,
            ).join(', ');

            const params: any[] = [campaignId];
            for (const r of recipients) {
                params.push(r.id, r.phone);
            }

            await this.prisma.executeInTenantSchema(
                schema,
                `INSERT INTO campaign_recipients (id, campaign_id, contact_id, phone, status, created_at)
                 VALUES ${values}`,
                params,
            );
        }

        return { id: campaignId, recipientCount: recipients.length };
    }

    // ================================================================
    // LAUNCH CAMPAIGN — queues all recipients as BullMQ jobs
    // ================================================================
    async launchCampaign(tenantId: string, campaignId: string) {
        const schema = await this.getTenantSchema(tenantId);
        await this.ensureBroadcastTables(schema);

        // Fetch campaign
        const campaigns = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM campaigns WHERE id = $1::uuid LIMIT 1`,
            [campaignId],
        );

        if (!campaigns?.length) {
            throw new NotFoundException('Campaign not found');
        }

        const campaign = campaigns[0];

        if (campaign.status !== 'draft' && campaign.status !== 'paused' && campaign.status !== 'scheduled') {
            throw new BadRequestException(
                `Campaign cannot be launched from status "${campaign.status}". Must be draft, paused or scheduled.`,
            );
        }

        // Fetch pending recipients
        const recipients = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, contact_id, phone FROM campaign_recipients
             WHERE campaign_id = $1::uuid AND status = 'pending'`,
            [campaignId],
        );

        if (!recipients?.length) {
            throw new BadRequestException('No pending recipients found for this campaign');
        }

        // Parse template config from metadata
        const metadata = typeof campaign.metadata === 'string'
            ? JSON.parse(campaign.metadata)
            : (campaign.metadata || {});

        const templateName = campaign.wa_template_name;
        const templateLanguage = metadata.templateLanguage || 'es';
        const templateComponents = metadata.templateComponents || [];

        // Mark campaign as sending
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE campaigns SET status = 'active', starts_at = NOW(), updated_at = NOW()
             WHERE id = $1::uuid`,
            [campaignId],
        );

        // Queue each recipient as an individual job with rate limiting
        const jobs = recipients.map((r) => ({
            name: 'send-template',
            data: {
                tenantId,
                schemaName: schema,
                campaignId,
                recipientId: r.id,
                phone: r.phone,
                templateName,
                templateLanguage,
                templateComponents,
            } as BroadcastJobData,
            opts: {
                attempts: 3,
                backoff: { type: 'exponential' as const, delay: 5000 },
                removeOnComplete: 100,
                removeOnFail: 500,
            },
        }));

        // BullMQ addBulk for efficient queueing
        await this.broadcastQueue.addBulk(jobs);

        // Update recipient statuses to 'queued'
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE campaign_recipients SET status = 'queued', updated_at = NOW()
             WHERE campaign_id = $1::uuid AND status = 'pending'`,
            [campaignId],
        );

        this.logger.log(
            `Campaign ${campaignId} launched: ${recipients.length} messages queued`,
        );

        return { queued: recipients.length };
    }

    // ================================================================
    // GET CAMPAIGNS — list with basic stats
    // ================================================================
    async getCampaigns(tenantId: string) {
        const schema = await this.getTenantSchema(tenantId);
        await this.ensureBroadcastTables(schema);

        const campaigns = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT c.*,
                    (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id) AS total_recipients,
                    (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id AND cr.status = 'sent') AS sent_count,
                    (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id AND cr.status = 'delivered') AS delivered_count,
                    (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id AND cr.status = 'read') AS read_count,
                    (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id AND cr.status = 'failed') AS failed_count
             FROM campaigns c
             ORDER BY c.created_at DESC`,
        );

        return (campaigns || []).map((c) => ({
            id: c.id,
            name: c.name,
            code: c.code,
            channel: c.channel,
            templateName: c.wa_template_name,
            status: c.status,
            targetAudience: c.target_audience,
            totalRecipients: parseInt(c.total_recipients || '0'),
            sentCount: parseInt(c.sent_count || '0'),
            deliveredCount: parseInt(c.delivered_count || '0'),
            readCount: parseInt(c.read_count || '0'),
            failedCount: parseInt(c.failed_count || '0'),
            scheduledAt: c.scheduled_at?.toISOString?.() || c.scheduled_at || null,
            startsAt: c.starts_at?.toISOString?.() || c.starts_at || null,
            endsAt: c.ends_at?.toISOString?.() || c.ends_at || null,
            createdAt: c.created_at?.toISOString?.() || c.created_at,
        }));
    }

    // ================================================================
    // GET CAMPAIGN STATS — detailed delivery stats
    // ================================================================
    async getCampaignStats(tenantId: string, campaignId: string): Promise<CampaignStats> {
        const schema = await this.getTenantSchema(tenantId);
        await this.ensureBroadcastTables(schema);

        const campaigns = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM campaigns WHERE id = $1::uuid LIMIT 1`,
            [campaignId],
        );

        if (!campaigns?.length) {
            throw new NotFoundException('Campaign not found');
        }

        const campaign = campaigns[0];

        const stats = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT
                status,
                COUNT(*)::int AS count
             FROM campaign_recipients
             WHERE campaign_id = $1::uuid
             GROUP BY status`,
            [campaignId],
        );

        const statusMap: Record<string, number> = {};
        for (const row of stats || []) {
            statusMap[row.status] = parseInt(row.count || '0');
        }

        const totalRecipients = Object.values(statusMap).reduce((a, b) => a + b, 0);

        return {
            campaignId,
            name: campaign.name,
            status: campaign.status,
            totalRecipients,
            queued: statusMap['queued'] || 0,
            sent: statusMap['sent'] || 0,
            delivered: statusMap['delivered'] || 0,
            read: statusMap['read'] || 0,
            failed: statusMap['failed'] || 0,
            launchedAt: campaign.starts_at?.toISOString?.() || campaign.starts_at || null,
            completedAt: campaign.ends_at?.toISOString?.() || campaign.ends_at || null,
        };
    }

    // ================================================================
    // UPDATE RECIPIENT STATUS — called by the queue processor
    // ================================================================
    async updateRecipientStatus(
        schemaName: string,
        recipientId: string,
        status: 'sent' | 'delivered' | 'read' | 'failed',
        errorMessage?: string,
        providerMessageId?: string,
    ) {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE campaign_recipients
             SET status = $1,
                 error_message = COALESCE($2, error_message),
                 provider_message_id = COALESCE($3, provider_message_id),
                 sent_at = CASE WHEN $1 IN ('sent','delivered','read') THEN COALESCE(sent_at, NOW()) ELSE sent_at END,
                 updated_at = NOW()
             WHERE id = $4::uuid`,
            [status, errorMessage || null, providerMessageId || null, recipientId],
        );
    }

    // ================================================================
    // CHECK CAMPAIGN COMPLETION — called after each job finishes
    // ================================================================
    async checkCampaignCompletion(schemaName: string, campaignId: string) {
        const pending = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int AS count FROM campaign_recipients
             WHERE campaign_id = $1::uuid AND status IN ('pending', 'queued')`,
            [campaignId],
        );

        const remaining = parseInt(pending?.[0]?.count || '0');
        if (remaining === 0) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE campaigns SET status = 'finished', ends_at = NOW(), updated_at = NOW()
                 WHERE id = $1::uuid`,
                [campaignId],
            );
            this.logger.log(`Campaign ${campaignId} completed — all recipients processed`);

            try {
                const campaign = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT c.name,
                            (SELECT COUNT(*)::int FROM campaign_recipients WHERE campaign_id = c.id AND status = 'sent') AS sent_count,
                            (SELECT COUNT(*)::int FROM campaign_recipients WHERE campaign_id = c.id AND status = 'failed') AS failed_count
                     FROM campaigns c WHERE c.id = $1::uuid`,
                    [campaignId],
                );
                if (campaign[0]) {
                    const tenant = await this.prisma.tenant.findFirst({ where: { schemaName }, select: { id: true } });
                    if (tenant) {
                        this.eventEmitter.emit('campaign.completed', {
                            tenantId: tenant.id,
                            campaignId,
                            name: campaign[0].name,
                            sentCount: campaign[0].sent_count,
                            failedCount: campaign[0].failed_count,
                        });
                    }
                }
            } catch (e: any) {
                this.logger.warn(`Failed to emit campaign.completed: ${e.message}`);
            }
        }
    }

    // ================================================================
    // CRON — auto-launch scheduled campaigns
    // ================================================================
    @Cron('* * * * *')
    async launchScheduledCampaigns() {
        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;

            for (const tenant of tenants || []) {
                const schema = tenant.schema_name;
                try {
                    const due = await this.prisma.executeInTenantSchema<any[]>(
                        schema,
                        `SELECT id FROM campaigns
                         WHERE status = 'scheduled' AND scheduled_at <= NOW()`,
                    );

                    for (const campaign of due || []) {
                        try {
                            await this.launchCampaign(tenant.id, campaign.id);
                            this.logger.log(`Auto-launched scheduled campaign ${campaign.id} for tenant ${tenant.id}`);
                        } catch (err: any) {
                            this.logger.warn(`Failed to auto-launch campaign ${campaign.id}: ${err.message}`);
                        }
                    }
                } catch {
                    // Schema may not have campaigns table yet
                }
            }
        } catch (err: any) {
            this.logger.error(`launchScheduledCampaigns cron failed: ${err.message}`);
        }
    }

    // ================================================================
    // PRIVATE HELPERS
    // ================================================================

    private async resolveRecipients(
        schema: string,
        data: CreateCampaignDto,
    ): Promise<Array<{ id: string; phone: string }>> {
        // Option 1: explicit phone list provided
        if (data.recipientPhones?.length) {
            const placeholders = data.recipientPhones.map((_, i) => `$${i + 1}`).join(', ');
            const contacts = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id, phone FROM contacts WHERE phone IN (${placeholders})`,
                data.recipientPhones,
            );
            return (contacts || []).map((c) => ({ id: c.id, phone: c.phone }));
        }

        // Option 2: audience filter
        const audience = data.targetAudience || 'all';

        if (audience === 'all') {
            const contacts = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id, phone FROM contacts WHERE phone IS NOT NULL AND phone != ''`,
            );
            return (contacts || []).map((c) => ({ id: c.id, phone: c.phone }));
        }

        // Option 3: JSON filter — tags or segmentId
        try {
            const filter = JSON.parse(audience);

            // 3a: segment-based targeting
            if (filter.segmentId) {
                const segs = await this.prisma.executeInTenantSchema<any[]>(
                    schema,
                    `SELECT filter_rules FROM contact_segments WHERE id = $1::uuid`,
                    [filter.segmentId],
                );
                if (segs?.length) {
                    const rules = typeof segs[0].filter_rules === 'string'
                        ? JSON.parse(segs[0].filter_rules)
                        : segs[0].filter_rules;

                    const { whereClause, params } = this.buildFilterSQL(rules);
                    const phoneCond = whereClause
                        ? `WHERE ${whereClause} AND phone IS NOT NULL AND phone != ''`
                        : `WHERE phone IS NOT NULL AND phone != ''`;

                    const contacts = await this.prisma.executeInTenantSchema<any[]>(
                        schema,
                        `SELECT id, phone FROM leads ${phoneCond}`,
                        params,
                    );
                    return (contacts || []).map((c) => ({ id: c.id, phone: c.phone }));
                }
            }

            // 3b: tag-based filter — {"tags": ["vip", "prospect"]}
            if (filter.tags?.length) {
                const contacts = await this.prisma.executeInTenantSchema<any[]>(
                    schema,
                    `SELECT id, phone FROM contacts
                     WHERE phone IS NOT NULL AND phone != ''
                       AND tags && $1::text[]`,
                    [filter.tags],
                );
                return (contacts || []).map((c) => ({ id: c.id, phone: c.phone }));
            }
        } catch {
            // Not valid JSON — treat as 'all'
        }

        const contacts = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, phone FROM contacts WHERE phone IS NOT NULL AND phone != ''`,
        );
        return (contacts || []).map((c) => ({ id: c.id, phone: c.phone }));
    }

    private buildFilterSQL(rules: any[]): { whereClause: string; params: any[] } {
        if (!rules || rules.length === 0) return { whereClause: '', params: [] };

        const conditions: string[] = [];
        const params: any[] = [];
        let n = 1;

        for (const rule of rules) {
            const column = rule.field?.startsWith('metadata.')
                ? `metadata->>'${rule.field.replace('metadata.', '')}'`
                : rule.field;
            if (!column) continue;

            switch (rule.operator) {
                case 'eq':    conditions.push(`${column} = $${n++}`); params.push(rule.value); break;
                case 'neq':   conditions.push(`${column} != $${n++}`); params.push(rule.value); break;
                case 'gt':    conditions.push(`${column} > $${n++}`); params.push(rule.value); break;
                case 'gte':   conditions.push(`${column} >= $${n++}`); params.push(rule.value); break;
                case 'lt':    conditions.push(`${column} < $${n++}`); params.push(rule.value); break;
                case 'lte':   conditions.push(`${column} <= $${n++}`); params.push(rule.value); break;
                case 'contains': conditions.push(`${column} ILIKE $${n++}`); params.push(`%${rule.value}%`); break;
                case 'in':
                    if (Array.isArray(rule.value)) {
                        const ph = rule.value.map(() => `$${n++}`).join(', ');
                        conditions.push(`${column} IN (${ph})`);
                        params.push(...rule.value);
                    }
                    break;
            }
        }

        return { whereClause: conditions.join(' AND '), params };
    }

    private async ensureBroadcastTables(schema: string): Promise<void> {
        const cacheKey = `broadcast:tables:v2:${schema}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        try {
            await this.prisma.$queryRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "${schema}".campaign_recipients (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    campaign_id UUID NOT NULL REFERENCES "${schema}".campaigns(id) ON DELETE CASCADE,
                    contact_id UUID REFERENCES "${schema}".contacts(id) ON DELETE SET NULL,
                    phone VARCHAR(50) NOT NULL,
                    status VARCHAR(50) DEFAULT 'pending',
                    provider_message_id VARCHAR(255),
                    error_message TEXT,
                    sent_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign
                    ON "${schema}".campaign_recipients(campaign_id);
                CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status
                    ON "${schema}".campaign_recipients(campaign_id, status);
            `);

            // Ensure scheduled_at column exists on campaigns
            await this.prisma.$queryRawUnsafe(`
                ALTER TABLE "${schema}".campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
            `);

            await this.redis.set(cacheKey, 'true', 86400);
        } catch (error: any) {
            if (!error.message?.includes('already exists')) {
                this.logger.warn(`Could not create broadcast tables in ${schema}: ${error.message}`);
            }
        }
    }

    private async getTenantSchema(tenantId: string): Promise<string> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;

        const tenant = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
        `;

        if (!tenant?.[0]?.schema_name) {
            throw new NotFoundException(`Tenant ${tenantId} not found`);
        }

        await this.redis.set(`tenant:${tenantId}:schema`, tenant[0].schema_name, 3600);
        return tenant[0].schema_name;
    }
}
