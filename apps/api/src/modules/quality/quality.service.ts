import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';

export const QUALITY_QUEUE = 'quality-scoring';

export interface QualityJob {
    tenantId: string;
    conversationId: string;
}

interface JudgeResult {
    overall: number;
    resolution: number;
    tone: number;
    accuracy: number;
    empathy: number;
    flags: string[];
    resolved: boolean;
    resolutionReason: string;
}

const RUBRIC_PROMPT = `Eres un evaluador de calidad (QA) de conversaciones de atención al cliente y ventas en Latinoamérica.
Analiza la transcripción y evalúa la calidad del servicio prestado (sea por IA o por un agente humano).

Devuelve ÚNICAMENTE un JSON con este formato exacto:
{
  "overall": 0-10,
  "resolution": 0-10,
  "tone": 0-10,
  "accuracy": 0-10,
  "empathy": 0-10,
  "flags": ["problema detectado 1", "problema detectado 2"],
  "resolved": true,
  "resolutionReason": "explicación breve de si la necesidad del cliente quedó resuelta"
}

Criterios (0 = pésimo, 10 = excelente):
- resolution: ¿se resolvió la necesidad/pregunta del cliente?
- tone: profesionalismo y calidez del tono.
- accuracy: ¿la información dada parece correcta y sin contradicciones?
- empathy: ¿se mostró comprensión hacia el cliente?
- overall: calificación global ponderada.

En "flags" lista problemas concretos si los hay (ej: "respondió con información no verificada", "no escaló cuando debía", "tono cortante", "ignoró una pregunta"). Si no hay problemas, devuelve [].
En "resolved" indica true SOLO si la necesidad del cliente quedó genuinamente resuelta en la conversación; false si quedó pendiente, ambigua o se prometió seguimiento sin cerrar.
Usa español. No incluyas explicaciones fuera del JSON.`;

@Injectable()
export class QualityService {
    private readonly logger = new Logger(QualityService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private llmRouter: LLMRouterService,
        @InjectQueue(QUALITY_QUEUE) private readonly queue: Queue<QualityJob>,
    ) {}

    /** Enqueue a conversation for QA scoring (called on conversation.resolved). */
    async enqueue(tenantId: string, conversationId: string): Promise<void> {
        try {
            await this.queue.add(
                'score',
                { tenantId, conversationId },
                {
                    jobId: `q:${conversationId}`, // dedupe repeated resolves of same conversation
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 5000 },
                    removeOnComplete: true,
                    removeOnFail: 200,
                },
            );
        } catch (err: any) {
            this.logger.warn(`Failed to enqueue quality job for ${conversationId}: ${err.message}`);
        }
    }

    async ensureTables(schemaName: string): Promise<void> {
        const cacheKey = `quality_cols:${schemaName}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE TABLE IF NOT EXISTS conversation_quality_scores (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID NOT NULL,
                overall_score NUMERIC,
                resolution_score NUMERIC,
                tone_score NUMERIC,
                accuracy_score NUMERIC,
                empathy_score NUMERIC,
                flags JSONB DEFAULT '[]'::jsonb,
                resolution_type VARCHAR(50),
                resolution_verified BOOLEAN,
                verification_reason TEXT,
                scored_by VARCHAR(20) DEFAULT 'ai',
                rubric_version VARCHAR(20) DEFAULT 'v1',
                created_at TIMESTAMPTZ DEFAULT NOW()
            )`,
            [],
        );
        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE INDEX IF NOT EXISTS idx_cqs_conversation ON conversation_quality_scores(conversation_id)`,
            [],
        );
        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE INDEX IF NOT EXISTS idx_cqs_created ON conversation_quality_scores(created_at)`,
            [],
        );
        // T1.8 — resolution verification flag on conversations
        await this.prisma.executeInTenantSchema(
            schemaName,
            `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS resolution_verified BOOLEAN`,
            [],
        );

        await this.redis.set(cacheKey, '1', 86400);
    }

    /**
     * Core QA job: LLM-as-judge scores the whole conversation (T1.6) and, when the
     * conversation was marked ai_resolved, verifies the resolution (T1.8).
     */
    async scoreConversation(tenantId: string, conversationId: string): Promise<void> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return;
        await this.ensureTables(schemaName);

        const convRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT resolution_type, was_handed_off FROM conversations WHERE id = $1::uuid`,
            [conversationId],
        );
        const resolutionType: string | null = convRows?.[0]?.resolution_type ?? null;

        const msgs = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT content_text, direction
             FROM messages
             WHERE conversation_id = $1::uuid AND content_text IS NOT NULL
             ORDER BY created_at ASC
             LIMIT 40`,
            [conversationId],
        );

        if (!msgs || msgs.length < 2) {
            this.logger.debug(`[QA] Skipping ${conversationId} — too few messages (${msgs?.length || 0})`);
            return;
        }

        const transcript = msgs
            .map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${m.content_text}`)
            .join('\n');

        let judge: JudgeResult;
        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: transcript }],
                systemPrompt: RUBRIC_PROMPT,
                temperature: 0.2,
                maxTokens: 500,
                tenantId,
            });
            judge = this.parseJudge(response.content);
        } catch (err: any) {
            this.logger.error(`[QA] LLM judge failed for ${conversationId}: ${err.message}`);
            return;
        }

        const clamp = (n: any) => Math.max(0, Math.min(10, Math.round((Number(n) || 0) * 10) / 10));
        const overall = clamp(judge.overall);
        const resolution = clamp(judge.resolution);
        const tone = clamp(judge.tone);
        const accuracy = clamp(judge.accuracy);
        const empathy = clamp(judge.empathy);
        const flags = Array.isArray(judge.flags) ? judge.flags.slice(0, 10).map((f) => String(f).slice(0, 240)) : [];

        // Resolution verification only meaningful when the system marked it ai_resolved.
        const isAiResolved = resolutionType === 'ai_resolved';
        const resolutionVerified = isAiResolved ? !!judge.resolved : null;
        const verificationReason = isAiResolved ? String(judge.resolutionReason || '').slice(0, 500) : null;

        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO conversation_quality_scores
                (conversation_id, overall_score, resolution_score, tone_score, accuracy_score, empathy_score,
                 flags, resolution_type, resolution_verified, verification_reason, scored_by, rubric_version)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'ai', 'v1')`,
            [
                conversationId,
                overall,
                resolution,
                tone,
                accuracy,
                empathy,
                JSON.stringify(flags),
                resolutionType,
                resolutionVerified,
                verificationReason,
            ],
        );

        // T1.8 — write back the verified flag so resolution-rate can report "verified" rate.
        if (isAiResolved) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE conversations SET resolution_verified = $2 WHERE id = $1::uuid`,
                [conversationId, resolutionVerified],
            );
        }

        this.logger.log(
            `[QA] Scored ${conversationId}: overall=${overall} resType=${resolutionType || '-'} verified=${resolutionVerified}`,
        );
    }

    /** Aggregated QA summary for the dashboard. */
    async getQualitySummary(tenantId: string, startDate: string, endDate: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                COUNT(*)::int AS scored,
                COALESCE(AVG(overall_score), 0) AS avg_overall,
                COALESCE(AVG(resolution_score), 0) AS avg_resolution,
                COALESCE(AVG(tone_score), 0) AS avg_tone,
                COALESCE(AVG(accuracy_score), 0) AS avg_accuracy,
                COALESCE(AVG(empathy_score), 0) AS avg_empathy,
                COUNT(*) FILTER (WHERE overall_score >= 8)::int AS excellent,
                COUNT(*) FILTER (WHERE overall_score >= 5 AND overall_score < 8)::int AS ok,
                COUNT(*) FILTER (WHERE overall_score < 5)::int AS poor,
                COUNT(*) FILTER (WHERE jsonb_array_length(flags) > 0)::int AS flagged,
                COUNT(*) FILTER (WHERE resolution_type = 'ai_resolved')::int AS ai_total,
                COUNT(*) FILTER (WHERE resolution_type = 'ai_resolved' AND resolution_verified = true)::int AS ai_verified
             FROM conversation_quality_scores
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
            [startDate, endDate],
        );

        const r = rows?.[0] || {};
        const round = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
        const aiTotal = Number(r.ai_total) || 0;
        const aiVerified = Number(r.ai_verified) || 0;
        return {
            scored: Number(r.scored) || 0,
            avgOverall: round(r.avg_overall),
            avgResolution: round(r.avg_resolution),
            avgTone: round(r.avg_tone),
            avgAccuracy: round(r.avg_accuracy),
            avgEmpathy: round(r.avg_empathy),
            distribution: {
                excellent: Number(r.excellent) || 0,
                ok: Number(r.ok) || 0,
                poor: Number(r.poor) || 0,
            },
            flagged: Number(r.flagged) || 0,
            verifiedResolutionRate: aiTotal > 0 ? Math.round((aiVerified / aiTotal) * 10000) / 100 : 0,
        };
    }

    /** Recently flagged conversations (lowest scores / with flags) for drill-down. */
    async getFlagged(tenantId: string, startDate: string, endDate: string, limit = 50) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT conversation_id, overall_score, resolution_score, tone_score, accuracy_score,
                    empathy_score, flags, resolution_type, resolution_verified, verification_reason, created_at
             FROM conversation_quality_scores
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
               AND (jsonb_array_length(flags) > 0 OR overall_score < 6)
             ORDER BY overall_score ASC, created_at DESC
             LIMIT $3`,
            [startDate, endDate, limit],
        );

        return (rows || []).map((r: any) => ({
            conversationId: r.conversation_id,
            overall: Number(r.overall_score) || 0,
            resolution: Number(r.resolution_score) || 0,
            tone: Number(r.tone_score) || 0,
            accuracy: Number(r.accuracy_score) || 0,
            empathy: Number(r.empathy_score) || 0,
            flags: Array.isArray(r.flags) ? r.flags : [],
            resolutionType: r.resolution_type,
            resolutionVerified: r.resolution_verified,
            verificationReason: r.verification_reason,
            createdAt: r.created_at,
        }));
    }

    private parseJudge(raw: string): JudgeResult {
        const fallback: JudgeResult = {
            overall: 0, resolution: 0, tone: 0, accuracy: 0, empathy: 0,
            flags: [], resolved: false, resolutionReason: '',
        };
        try {
            const match = raw.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(match ? match[0] : raw);
            return { ...fallback, ...parsed };
        } catch {
            this.logger.warn('[QA] Failed to parse judge JSON, using fallback');
            return fallback;
        }
    }
}
