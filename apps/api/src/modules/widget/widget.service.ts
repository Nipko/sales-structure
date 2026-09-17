import { ensureWidgetSchema } from './widget-schema';
import { ForbiddenException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { resolveReadyTenantContext } from '../../common/utils/tenant-lifecycle.util';
import {
    resolveTenantSubscriptionAccess,
    type SubscriptionAccessMode,
} from '../../common/utils/subscription-entitlement.util';

import { WIDGET_DEFAULTS } from './widget-defaults';
import { DemoAllowanceService } from '../throttle/demo-allowance.service';

@Injectable()
export class WidgetService implements OnModuleInit {
    private readonly logger = new Logger(WidgetService.name);
    private jwtSecret: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly config: ConfigService,
        private readonly throttle: TenantThrottleService,
        @Optional() private readonly demoAllowance?: DemoAllowanceService,
    ) {
        // No hardcoded literal fallback — a predictable secret would let anyone
        // forge widget session tokens. Prefer a dedicated secret, else the platform
        // JWT secret (required env var; fail fast if absent).
        this.jwtSecret = this.config.get<string>('WIDGET_JWT_SECRET') || this.config.getOrThrow<string>('JWT_SECRET');
    }

    async onModuleInit() {
        await this.ensureWidgetTables();
    }

    private async ensureWidgetTables() {
        try {
            await ensureWidgetSchema(this.prisma);

        } catch (err: any) {
            this.logger.warn(`Widget tables creation: ${err.message}`);
            throw err;
        }
    }

    // ─── Widget Config CRUD ───────────────────────────────────────────

    async getConfig(widgetId: string): Promise<any> {
        const cached = await this.redis.get(`widget:config:${widgetId}`);
        if (cached) {
            const config = JSON.parse(cached);
            return await this.isConfigRuntimeAvailable(config) ? config : null;
        }

        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT wc.*, t.slug as tenant_slug, t.name as tenant_name
             FROM public.widget_configs wc
             JOIN public.tenants t ON t.id = wc.tenant_id
             WHERE wc.widget_id = $1 AND wc.is_active = true`,
            widgetId,
        );
        if (!rows?.length) return null;

        const config = rows[0];
        if (!await this.isConfigRuntimeAvailable(config)) return null;
        await this.redis.set(`widget:config:${widgetId}`, JSON.stringify(config), 300);
        return config;
    }

    /**
     * The tenant's own web chat widgets. The public link ("El enlace de
     * {Nombre}", is_demo) is deliberately absent: it is not a widget the owner
     * configures, and deleting it from here would break a URL already shared in
     * an Instagram bio. It is offered by setup-status instead.
     */
    async listWidgets(tenantId: string): Promise<any[]> {
        return this.prisma.$queryRawUnsafe(
            `SELECT * FROM public.widget_configs WHERE tenant_id = $1::uuid AND COALESCE(is_demo, false) = false ORDER BY created_at DESC`,
            tenantId,
        );
    }

    async createWidget(tenantId: string, data: any): Promise<any> {
        const widgetId = 'wgt_' + crypto.randomBytes(6).toString('hex');

        // Resolve tenant language for localised defaults (es-CO → es, fallback es)
        const lang = await this.getTenantLanguage(tenantId);
        const defaults = WIDGET_DEFAULTS[lang] ?? WIDGET_DEFAULTS['es'];

        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `INSERT INTO public.widget_configs (tenant_id, widget_id, name, primary_color, position, welcome_message, agent_name, pre_chat_enabled, pre_chat_fields, allowed_domains, locale)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::text[], $11)
             RETURNING *`,
            tenantId, widgetId,
            data.name || 'Web Chat',
            data.primaryColor || '#6c5ce7',
            data.position || 'bottom-right',
            data.welcomeMessage || defaults.welcomeMessage,
            data.agentName || defaults.agentName,
            data.preChatEnabled || false,
            JSON.stringify(data.preChatFields || ['name', 'email']),
            data.allowedDomains || [],
            data.locale || lang,
        );
        return rows[0];
    }

    /** Tenant language as a short code (es/en/pt/fr), falling back to 'es'. */
    private async getTenantLanguage(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { language: true },
            });
            return (tenant?.language || 'es').split('-')[0];
        } catch {
            return 'es';
        }
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
             WHERE id = $1::uuid AND tenant_id = $2::uuid AND COALESCE(is_demo, false) = false
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
            `DELETE FROM public.widget_configs WHERE id = $1::uuid AND tenant_id = $2::uuid AND COALESCE(is_demo, false) = false RETURNING widget_id`,
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
        resumeToken?: string;
    }): Promise<{ sessionId: string; token: string }> {
        if (!await this.isTenantWidgetRuntimeAvailable(widgetConfig?.tenant_id, 'write', widgetConfig?.is_demo === true)) {
            throw new ForbiddenException({ error: 'subscription_unavailable' });
        }
        if (data.resumeToken) {
            const existing = await this.getSessionByToken(data.resumeToken);
            if (existing && existing.widget_config_id === widgetConfig.id && existing.tenant_id === widgetConfig.tenant_id
                && existing.visitor_id === data.visitorId) {
                const token = this.generateToken(existing.id, widgetConfig.tenant_id, widgetConfig.widget_id);
                const rotated: any[] = await this.prisma.$queryRawUnsafe(
                    'UPDATE public.widget_sessions SET last_seen_at=NOW(),token=$2 WHERE id=$1::uuid AND token=$3 RETURNING id',
                    existing.id,token,data.resumeToken);
                if (rotated[0]) return {sessionId:existing.id,token};
                throw new ForbiddenException({error:'widget_session_rotated'});
            }
            // An expired or revoked credential starts a fresh session; its visitor ID cannot recover history.
        }

        // The JWT sessionId must be the exact primary key persisted below. Signing a
        // separate random UUID made every first-session token impossible to resolve;
        // only a second create/resume request happened to repair it.
        const sessionId = crypto.randomUUID();
        const token = this.generateToken(sessionId, widgetConfig.tenant_id, widgetConfig.widget_id);
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `INSERT INTO public.widget_sessions (id, widget_config_id, tenant_id, visitor_id, visitor_name, visitor_email, visitor_phone, page_url, token)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            sessionId, widgetConfig.id, widgetConfig.tenant_id,
            data.visitorId, data.name || null, data.email || null, data.phone || null, data.page || null, token,
        );

        return { sessionId: rows[0].id, token };
    }

    async getSessionByToken(token: string): Promise<any> {
        try {
            const decoded = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as any;
            if (!decoded || typeof decoded.sessionId !== 'string' ||
                typeof decoded.tenantId !== 'string' || typeof decoded.widgetId !== 'string') {
                return null;
            }
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT ws.*, wc.tenant_id, wc.widget_id, wc.allowed_domains,
                        wc.is_active AS widget_is_active, wc.is_demo, wc.locale AS widget_locale
                 FROM public.widget_sessions ws
                 JOIN public.widget_configs wc ON wc.id = ws.widget_config_id AND wc.tenant_id = ws.tenant_id
                 WHERE ws.id = $1::uuid
                   AND ws.token = $2
                   AND wc.is_active = true`,
                decoded.sessionId, token,
            );
            const row = rows?.[0] || null;
            if (!row) return null;
            // Defense in depth: the token's tenant/widget claims must match the
            // session's actual config (a token can't be replayed across tenants).
            if ((decoded.tenantId && decoded.tenantId !== row.tenant_id) ||
                (decoded.widgetId && decoded.widgetId !== row.widget_id)) {
                this.logger.warn(`[Widget] token claim mismatch for session ${decoded.sessionId}`);
                return null;
            }
            if (!await this.isTenantWidgetRuntimeAvailable(row.tenant_id, 'read', row.is_demo === true)) return null;
            return row;
        } catch {
            return null;
        }
    }

    private async isConfigRuntimeAvailable(config: any): Promise<boolean> {
        if (!config?.id || !config?.tenant_id || !config?.widget_id) return false;
        const active: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT 1
               FROM public.widget_configs
              WHERE id = $1::uuid AND tenant_id = $2::uuid
                AND widget_id = $3 AND is_active = true
              LIMIT 1`,
            config.id, config.tenant_id, config.widget_id,
        );
        if (!active?.length) return false;
        return this.isTenantWidgetRuntimeAvailable(config.tenant_id, 'read', config.is_demo === true);
    }

    /**
     * The tenant must be ready and entitled. The plan's `widget` feature gates
     * the embeddable widget; the day-0 public link (is_demo) is paid by the
     * platform up to a cap (D19) and therefore only needs the allowance to be
     * switched on.
     */
    private async isTenantWidgetRuntimeAvailable(
        tenantId: string,
        mode: SubscriptionAccessMode = 'read',
        demo = false,
    ): Promise<boolean> {
        if (!await resolveReadyTenantContext(this.prisma, this.redis, tenantId)) return false;
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, mode);
        if (!entitlement.allowed) return false;
        // The allowance only ADDS a lane. A tenant whose plan includes the web
        // chat keeps its widget even if the platform switches the demo off.
        if (demo && (await this.demoAllowance?.get())?.enabled !== false) return true;
        const features = await this.throttle.getPlanFeatures(tenantId);
        return features.widget === true;
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
            { sessionId, tenantId, widgetId, jti: crypto.randomUUID() },
            this.jwtSecret,
            { expiresIn: '7d' },
        );
    }
}
