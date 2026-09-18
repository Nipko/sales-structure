import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { WIDGET_DEFAULTS } from './widget-defaults';

const logger = new Logger('WidgetDemoLink');

/**
 * Copy the visitor sees on the public page and in the widget, by locale.
 *
 * Both only ever reach a TRIAL turn: on a plan that includes the web chat the
 * link is a real channel with no page cap and the plan's own quota message.
 * So "cuando el negocio active su plan" was false for a business that already
 * pays a plan without the web chat; what brings the chat back is the web chat
 * itself, and that is what the visitor is told.
 */
const DEMO_PAGE_MESSAGES: Record<string, { dailyCap: string; allowanceExhausted: string }> = {
    es: {
        dailyCap: 'Este enlace de prueba alcanzó su límite de mensajes por hoy. Vuelve mañana.',
        allowanceExhausted: 'Este chat de prueba llegó a su tope de mensajes. Vuelve a funcionar cuando el negocio active el chat web.',
    },
    en: {
        dailyCap: 'This trial link reached its message limit for today. Come back tomorrow.',
        allowanceExhausted: 'This trial chat reached its message cap. It works again once the business turns on web chat.',
    },
    pt: {
        dailyCap: 'Este link de teste atingiu o limite de mensagens de hoje. Volte amanhã.',
        allowanceExhausted: 'Este chat de teste chegou ao limite de mensagens. Volta a funcionar quando o negócio ativar o chat web.',
    },
    fr: {
        dailyCap: "Ce lien d'essai a atteint sa limite de messages pour aujourd'hui. Revenez demain.",
        allowanceExhausted: "Ce chat d'essai a atteint son plafond de messages. Il fonctionnera de nouveau quand l'entreprise activera le chat web.",
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

/**
 * Is this turn on the platform-paid trial lane?
 *
 * The purpose is persisted. Buying or changing a plan never silently turns a
 * link the owner was testing into a customer-facing channel. Old rows and old
 * cached configs safely remain trials.
 */
export type DemoLinkUsageMode = 'trial' | 'operational';

export async function isTrialLink(
    widget: { is_demo?: unknown; usage_mode?: unknown } | null | undefined,
    _throttle?: { getPlanFeatures(tenantId: string): Promise<{ widget?: unknown }> } | null,
): Promise<boolean> {
    if (widget?.is_demo !== true) return false;
    // Old rows and old cached configs have no mode. They remain trials until
    // the owner explicitly chooses to use the link with customers.
    return widget.usage_mode !== 'operational';
}

export interface DemoLink {
    widgetId: string;
    /** Path on the dashboard host; the absolute URL is the caller's origin + path. */
    path: string;
    agentName: string;
    usageMode: DemoLinkUsageMode;
}

/** Why the agent's link does not answer right now (F11). */
export type DemoLinkUnavailableReason = 'switched_off' | 'allowance_used' | 'plan_required';

/**
 * Whether a visitor who writes on the agent's link gets a reply right now.
 *
 * `setup-status` used to hand out the link unconditionally, so the wizard,
 * Channels and the editor said "tu agente ya responde por su enlace" to an
 * account whose trial the platform had switched off or whose platform-paid
 * replies were used up. Dashboards that predate these two fields ignore them.
 */
export interface DemoLinkAvailability {
    answers: boolean;
    /** `null` whenever `answers` is true. */
    unavailableReason: DemoLinkUnavailableReason | null;
}

/** The link as `setup-status` returns it: where it is, and whether it answers. */
export type SetupStatusDemoLink = DemoLink & DemoLinkAvailability;

/**
 * The runtime's own rule, as a pure function of what could be read (`null` =
 * the read failed).
 *
 * On a plan that includes the web chat the link is a real channel and answers
 * on the plan's quota: the same predicate as `isTrialLink`. Otherwise it is
 * the platform-paid trial, and the reply lane (`processWidgetMessage`) answers
 * only while the allowance is switched on and the lifetime counter
 * (`demo_msg:{tenantId}`) is below `messagesPerTenant`.
 *
 * Anything unknown answers `true`: a blip must not tell an owner their link
 * went quiet, and the page itself says why when a visitor hits a real limit.
 */
export function demoLinkAvailability(input: {
    usageMode: DemoLinkUsageMode;
    planIncludesWebChat: boolean | null;
    allowance: { enabled: boolean; messagesPerTenant: number } | null;
    used: number | null;
}): DemoLinkAvailability {
    const answering: DemoLinkAvailability = { answers: true, unavailableReason: null };
    if (input.usageMode === 'operational') {
        if (input.planIncludesWebChat === false) return { answers: false, unavailableReason: 'plan_required' };
        return answering;
    }
    if (!input.allowance) return answering;
    if (input.allowance.enabled === false) return { answers: false, unavailableReason: 'switched_off' };
    if (input.used === null || !Number.isFinite(input.used)) return answering;
    return input.allowance.messagesPerTenant > input.used ? answering : { answers: false, unavailableReason: 'allowance_used' };
}

export function demoLinkPath(widgetId: string): string {
    return `/w/${widgetId}`;
}

/** Persist the owner's choice without replacing the stable public URL. */
export async function setDemoLinkUsageMode(
    prisma: PrismaService,
    tenantId: string,
    usageMode: DemoLinkUsageMode,
): Promise<DemoLink | null> {
    const rows = await prisma.$queryRawUnsafe(
        `UPDATE public.widget_configs
            SET usage_mode = $2, updated_at = NOW()
          WHERE tenant_id = $1::uuid AND is_demo = true AND is_active = true
          RETURNING widget_id, agent_name, usage_mode`,
        tenantId, usageMode,
    );
    const row = Array.isArray(rows) ? (rows as any[])[0] : null;
    return row?.widget_id ? {
        widgetId: String(row.widget_id),
        path: demoLinkPath(String(row.widget_id)),
        agentName: String(row.agent_name || ''),
        usageMode: row.usage_mode === 'operational' ? 'operational' : 'trial',
    } : null;
}

/**
 * "El enlace de {Nombre}" (D11): the one public page where anyone can talk to
 * the tenant's agent, born at day 0 on top of the web chat widget.
 *
 * It lives only in public.widget_configs with is_demo = true. It begins in
 * trial mode and does not count as a connection. If the owner explicitly
 * chooses operational mode, the stable URL becomes a real web-chat channel;
 * that transition is handled by the authenticated endpoint, not here.
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
            `SELECT widget_id, agent_name, locale, COALESCE(usage_mode, 'trial') AS usage_mode
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
                return { widgetId: String(found.widget_id), path: demoLinkPath(String(found.widget_id)), agentName: wanted, usageMode: found.usage_mode === 'operational' ? 'operational' : 'trial' };
            }
            return { widgetId: String(found.widget_id), path: demoLinkPath(String(found.widget_id)), agentName: String(found.agent_name || ''), usageMode: found.usage_mode === 'operational' ? 'operational' : 'trial' };
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
                (tenant_id, widget_id, name, agent_name, welcome_message, pre_chat_enabled, pre_chat_fields, allowed_domains, locale, is_demo, usage_mode)
             SELECT $1::uuid, $2, $3, $4, $5, false, '[]'::jsonb, '{}'::text[], $6, true, 'trial'
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
        if (row?.widget_id) return { widgetId: String(row.widget_id), path: demoLinkPath(String(row.widget_id)), agentName: String(row.agent_name || agentName), usageMode: 'trial' };
        // Lost the race (the partial unique index turned the second insert into
        // a 23505, or the NOT EXISTS saw the committed row): read the winner.
        const again = await prisma.$queryRawUnsafe<any[]>(
            `SELECT widget_id, agent_name, COALESCE(usage_mode, 'trial') AS usage_mode FROM public.widget_configs
              WHERE tenant_id = $1::uuid AND is_demo = true AND is_active = true ORDER BY created_at ASC LIMIT 1`,
            tenantId,
        );
        const other = Array.isArray(again) ? again[0] : null;
        return other?.widget_id ? { widgetId: String(other.widget_id), path: demoLinkPath(String(other.widget_id)), agentName: String(other.agent_name || agentName), usageMode: other.usage_mode === 'operational' ? 'operational' : 'trial' } : null;
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
