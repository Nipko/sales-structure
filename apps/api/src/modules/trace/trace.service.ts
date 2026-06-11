import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface LlmTurnEvent {
    tenantId: string;
    conversationId: string;
    provider: string;
    model: string;
    tier: string;
    task: string | null;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    fallbackUsed: boolean;
    kbSources: string[];
    stage: string | null;
}

@Injectable()
export class TraceService {
    private readonly logger = new Logger(TraceService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    async ensureTables(schemaName: string): Promise<void> {
        // v2 forces a one-time re-ensure on existing tenants so turn_traces appears.
        const cacheKey = `trace_cols_v2:${schemaName}`;
        if (await this.redis.get(cacheKey)) return;

        const ignoreDupError = (err: any) => {
            const msg = err?.message || '';
            const code = String(err?.code || err?.meta?.code || '');
            if (
                code === '23505' ||
                code === '42P07' ||
                code === '42710' ||
                msg.includes('already exists') ||
                msg.includes('23505') ||
                msg.includes('42P07') ||
                msg.includes('42710')
            ) {
                this.logger.debug(`[Trace ensureTables] Skip non-fatal database existence/concurrency error: ${msg}`);
                return;
            }
            throw err;
        };

        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE TABLE IF NOT EXISTS conversation_traces (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    conversation_id UUID NOT NULL,
                    provider VARCHAR(40),
                    model VARCHAR(80),
                    tier VARCHAR(40),
                    task VARCHAR(40),
                    latency_ms INTEGER,
                    prompt_tokens INTEGER,
                    completion_tokens INTEGER,
                    total_tokens INTEGER,
                    fallback_used BOOLEAN DEFAULT false,
                    kb_sources JSONB DEFAULT '[]'::jsonb,
                    stage VARCHAR(40),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )`,
                [],
            );
        } catch (err) {
            ignoreDupError(err);
        }

        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE INDEX IF NOT EXISTS idx_ctrace_conversation ON conversation_traces(conversation_id, created_at)`,
                [],
            );
        } catch (err) {
            ignoreDupError(err);
        }

        // Step-by-step turn traces (WS5 #1) — one row per turn, steps[] as JSONB.
        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE TABLE IF NOT EXISTS turn_traces (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    conversation_id UUID NOT NULL,
                    message_id UUID NULL,
                    total_duration_ms INTEGER,
                    step_count INTEGER,
                    steps JSONB DEFAULT '[]'::jsonb,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )`,
                [],
            );
        } catch (err) {
            ignoreDupError(err);
        }

        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE INDEX IF NOT EXISTS idx_turntrace_conv ON turn_traces(conversation_id, created_at)`,
                [],
            );
        } catch (err) {
            ignoreDupError(err);
        }

        await this.redis.set(cacheKey, '1', 86400);
    }

    async record(event: LlmTurnEvent): Promise<void> {
        if (!event?.tenantId || !event?.conversationId) return;
        try {
            const schemaName = await this.prisma.getTenantSchemaName(event.tenantId);
            if (!schemaName) return;
            await this.ensureTables(schemaName);
            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO conversation_traces
                    (conversation_id, provider, model, tier, task, latency_ms,
                     prompt_tokens, completion_tokens, total_tokens, fallback_used, kb_sources, stage)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
                [
                    event.conversationId,
                    event.provider,
                    event.model,
                    event.tier,
                    event.task,
                    event.latencyMs,
                    event.promptTokens,
                    event.completionTokens,
                    event.totalTokens,
                    event.fallbackUsed,
                    JSON.stringify(event.kbSources || []),
                    event.stage,
                ],
            );
        } catch (err: any) {
            this.logger.warn(`Failed to record trace for ${event.conversationId}: ${err.message}`);
        }
    }

    async getTrace(tenantId: string, conversationId: string, limit = 100) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return [];
        await this.ensureTables(schemaName);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT provider, model, tier, task, latency_ms, prompt_tokens, completion_tokens,
                    total_tokens, fallback_used, kb_sources, stage, created_at
             FROM conversation_traces
             WHERE conversation_id = $1::uuid
             ORDER BY created_at ASC
             LIMIT $2`,
            [conversationId, limit],
        );

        return (rows || []).map((r: any) => ({
            provider: r.provider,
            model: r.model,
            tier: r.tier,
            task: r.task,
            latencyMs: Number(r.latency_ms) || 0,
            promptTokens: Number(r.prompt_tokens) || 0,
            completionTokens: Number(r.completion_tokens) || 0,
            totalTokens: Number(r.total_tokens) || 0,
            fallbackUsed: !!r.fallback_used,
            kbSources: Array.isArray(r.kb_sources) ? r.kb_sources : [],
            stage: r.stage,
            createdAt: r.created_at,
        }));
    }

    /** Persist one turn's step-by-step trace. Best-effort — never throws into the pipeline. */
    async recordTurn(evt: {
        tenantId: string;
        conversationId: string;
        messageId?: string | null;
        totalDurationMs: number;
        stepCount: number;
        steps: any[];
    }): Promise<void> {
        if (!evt?.tenantId || !evt?.conversationId) return;
        try {
            const schemaName = await this.prisma.getTenantSchemaName(evt.tenantId);
            if (!schemaName) return;
            await this.ensureTables(schemaName);
            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO turn_traces (conversation_id, message_id, total_duration_ms, step_count, steps)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)`,
                [evt.conversationId, evt.messageId || null, evt.totalDurationMs, evt.stepCount, JSON.stringify(evt.steps || [])],
            );
        } catch (err: any) {
            this.logger.warn(`Failed to record turn trace for ${evt.conversationId}: ${err.message}`);
        }
    }

    async getTurnTraces(tenantId: string, conversationId: string, limit = 50) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return [];
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT message_id, total_duration_ms, step_count, steps, created_at
             FROM turn_traces WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
            [conversationId, limit],
        );
        return (rows || []).map((r: any) => ({
            messageId: r.message_id,
            totalDurationMs: Number(r.total_duration_ms) || 0,
            stepCount: Number(r.step_count) || 0,
            steps: Array.isArray(r.steps) ? r.steps : [],
            createdAt: r.created_at,
        }));
    }
}
