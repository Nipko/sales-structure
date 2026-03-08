import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';

export interface Campaign {
    id: string;
    name: string;
    status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
    channel: string;
    template: string;
    targetAudience: string;
    scheduledAt: string | null;
    sentAt: string | null;
    recipientCount: number;
    deliveredCount: number;
    readCount: number;
    repliedCount: number;
    createdAt: string;
}

@Injectable()
export class BroadcastService {
    private readonly logger = new Logger(BroadcastService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private channelGateway: ChannelGatewayService,
    ) { }

    async getCampaigns(tenantId: string): Promise<Campaign[]> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        await this.ensureBroadcastTables(schema);

        try {
            const campaigns = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT * FROM campaigns ORDER BY created_at DESC`
            );

            return (campaigns || []).map(c => ({
                id: c.id,
                name: c.name,
                status: c.status,
                channel: c.channel,
                template: c.template_content,
                targetAudience: c.target_audience,
                scheduledAt: c.scheduled_at?.toISOString() || null,
                sentAt: c.sent_at?.toISOString() || null,
                recipientCount: parseInt(c.recipient_count || '0'),
                deliveredCount: parseInt(c.delivered_count || '0'),
                readCount: parseInt(c.read_count?.toString() || '0'),
                repliedCount: parseInt(c.replied_count?.toString() || '0'),
                createdAt: c.created_at?.toISOString() || new Date().toISOString()
            }));
        } catch (error) {
            this.logger.error(`Error fetching campaigns: ${error}`);
            return [];
        }
    }

    async createCampaign(tenantId: string, data: {
        name: string;
        channel: string;
        template: string;
        targetAudience: string;
    }): Promise<{ id: string }> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant schema not found');

        await this.ensureBroadcastTables(schema);

        const res = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO campaigns (id, name, status, channel, template_content, target_audience, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, 'draft', $2, $3, $4, NOW(), NOW()) RETURNING id`,
            [data.name, data.channel, data.template, data.targetAudience]
        );

        return { id: res?.[0]?.id };
    }

    async sendCampaign(tenantId: string, campaignId: string): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant schema not found');

        // 1. Mark as sending
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1::uuid`,
            [campaignId]
        );

        const campaign = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM campaigns WHERE id = $1::uuid LIMIT 1`,
            [campaignId]
        );

        if (!campaign || campaign.length === 0) throw new Error('Campaign not found');
        const c = campaign[0];

        // 2. Fetch target audience
        // For the MVP, we assume "all" means all contacts in the tenant with a valid phone number.
        let contacts: any[] = [];
        if (c.target_audience === 'all') {
            contacts = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id, name, phone, email FROM contacts WHERE phone IS NOT NULL AND phone != ''`
            ) || [];
        } else {
            // In future: parse targetAudience JSON to apply specific tag/segment filters
            contacts = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id, name, phone, email FROM contacts WHERE phone IS NOT NULL AND phone != '' LIMIT 10`
            ) || [];
        }

        // 3. Process dispatch asynchronously so the endpoint can return quickly
        this.dispatchMessages(tenantId, schema, c, contacts).catch(err => {
            this.logger.error(`Error dispatching campaign ${campaignId}: ${err}`);
        });
    }

    private async dispatchMessages(tenantId: string, schema: string, campaign: any, contacts: any[]) {
        let successCount = 0;
        let failCount = 0;

        for (const contact of contacts) {
            try {
                // Personalize template
                let message = campaign.template_content;
                message = message.replace(/\{\{name\}\}/g, contact.name || 'Cliente');

                // Send via Gateway
                // Note: In a production CRM, the platform typically requires an active conversation
                // or uses template messages for outbound. Here we use standard sendMessage, assuming the 
                // channel supports outbound logic or template matching underneath.
                const platformContactId = contact.phone; // simplified assumption

                // For Meta WhatsApp Cloud API outbound templated messages require specific payload,
                // but for our test environment, we pass it as standard text.
                await this.channelGateway.sendMessage({
                    channelType: campaign.channel as any,
                    tenantId,
                    to: platformContactId,
                    channelAccountId: 'default', // Needed for interface
                    content: { type: 'text', text: message },
                }, 'sys-token'); // Require access token for interface

                // Log success
                await this.prisma.executeInTenantSchema(
                    schema,
                    `INSERT INTO campaign_logs (id, campaign_id, contact_id, status, sent_at)
                       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'sent', NOW())`,
                    [campaign.id, contact.id]
                );

                successCount++;
            } catch (error) {
                this.logger.error(`Failed to send to ${contact.id}: ${error}`);
                failCount++;

                await this.prisma.executeInTenantSchema(
                    schema,
                    `INSERT INTO campaign_logs (id, campaign_id, contact_id, status, error_message, sent_at)
                       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'failed', $3, NOW())`,
                    [campaign.id, contact.id, (error as Error).message]
                );
            }

            // Small delay to prevent rate limiting
            await new Promise(r => setTimeout(r, 100));
        }

        // Update Campaign Final Stats
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE campaigns 
              SET status = 'sent', sent_at = NOW(), recipient_count = $1, delivered_count = $2, updated_at = NOW()
              WHERE id = $3::uuid`,
            [contacts.length, successCount, campaign.id]
        );
    }

    private async ensureBroadcastTables(schema: string): Promise<void> {
        const cacheKey = `broadcast:tables:${schema}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        try {
            await this.prisma.$queryRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "${schema}".campaigns (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    status VARCHAR(50) DEFAULT 'draft',
                    channel VARCHAR(50) NOT NULL,
                    template_content TEXT NOT NULL,
                    target_audience TEXT DEFAULT 'all',
                    scheduled_at TIMESTAMP,
                    sent_at TIMESTAMP,
                    recipient_count INTEGER DEFAULT 0,
                    delivered_count INTEGER DEFAULT 0,
                    read_count INTEGER DEFAULT 0,
                    replied_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS "${schema}".campaign_logs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    campaign_id UUID REFERENCES "${schema}".campaigns(id) ON DELETE CASCADE,
                    contact_id UUID REFERENCES "${schema}".contacts(id) ON DELETE CASCADE,
                    status VARCHAR(50) NOT NULL,
                    error_message TEXT,
                    sent_at TIMESTAMP DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_campaigns_status ON "${schema}".campaigns(status);
                CREATE INDEX IF NOT EXISTS idx_campaign_logs_cid ON "${schema}".campaign_logs(campaign_id);
            `);

            await this.redis.set(cacheKey, 'true', 86400); // 24h
        } catch (error) {
            this.logger.warn(`Could not create broadcast tables in ${schema}: ${error}`);
        }
    }

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`;
        if (tenant?.[0]) {
            await this.redis.set(`tenant:${tenantId}:schema`, tenant[0].schema_name, 3600);
            return tenant[0].schema_name;
        }
        return null;
    }
}
