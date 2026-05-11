import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class WidgetService implements OnModuleInit {
    private readonly logger = new Logger(WidgetService.name);
    private jwtSecret: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly config: ConfigService,
    ) {
        this.jwtSecret = this.config.get<string>('JWT_SECRET') || 'widget-secret';
    }

    async onModuleInit() {
        await this.ensureWidgetTables();
    }

    private async ensureWidgetTables() {
        try {
            await this.prisma.$queryRawUnsafe(`
                CREATE TABLE IF NOT EXISTS public.widget_configs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
                    widget_id TEXT NOT NULL UNIQUE DEFAULT 'wgt_' || substr(gen_random_uuid()::text, 1, 12),
                    name TEXT NOT NULL DEFAULT 'Web Chat',
                    primary_color TEXT NOT NULL DEFAULT '#6c5ce7',
                    position TEXT NOT NULL DEFAULT 'bottom-right',
                    welcome_message TEXT DEFAULT '¡Hola! ¿En qué te puedo ayudar?',
                    agent_name TEXT DEFAULT 'Asistente',
                    agent_avatar TEXT,
                    pre_chat_enabled BOOLEAN DEFAULT false,
                    pre_chat_fields JSONB DEFAULT '["name","email"]'::jsonb,
                    allowed_domains TEXT[] DEFAULT '{}',
                    is_active BOOLEAN DEFAULT true,
                    locale TEXT DEFAULT 'es',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            await this.prisma.$queryRawUnsafe(`
                CREATE TABLE IF NOT EXISTS public.widget_sessions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    widget_config_id UUID NOT NULL REFERENCES public.widget_configs(id) ON DELETE CASCADE,
                    tenant_id UUID NOT NULL,
                    visitor_id TEXT NOT NULL,
                    conversation_id UUID,
                    contact_id UUID,
                    visitor_name TEXT,
                    visitor_email TEXT,
                    visitor_phone TEXT,
                    page_url TEXT,
                    token TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    last_seen_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            await this.prisma.$queryRawUnsafe(`
                CREATE INDEX IF NOT EXISTS idx_widget_sessions_visitor ON public.widget_sessions(visitor_id, widget_config_id)
            `);
        } catch (err: any) {
            this.logger.warn(`Widget tables creation: ${err.message}`);
        }
    }

    // ─── Widget Config CRUD ───────────────────────────────────────────

    async getConfig(widgetId: string): Promise<any> {
        const cached = await this.redis.get(`widget:config:${widgetId}`);
        if (cached) return JSON.parse(cached);

        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT wc.*, t.slug as tenant_slug, t.name as tenant_name
             FROM public.widget_configs wc
             JOIN public.tenants t ON t.id = wc.tenant_id
             WHERE wc.widget_id = $1 AND wc.is_active = true`,
            widgetId,
        );
        if (!rows?.length) return null;

        const config = rows[0];
        await this.redis.set(`widget:config:${widgetId}`, JSON.stringify(config), 300);
        return config;
    }

    async listWidgets(tenantId: string): Promise<any[]> {
        return this.prisma.$queryRawUnsafe(
            `SELECT * FROM public.widget_configs WHERE tenant_id = $1::uuid ORDER BY created_at DESC`,
            tenantId,
        );
    }

    async createWidget(tenantId: string, data: any): Promise<any> {
        const widgetId = 'wgt_' + crypto.randomBytes(6).toString('hex');
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `INSERT INTO public.widget_configs (tenant_id, widget_id, name, primary_color, position, welcome_message, agent_name, pre_chat_enabled, pre_chat_fields, allowed_domains, locale)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::text[], $11)
             RETURNING *`,
            tenantId, widgetId,
            data.name || 'Web Chat',
            data.primaryColor || '#6c5ce7',
            data.position || 'bottom-right',
            data.welcomeMessage || '¡Hola! ¿En qué te puedo ayudar?',
            data.agentName || 'Asistente',
            data.preChatEnabled || false,
            JSON.stringify(data.preChatFields || ['name', 'email']),
            data.allowedDomains || [],
            data.locale || 'es',
        );
        return rows[0];
    }

    async updateWidget(tenantId: string, widgetConfigId: string, data: any): Promise<any> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `UPDATE public.widget_configs
             SET name = COALESCE($3, name),
                 primary_color = COALESCE($4, primary_color),
                 position = COALESCE($5, position),
                 welcome_message = COALESCE($6, welcome_message),
                 agent_name = COALESCE($7, agent_name),
                 pre_chat_enabled = COALESCE($8, pre_chat_enabled),
                 pre_chat_fields = COALESCE($9::jsonb, pre_chat_fields),
                 allowed_domains = COALESCE($10::text[], allowed_domains),
                 is_active = COALESCE($11, is_active),
                 locale = COALESCE($12, locale),
                 updated_at = NOW()
             WHERE id = $1::uuid AND tenant_id = $2::uuid
             RETURNING *`,
            widgetConfigId, tenantId,
            data.name ?? null,
            data.primaryColor ?? null,
            data.position ?? null,
            data.welcomeMessage ?? null,
            data.agentName ?? null,
            data.preChatEnabled ?? null,
            data.preChatFields ? JSON.stringify(data.preChatFields) : null,
            data.allowedDomains ?? null,
            data.isActive ?? null,
            data.locale ?? null,
        );

        if (rows?.[0]?.widget_id) {
            await this.redis.del(`widget:config:${rows[0].widget_id}`);
        }
        return rows[0];
    }

    async deleteWidget(tenantId: string, widgetConfigId: string): Promise<void> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `DELETE FROM public.widget_configs WHERE id = $1::uuid AND tenant_id = $2::uuid RETURNING widget_id`,
            widgetConfigId, tenantId,
        );
        if (rows?.[0]?.widget_id) {
            await this.redis.del(`widget:config:${rows[0].widget_id}`);
        }
    }

    // ─── Sessions ─────────────────────────────────────────────────────

    async createSession(widgetConfig: any, data: {
        visitorId: string;
        name?: string;
        email?: string;
        phone?: string;
        page?: string;
    }): Promise<{ sessionId: string; token: string }> {
        const existing: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, conversation_id, token FROM public.widget_sessions
             WHERE visitor_id = $1 AND widget_config_id = $2::uuid AND last_seen_at > NOW() - interval '90 days'
             ORDER BY last_seen_at DESC LIMIT 1`,
            data.visitorId, widgetConfig.id,
        );

        if (existing?.length) {
            const token = this.generateToken(existing[0].id, widgetConfig.tenant_id, widgetConfig.widget_id);
            await this.prisma.$queryRawUnsafe(
                `UPDATE public.widget_sessions SET last_seen_at = NOW(), token = $2 WHERE id = $1::uuid`,
                existing[0].id, token,
            );
            return { sessionId: existing[0].id, token };
        }

        const token = this.generateToken(crypto.randomUUID(), widgetConfig.tenant_id, widgetConfig.widget_id);
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `INSERT INTO public.widget_sessions (widget_config_id, tenant_id, visitor_id, visitor_name, visitor_email, visitor_phone, page_url, token)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            widgetConfig.id, widgetConfig.tenant_id,
            data.visitorId, data.name || null, data.email || null, data.phone || null, data.page || null, token,
        );

        return { sessionId: rows[0].id, token };
    }

    async getSessionByToken(token: string): Promise<any> {
        try {
            const decoded = jwt.verify(token, this.jwtSecret) as any;
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT ws.*, wc.tenant_id, wc.widget_id
                 FROM public.widget_sessions ws
                 JOIN public.widget_configs wc ON wc.id = ws.widget_config_id
                 WHERE ws.id = $1::uuid`,
                decoded.sessionId,
            );
            return rows?.[0] || null;
        } catch {
            return null;
        }
    }

    async updateSessionConversation(sessionId: string, conversationId: string, contactId: string): Promise<void> {
        await this.prisma.$queryRawUnsafe(
            `UPDATE public.widget_sessions SET conversation_id = $2::uuid, contact_id = $3::uuid, last_seen_at = NOW() WHERE id = $1::uuid`,
            sessionId, conversationId, contactId,
        );
    }

    getEmbedSnippet(widgetId: string, apiUrl: string): string {
        return `<script>\n  window.__paralllyWidget = { widgetId: '${widgetId}' };\n</script>\n<script async src="${apiUrl}/widget/loader.js"></script>`;
    }

    private generateToken(sessionId: string, tenantId: string, widgetId: string): string {
        return jwt.sign(
            { sessionId, tenantId, widgetId },
            this.jwtSecret,
            { expiresIn: '7d' },
        );
    }
}
