import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { WIDGET_DEFAULTS } from './widget-defaults';

const logger = new Logger('WidgetDemoLink');

/** Copy the visitor sees on the public page and in the widget, by locale. */
const DEMO_PAGE_MESSAGES: Record<string, { dailyCap: string; allowanceExhausted: string }> = {
    es: {
        dailyCap: 'Este enlace de prueba alcanzó su límite de mensajes por hoy. Vuelve mañana.',
        allowanceExhausted: 'Esta prueba llegó a su tope de mensajes. Cuando el negocio active su plan, el chat sigue.',
    },
    en: {
        dailyCap: 'This trial link reached its message limit for today. Come back tomorrow.',
        allowanceExhausted: 'This trial reached its message cap. Once the business activates its plan, the chat continues.',
    },
    pt: {
        dailyCap: 'Este link de teste atingiu o limite de mensagens de hoje. Volte amanhã.',
        allowanceExhausted: 'Este teste chegou ao seu limite de mensagens. Quando o negócio ativar o plano, o chat continua.',
    },
    fr: {
        dailyCap: "Ce lien d'essai a atteint sa limite de messages pour aujourd'hui. Revenez demain.",
        allowanceExhausted: "Cet essai a atteint son plafond de messages. Quand l'entreprise activera son forfait, le chat continuera.",
    },
};

export function demoDailyCapText(locale?: string | null): string {
    return (DEMO_PAGE_MESSAGES[String(locale || 'es').slice(0, 2)] ?? DEMO_PAGE_MESSAGES.es).dailyCap;
}

export function demoAllowanceExhaustedText(locale?: string | null): string {
    return (DEMO_PAGE_MESSAGES[String(locale || 'es').slice(0, 2)] ?? DEMO_PAGE_MESSAGES.es).allowanceExhausted;
}

/** Said in the chat when the abuse ceiling stops a visitor, in their language. */
const RATE_LIMITED_TEXT: Record<string, string> = {
    es: 'Estás enviando mensajes muy rápido. Espera un momento e inténtalo de nuevo.',
    en: 'You are sending messages too quickly. Wait a moment and try again.',
    pt: 'Você está enviando mensagens muito rápido. Espere um momento e tente de novo.',
    fr: 'Vous envoyez des messages trop vite. Attendez un instant et réessayez.',
};

export function widgetRateLimitedText(locale?: string | null): string {
    return RATE_LIMITED_TEXT[String(locale || 'es').slice(0, 2)] ?? RATE_LIMITED_TEXT.es;
}

export interface DemoLink {
    widgetId: string;
    /** Path on the dashboard host; the absolute URL is the caller's origin + path. */
    path: string;
    agentName: string;
}

export function demoLinkPath(widgetId: string): string {
    return `/w/${widgetId}`;
}

/**
 * "El enlace de {Nombre}" (D11): the one public page where anyone can talk to
 * the tenant's agent, born at day 0 on top of the web chat widget.
 *
 * It lives ONLY in public.widget_configs with is_demo = true. On purpose it
 * is not a channel_accounts row, is not bound to the agent, and is skipped by
 * the readers that define "canal conectado": a demo is a place to show the
 * agent to a partner while Meta takes days, never an activation. The default
 * agent already answers web_widget without a binding (serving-persona).
 *
 * Idempotent (one demo widget per tenant) and never throws: a failed
 * provisioning must not break a signup nor a setup-status read; the next
 * call simply tries again.
 */
export async function ensureDemoWidget(
    prisma: PrismaService,
    tenantId: string,
    options: { agentName?: string | null; locale?: string | null; redis?: { del(key: string): Promise<unknown> } } = {},
): Promise<DemoLink | null> {
    try {
        const existing = await prisma.$queryRawUnsafe<any[]>(
            `SELECT widget_id, agent_name, locale
               FROM public.widget_configs
              WHERE tenant_id = $1::uuid AND is_demo = true AND is_active = true
              ORDER BY created_at ASC
              LIMIT 1`,
            tenantId,
        );
        const found = Array.isArray(existing) ? existing[0] : null;
        if (found?.widget_id) {
            // The link was created before the owner named the agent, so the row
            // still says "Asistente" while every other surface says Valentina.
            // Whoever knows the current name (setup-status) passes it, and the
            // page, the chat header and the share text agree again.
            const wanted = (options.agentName || '').trim();
            if (wanted && wanted !== String(found.agent_name || '')) {
                const locale = normaliseLocale(options.locale || found.locale);
                await prisma.$queryRawUnsafe(
                    `UPDATE public.widget_configs SET agent_name = $2, name = $3, updated_at = NOW()
                      WHERE widget_id = $1 AND is_demo = true`,
                    String(found.widget_id), wanted, demoLinkName(wanted, locale),
                ).catch(() => null);
                // The public config is cached for 5 minutes by widget id.
                await options.redis?.del(`widget:config:${String(found.widget_id)}`).catch(() => {});
                return { widgetId: String(found.widget_id), path: demoLinkPath(String(found.widget_id)), agentName: wanted };
            }
            return { widgetId: String(found.widget_id), path: demoLinkPath(String(found.widget_id)), agentName: String(found.agent_name || '') };
        }

        const tenantRows = await prisma.$queryRawUnsafe<any[]>(
            `SELECT language, schema_name FROM public.tenants WHERE id = $1::uuid`, tenantId,
        );
        const tenant = Array.isArray(tenantRows) ? tenantRows[0] : null;
        if (!tenant) return null;
        const locale = normaliseLocale(options.locale || tenant.language);
        const defaults = WIDGET_DEFAULTS[locale] ?? WIDGET_DEFAULTS.es;
        let agentName = (options.agentName || '').trim();
        if (!agentName && tenant.schema_name && /^tenant_[a-z0-9_]{1,56}$/.test(String(tenant.schema_name))) {
            const agents = await prisma.$queryRawUnsafe<any[]>(
                `SELECT name FROM "${tenant.schema_name}".agent_personas WHERE is_active = true ORDER BY is_default DESC, created_at ASC LIMIT 1`,
            ).catch(() => [] as any[]);
            agentName = String((Array.isArray(agents) ? agents[0]?.name : '') || '').trim();
        }
        if (!agentName) agentName = defaults.agentName;
        const widgetId = 'wgt_' + crypto.randomBytes(6).toString('hex');
        // One statement: a retry of the same signup, or a setup-status read
        // racing the signup, cannot create two demo links.
        const inserted = await prisma.$queryRawUnsafe<any[]>(
            `INSERT INTO public.widget_configs
                (tenant_id, widget_id, name, agent_name, welcome_message, pre_chat_enabled, pre_chat_fields, allowed_domains, locale, is_demo)
             SELECT $1::uuid, $2, $3, $4, $5, false, '[]'::jsonb, '{}'::text[], $6, true
              WHERE NOT EXISTS (SELECT 1 FROM public.widget_configs WHERE tenant_id = $1::uuid AND is_demo = true AND is_active = true)
             RETURNING widget_id, agent_name`,
            tenantId, widgetId, demoLinkName(agentName, locale), agentName, defaults.welcomeMessage, locale,
        ).catch((error: any) => {
            // The partial unique index turned a concurrent provisioning into a
            // duplicate: that is the guard working, not a failure.
            if (!`${error?.code || ''} ${error?.message || ''}`.includes('23505')) throw error;
            return [] as any[];
        });
        const row = Array.isArray(inserted) ? inserted[0] : null;
        if (row?.widget_id) return { widgetId: String(row.widget_id), path: demoLinkPath(String(row.widget_id)), agentName: String(row.agent_name || agentName) };
        // Lost the race (the partial unique index turned the second insert into
        // a 23505, or the NOT EXISTS saw the committed row): read the winner.
        const again = await prisma.$queryRawUnsafe<any[]>(
            `SELECT widget_id, agent_name FROM public.widget_configs
              WHERE tenant_id = $1::uuid AND is_demo = true AND is_active = true ORDER BY created_at ASC LIMIT 1`,
            tenantId,
        );
        const other = Array.isArray(again) ? again[0] : null;
        return other?.widget_id ? { widgetId: String(other.widget_id), path: demoLinkPath(String(other.widget_id)), agentName: String(other.agent_name || agentName) } : null;
    } catch (error: any) {
        logger.warn(`ensureDemoWidget failed for ${tenantId}: ${error?.message}`);
        return null;
    }
}

function normaliseLocale(raw: unknown): string {
    const code = String(raw || 'es').toLowerCase().slice(0, 2);
    return WIDGET_DEFAULTS[code] ? code : 'es';
}

function demoLinkName(agentName: string, locale: string): string {
    const label: Record<string, string> = { es: 'El enlace de', en: 'The link of', pt: 'O link de', fr: 'Le lien de' };
    return `${label[locale] ?? label.es} ${agentName}`;
}
