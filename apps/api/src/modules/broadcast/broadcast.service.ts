import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AbTestService } from './ab-test.service';

export const BROADCAST_QUEUE = 'broadcast-messages';

export interface ChannelContent {
    whatsapp?: { templateName: string; templateLanguage?: string; templateComponents?: any[] };
    email?: { subject: string; html?: string; text?: string };
    sms?: { body: string };
}

export interface CreateCampaignDto {
    name: string;
    channel?: string;
    channels?: string[];
    channelContent?: ChannelContent;
    templateName?: string;
    templateLanguage?: string;
    templateComponents?: any[];
    targetAudience?: string;
    recipientPhones?: string[];
    scheduledAt?: string;
    metadata?: Record<string, any>;
    // Sender account (which WhatsApp number / SMS number) the campaign goes out from
    // when the tenant has more than one connected account of that channel type.
    channelAccountId?: string;
    variants?: Array<{ name: string; content: Record<string, any>; percentage: number }>;
    abTestConfig?: Record<string, any>;
}

export interface BroadcastJobData {
    tenantId: string;
    schemaName: string;
    campaignId: string;
    recipientId: string;
    channel: string;
    phone: string;
    email?: string;
    templateName: string;
    templateLanguage: string;
    templateComponents: any[];
    emailSubject?: string;
    emailHtml?: string;
    emailText?: string;
    smsBody?: string;
    // Sender account resolved from the campaign (multi-account).
    channelAccountId?: string;
    variantId?: string;
    variantContent?: Record<string, any>;
}

export interface CampaignStats {
    campaignId: string;
    name: string;
    status: string;
    channels: string[];
    totalRecipients: number;
    queued: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    byChannel: Record<string, { sent: number; delivered: number; failed: number }>;
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
        @Inject(forwardRef(() => AbTestService))
        private readonly abTestService: AbTestService,
    ) {}

    // ================================================================
    // CREATE CAMPAIGN
    // ================================================================
    async createCampaign(tenantId: string, data: CreateCampaignDto) {
        const schema = await this.getTenantSchema(tenantId);
        await this.ensureBroadcastTables(schema);

        const channels = data.channels?.length ? data.channels : [data.channel || 'whatsapp'];
        const channelContent = data.channelContent || {};

        // Backward compat: if only WA template provided via legacy fields, populate channelContent
        if (!channelContent.whatsapp && data.templateName) {
            channelContent.whatsapp = {
                templateName: data.templateName,
                templateLanguage: data.templateLanguage || 'es',
                templateComponents: data.templateComponents || [],
            };
        }

        const recipients = await this.resolveRecipientsMultiChannel(schema, data, channels);

        const metadata = {
            ...(data.metadata || {}),
            channels,
            channelContent,
            templateLanguage: channelContent.whatsapp?.templateLanguage || data.templateLanguage || 'es',
            templateComponents: channelContent.whatsapp?.templateComponents || data.templateComponents || [],
            recipientPhones: data.recipientPhones || null,
            channelAccountId: data.channelAccountId || null,
        };

        const status = data.scheduledAt ? 'scheduled' : 'draft';
        const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt).toISOString() : null;

        const fullMetadata = { ...metadata, targetAudience: data.targetAudience || 'all' };
        const isAbTest = !!(data.variants && data.variants.length >= 2);
        const abTestConfig = isAbTest ? (data.abTestConfig || { testPercentage: 100 }) : {};

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO campaigns (
                id, name, channel, wa_template_name, status,
                metadata, scheduled_at, created_at, updated_at
            ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4,
                $5, $6::timestamptz, NOW(), NOW()
            ) RETURNING id`,
            [
                data.name,
                channels.join(','),
                channelContent.whatsapp?.templateName || data.templateName || '',
                status,
                JSON.stringify(fullMetadata),
                scheduledAt,
            ],
        );

        const campaignId = rows?.[0]?.id;

        // Set A/B test columns if variants provided
        if (isAbTest && campaignId) {
            await this.abTestService.ensureAbTestTables(schema);

            await this.prisma.executeInTenantSchema(
                schema,
                `UPDATE campaigns SET is_ab_test = true, ab_test_config = $1::jsonb
                 WHERE id = $2::uuid`,
                [JSON.stringify(abTestConfig), campaignId],
            );

            await this.abTestService.createVariants(schema, campaignId, data.variants!);
        }

        if (recipients.length > 0) {
            const batchSize = 200;
            for (let i = 0; i < recipients.length; i += batchSize) {
                const batch = recipients.slice(i, i + batchSize);
                const values = batch.map(
                    (_, j) => `(gen_random_uuid(), $1::uuid, $${j * 4 + 2}::uuid, $${j * 4 + 3}, $${j * 4 + 4}, $${j * 4 + 5}, 'pending', NOW())`,
                ).join(', ');

                const params: any[] = [campaignId];
                for (const r of batch) {
                    params.push(r.id, r.phone || '', r.email || '', r.channel);
                }

                await this.prisma.executeInTenantSchema(
                    schema,
                    `INSERT INTO campaign_recipients (id, campaign_id, contact_id, phone, email, channel, status, created_at)
                     VALUES ${values}`,
                    params,
                );
            }
        }

        return { id: campaignId, recipientCount: recipients.length, channels, isAbTest };
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

        const recipients = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, contact_id, phone, email, channel, variant_id FROM campaign_recipients
             WHERE campaign_id = $1::uuid AND status = 'pending'`,
            [campaignId],
        );

        if (!recipients?.length) {
            throw new BadRequestException('No pending recipients found for this campaign');
        }

        const metadata = typeof campaign.metadata === 'string'
            ? JSON.parse(campaign.metadata)
            : (campaign.metadata || {});

        const channelContent: ChannelContent = metadata.channelContent || {};
        const waContent = channelContent.whatsapp || {
            templateName: campaign.wa_template_name,
            templateLanguage: metadata.templateLanguage || 'es',
            templateComponents: metadata.templateComponents || [],
        };

        // If A/B test, assign recipients to variants before queuing
        const isAbTest = campaign.is_ab_test === true;
        let variantContentMap: Record<string, Record<string, any>> = {};

        if (isAbTest) {
            await this.abTestService.ensureAbTestTables(schema);
            await this.abTestService.assignRecipientsToVariants(schema, campaignId);

            // Re-fetch recipients to get assigned variant_id
            const updatedRecipients = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id, contact_id, phone, email, channel, variant_id FROM campaign_recipients
                 WHERE campaign_id = $1::uuid AND status = 'pending'`,
                [campaignId],
            );
            recipients.length = 0;
            recipients.push(...(updatedRecipients || []));

            // Pre-load variant content map
            const variants = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id, content FROM campaign_variants WHERE campaign_id = $1::uuid`,
                [campaignId],
            );
            for (const v of variants || []) {
                const content = typeof v.content === 'string' ? JSON.parse(v.content) : (v.content || {});
                variantContentMap[v.id] = content;
            }
        }

        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE campaigns SET status = 'active', starts_at = NOW(), updated_at = NOW()
             WHERE id = $1::uuid`,
            [campaignId],
        );

        const jobs = recipients.map((r) => {
            const ch = r.channel || 'whatsapp';
            const variantId = r.variant_id || undefined;
            const variantContent = variantId ? variantContentMap[variantId] : undefined;

            // For A/B tests, override content from variant if available
            let jobTemplateName = waContent.templateName || '';
            let jobTemplateLang = waContent.templateLanguage || 'es';
            let jobTemplateComp = waContent.templateComponents || [];
            let jobEmailSubject = channelContent.email?.subject || '';
            let jobEmailHtml = channelContent.email?.html || '';
            let jobEmailText = channelContent.email?.text || '';
            let jobSmsBody = channelContent.sms?.body || '';

            if (variantContent) {
                if (variantContent.whatsapp) {
                    jobTemplateName = variantContent.whatsapp.templateName || jobTemplateName;
                    jobTemplateLang = variantContent.whatsapp.templateLanguage || jobTemplateLang;
                    jobTemplateComp = variantContent.whatsapp.templateComponents || jobTemplateComp;
                }
                if (variantContent.email) {
                    jobEmailSubject = variantContent.email.subject || jobEmailSubject;
                    jobEmailHtml = variantContent.email.html || jobEmailHtml;
                    jobEmailText = variantContent.email.text || jobEmailText;
                }
                if (variantContent.sms) {
                    jobSmsBody = variantContent.sms.body || jobSmsBody;
                }
            }

            return {
                name: `send-${ch}`,
                data: {
                    tenantId,
                    schemaName: schema,
                    campaignId,
                    recipientId: r.id,
                    channel: ch,
                    phone: r.phone || '',
                    email: r.email || '',
                    templateName: jobTemplateName,
                    templateLanguage: jobTemplateLang,
                    templateComponents: jobTemplateComp,
                    emailSubject: jobEmailSubject,
                    emailHtml: jobEmailHtml,
                    emailText: jobEmailText,
                    smsBody: jobSmsBody,
                    channelAccountId: metadata.channelAccountId || undefined,
                    variantId,
                    variantContent,
                } as BroadcastJobData,
                opts: {
                    attempts: 3,
                    backoff: { type: 'exponential' as const, delay: 5000 },
                    removeOnComplete: 100,
                    removeOnFail: 500,
                },
            };
        });

        await this.broadcastQueue.addBulk(jobs);

        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE campaign_recipients SET status = 'queued', updated_at = NOW()
             WHERE campaign_id = $1::uuid AND status = 'pending'`,
            [campaignId],
        );

        this.logger.log(`Campaign ${campaignId} launched: ${recipients.length} messages queued`);
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

        return (campaigns || []).map((c) => {
            const meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {});
            const channels = meta.channels || [c.channel || 'whatsapp'];
            return {
                id: c.id,
                name: c.name,
                code: c.code,
                channel: c.channel,
                channels: Array.isArray(channels) ? channels : channels.split(','),
                templateName: c.wa_template_name,
                status: c.status,
                targetAudience: meta.targetAudience || 'all',
                totalRecipients: parseInt(c.total_recipients || '0'),
                sentCount: parseInt(c.sent_count || '0'),
                deliveredCount: parseInt(c.delivered_count || '0'),
                readCount: parseInt(c.read_count || '0'),
                failedCount: parseInt(c.failed_count || '0'),
                scheduledAt: c.scheduled_at?.toISOString?.() || c.scheduled_at || null,
                startsAt: c.starts_at?.toISOString?.() || c.starts_at || null,
                endsAt: c.ends_at?.toISOString?.() || c.ends_at || null,
                createdAt: c.created_at?.toISOString?.() || c.created_at,
            };
        });
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
            `SELECT status, COALESCE(channel, 'whatsapp') AS channel, COUNT(*)::int AS count
             FROM campaign_recipients
             WHERE campaign_id = $1::uuid
             GROUP BY status, channel`,
            [campaignId],
        );

        const statusMap: Record<string, number> = {};
        const byChannel: Record<string, { sent: number; delivered: number; failed: number }> = {};

        for (const row of stats || []) {
            const count = parseInt(row.count || '0');
            statusMap[row.status] = (statusMap[row.status] || 0) + count;

            if (!byChannel[row.channel]) byChannel[row.channel] = { sent: 0, delivered: 0, failed: 0 };
            if (row.status === 'sent' || row.status === 'delivered' || row.status === 'read') {
                byChannel[row.channel].sent += count;
            }
            if (row.status === 'delivered' || row.status === 'read') {
                byChannel[row.channel].delivered += count;
            }
            if (row.status === 'failed') byChannel[row.channel].failed += count;
        }

        const totalRecipients = Object.values(statusMap).reduce((a, b) => a + b, 0);
        const meta = typeof campaign.metadata === 'string' ? JSON.parse(campaign.metadata || '{}') : (campaign.metadata || {});
        const channels = meta.channels || [campaign.channel || 'whatsapp'];

        const result: CampaignStats = {
            campaignId,
            name: campaign.name,
            status: campaign.status,
            channels: Array.isArray(channels) ? channels : channels.split(','),
            totalRecipients,
            queued: statusMap['queued'] || 0,
            sent: statusMap['sent'] || 0,
            delivered: statusMap['delivered'] || 0,
            read: statusMap['read'] || 0,
            failed: statusMap['failed'] || 0,
            byChannel,
            launchedAt: campaign.starts_at?.toISOString?.() || campaign.starts_at || null,
            completedAt: campaign.ends_at?.toISOString?.() || campaign.ends_at || null,
        };

        // Include A/B test variant breakdown if applicable
        if (campaign.is_ab_test === true) {
            try {
                const variantStats = await this.abTestService.getVariantStats(schema, campaignId);
                (result as any).isAbTest = true;
                (result as any).variants = variantStats;
            } catch {
                // Tables may not exist yet — safe to ignore
            }
        }

        return result;
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

        // For A/B campaigns, try auto-selecting a winner after each batch of sends
        try {
            const abCheck = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT is_ab_test FROM campaigns WHERE id = $1::uuid LIMIT 1`,
                [campaignId],
            );
            if (abCheck?.[0]?.is_ab_test === true) {
                await this.abTestService.autoSelectWinner(schemaName, campaignId);
            }
        } catch {
            // A/B columns may not exist — safe to ignore
        }

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
                    const hasCampaigns = await this.prisma.$queryRawUnsafe(
                        `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'campaigns' AND column_name = 'scheduled_at'`,
                        schema,
                    ) as any[];
                    if (!hasCampaigns?.length) continue;

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

    private async resolveRecipientsMultiChannel(
        schema: string,
        data: CreateCampaignDto,
        channels: string[],
    ): Promise<Array<{ id: string; phone: string; email: string; channel: string }>> {
        const raw = await this.resolveRawContacts(schema, data);

        const hasWA = channels.includes('whatsapp');
        const hasEmail = channels.includes('email');
        const hasSMS = channels.includes('sms');

        const result: Array<{ id: string; phone: string; email: string; channel: string }> = [];

        for (const c of raw) {
            const hasPhone = !!(c.phone && c.phone.trim());
            const hasEmailAddr = !!(c.email && c.email.trim());

            if (hasWA && hasPhone) {
                result.push({ id: c.id, phone: c.phone, email: c.email || '', channel: 'whatsapp' });
            } else if (hasEmail && hasEmailAddr) {
                result.push({ id: c.id, phone: c.phone || '', email: c.email, channel: 'email' });
            } else if (hasSMS && hasPhone) {
                result.push({ id: c.id, phone: c.phone, email: c.email || '', channel: 'sms' });
            }
        }

        return result;
    }

    private async resolveRawContacts(
        schema: string,
        data: CreateCampaignDto,
    ): Promise<Array<{ id: string; phone: string; email: string }>> {
        if (data.recipientPhones?.length) {
            const placeholders = data.recipientPhones.map((_, i) => `$${i + 1}`).join(', ');
            const contacts = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id, phone, email FROM contacts WHERE phone IN (${placeholders})`,
                data.recipientPhones,
            );
            return (contacts || []).map((c) => ({ id: c.id, phone: c.phone || '', email: c.email || '' }));
        }

        const audience = data.targetAudience || 'all';

        if (audience === 'all') {
            const contacts = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id, phone, email FROM contacts WHERE (phone IS NOT NULL AND phone != '') OR (email IS NOT NULL AND email != '')`,
            );
            return (contacts || []).map((c) => ({ id: c.id, phone: c.phone || '', email: c.email || '' }));
        }

        try {
            const filter = JSON.parse(audience);

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
                    const cond = whereClause
                        ? `WHERE ${whereClause} AND ((phone IS NOT NULL AND phone != '') OR (email IS NOT NULL AND email != ''))`
                        : `WHERE (phone IS NOT NULL AND phone != '') OR (email IS NOT NULL AND email != '')`;

                    const contacts = await this.prisma.executeInTenantSchema<any[]>(
                        schema,
                        `SELECT id, phone, email FROM leads ${cond}`,
                        params,
                    );
                    return (contacts || []).map((c) => ({ id: c.id, phone: c.phone || '', email: c.email || '' }));
                }
            }

            if (filter.tags?.length) {
                const contacts = await this.prisma.executeInTenantSchema<any[]>(
                    schema,
                    `SELECT id, phone, email FROM contacts
                     WHERE ((phone IS NOT NULL AND phone != '') OR (email IS NOT NULL AND email != ''))
                       AND tags && $1::text[]`,
                    [filter.tags],
                );
                return (contacts || []).map((c) => ({ id: c.id, phone: c.phone || '', email: c.email || '' }));
            }
        } catch {
            // Not valid JSON — treat as 'all'
        }

        const contacts = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, phone, email FROM contacts WHERE (phone IS NOT NULL AND phone != '') OR (email IS NOT NULL AND email != '')`,
        );
        return (contacts || []).map((c) => ({ id: c.id, phone: c.phone || '', email: c.email || '' }));
    }

    private static readonly BROADCAST_ALLOWED_FIELDS = new Set([
        'first_name', 'last_name', 'phone', 'email', 'stage', 'source',
        'score', 'assigned_to', 'is_vip', 'created_at', 'updated_at',
        'converted_at', 'archived_at', 'tags',
    ]);
    private static readonly META_KEY_PATTERN = /^[a-zA-Z0-9_]+$/;

    private buildFilterSQL(rules: any[]): { whereClause: string; params: any[] } {
        if (!rules || rules.length === 0) return { whereClause: '', params: [] };

        const conditions: string[] = [];
        const params: any[] = [];
        let n = 1;

        for (const rule of rules) {
            let column: string;
            if (rule.field?.startsWith('metadata.')) {
                const key = rule.field.replace('metadata.', '');
                if (!BroadcastService.META_KEY_PATTERN.test(key)) continue;
                column = `metadata->>'${key}'`;
            } else {
                if (!rule.field || !BroadcastService.BROADCAST_ALLOWED_FIELDS.has(rule.field)) continue;
                column = rule.field;
            }

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
        const cacheKey = `broadcast:tables:v3:${schema}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        try {
            await this.prisma.$queryRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "${schema}".campaign_recipients (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    campaign_id UUID NOT NULL REFERENCES "${schema}".campaigns(id) ON DELETE CASCADE,
                    contact_id UUID REFERENCES "${schema}".contacts(id) ON DELETE SET NULL,
                    phone VARCHAR(50) DEFAULT '',
                    status VARCHAR(50) DEFAULT 'pending',
                    provider_message_id VARCHAR(255),
                    error_message TEXT,
                    sent_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
        } catch { /* already exists */ }

        try {
            await this.prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON "${schema}".campaign_recipients(campaign_id)`);
            await this.prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status ON "${schema}".campaign_recipients(campaign_id, status)`);
        } catch { /* ok */ }

        // Multi-channel columns
        try {
            await this.prisma.$queryRawUnsafe(`ALTER TABLE "${schema}".campaign_recipients ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT ''`);
            await this.prisma.$queryRawUnsafe(`ALTER TABLE "${schema}".campaign_recipients ADD COLUMN IF NOT EXISTS channel VARCHAR(50) DEFAULT 'whatsapp'`);
            await this.prisma.$queryRawUnsafe(`ALTER TABLE "${schema}".campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`);
        } catch { /* ok */ }

        await this.redis.set(cacheKey, 'true', 86400);
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
