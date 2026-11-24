import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { redactTraceSteps } from './turn-trace-context';

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

    // `conversation_traces` and `turn_traces` are shared tables (ADR 0034): a migration defines them, the tenant
    // helpers of PrismaService scope every statement to the tenant, and nothing is created at runtime.
    constructor(private prisma: PrismaService) {}

    async record(event: LlmTurnEvent): Promise<void> {
        if (!event?.tenantId || !event?.conversationId) return;
        try {
            const schemaName = await this.prisma.getTenantSchemaName(event.tenantId);
            if (!schemaName) return;
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
            this.logger.warn(`Failed to record trace for ${event.conversationId}: ${err?.code || err?.name || 'error'}`);
        }
    }

    async getTrace(tenantId: string, conversationId: string, limit = 100) {
        const boundedLimit = Math.min(200, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 100));
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return [];

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT provider, model, tier, task, latency_ms, prompt_tokens, completion_tokens,
                    total_tokens, fallback_used, kb_sources, stage, created_at
             FROM conversation_traces
             WHERE conversation_id = $1::uuid
             ORDER BY created_at ASC
             LIMIT $2`,
            [conversationId, boundedLimit],
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
            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO turn_traces (conversation_id, message_id, total_duration_ms, step_count, steps)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)`,
                [
                    evt.conversationId,
                    evt.messageId || null,
                    evt.totalDurationMs,
                    Math.min(100, Math.max(0, evt.stepCount || 0)),
                    JSON.stringify(redactTraceSteps(evt.steps || [])),
                ],
            );
        } catch (err: any) {
            this.logger.warn(`Failed to record turn trace for ${evt.conversationId}: ${err?.code || err?.name || 'error'}`);
        }
    }

    async getTurnTraces(tenantId: string, conversationId: string, limit = 50) {
        const boundedLimit = Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 50));
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return [];
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT message_id, total_duration_ms, step_count, steps, created_at
             FROM turn_traces WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
            [conversationId, boundedLimit],
        );
        return (rows || []).map((r: any) => ({
            messageId: r.message_id,
            totalDurationMs: Number(r.total_duration_ms) || 0,
            stepCount: Number(r.step_count) || 0,
            steps: Array.isArray(r.steps) ? r.steps : [],
            createdAt: r.created_at,
        }));
    }

    /**
     * Delete turn traces older than `days` for one tenant. Step-by-step traces are
     * voluminous (one row per turn) so retention is short. Best-effort: never throws.
     */
    async pruneTurnTraces(schemaName: string, days = 30): Promise<void> {
        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `DELETE FROM turn_traces WHERE created_at < NOW() - ($1 || ' days')::interval`,
                [String(days)],
            );
        } catch (err: any) {
            if (!/does not exist|42P01/i.test(err?.message || '')) {
                this.logger.warn(`pruneTurnTraces failed for ${schemaName}: ${err.message}`);
            }
        }
    }
}
