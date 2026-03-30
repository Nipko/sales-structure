import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

// ============================================
// Interfaces
// ============================================

export interface ScoringFactors {
    engagement: number;          // 0-100: message count, response rate, session length
    intent: number;              // 0-100: purchase signals in messages
    recency: number;             // 0-100: how recent the last interaction
    stageProgress: number;       // 0-100: how far in the pipeline
    profileCompleteness: number; // 0-100: name, email, phone filled
}

export interface ScoringResult {
    score: number;           // 1-10 final score
    factors: ScoringFactors;
    label: 'cold' | 'warm' | 'hot' | 'ready';
    recommendation: string;  // Spanish recommendation
}

// ============================================
// Constants
// ============================================

const WEIGHTS = {
    engagement: 0.25,
    intent: 0.30,
    recency: 0.20,
    stageProgress: 0.15,
    profileCompleteness: 0.10,
};

const PURCHASE_KEYWORDS = [
    'precio', 'costo', 'comprar', 'reservar', 'disponible',
    'cuánto vale', 'cuanto vale', 'quiero', 'inscribir',
    'matricular', 'pagar', 'descuento', 'promoción', 'promocion',
    'oferta', 'financiación', 'financiacion', 'cuotas',
];

const STAGE_SCORES: Record<string, number> = {
    nuevo: 10,
    contactado: 20,
    respondio: 35,
    calificado: 50,
    tibio: 60,
    caliente: 80,
    listo_cierre: 95,
    ganado: 100,
    perdido: 0,
    no_interesado: 0,
};

const CACHE_TTL_SECONDS = 300; // 5 minutes

// ============================================
// Service
// ============================================

@Injectable()
export class LeadScoringService {
    private readonly logger = new Logger(LeadScoringService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private eventEmitter: EventEmitter2,
    ) {}

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * Calculate full scoring result for a lead (uses cache).
     */
    async calculateScore(tenantId: string, leadId: string): Promise<ScoringResult> {
        const cacheKey = this.redis.tenantKey(tenantId, `lead_score:${leadId}`);
        const cached = await this.redis.getJson<ScoringResult>(cacheKey);
        if (cached) return cached;

        const schema = await this.getTenantSchema(tenantId);
        if (!schema) {
            return this.defaultResult();
        }

        const factors = await this.computeFactors(schema, leadId);
        const result = this.buildResult(factors);

        // Cache result
        await this.redis.setJson(cacheKey, result, CACHE_TTL_SECONDS);

        return result;
    }

    /**
     * Calculate score, persist to DB, and update associated opportunity.
     */
    async updateLeadScore(tenantId: string, leadId: string): Promise<ScoringResult> {
        // Bypass cache for a fresh calculation
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return this.defaultResult();

        const factors = await this.computeFactors(schema, leadId);
        const result = this.buildResult(factors);

        // Persist score and scoring metadata on the lead
        const scoringJson = JSON.stringify({
            factors: result.factors,
            label: result.label,
            recommendation: result.recommendation,
            calculatedAt: new Date().toISOString(),
        });

        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE leads
             SET score = $1,
                 metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{scoring}', $2::jsonb),
                 updated_at = NOW()
             WHERE id = $3`,
            [result.score, scoringJson, leadId],
        );

        // Also update the most recent opportunity score
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE opportunities
             SET score = $1, updated_at = NOW()
             WHERE lead_id = $2
             ORDER BY created_at DESC
             LIMIT 1`,
            [result.score, leadId],
        ).catch(() => {
            // Some DBs don't support ORDER BY + LIMIT in UPDATE; use sub-select fallback
            return this.prisma.executeInTenantSchema(
                schema,
                `UPDATE opportunities
                 SET score = $1, updated_at = NOW()
                 WHERE id = (
                     SELECT id FROM opportunities WHERE lead_id = $2 ORDER BY created_at DESC LIMIT 1
                 )`,
                [result.score, leadId],
            );
        });

        // Refresh cache
        const cacheKey = this.redis.tenantKey(tenantId, `lead_score:${leadId}`);
        await this.redis.setJson(cacheKey, result, CACHE_TTL_SECONDS);

        return result;
    }

    /**
     * Called after each message in a conversation.
     * Finds the lead, recalculates, and emits event if score changed.
     */
    async scoreAfterMessage(tenantId: string, conversationId: string): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        // Find the lead associated with this conversation
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT l.id, l.score AS old_score
             FROM leads l
             JOIN opportunities o ON o.lead_id = l.id
             WHERE o.conversation_id = $1
             LIMIT 1`,
            [conversationId],
        );

        if (!rows || rows.length === 0) return;

        const { id: leadId, old_score: oldScore } = rows[0];

        const result = await this.updateLeadScore(tenantId, leadId);

        if (result.score !== (oldScore ?? 0)) {
            this.eventEmitter.emit('lead.score_changed', {
                tenantId,
                leadId,
                conversationId,
                oldScore: oldScore ?? 0,
                newScore: result.score,
                label: result.label,
                factors: result.factors,
            });
            this.logger.log(
                `Lead ${leadId} score changed: ${oldScore ?? 0} -> ${result.score} (${result.label})`,
            );
        }
    }

    // ------------------------------------------------------------------
    // Factor computation (all simple SQL aggregates, no LLM)
    // ------------------------------------------------------------------

    private async computeFactors(schema: string, leadId: string): Promise<ScoringFactors> {
        const [engagement, intent, recency, stageProgress, profileCompleteness] = await Promise.all([
            this.computeEngagement(schema, leadId),
            this.computeIntent(schema, leadId),
            this.computeRecency(schema, leadId),
            this.computeStageProgress(schema, leadId),
            this.computeProfileCompleteness(schema, leadId),
        ]);

        return { engagement, intent, recency, stageProgress, profileCompleteness };
    }

    /**
     * Engagement: message count in last 7 days + response rate
     */
    private async computeEngagement(schema: string, leadId: string): Promise<number> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT
                COUNT(*) FILTER (WHERE m.created_at > NOW() - INTERVAL '7 days') AS msg_count,
                COUNT(*) FILTER (WHERE m.direction = 'inbound' AND m.created_at > NOW() - INTERVAL '7 days') AS inbound_count,
                COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.created_at > NOW() - INTERVAL '7 days') AS outbound_count
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             JOIN contacts ct ON ct.id = c.contact_id
             JOIN leads l ON l.contact_id = ct.id
             WHERE l.id = $1`,
            [leadId],
        );

        if (!rows || rows.length === 0) return 0;

        const { msg_count, inbound_count, outbound_count } = rows[0];
        const total = parseInt(msg_count) || 0;
        const inbound = parseInt(inbound_count) || 0;
        const outbound = parseInt(outbound_count) || 0;

        // Message volume score (0-50): caps at 20 messages
        const volumeScore = Math.min(total / 20, 1) * 50;

        // Response rate score (0-50): ratio of customer replies to AI messages
        const responseRate = outbound > 0 ? Math.min(inbound / outbound, 1) : 0;
        const responseScore = responseRate * 50;

        return Math.round(volumeScore + responseScore);
    }

    /**
     * Intent: scan last 10 messages for purchase keywords
     */
    private async computeIntent(schema: string, leadId: string): Promise<number> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT m.content_text
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             JOIN contacts ct ON ct.id = c.contact_id
             JOIN leads l ON l.contact_id = ct.id
             WHERE l.id = $1 AND m.direction = 'inbound' AND m.content_text IS NOT NULL
             ORDER BY m.created_at DESC
             LIMIT 10`,
            [leadId],
        );

        if (!rows || rows.length === 0) return 0;

        let keywordHits = 0;
        let questionCount = 0;

        for (const row of rows) {
            const text = (row.content_text || '').toLowerCase();
            for (const keyword of PURCHASE_KEYWORDS) {
                if (text.includes(keyword)) {
                    keywordHits++;
                    break; // Count max 1 hit per message
                }
            }
            // Count questions (messages containing '?')
            if (text.includes('?')) {
                questionCount++;
            }
        }

        // Keyword score (0-70): each message with a keyword = 10 points, capped at 70
        const keywordScore = Math.min(keywordHits * 10, 70);

        // Question score (0-30): questions about products indicate interest
        const questionScore = Math.min(questionCount * 10, 30);

        return Math.min(keywordScore + questionScore, 100);
    }

    /**
     * Recency: how recent the last interaction
     */
    private async computeRecency(schema: string, leadId: string): Promise<number> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(m.created_at))) AS seconds_ago
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             JOIN contacts ct ON ct.id = c.contact_id
             JOIN leads l ON l.contact_id = ct.id
             WHERE l.id = $1 AND m.direction = 'inbound'`,
            [leadId],
        );

        if (!rows || rows.length === 0 || rows[0].seconds_ago === null) return 0;

        const secondsAgo = parseFloat(rows[0].seconds_ago);
        const hoursAgo = secondsAgo / 3600;

        if (hoursAgo < 1) return 100;
        if (hoursAgo < 4) return 80;
        if (hoursAgo < 24) return 60;
        if (hoursAgo < 72) return 30;
        return 10;
    }

    /**
     * Stage progress: map pipeline stage to a score
     */
    private async computeStageProgress(schema: string, leadId: string): Promise<number> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT stage FROM leads WHERE id = $1 LIMIT 1`,
            [leadId],
        );

        if (!rows || rows.length === 0) return 0;

        const stage = rows[0].stage || 'nuevo';
        return STAGE_SCORES[stage] ?? 10;
    }

    /**
     * Profile completeness: name, phone, email, tags
     */
    private async computeProfileCompleteness(schema: string, leadId: string): Promise<number> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT l.first_name, l.phone, l.email,
                    (SELECT COUNT(*) FROM lead_tags lt WHERE lt.lead_id = l.id) AS tag_count
             FROM leads l
             WHERE l.id = $1 LIMIT 1`,
            [leadId],
        );

        if (!rows || rows.length === 0) return 0;

        const lead = rows[0];
        let score = 0;

        if (lead.first_name) score += 30;
        if (lead.phone) score += 30;
        if (lead.email) score += 20;
        if (parseInt(lead.tag_count) > 0) score += 20;

        return score;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private buildResult(factors: ScoringFactors): ScoringResult {
        const compositeScore =
            factors.engagement * WEIGHTS.engagement +
            factors.intent * WEIGHTS.intent +
            factors.recency * WEIGHTS.recency +
            factors.stageProgress * WEIGHTS.stageProgress +
            factors.profileCompleteness * WEIGHTS.profileCompleteness;

        const score = Math.max(1, Math.min(10, Math.round(compositeScore / 10)));

        let label: ScoringResult['label'];
        let recommendation: string;

        if (score >= 9) {
            label = 'ready';
            recommendation = 'Listo para cierre. Contactar de inmediato para cerrar la venta.';
        } else if (score >= 7) {
            label = 'hot';
            recommendation = 'Lead caliente. Dar seguimiento en las proximas 4 horas.';
        } else if (score >= 4) {
            label = 'warm';
            recommendation = 'Lead tibio. Enviar informacion relevante y dar seguimiento en 24 horas.';
        } else {
            label = 'cold';
            recommendation = 'Lead frio. Nutrir con contenido automatizado y reevaluar en 3 dias.';
        }

        return { score, factors, label, recommendation };
    }

    private defaultResult(): ScoringResult {
        return {
            score: 1,
            factors: { engagement: 0, intent: 0, recency: 0, stageProgress: 0, profileCompleteness: 0 },
            label: 'cold',
            recommendation: 'Sin datos suficientes para evaluar. Esperar mas interacciones.',
        };
    }

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
        `;
        if (tenant && tenant.length > 0) {
            const schema = tenant[0].schema_name;
            await this.redis.set(`tenant:${tenantId}:schema`, schema, 3600);
            return schema;
        }
        return null;
    }
}
