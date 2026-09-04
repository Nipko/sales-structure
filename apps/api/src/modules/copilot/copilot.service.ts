import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { VerticalsService } from '../verticals/verticals.service';
import * as path from 'path';
import * as fs from 'fs';
import { CopilotRateLimitService } from './copilot-rate-limit.service';
import { AgentQualityService } from '../quality/agent-quality.service';
import { AgentQualitySignalService } from '../quality/agent-quality-signal.service';
import {
    GuidedTourDefinition,
    GuidedTourId,
    canRoleRunGuidedTour,
    extractGuidedTourMarker,
    findGuidedTourForQualityCode,
    getGuidedTour,
    guidedToursForArticles,
} from '@parallext/shared';

export interface CopilotQualityTarget {
    kind: 'agent_quality';
    agentId: string;
    signalId?: string;
}

export type CopilotChatAction =
    | { code: 'open_quality_center'; labelKey: 'openCenter'; href: string }
    | { code: 'open_quality_action'; labelKey: 'resolvePriority'; href: string }
    /** Opens the screen and walks the person through it. `href` always comes
     *  from the shared registry (mobile fallback), never from model text. */
    | { code: 'start_guided_tour'; labelKey: 'showMe'; href: string; tourId: GuidedTourId };

/**
 * What the tenant actually has connected. Provided by `AgentQualityService`;
 * declared structurally here so the copilot compiles and degrades to "no
 * channel block" while the provider method is being rolled out.
 */
interface TenantChannelSnapshot {
    generatedAt: string;
    total: number;
    channels: { type: string; accounts: number; health: string }[];
}

interface TenantChannelSnapshotProvider {
    getTenantChannelSnapshot(tenantId: string): Promise<TenantChannelSnapshot>;
}

// ─── Existing interfaces (platform copilot chat) ────────────────────────────

export interface CopilotChatRequest {
    message: string;
    target?: CopilotQualityTarget;
    context: {
        page: string;
        tenantId: string;
        userName: string;
        userRole: string;
        /** UI locale (es|en|pt|fr) — drives KB language and reply language. */
        locale: string;
    };
    history: { role: 'user' | 'assistant'; content: string }[];
}

/** One functional help article of the assistant KB (kb/assistant/{locale}/*.md). */
interface KbArticle {
    id: string;
    locale: string;
    title: string;
    routes: string[];
    roles: string[];
    keywords: string[];
    body: string;
}

export interface CopilotChatResponse {
    reply: string;
    model?: string;
    tokensUsed?: number;
    actions?: CopilotChatAction[];
}

// ─── New interfaces (conversation copilot) ──────────────────────────────────

export interface SuggestedReply {
    text: string;
    tone: 'formal' | 'friendly' | 'empathetic';
}

export interface ConversationSummary {
    summary: string;
    customerIntent: string;
    keyInfoShared: string[];
    pendingQuestions: string[];
}

export interface IntentAnalysis {
    primaryIntent: string;
    confidence: number;
    recommendedAction: string;
}

export interface ContextualAnswer {
    answer: string;
    sources: string[];
}

const COPILOT_CACHE_TTL = 60; // seconds

@Injectable()
export class CopilotService {
    private readonly logger = new Logger(CopilotService.name);

    constructor(
        private configService: ConfigService,
        private prisma: PrismaService,
        private redis: RedisService,
        private llmRouter: LLMRouterService,
        private knowledgeService: KnowledgeService,
        private throttle: TenantThrottleService,
        private verticals: VerticalsService,
        private rateLimiter: CopilotRateLimitService = null as any,
        private agentQuality: AgentQualityService = null as any,
        private qualitySignals: AgentQualitySignalService = null as any,
    ) {}

    // ─── Per-plan capability context ────────────────────────────────────────
    // So the assistant can answer "can I do X on MY plan?" accurately: it knows
    // the user's current plan and, for anything not included, the minimum plan
    // that unlocks it. Values are read LIVE from the plan catalog (billing_plans
    // via seed-billing-plans.js) — never hand-copied, so they can't drift.

    private planCatalog: { at: number; plans: any[] } | null = null;

    // User-facing capabilities in rough order of relevance. kind 'num' = a limit
    // (count/quota), 'bool' = an on/off feature gate. Internal keys (rate limits,
    // budgets, per-5min bursts…) are intentionally excluded — not user-relevant.
    private static readonly PLAN_CAPS: { key: string; label: string; kind: 'num' | 'bool' }[] = [
        { key: 'maxAgents', label: 'Agentes de IA', kind: 'num' },
        { key: 'maxAiMessages', label: 'Mensajes de IA por mes', kind: 'num' },
        { key: 'maxChannelAccounts', label: 'Conexiones por tipo de canal', kind: 'num' },
        { key: 'maxCalendars', label: 'Calendarios', kind: 'num' },
        { key: 'broadcastCampaigns', label: 'Campañas de difusión por mes', kind: 'num' },
        { key: 'automationRules', label: 'Reglas de automatización', kind: 'num' },
        { key: 'maxDripSequences', label: 'Secuencias de nurturing', kind: 'num' },
        { key: 'knowledgeArticles', label: 'Artículos de base de conocimiento', kind: 'num' },
        { key: 'maxProperties', label: 'Propiedades (turismo)', kind: 'num' },
        { key: 'segments', label: 'Segmentos guardados', kind: 'num' },
        { key: 'mediaStorageMb', label: 'Almacenamiento multimedia (MB)', kind: 'num' },
        { key: 'widgetTriggers', label: 'Disparadores del widget web', kind: 'num' },
        { key: 'dataRetentionDays', label: 'Retención de datos (días)', kind: 'num' },
        { key: 'widget', label: 'Widget de chat web', kind: 'bool' },
        { key: 'smsNotifications', label: 'Notificaciones por SMS', kind: 'bool' },
        { key: 'externalCrm', label: 'Integración con CRM externo (HubSpot/Pipedrive)', kind: 'bool' },
        { key: 'outboundWebhooks', label: 'Webhooks salientes', kind: 'bool' },
        { key: 'customPrompt', label: 'Personalización avanzada del agente', kind: 'bool' },
        { key: 'customTemplates', label: 'Plantillas de agente personalizadas', kind: 'bool' },
        { key: 'aiInsights', label: 'Insights de IA', kind: 'bool' },
        { key: 'scheduledReports', label: 'Reportes programados', kind: 'bool' },
        { key: 'abTestBroadcasts', label: 'Pruebas A/B en campañas', kind: 'bool' },
        { key: 'sso', label: 'Inicio de sesión único (SSO/SAML)', kind: 'bool' },
        { key: 'auditLog', label: 'Registro de auditoría', kind: 'bool' },
        { key: 'whiteLabel', label: 'Marca blanca (white-label)', kind: 'bool' },
        { key: 'publicApi', label: 'API pública', kind: 'bool' },
        { key: 'biApi', label: 'API de BI (analítica)', kind: 'bool' },
        { key: 'staffScheduling', label: 'Agenda de personal (staff)', kind: 'bool' },
        { key: 'ecommerce', label: 'Integración e-commerce (Shopify/WooCommerce)', kind: 'bool' },
        { key: 'channelManager', label: 'Channel manager (hospitalidad)', kind: 'bool' },
        { key: 'vehicleInventory', label: 'Inventario de vehículos', kind: 'bool' },
        { key: 'prioritySupport', label: 'Soporte prioritario', kind: 'bool' },
    ];

    private async loadPlanCatalog(): Promise<any[]> {
        if (this.planCatalog && (Date.now() - this.planCatalog.at) < 300_000) return this.planCatalog.plans;
        try {
            const plans = await this.prisma.billingPlan.findMany({
                where: { isActive: true },
                select: { slug: true, name: true, sortOrder: true, maxAgents: true, maxAiMessages: true, features: true },
                orderBy: { sortOrder: 'asc' },
            });
            this.planCatalog = { at: Date.now(), plans };
            return plans;
        } catch (e: any) {
            this.logger.warn(`Could not load plan catalog: ${e.message}`);
            return this.planCatalog?.plans ?? [];
        }
    }

    private planFeatureValue(plan: any, key: string): any {
        if (key === 'maxAgents') return plan.maxAgents;
        if (key === 'maxAiMessages') return plan.maxAiMessages;
        return (plan.features ?? {})[key];
    }

    /** A plan "has" a capability if the value is truthy / a non-zero limit / -1 (unlimited). */
    private capIncluded(v: any): boolean {
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v !== 0;
        if (v == null) return false;
        if (typeof v === 'object') return Object.values(v).some((x) => x !== 0);
        return !!v;
    }

    private capValueLabel(v: any, kind: 'num' | 'bool'): string {
        if (kind === 'bool') return this.capIncluded(v) ? 'Sí' : 'No';
        if (v === -1) return 'ilimitado';
        if (v == null) return 'no incluido';
        if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${x === -1 ? '∞' : x}`).join(', ');
        return String(v);
    }

    /**
     * Builds the plan-awareness block for the assistant prompt: the user's current
     * plan with what it includes, and — for anything not included — the cheapest
     * plan that unlocks it (so the assistant can guide upgrades accurately).
     */
    private async buildPlanContext(tenantId?: string): Promise<string> {
        if (!tenantId) return '';
        try {
            const plans = await this.loadPlanCatalog();
            if (!plans.length) return '';
            const currentSlug = await this.throttle.getTenantPlan(tenantId);
            const currentFeatures = await this.throttle.getPlanFeatures(tenantId); // overrides applied
            const current = plans.find((p) => p.slug === currentSlug);
            const currentName = current?.name || currentSlug;

            const included: string[] = [];
            const notIncluded: string[] = [];

            for (const cap of CopilotService.PLAN_CAPS) {
                const val = currentFeatures[cap.key];
                if (this.capIncluded(val)) {
                    included.push(`- ${cap.label}: ${this.capValueLabel(val, cap.kind)}`);
                } else {
                    // Minimum plan (by sortOrder) that unlocks this capability.
                    const unlockPlan = plans.find((p) => this.capIncluded(this.planFeatureValue(p, cap.key)));
                    notIncluded.push(`- ${cap.label}: no incluido${unlockPlan ? ` (disponible desde el plan ${unlockPlan.name})` : ''}`);
                }
            }

            return `## PLAN DEL USUARIO (información AUTORITATIVA para preguntas de "¿puedo hacer X en mi plan?")
El usuario está en el plan **${currentName}**.

Incluido en su plan actual:
${included.join('\n') || '- (sin datos)'}

NO incluido en su plan actual (y desde qué plan se obtiene):
${notIncluded.join('\n') || '- (todo incluido)'}

REGLA DE PLAN: estos valores son la ÚNICA fuente válida sobre límites y disponibilidad por plan; si algún artículo muestra cifras por plan distintas, prevalece este bloque. Cuando el usuario pregunte si puede hacer algo, responde según SU plan actual; si requiere un plan superior, dilo con claridad e invítalo a mejorar su plan en Configuración → Facturación. Nunca inventes precios ni límites que no estén aquí o en los artículos.`;
        } catch (e: any) {
            this.logger.warn(`buildPlanContext failed: ${e.message}`);
            return '';
        }
    }

    // ─── Assistant Knowledge Base (apps/api/kb/assistant/{locale}/*.md) ─────
    // The KB ships INSIDE the Docker image (Dockerfile.api copies apps/api/kb),
    // unlike the old docs/user-manual.md approach where docs/ was never in the
    // image and the assistant ran blind in production. Articles are functional
    // user-level ONLY — the KB itself is the primary guardrail: what isn't in
    // it, the assistant honestly says it doesn't know.

    private kbArticles = new Map<string, KbArticle[]>(); // locale → articles
    private kbLoadAttempted = new Set<string>();

    private static readonly KB_LOCALES = ['es', 'en', 'pt', 'fr'];
    private static readonly KB_STOPWORDS = new Set([
        'como', 'para', 'que', 'con', 'los', 'las', 'del', 'por', 'una', 'este', 'esta',
        'the', 'and', 'for', 'how', 'can', 'with', 'what', 'una', 'mais', 'pour', 'des',
        'quiero', 'puedo', 'hago', 'hacer', 'donde', 'cual', 'cuales', 'mis', 'sus',
    ]);

    /** Lowercase + strip diacritics so "configuración" matches "configuracion". */
    private normalize(s: string): string {
        // eslint-disable-next-line no-misleading-character-class
        return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    private kbBaseDirs(): string[] {
        return [
            path.join(process.cwd(), 'kb', 'assistant'),                    // prod image (/app/kb) + dev cwd=apps/api
            path.join(process.cwd(), 'apps', 'api', 'kb', 'assistant'),     // dev cwd=repo root
            path.resolve(__dirname, '../../../kb/assistant'),               // dist-relative fallback
            path.resolve(__dirname, '../../../../kb/assistant'),
        ];
    }

    /** Read one locale directory into a Map keyed by article id (no ES fallback). */
    private loadLocaleDir(loc: string): Map<string, KbArticle> {
        const byId = new Map<string, KbArticle>();
        let dir = '';
        for (const base of this.kbBaseDirs()) {
            try {
                if (fs.existsSync(path.join(base, loc))) { dir = path.join(base, loc); break; }
            } catch { /* keep trying */ }
        }
        if (!dir) return byId;

        try {
            for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
                try {
                    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
                    const parsed = this.parseKbArticle(raw, loc, file);
                    if (parsed) byId.set(parsed.id, parsed);
                } catch (e: any) {
                    this.logger.warn(`Skipping malformed KB article ${loc}/${file}: ${e.message}`);
                }
            }
        } catch (e: any) {
            this.logger.error(`Failed reading assistant KB dir ${dir}: ${e.message}`);
        }
        return byId;
    }

    /**
     * Returns the full article set for a locale: native articles first, and any
     * article NOT yet translated is filled in from the Spanish base (100% topic
     * coverage even with partial translations — the LLM replies in the user's
     * language regardless of the article's source language). Spanish is the
     * canonical base and always loads its own directory.
     */
    private loadKb(locale: string): KbArticle[] {
        const loc = CopilotService.KB_LOCALES.includes(locale) ? locale : 'es';
        if (this.kbArticles.has(loc)) return this.kbArticles.get(loc)!;
        if (this.kbLoadAttempted.has(loc)) return this.kbArticles.get(loc) ?? [];
        this.kbLoadAttempted.add(loc);

        const merged = new Map<string, KbArticle>();
        // Spanish base first (canonical), then overlay native-locale articles.
        if (loc !== 'es') {
            for (const [id, a] of this.loadLocaleDir('es')) merged.set(id, a);
        }
        let native = 0;
        for (const [id, a] of this.loadLocaleDir(loc)) { merged.set(id, a); native++; }

        const articles = [...merged.values()];
        if (articles.length === 0) {
            this.logger.error(`Assistant KB empty for locale "${loc}" (tried ${this.kbBaseDirs().join(' | ')})`);
        } else {
            this.logger.log(`Assistant KB loaded for "${loc}": ${articles.length} articles (${native} native${loc !== 'es' ? `, ${articles.length - native} from es fallback` : ''})`);
        }
        this.kbArticles.set(loc, articles);
        return articles;
    }

    /** Front-matter: --- delimited; arrays as JSON (["a","b"]), scalars as plain text. */
    private parseKbArticle(raw: string, locale: string, file: string): KbArticle | null {
        const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        if (!m) return null;
        const meta: Record<string, any> = {};
        for (const line of m[1].split(/\r?\n/)) {
            const kv = line.match(/^(\w+):\s*(.*)$/);
            if (!kv) continue;
            const [, key, valRaw] = kv;
            const val = valRaw.trim();
            if (val.startsWith('[')) {
                try { meta[key] = JSON.parse(val); } catch { meta[key] = [val]; }
            } else {
                meta[key] = val.replace(/^"|"$/g, '');
            }
        }
        return {
            id: meta.id || file.replace(/\.md$/, ''),
            locale,
            title: meta.title || file,
            routes: Array.isArray(meta.routes) ? meta.routes : [],
            roles: Array.isArray(meta.roles) ? meta.roles : [],
            keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
            body: m[2].trim(),
        };
    }

    private routeMatchesPage(page: string, route: string): boolean {
        const normalizePage = (value: string) => {
            const pathname = (value || '').split(/[?#]/, 1)[0].replace(/\/+$/, '');
            return pathname || '/';
        };
        const current = normalizePage(page);
        const target = normalizePage(route);
        // The dashboard root is a destination, not a parent category. Treating
        // `/admin` as a prefix makes every page look like dashboard context and
        // lets generic home articles displace exact keyword matches.
        if (target === '/admin') return current === target;
        return current === target || current.startsWith(`${target}/`);
    }

    /** Top-N role-authorized articles, with the authenticated current page as a relevance boost. */
    private searchKb(
        query: string,
        locale: string,
        page: string,
        userRole: string,
        topN = 3,
    ): KbArticle[] {
        const articles = this.loadKb(locale)
            .filter((article) => article.roles.includes(userRole));
        if (articles.length === 0) return [];

        const words = this.normalize(query)
            .split(/[^a-z0-9]+/)
            .filter(w => w.length >= 2 && !CopilotService.KB_STOPWORDS.has(w));
        if (words.length === 0 && !page) return [];

        const semanticMatches = articles.map(a => {
            const nKeywords = a.keywords.map(k => this.normalize(k));
            const nTitle = this.normalize(a.title);
            const nBody = this.normalize(a.body);
            let score = 0;
            for (const w of words) {
                if (nKeywords.some(k => k === w)) score += 6;
                else if (nKeywords.some(k => k.includes(w) || w.includes(k))) score += 4;
                if (nTitle.includes(w)) score += 3;
                if (nBody.includes(w)) score += 1;
            }
            return {
                a,
                semanticScore: score,
                pageMatches: a.routes.some((route) => this.routeMatchesPage(page, route)),
            };
        });

        const hasSemanticMatch = semanticMatches.some(({ semanticScore }) => semanticScore > 0);
        const scored = semanticMatches.map(({ a, semanticScore, pageMatches }) => ({
            a,
            // Page context breaks ties between relevant articles. It is also a
            // useful fallback for generic "help" queries, but must not displace
            // a real semantic match such as "MCP" from the dashboard root.
            score: semanticScore + (pageMatches && (semanticScore > 0 || !hasSemanticMatch) ? 8 : 0),
        }));

        return scored
            .filter(x => x.score > 0)
            .sort((x, y) => y.score - x.score)
            .slice(0, topN)
            .map(x => x.a);
    }

    private async buildVerticalContext(tenantId: string): Promise<string> {
        try {
            const config = await this.verticals.getVerticalConfig(tenantId);
            if (!config) return '';
            const effectiveCapabilities = Array.isArray(config.effectiveCapabilities)
                ? config.effectiveCapabilities.filter((capability) => typeof capability === 'string')
                : [];
            const context = {
                industry: config.industry,
                subType: config.subType || null,
                effectiveCapabilities,
            };
            return `## CONTEXTO VERTICAL EFECTIVO (autoritativo, derivado del tenant autenticado)
${JSON.stringify(context)}
REGLA VERTICAL: orienta la respuesta hacia esta industria y subtipo. Solo presentes como disponibles las capacidades incluidas en effectiveCapabilities; una lista vacía es fail-closed y no autoriza inferir funciones verticales.`;
        } catch (error: any) {
            this.logger.warn(`buildVerticalContext failed: ${error.message}`);
            return '';
        }
    }

    private safeAdminHref(value: unknown): string | null {
        if (typeof value !== 'string'
            || !(value === '/admin' || value.startsWith('/admin/'))
            || value.startsWith('//')
            || value.includes('..')) return null;
        return value.slice(0, 512);
    }

    // ─── Channels, evidence and guided tours (bounded, server-derived) ──────

    /** Roles that may see tenant-wide configuration context. Agents get none. */
    private static readonly TENANT_CONTEXT_ROLES = ['super_admin', 'tenant_admin', 'tenant_supervisor'];

    /** Focus params the dashboard reads to explain why the user landed there. */
    private static readonly QUALITY_FOCUS_SIGNAL_PARAM = 'qa';
    private static readonly QUALITY_FOCUS_AGENT_PARAM = 'qagent';

    private static readonly UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    /** Evidence is bounded on purpose: codes and counts, never free text. */
    private static readonly EVIDENCE_KEY_PATTERN = /^[a-z0-9_]{1,40}$/i;
    private static readonly EVIDENCE_VALUE_PATTERN = /^[a-z0-9_,:.-]{1,80}$/i;
    private static readonly MAX_EVIDENCE_KEYS = 8;
    private static readonly MAX_CHAT_ACTIONS = 3;

    /** One line per tour, shown to the model so it can offer the right one. */
    private static readonly GUIDED_TOUR_DESCRIPTIONS: Record<GuidedTourId, string> = {
        connect_channel: 'dónde conectar, revisar o reautorizar un canal',
        assign_agent_channel: 'dónde elegir qué canales atiende un agente',
        agent_handoff_rules: 'dónde configurar reglas de comportamiento, motivos de escalamiento y mensaje de respaldo',
        human_handoff_route: 'dónde invitar personas que reciban las conversaciones escaladas',
        business_identity: 'dónde completar los datos del negocio que usa el agente',
        knowledge_base: 'dónde cargar documentos y preguntas frecuentes de la base de conocimiento',
        appointments_setup: 'dónde definir servicios y disponibilidad para agendar citas',
        business_hours: 'dónde configurar el horario de atención',
        run_agent_tests: 'dónde probar el agente antes de publicarlo',
        agent_quality_center: 'dónde ver el estado de calidad del agente y su acción prioritaria',
        home_first_steps: 'dónde están los primeros pasos de la cuenta',
        first_channel_whatsapp: 'dónde conectar el primer número de WhatsApp',
        resume_setup_wizard: 'dónde retomar la configuración inicial pendiente',
        help_system: 'dónde están las ayudas en pantalla y este asistente',
        inbox_first_conversation: 'dónde se atienden las conversaciones en el inbox',
    };

    /** Short, safe token (channel type, health state). Anything else is dropped. */
    private boundedToken(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        return /^[a-z0-9_.-]{1,40}$/i.test(trimmed) ? trimmed : null;
    }

    /**
     * Keep only bounded primitives from a check's evidence. Long strings,
     * arrays, objects and nulls are dropped, so transcripts, prompts, labels
     * and conversation ids can never reach the model through this path.
     */
    private sanitizeEvidence(evidence: unknown): Record<string, string | number | boolean> | null {
        if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
        const safe: Record<string, string | number | boolean> = {};
        let kept = 0;
        for (const [key, value] of Object.entries(evidence as Record<string, unknown>)) {
            if (kept >= CopilotService.MAX_EVIDENCE_KEYS) break;
            if (!CopilotService.EVIDENCE_KEY_PATTERN.test(key)) continue;
            if (typeof value === 'number') {
                if (!Number.isFinite(value)) continue;
                safe[key] = value;
            } else if (typeof value === 'boolean') {
                safe[key] = value;
            } else if (typeof value === 'string') {
                if (!CopilotService.EVIDENCE_VALUE_PATTERN.test(value)) continue;
                safe[key] = value;
            } else {
                continue;
            }
            kept++;
        }
        return kept > 0 ? safe : null;
    }

    /** Evidence of the preparation check behind a blocker or `fix_<check>` code. */
    private checkEvidenceForCode(overview: any, code: unknown): Record<string, string | number | boolean> | null {
        if (typeof code !== 'string' || !code) return null;
        const checkCode = code.startsWith('fix_') ? code.slice(4) : code;
        const dimensions = Array.isArray(overview?.preparation?.dimensions) ? overview.preparation.dimensions : [];
        for (const dimension of dimensions) {
            const checks = Array.isArray(dimension?.checks) ? dimension.checks : [];
            for (const check of checks) {
                if (check?.code === checkCode) return this.sanitizeEvidence(check.evidence);
            }
        }
        return null;
    }

    /**
     * The authoritative list of what this tenant actually has connected. Without
     * it the model reads a `channel_connection` blocker as "there are no
     * channels" and tells the owner something false while WhatsApp is running.
     */
    private async buildChannelContext(tenantId: string, userRole: string): Promise<string> {
        if (!CopilotService.TENANT_CONTEXT_ROLES.includes(userRole)) return '';
        const provider = this.agentQuality as unknown as Partial<TenantChannelSnapshotProvider> | null;
        if (typeof provider?.getTenantChannelSnapshot !== 'function') return '';
        try {
            const snapshot = await provider.getTenantChannelSnapshot(tenantId);
            const rawChannels = Array.isArray(snapshot?.channels) ? snapshot.channels : [];
            const channels = rawChannels
                .map((channel: any) => ({
                    type: this.boundedToken(channel?.type),
                    accounts: Number.isFinite(Number(channel?.accounts)) ? Math.max(0, Math.trunc(Number(channel.accounts))) : 0,
                    health: this.boundedToken(channel?.health) || 'unknown',
                }))
                .filter((channel) => !!channel.type)
                .slice(0, 20);
            const total = Number.isFinite(Number(snapshot?.total))
                ? Math.max(0, Math.trunc(Number(snapshot.total)))
                : channels.length;
            return `## CANALES CONECTADOS (autoritativo, derivado del tenant autenticado)
${JSON.stringify({ total, channels })}
REGLA DE CANALES: esta lista es la ÚNICA fuente sobre qué canales están conectados. Si no está vacía, NUNCA afirmes que no hay canales conectados; nombra los tipos conectados. Una señal de calidad sobre canales significa que UNA asignación del agente no está conectada, que un vínculo por cuenta quedó obsoleto o que una credencial requiere reautorizar; no significa que el negocio no tenga canales. Si la lista está vacía, indícalo y guía a Administración → Canales.`;
        } catch (error: any) {
            this.logger.warn(`buildChannelContext failed: ${error?.message || error}`);
            return '';
        }
    }

    /** Catalog of tours the model may offer this turn, plus the marker rule. */
    private buildGuidedTourContext(tours: GuidedTourDefinition[]): string {
        if (tours.length === 0) return '';
        const lines = tours
            .map((tour) => `- ${tour.id} — ${CopilotService.GUIDED_TOUR_DESCRIPTIONS[tour.id]}`)
            .join('\n');
        return `## RECORRIDOS GUIADOS DISPONIBLES (el botón "Mostrarme dónde" abre la pantalla y resalta paso a paso; no modifica nada)
${lines}
REGLA DE RECORRIDOS: cuando el usuario pregunte DÓNDE o CÓMO hacer algo que cubre un recorrido de esta lista, termina tu respuesta con una línea exacta [[tour:ID]] (un solo marcador, ID de esta lista). No lo uses para preguntas conceptuales ni para recorridos que no estén en la lista.`;
    }

    /** At most one tour action per reply; the href always comes from the registry. */
    private addGuidedTourAction(actions: CopilotChatAction[], tourId: GuidedTourId | null): void {
        if (!tourId) return;
        if (actions.some((action) => action.code === 'start_guided_tour')) return;
        const tour = getGuidedTour(tourId);
        if (!tour) return;
        actions.push({ code: 'start_guided_tour', labelKey: 'showMe', href: tour.route, tourId: tour.id });
    }

    /** Focus params so the destination screen can say why the user is there. */
    private withQualityFocus(href: string, focus: { signalId?: string; agentId?: string }): string {
        const signalId = focus.signalId || '';
        const agentId = focus.agentId || '';
        if (!CopilotService.UUID_PATTERN.test(signalId) || !CopilotService.UUID_PATTERN.test(agentId)) return href;
        const separator = href.includes('?') ? '&' : '?';
        const next = `${href}${separator}`
            + `${CopilotService.QUALITY_FOCUS_SIGNAL_PARAM}=${encodeURIComponent(signalId)}`
            + `&${CopilotService.QUALITY_FOCUS_AGENT_PARAM}=${encodeURIComponent(agentId)}`;
        if (next.length > 512) return href;
        return this.safeAdminHref(next) || href;
    }

    /** Bounded, server-derived quality context. It intentionally excludes
     * transcripts, judge text, prompts, issue labels and conversation IDs. */
    private async buildAgentQualityContext(
        tenantId: string,
        target: CopilotQualityTarget | undefined,
        userRole: string,
    ): Promise<{ prompt: string; actions: CopilotChatAction[] }> {
        if (!target || !['super_admin', 'tenant_admin', 'tenant_supervisor'].includes(userRole)) {
            return { prompt: '', actions: [] };
        }
        if (!this.agentQuality) return { prompt: '', actions: [] };

        const overview = await this.agentQuality.getOverview(tenantId, target.agentId);
        let requestedSignal = null;
        if (target.signalId && this.qualitySignals) {
            try {
                requestedSignal = await this.qualitySignals.getSignalForAssistant(
                    tenantId,
                    target.signalId,
                    target.agentId,
                );
            } catch (error: any) {
                // A signal can be resolved or superseded between rendering the
                // dashboard and opening Assist. The current overview remains
                // authoritative; never turn that normal race into a broken chat.
                this.logger.debug(`Quality signal is no longer active: ${error?.message || error}`);
            }
        }
        const canOpenRepairActions = userRole === 'tenant_admin' || userRole === 'super_admin';
        const criticalBlockers = overview.preparation.criticalBlockers.slice(0, 10);
        // Codes alone made the model invent the cause ("no tenés canales").
        // Bounded evidence lets it say what is actually failing, and nothing else.
        const criticalBlockerEvidence: Record<string, Record<string, string | number | boolean>> = {};
        for (const blocker of criticalBlockers) {
            const evidence = this.checkEvidenceForCode(overview, blocker);
            if (evidence) criticalBlockerEvidence[blocker] = evidence;
        }
        const recommendations = overview.recommendations.slice(0, 5).map((item) => ({
            code: item.code,
            pillar: item.pillar,
            dimension: item.dimension,
            severity: item.severity,
            href: canOpenRepairActions ? this.safeAdminHref(item.href) : null,
            evidenceCount: typeof item.evidenceCount === 'number' ? item.evidenceCount : null,
        }));
        const qualityContext = {
            // Agent names are tenant-controlled free text. Keep them in the UI,
            // but never place them in the system prompt where they could act as
            // instructions. The authenticated target is represented by version.
            agent: { version: overview.agent.version },
            status: overview.status,
            nextMilestone: overview.nextMilestone,
            preparation: {
                status: overview.preparation.status,
                criticalBlockers,
                criticalBlockerEvidence,
            },
            tested: { status: overview.tested.status, stale: overview.tested.stale },
            production: {
                status: overview.production.status,
                sampleSize: overview.production.sampleSize,
                minimumSample: overview.production.minimumSample,
            },
            selectedSignal: requestedSignal ? {
                code: requestedSignal.code,
                severity: requestedSignal.severity,
                pillar: requestedSignal.pillar,
                dimension: requestedSignal.dimension,
                evidenceCount: requestedSignal.evidenceCount,
                evidence: this.checkEvidenceForCode(overview, requestedSignal.code),
                href: canOpenRepairActions ? this.safeAdminHref(requestedSignal.href) : null,
            } : null,
            recommendations,
            generatedAt: overview.generatedAt,
        };
        const centerHref = `/admin/agent/quality?agent=${encodeURIComponent(overview.agent.id)}`;
        const preferredHref = canOpenRepairActions
            ? this.safeAdminHref(requestedSignal?.href) || recommendations.find((item) => item.href)?.href || centerHref
            : centerHref;
        const actions: CopilotChatAction[] = [
            {
                code: 'open_quality_center',
                labelKey: 'openCenter',
                href: centerHref,
            },
        ];
        if (preferredHref && preferredHref !== actions[0].href) {
            const focusedHref = this.withQualityFocus(preferredHref, {
                signalId: requestedSignal?.id || target.signalId,
                agentId: requestedSignal?.agent?.id || overview.agent.id || target.agentId,
            });
            actions.unshift({ code: 'open_quality_action', labelKey: 'resolvePriority', href: focusedHref });
        }
        // "Mostrarme dónde" for the very thing being explained. The tour only
        // opens and highlights the screen; the person still makes the change.
        const tour = findGuidedTourForQualityCode(
            requestedSignal?.code ?? recommendations[0]?.code ?? criticalBlockers[0],
        );
        if (tour && canRoleRunGuidedTour(tour, userRole)) this.addGuidedTourAction(actions, tour.id);
        return {
            prompt: `## ESTADO REAL DEL AGENTE (autoritativo, derivado del tenant autenticado)\n${JSON.stringify(qualityContext)}\nREGLA: explica este estado y prioriza una sola acción. No inventes evidencia, puntajes, causas ni enlaces. No afirmes que un cambio fue aplicado.`,
            actions,
        };
    }

    // ─── Conversation Copilot Methods ───────────────────────────────────────

    /**
     * Returns 3 suggested replies based on conversation context.
     */
    async getSuggestions(
        tenantId: string,
        conversationId: string,
        actorId: string,
        actorRole: string,
    ): Promise<SuggestedReply[]> {
        await this.authorizeConversationCopilot(tenantId, conversationId, actorId, actorRole);
        const cacheKey = this.redis.tenantKey(tenantId, `copilot:suggestions:${conversationId}`);
        const cached = await this.redis.getJson<SuggestedReply[]>(cacheKey);
        if (cached) return cached;

        const messages = await this.loadRecentMessages(tenantId, conversationId);
        if (!messages || messages.length === 0) {
            return [{ text: 'No hay suficiente contexto para generar sugerencias.', tone: 'formal' }];
        }

        const chatHistory = this.buildChatMessages(messages);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: chatHistory,
                systemPrompt: `Eres un copiloto de ventas que asiste a agentes humanos de atención al cliente en Latinoamérica.
Basándote en el historial de la conversación, genera exactamente 3 respuestas sugeridas que el agente podría enviar al cliente.

Cada sugerencia debe ser:
- Corta (máximo 2 oraciones)
- Profesional y cálida
- En español latinoamericano
- Relevante al último mensaje del cliente

Responde ÚNICAMENTE con un JSON array con este formato:
[
  { "text": "respuesta 1", "tone": "formal" },
  { "text": "respuesta 2", "tone": "friendly" },
  { "text": "respuesta 3", "tone": "empathetic" }
]

No incluyas explicaciones, solo el JSON.`,
                temperature: 0.7,
                maxTokens: 500,
                tenantId,
            });

            const suggestions = this.parseJsonSafe<SuggestedReply[]>(response.content, [
                { text: 'Gracias por contactarnos. Permítame revisar su caso.', tone: 'formal' },
                { text: '¡Claro! Con gusto le ayudo con eso.', tone: 'friendly' },
                { text: 'Entiendo su situación. Vamos a resolverlo juntos.', tone: 'empathetic' },
            ]);

            await this.redis.setJson(cacheKey, suggestions, COPILOT_CACHE_TTL);
            return suggestions;
        } catch (error: any) {
            this.logger.error(`getSuggestions failed: ${error.message}`);
            return [
                { text: 'Gracias por contactarnos. Permítame revisar su caso.', tone: 'formal' },
                { text: '¡Claro! Con gusto le ayudo con eso.', tone: 'friendly' },
                { text: 'Entiendo su situación. Vamos a resolverlo juntos.', tone: 'empathetic' },
            ];
        }
    }

    /**
     * Returns a concise summary of the conversation so far.
     */
    async getSummary(
        tenantId: string,
        conversationId: string,
        actorId: string,
        actorRole: string,
    ): Promise<ConversationSummary> {
        await this.authorizeConversationCopilot(tenantId, conversationId, actorId, actorRole);
        const cacheKey = this.redis.tenantKey(tenantId, `copilot:summary:${conversationId}`);
        const cached = await this.redis.getJson<ConversationSummary>(cacheKey);
        if (cached) return cached;

        const messages = await this.loadRecentMessages(tenantId, conversationId);
        if (!messages || messages.length === 0) {
            return {
                summary: 'No hay mensajes en esta conversación.',
                customerIntent: 'desconocido',
                keyInfoShared: [],
                pendingQuestions: [],
            };
        }

        const chatHistory = this.buildChatMessages(messages);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: chatHistory,
                systemPrompt: `Eres un copiloto de ventas que analiza conversaciones para agentes humanos.
Analiza el historial de la conversación y genera un resumen conciso.

Responde ÚNICAMENTE con un JSON con este formato:
{
  "summary": "Resumen breve de la conversación en 1-2 oraciones",
  "customerIntent": "Qué busca o necesita el cliente",
  "keyInfoShared": ["dato clave 1", "dato clave 2"],
  "pendingQuestions": ["pregunta sin resolver 1", "pregunta sin resolver 2"]
}

Usa español latinoamericano. No incluyas explicaciones, solo el JSON.`,
                temperature: 0.3,
                maxTokens: 500,
                tenantId,
            });

            const summary = this.parseJsonSafe<ConversationSummary>(response.content, {
                summary: 'No se pudo generar el resumen.',
                customerIntent: 'desconocido',
                keyInfoShared: [],
                pendingQuestions: [],
            });

            await this.redis.setJson(cacheKey, summary, COPILOT_CACHE_TTL);
            return summary;
        } catch (error: any) {
            this.logger.error(`getSummary failed: ${error.message}`);
            return {
                summary: 'Error al generar el resumen.',
                customerIntent: 'desconocido',
                keyInfoShared: [],
                pendingQuestions: [],
            };
        }
    }

    /**
     * Analyzes the last few messages and returns intent analysis.
     */
    async detectIntent(
        tenantId: string,
        conversationId: string,
        actorId: string,
        actorRole: string,
    ): Promise<IntentAnalysis> {
        await this.authorizeConversationCopilot(tenantId, conversationId, actorId, actorRole);
        const cacheKey = this.redis.tenantKey(tenantId, `copilot:intent:${conversationId}`);
        const cached = await this.redis.getJson<IntentAnalysis>(cacheKey);
        if (cached) return cached;

        const messages = await this.loadRecentMessages(tenantId, conversationId);
        if (!messages || messages.length === 0) {
            return {
                primaryIntent: 'unknown',
                confidence: 0,
                recommendedAction: 'Esperar más contexto del cliente.',
            };
        }

        const chatHistory = this.buildChatMessages(messages);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: chatHistory,
                systemPrompt: `Eres un analizador de intención de clientes para un equipo de ventas en Latinoamérica.
Analiza los últimos mensajes de la conversación y determina la intención del cliente.

Intenciones posibles:
- "product_inquiry" — Pregunta sobre productos o servicios
- "complaint" — Queja o reclamo
- "purchase_intent" — Intención de compra
- "support" — Solicitud de soporte técnico
- "pricing" — Consulta de precios
- "scheduling" — Agendar cita o reunión
- "follow_up" — Seguimiento de caso anterior
- "general_info" — Información general

Responde ÚNICAMENTE con un JSON con este formato:
{
  "primaryIntent": "una_de_las_intenciones_anteriores",
  "confidence": 0.85,
  "recommendedAction": "Acción recomendada para el agente en español"
}

El campo confidence debe ser un número entre 0 y 1. No incluyas explicaciones, solo el JSON.`,
                temperature: 0.2,
                maxTokens: 300,
                tenantId,
            });

            const intent = this.parseJsonSafe<IntentAnalysis>(response.content, {
                primaryIntent: 'unknown',
                confidence: 0,
                recommendedAction: 'No se pudo determinar la intención.',
            });

            // Clamp confidence to 0-1
            intent.confidence = Math.max(0, Math.min(1, intent.confidence));

            await this.redis.setJson(cacheKey, intent, COPILOT_CACHE_TTL);
            return intent;
        } catch (error: any) {
            this.logger.error(`detectIntent failed: ${error.message}`);
            return {
                primaryIntent: 'unknown',
                confidence: 0,
                recommendedAction: 'Error al analizar la intención.',
            };
        }
    }

    /**
     * Agent asks a question about the conversation/product. Uses RAG knowledge base + conversation context.
     */
    async getContextualHelp(
        tenantId: string,
        conversationId: string,
        agentQuery: string,
        actorId: string,
        actorRole: string,
    ): Promise<ContextualAnswer> {
        await this.authorizeConversationCopilot(tenantId, conversationId, actorId, actorRole);
        const messages = await this.loadRecentMessages(tenantId, conversationId);
        const conversationContext = messages
            ? messages.map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${m.content_text}`).join('\n')
            : '(Sin contexto de conversación)';

        // Search knowledge base for relevant info
        let knowledgeContext = '';
        const sources: string[] = [];
        try {
            const results = await this.knowledgeService.searchRelevant(tenantId, agentQuery, 3);
            if (results && results.length > 0) {
                knowledgeContext = results
                    .map((r: any) => r.chunk_text)
                    .join('\n---\n');
                sources.push(
                    ...results.map((r: any) => r.document_title).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i),
                );
            }
        } catch (error: any) {
            this.logger.warn(`Knowledge search failed: ${error.message}`);
        }

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: agentQuery }],
                tenantId,
                systemPrompt: `Eres un copiloto inteligente que ayuda a agentes de ventas y soporte en Latinoamérica.
El agente te hace una pregunta mientras atiende a un cliente. Responde de forma útil y concisa.

## Contexto de la conversación actual:
${conversationContext}

${knowledgeContext ? `## Información de la base de conocimiento:\n${knowledgeContext}` : '## No hay información relevante en la base de conocimiento.'}

Reglas:
- Responde en español latinoamericano
- Sé conciso y directo (máximo 3-4 oraciones)
- Si no tienes suficiente información, indícalo honestamente
- Prioriza la información de la base de conocimiento cuando esté disponible`,
                temperature: 0.4,
                maxTokens: 500,
            });

            return {
                answer: response.content || 'No pude generar una respuesta.',
                sources,
            };
        } catch (error: any) {
            this.logger.error(`getContextualHelp failed: ${error.message}`);
            return {
                answer: 'Error al procesar tu consulta. Intenta reformularla.',
                sources: [],
            };
        }
    }

    /**
     * Rewrites an agent's draft reply in a given tone, preserving meaning and language.
     * Tones: professional | friendly | empathetic | shorter | expand | fix_grammar
     */
    async rewriteReply(
        tenantId: string,
        draft: string,
        tone: string,
        conversationId: string,
        actorId: string,
        actorRole: string,
    ): Promise<{ text: string }> {
        await this.authorizeConversationCopilot(tenantId, conversationId, actorId, actorRole);
        if (!draft || !draft.trim()) {
            return { text: '' };
        }

        const toneInstructions: Record<string, string> = {
            professional: 'Reescribe el texto en un tono profesional y cortés.',
            friendly: 'Reescribe el texto en un tono cálido, cercano y amigable.',
            empathetic: 'Reescribe el texto mostrando empatía y comprensión hacia el cliente.',
            shorter: 'Haz el texto más corto y directo, conservando el mensaje esencial.',
            expand: 'Expande ligeramente el texto con un poco más de detalle y cordialidad, sin volverlo largo.',
            fix_grammar: 'Corrige ortografía, gramática y puntuación sin cambiar el significado ni el tono.',
        };
        const instruction = toneInstructions[tone] || toneInstructions['professional'];

        // Optional conversation context (only to inform tone, never to invent content).
        let contextBlock = '';
        if (conversationId) {
            try {
                const messages = await this.loadRecentMessages(tenantId, conversationId);
                if (messages && messages.length) {
                    const ctx = messages
                        .slice(-6)
                        .map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${m.content_text}`)
                        .join('\n');
                    contextBlock = `\n\n## Contexto reciente (solo referencia, no copiar):\n${ctx}`;
                }
            } catch {
                // best-effort; context is optional
            }
        }

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: draft }],
                systemPrompt: `Eres un asistente de redacción para agentes de atención al cliente y ventas.
${instruction}

Reglas estrictas:
- Mantén EXACTAMENTE el mismo idioma del texto original.
- Conserva el significado y la intención del mensaje.
- No inventes datos, precios, fechas ni compromisos que no estén en el texto original.
- Devuelve ÚNICAMENTE el texto reescrito: sin comillas, sin explicaciones, sin prefijos.${contextBlock}`,
                temperature: 0.4,
                maxTokens: 400,
                tenantId,
            });

            const text = (response.content || '').trim();
            return { text: text || draft };
        } catch (error: any) {
            this.logger.error(`rewriteReply failed: ${error.message}`);
            return { text: draft };
        }
    }

    /**
     * Invalidate all copilot caches for a conversation (call on new message).
     */
    async invalidateCache(tenantId: string, conversationId: string): Promise<void> {
        const keys = [
            this.redis.tenantKey(tenantId, `copilot:suggestions:${conversationId}`),
            this.redis.tenantKey(tenantId, `copilot:summary:${conversationId}`),
            this.redis.tenantKey(tenantId, `copilot:intent:${conversationId}`),
        ];
        for (const key of keys) {
            await this.redis.del(key);
        }
    }

    // ─── Platform Copilot Chat (existing) ───────────────────────────────────

    async chat(request: CopilotChatRequest): Promise<CopilotChatResponse> {
        const tenantId = request.context.tenantId;
        const locale = (request.context.locale || 'es').slice(0, 2).toLowerCase();
        const articles = this.searchKb(
            request.message,
            locale,
            request.context.page,
            request.context.userRole,
        );

        // Each retrieved article is injected with its navigation metadata so the
        // assistant can give exact menu paths and role requirements.
        const kbContext = articles.length > 0
            ? articles.map(a => {
                const roles = a.roles.length ? ` | Requiere rol: ${a.roles.join(' o ')}` : '';
                const routes = a.routes.length ? ` | Ruta en el panel: ${a.routes.join(' , ')}` : '';
                return `### Artículo: ${a.title}${routes}${roles}\n${a.body}`;
            }).join('\n\n---\n\n')
            : '(No se encontró información relevante en la base de conocimiento para esta consulta.)';

        const langNames: Record<string, string> = { es: 'español latinoamericano', en: 'English', pt: 'português brasileiro', fr: 'français' };
        const replyLang = langNames[locale] || langNames.es;

        // Tours the authenticated role may run for the retrieved topics. This is
        // also the allowlist that bounds any marker the model emits.
        const availableTours = guidedToursForArticles(
            articles.map((article) => article.id),
            request.context.userRole,
        );
        const guidedTourContext = this.buildGuidedTourContext(availableTours);

        // The user's live plan + per-plan capability matrix, so "can I do X on my
        // plan?" is answered accurately and personally.
        const [planContext, verticalContext, channelContext, qualityContext] = await Promise.all([
            request.context.userRole === 'tenant_admin'
                ? this.buildPlanContext(tenantId)
                : Promise.resolve(''),
            this.buildVerticalContext(tenantId),
            this.buildChannelContext(tenantId, request.context.userRole),
            this.buildAgentQualityContext(tenantId, request.target, request.context.userRole).catch((error: any) => {
                this.logger.warn(`Agent quality context unavailable: ${error?.message || error}`);
                if (!request.target) return { prompt: '', actions: [] };
                const href = `/admin/agent/quality?agent=${encodeURIComponent(request.target.agentId)}`;
                return {
                    prompt: '## ESTADO REAL DEL AGENTE\nEl análisis de calidad no está disponible en este momento. No infieras su estado ni sus causas; indica que se debe reintentar desde el Centro de calidad.',
                    actions: [{ code: 'open_quality_center' as const, labelKey: 'openCenter' as const, href }],
                };
            }),
        ]);

        const systemPrompt = `Eres **Parallly Assist**, el asistente oficial de ayuda de la plataforma Parallly.
Tu única misión: ayudar a los usuarios (administradores, supervisores y agentes de negocio) a entender, configurar y usar las funcionalidades de la plataforma.

## BASE DE CONOCIMIENTO (única fuente de verdad sobre la plataforma):
${kbContext}
${planContext ? '\n' + planContext + '\n' : ''}
${verticalContext ? '\n' + verticalContext + '\n' : ''}
${channelContext ? '\n' + channelContext + '\n' : ''}
${qualityContext.prompt ? '\n' + qualityContext.prompt + '\n' : ''}
${guidedTourContext ? '\n' + guidedTourContext + '\n' : ''}

## REGLAS CRÍTICAS:
1. **RESPONDE SOLO DESDE LA BASE DE CONOCIMIENTO.** Toda afirmación sobre la plataforma (menús, funciones, límites, precios, pasos) debe salir de los artículos de arriba. Si la información no está ahí, dilo con honestidad: "No tengo esa información con certeza" y sugiere escribir a soporte (https://parallly-chat.cloud/support). NUNCA inventes menús, funciones, precios ni límites.
2. **SOLO NIVEL FUNCIONAL.** Explicas cómo usar la plataforma: pantallas, menús, campos, configuraciones y flujos. NUNCA hables de tecnologías, código, bases de datos, servidores, infraestructura ni de cómo está construida la plataforma. Si te lo preguntan, responde exactamente con la idea: "Soy el asistente de ayuda de Parallly y te acompaño en el uso de la plataforma. Sobre temas técnicos internos no tengo información. ¿Te ayudo con alguna configuración o funcionalidad?" (adaptada al idioma del usuario).
3. **IDIOMA:** responde SIEMPRE en ${replyLang}, con tono cálido, servicial y profesional. Aunque el artículo esté en otro idioma, tu respuesta va en ${replyLang}.
4. **NAVEGACIÓN EXACTA:** cuando guíes al usuario, usa las rutas de menú tal como aparecen en los artículos (sección y nombre del ítem). Formato paso a paso con listas numeradas.
5. **ROLES:** si la acción requiere un rol que el usuario no tiene (ver "Requiere rol" del artículo y el rol del usuario abajo), acláralo amablemente ("esto lo configura un administrador de la cuenta").
6. **FORMATO:** Markdown limpio: pasos numerados, viñetas, **negritas** para nombres de menús y botones. Respuestas concisas; máximo ~10 líneas salvo que pidan detalle.
7. **CONSCIENCIA DE PLAN:** si hay un bloque "PLAN DEL USUARIO", úsalo para responder con precisión qué puede o no hacer el usuario según SU plan; para límites/disponibilidad por plan, ese bloque manda sobre cualquier cifra de los artículos. Si algo no está en su plan, indícalo y menciona desde qué plan se obtiene. Si NO hay bloque de plan, no reveles ni infieras el plan, las cuotas o la facturación del tenant; indica que esa información corresponde al administrador.
8. **CONTEXTO VERTICAL:** si existe el bloque de contexto vertical, úsalo para priorizar ejemplos relevantes. No anuncies herramientas o flujos verticales que no aparezcan en effectiveCapabilities.
9. **CALIDAD DEL AGENTE:** si existe el bloque de estado real, ese bloque manda sobre explicaciones genéricas de la KB. Explica evidencia y prioridad sin revelar identificadores internos, transcripciones ni texto de clientes. Los cambios siempre requieren revisión humana.
10. **RECORRIDOS:** cuando exista un recorrido guiado para lo que pide el usuario, prefiere ofrecerlo antes que describir menús largos. El recorrido no cambia ninguna configuración por sí mismo: abre la pantalla y muestra dónde; la persona hace el cambio.

## Contexto de la consulta:
- Rol autenticado: ${request.context.userRole}
- Página actual del panel: ${request.context.page}`;

        const messages = [
            ...request.history.slice(-10).map(m => ({
                role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: m.content
            })),
            { role: 'user' as const, content: request.message }
        ];

        try {
            const response = await this.llmRouter.execute({
                task: 'conversation',
                messages,
                systemPrompt,
                tenantId,
                // Low temperature: this is a support assistant — accuracy over creativity.
                temperature: 0.4,
                maxTokens: 800,
            });

            this.logger.log(
                `Copilot reply for user "${request.context.userName}" on ${request.context.page} ` +
                `via ${response.routingDecision?.selectedModel?.id || 'default'}`
            );

            // Always strip markers, even with no tours available: an invented
            // marker must never reach the user as literal text, and only an
            // allowlisted id can turn into an action.
            const { text, tourId } = extractGuidedTourMarker(
                response.content || this.getFallbackResponse(locale),
                availableTours,
            );
            const actions = [...qualityContext.actions];
            this.addGuidedTourAction(actions, tourId);

            return {
                reply: text || this.getFallbackResponse(locale),
                model: response.routingDecision?.selectedModel?.id,
                tokensUsed: response.usage?.totalTokens,
                actions: actions.slice(0, CopilotService.MAX_CHAT_ACTIONS),
            };
        } catch (error: any) {
            this.logger.error('Copilot chat error, returning fallback:', error);
            return {
                reply: this.getFallbackResponse(locale),
                actions: qualityContext.actions.slice(0, CopilotService.MAX_CHAT_ACTIONS),
            };
        }
    }

    // ─── Private Helpers ────────────────────────────────────────────────────

    private async loadRecentMessages(tenantId: string, conversationId: string): Promise<any[] | null> {
        const schemaName = await this.tenantSchema(tenantId);

        try {
            const messages = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, content_text, content_type, direction, created_at, metadata
                 FROM messages
                 WHERE conversation_id = $1::uuid
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [conversationId],
            );
            return messages && messages.length > 0 ? messages.reverse() : null;
        } catch (error: any) {
            this.logger.error(`Failed to load messages for ${conversationId}: ${error.message}`);
            return null;
        }
    }

    private async authorizeConversationCopilot(
        tenantId: string,
        conversationId: string,
        actorId: string,
        actorRole: string,
    ): Promise<void> {
        if (!['tenant_admin', 'tenant_supervisor', 'tenant_agent'].includes(actorRole)) {
            throw new ForbiddenException('Role cannot use conversation Copilot');
        }
        const schemaName = await this.tenantSchema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<Array<{ assigned_to: string | null }>>(
            schemaName,
            `SELECT assigned_to FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );
        if (!rows?.length) throw new NotFoundException('Conversation not found');
        if (
            actorRole === 'tenant_agent'
            && rows[0].assigned_to !== null
            && rows[0].assigned_to !== actorId
        ) {
            throw new ForbiddenException('Conversation is assigned to another agent');
        }

        // Ownership is checked before consuming a cost/rate-limit bucket so an
        // attacker cannot burn another tenant member's quota with guessed UUIDs.
        await this.rateLimiter.consume(tenantId, actorId);
    }

    private buildChatMessages(messages: any[]): { role: 'user' | 'assistant'; content: string }[] {
        return messages
            .filter((m: any) => m.content_text)
            .map((m: any) => ({
                role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: m.content_text,
            }));
    }

    private parseJsonSafe<T>(raw: string, fallback: T): T {
        try {
            // Try to extract JSON from the response (handles markdown code blocks)
            const jsonMatch = raw.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as T;
            }
            return JSON.parse(raw) as T;
        } catch {
            this.logger.warn(`Failed to parse LLM JSON response, using fallback`);
            return fallback;
        }
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    // ─── Fallback (platform copilot) ────────────────────────────────────────
    // Honest, localized fallback for when the LLM is unavailable. Never invents
    // platform facts (the previous version described a long-gone product era).

    private getFallbackResponse(locale: string): string {
        const fallbacks: Record<string, string> = {
            es: 'En este momento no puedo responder tu consulta por un problema temporal del asistente. Intenta de nuevo en unos minutos o escríbenos en https://parallly-chat.cloud/support — con gusto te ayudamos.',
            en: 'I can\'t answer your question right now due to a temporary issue with the assistant. Please try again in a few minutes or reach us at https://parallly-chat.cloud/support — we\'ll be happy to help.',
            pt: 'No momento não consigo responder à sua pergunta por um problema temporário do assistente. Tente novamente em alguns minutos ou fale conosco em https://parallly-chat.cloud/support — teremos prazer em ajudar.',
            fr: 'Je ne peux pas répondre à votre question pour le moment en raison d\'un problème temporaire de l\'assistant. Réessayez dans quelques minutes ou contactez-nous sur https://parallly-chat.cloud/support — nous serons ravis de vous aider.',
        };
        return fallbacks[locale] || fallbacks.es;
    }
}
