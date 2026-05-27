import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

export interface EmailChannelConfig {
    id: string;
    tenantId: string;
    provider: string;
    fromEmail: string;
    fromName: string | null;
    replyTo: string | null;
    inboundType: string;
    providerConfig: Record<string, unknown>;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface EmailThread {
    id: string;
    conversationId: string;
    subject: string | null;
    messageIdHeader: string | null;
    inReplyTo: string | null;
    referencesHeader: string | null;
    cc: string[];
    bcc: string[];
    createdAt: Date;
}

/**
 * Service for managing email channel configuration and thread tracking.
 *
 * Tables:
 *   - public.email_channel_configs — Per-tenant email channel settings
 *   - {tenant_schema}.email_threads — Per-conversation email thread metadata
 */
@Injectable()
export class EmailChannelService {
    private readonly logger = new Logger(EmailChannelService.name);
    private readonly TABLE_CACHE_KEY = 'email_channel:tables_created';
    private readonly THREAD_TABLE_PREFIX = 'email_channel:thread_table:';

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    // ── Public schema: email_channel_configs ──────────────────

    /**
     * Ensure the email_channel_configs table exists in the public schema.
     * Uses Redis cache to avoid running CREATE TABLE on every call.
     */
    async ensureConfigTable(): Promise<void> {
        const cached = await this.redis.get(this.TABLE_CACHE_KEY);
        if (cached) return;

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS public.email_channel_configs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL REFERENCES public.tenants(id),
                provider TEXT NOT NULL DEFAULT 'smtp',
                from_email TEXT NOT NULL,
                from_name TEXT,
                reply_to TEXT,
                inbound_type TEXT DEFAULT 'sendgrid_parse',
                provider_config JSONB DEFAULT '{}',
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(tenant_id)
            )
        `);

        await this.redis.set(this.TABLE_CACHE_KEY, '1', 86400);
        this.logger.log('email_channel_configs table ensured');
    }

    /**
     * Get the email channel config for a tenant.
     */
    async getConfig(tenantId: string): Promise<EmailChannelConfig | null> {
        await this.ensureConfigTable();

        const rows = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT id, tenant_id, provider, from_email, from_name, reply_to,
                    inbound_type, provider_config, is_active, created_at, updated_at
             FROM public.email_channel_configs
             WHERE tenant_id = $1::uuid AND is_active = true
             LIMIT 1`,
            tenantId,
        );

        if (!rows?.length) return null;

        const row = rows[0];
        return {
            id: row.id,
            tenantId: row.tenant_id,
            provider: row.provider,
            fromEmail: row.from_email,
            fromName: row.from_name,
            replyTo: row.reply_to,
            inboundType: row.inbound_type,
            providerConfig: row.provider_config || {},
            isActive: row.is_active,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    /**
     * Save (upsert) email channel config for a tenant.
     */
    async saveConfig(tenantId: string, data: {
        provider?: string;
        fromEmail: string;
        fromName?: string;
        replyTo?: string;
        inboundType?: string;
        providerConfig?: Record<string, unknown>;
        isActive?: boolean;
    }): Promise<EmailChannelConfig> {
        await this.ensureConfigTable();

        const rows = await this.prisma.$queryRawUnsafe<any[]>(
            `INSERT INTO public.email_channel_configs (tenant_id, provider, from_email, from_name, reply_to, inbound_type, provider_config, is_active)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8)
             ON CONFLICT (tenant_id) DO UPDATE SET
                provider = EXCLUDED.provider,
                from_email = EXCLUDED.from_email,
                from_name = EXCLUDED.from_name,
                reply_to = EXCLUDED.reply_to,
                inbound_type = EXCLUDED.inbound_type,
                provider_config = EXCLUDED.provider_config,
                is_active = EXCLUDED.is_active,
                updated_at = NOW()
             RETURNING id, tenant_id, provider, from_email, from_name, reply_to,
                       inbound_type, provider_config, is_active, created_at, updated_at`,
            tenantId,
            data.provider || 'smtp',
            data.fromEmail,
            data.fromName || null,
            data.replyTo || null,
            data.inboundType || 'sendgrid_parse',
            JSON.stringify(data.providerConfig || {}),
            data.isActive !== false,
        );

        const row = rows[0];
        return {
            id: row.id,
            tenantId: row.tenant_id,
            provider: row.provider,
            fromEmail: row.from_email,
            fromName: row.from_name,
            replyTo: row.reply_to,
            inboundType: row.inbound_type,
            providerConfig: row.provider_config || {},
            isActive: row.is_active,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    /**
     * Look up which tenant owns a given inbound email address.
     */
    async findTenantByInboundEmail(toEmail: string): Promise<string | null> {
        await this.ensureConfigTable();

        const rows = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT tenant_id FROM public.email_channel_configs
             WHERE LOWER(from_email) = LOWER($1) AND is_active = true
             LIMIT 1`,
            toEmail,
        );

        return rows?.length ? rows[0].tenant_id : null;
    }

    // ── Tenant schema: email_threads ─────────────────────────

    /**
     * Ensure the email_threads table exists in a tenant's schema.
     * Uses Redis cache (24h) per tenant to avoid repeated DDL.
     */
    async ensureThreadTable(tenantId: string): Promise<void> {
        const cacheKey = `${this.THREAD_TABLE_PREFIX}${tenantId}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".email_threads (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID NOT NULL,
                subject TEXT,
                message_id_header TEXT,
                in_reply_to TEXT,
                references_header TEXT,
                cc TEXT[],
                bcc TEXT[],
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Index for fast lookup by conversation
        await this.prisma.$queryRawUnsafe(`
            CREATE INDEX IF NOT EXISTS idx_email_threads_conv
            ON "${schemaName}".email_threads (conversation_id)
        `);

        await this.redis.set(cacheKey, '1', 86400);
        this.logger.log(`email_threads table ensured for schema ${schemaName}`);
    }

    /**
     * Get or create an email thread for a conversation.
     */
    async getThreadByConversation(tenantId: string, conversationId: string): Promise<EmailThread | null> {
        await this.ensureThreadTable(tenantId);
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, conversation_id, subject, message_id_header, in_reply_to,
                    references_header, cc, bcc, created_at
             FROM email_threads
             WHERE conversation_id = $1::uuid
             ORDER BY created_at DESC
             LIMIT 1`,
            [conversationId],
        );

        if (!rows?.length) return null;

        const row = rows[0];
        return {
            id: row.id,
            conversationId: row.conversation_id,
            subject: row.subject,
            messageIdHeader: row.message_id_header,
            inReplyTo: row.in_reply_to,
            referencesHeader: row.references_header,
            cc: row.cc || [],
            bcc: row.bcc || [],
            createdAt: row.created_at,
        };
    }

    /**
     * Save an email thread entry (called when an inbound email arrives or outbound is sent).
     */
    async saveThread(tenantId: string, data: {
        conversationId: string;
        subject?: string;
        messageIdHeader?: string;
        inReplyTo?: string;
        referencesHeader?: string;
        cc?: string[];
        bcc?: string[];
    }): Promise<void> {
        await this.ensureThreadTable(tenantId);
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO email_threads (conversation_id, subject, message_id_header, in_reply_to, references_header, cc, bcc)
             VALUES ($1::uuid, $2, $3, $4, $5, $6::text[], $7::text[])`,
            [
                data.conversationId,
                data.subject || null,
                data.messageIdHeader || null,
                data.inReplyTo || null,
                data.referencesHeader || null,
                data.cc || [],
                data.bcc || [],
            ],
        );
    }
}
