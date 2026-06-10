import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import type { ProcedureDefinition, ProcedureStep, ProcedureRunState } from '@parallext/shared';

export interface ProcedureProcessResult {
    handled: boolean;
    /** Directive text for the LLM to voice (what to say), like the booking engine. */
    text?: string;
    completed?: boolean;
    handoff?: boolean;
    handoffReason?: string;
    procedureName?: string;
}

const STATE_TTL = 3600; // 1h
const ACTIVE_CACHE_TTL = 300; // 5min
const MAX_STEPS_PER_TURN = 25;

/**
 * Deterministic procedure (AOP/SOP) execution engine — T2.12.
 *
 * Mirrors the booking engine's directive pattern: the engine decides the flow
 * step-by-step and returns ONE directive per turn; the LLM only voices it. The
 * LLM never decides which step comes next, so the flow can't be hallucinated.
 *
 * State is kept in Redis `procedure:{conversationId}`. Procedure definitions are
 * read directly from the tenant `procedures` table (created by ProceduresService).
 */
@Injectable()
export class ProcedureEngineService {
    private readonly logger = new Logger(ProcedureEngineService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly toolExecutor: AIToolExecutorService,
    ) {}

    private stateKey(conversationId: string): string {
        return `procedure:${conversationId}`;
    }

    async getState(conversationId: string): Promise<ProcedureRunState | null> {
        return this.redis.getJson<ProcedureRunState>(this.stateKey(conversationId));
    }

    private async saveState(conversationId: string, state: ProcedureRunState): Promise<void> {
        await this.redis.setJson(this.stateKey(conversationId), state, STATE_TTL);
    }

    async clearState(conversationId: string): Promise<void> {
        await this.redis.del(this.stateKey(conversationId)).catch(() => {});
    }

    /** Active procedures for a tenant (cached). Empty array if the table is absent. */
    private async loadActiveProcedures(tenantId: string, schemaName: string): Promise<ProcedureDefinition[]> {
        const cacheKey = `procedures:active:${tenantId}`;
        const cached = await this.redis.getJson<ProcedureDefinition[]>(cacheKey);
        if (cached) return cached;

        let procs: ProcedureDefinition[] = [];
        try {
            // The per-tenant `procedures` table is created lazily by ProceduresService.
            // For tenants without procedures it doesn't exist yet — probe with
            // to_regclass first (returns NULL, no error) so we never issue a failing
            // query that Prisma logs on every incoming message.
            const reg = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT to_regclass('procedures') AS reg`,
                [],
            );
            if (reg?.[0]?.reg) {
                const rows = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT id, name, trigger, steps, version FROM procedures WHERE status = 'active'`,
                    [],
                );
                procs = (rows || []).map((r) => ({
                    id: r.id,
                    name: r.name,
                    trigger: r.trigger && typeof r.trigger === 'object' ? r.trigger : { keywords: [] },
                    steps: Array.isArray(r.steps) ? r.steps : [],
                    status: 'active' as const,
                    version: Number(r.version) || 1,
                }));
            }
        } catch {
            // to_regclass already handled the "table missing" case (returns NULL,
            // no throw). Reaching here means the SELECT failed — a TRANSIENT error.
            // Return empty for THIS turn only; do NOT cache it, or a momentary DB
            // blip would disable procedures for the full cache TTL.
            return [];
        }
        // Cache the successful result (a genuine empty list included — table missing
        // via to_regclass NULL also lands here). Invalidated on create/activate.
        await this.redis.setJson(cacheKey, procs, ACTIVE_CACHE_TTL).catch(() => {});
        return procs;
    }

    private async loadProcedureById(schemaName: string, id: string): Promise<ProcedureDefinition | null> {
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, name, trigger, steps, status, version FROM procedures WHERE id = $1::uuid`,
                [id],
            );
            const r = rows?.[0];
            if (!r) return null;
            return {
                id: r.id,
                name: r.name,
                trigger: r.trigger || { keywords: [] },
                steps: Array.isArray(r.steps) ? r.steps : [],
                status: r.status,
                version: Number(r.version) || 1,
            };
        } catch {
            return null;
        }
    }

    private matchTrigger(procs: ProcedureDefinition[], userText: string): ProcedureDefinition | null {
        // Normalize BOTH sides (lowercase + strip accents) so a keyword like
        // "Devolución" matches "quiero una devolucion" regardless of case/accents.
        const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const text = norm(userText);
        if (!text.trim()) return null;
        for (const p of procs) {
            const kws = p.trigger?.keywords || [];
            if (kws.some((k) => k && text.includes(norm(k)))) return p;
        }
        return null;
    }

    /**
     * Main entry. Returns handled=false when no procedure is active/triggered, so
     * the normal pipeline continues. When handled, `text` is the directive.
     */
    async process(
        schemaName: string,
        tenantId: string,
        conversationId: string,
        contactId: string,
        userText: string,
    ): Promise<ProcedureProcessResult> {
        let state = await this.getState(conversationId);
        let procedure: ProcedureDefinition | null = null;

        if (state) {
            procedure = await this.loadProcedureById(schemaName, state.procedureId);
            // If the procedure was deleted, deactivated, or re-versioned, abandon cleanly.
            if (!procedure || procedure.status !== 'active' || procedure.version !== state.version) {
                await this.clearState(conversationId);
                return { handled: false };
            }
        } else {
            const active = await this.loadActiveProcedures(tenantId, schemaName);
            const matched = this.matchTrigger(active, userText);
            if (!matched || !matched.steps.length) return { handled: false };
            procedure = matched;
            state = {
                procedureId: procedure.id,
                version: procedure.version,
                currentStepId: procedure.steps[0].id,
                collected: {},
                awaitingField: null,
                startedAt: new Date().toISOString(),
            };
            this.logger.log(`[Procedure] Started "${procedure.name}" for conversation ${conversationId}`);
        }

        const byId = new Map(procedure.steps.map((s) => [s.id, s]));
        const indexOfId = (id: string | null) => procedure!.steps.findIndex((s) => s.id === id);

        // If we were awaiting an answer, capture it and advance past the ask.
        if (state.awaitingField) {
            state.collected[state.awaitingField] = userText;
            state.awaitingField = null;
            state.currentStepId = this.nextStepId(procedure, state.currentStepId);
        }

        const parts: string[] = [];
        let guard = 0;
        while (state.currentStepId && guard++ < MAX_STEPS_PER_TURN) {
            const step = byId.get(state.currentStepId);
            if (!step) { state.currentStepId = null; break; }

            if (step.type === 'message') {
                if (step.config.text) parts.push(step.config.text);
                state.currentStepId = this.nextStepId(procedure, state.currentStepId);
                continue;
            }

            if (step.type === 'ask') {
                if (step.config.question) parts.push(step.config.question);
                state.awaitingField = step.config.field || `field_${step.id}`;
                await this.saveState(conversationId, state);
                return { handled: true, text: parts.join('\n\n'), procedureName: procedure.name };
            }

            if (step.type === 'tool') {
                try {
                    const result = await this.toolExecutor.execute(
                        schemaName, tenantId, contactId, step.config.tool || '', step.config.args || {}, conversationId,
                    );
                    if (step.config.saveAs) state.collected[step.config.saveAs] = result;
                } catch (e: any) {
                    this.logger.warn(`[Procedure] tool ${step.config.tool} failed: ${e.message}`);
                    if (step.config.saveAs) state.collected[step.config.saveAs] = { error: true };
                }
                state.currentStepId = this.nextStepId(procedure, state.currentStepId);
                continue;
            }

            if (step.type === 'condition') {
                const pass = this.evaluateCondition(step, state.collected);
                const target = pass ? step.config.then : step.config.else;
                // jump to target if valid, else fall through to sequential next
                state.currentStepId = target && indexOfId(target) >= 0 ? target : this.nextStepId(procedure, state.currentStepId);
                continue;
            }

            if (step.type === 'handoff') {
                await this.clearState(conversationId);
                return {
                    handled: true,
                    text: parts.length ? parts.join('\n\n') : undefined,
                    handoff: true,
                    handoffReason: step.config.reason || `Procedimiento: ${procedure.name}`,
                    procedureName: procedure.name,
                };
            }

            // Unknown step type — skip.
            state.currentStepId = this.nextStepId(procedure, state.currentStepId);
        }

        // If the per-turn step guard tripped while steps are still pending, the
        // procedure is NOT complete — persist the state and resume next turn
        // instead of wrongly marking it completed and discarding mid-flow state.
        if (state.currentStepId) {
            await this.saveState(conversationId, state);
            return {
                handled: parts.length > 0,
                text: parts.length ? parts.join('\n\n') : undefined,
                completed: false,
                procedureName: procedure.name,
            };
        }

        // Reached the end → procedure complete.
        await this.clearState(conversationId);
        return {
            handled: parts.length > 0,
            text: parts.length ? parts.join('\n\n') : undefined,
            completed: true,
            procedureName: procedure.name,
        };
    }

    private nextStepId(procedure: ProcedureDefinition, currentId: string | null): string | null {
        if (!currentId) return null;
        const idx = procedure.steps.findIndex((s) => s.id === currentId);
        if (idx < 0) return null;
        const explicitNext = procedure.steps[idx].next;
        if (explicitNext && procedure.steps.some((s) => s.id === explicitNext)) return explicitNext;
        return idx + 1 < procedure.steps.length ? procedure.steps[idx + 1].id : null;
    }

    private evaluateCondition(step: ProcedureStep, collected: Record<string, any>): boolean {
        const raw = this.resolvePath(collected, step.config.conditionField || '');
        const op = step.config.operator || 'exists';
        const target = step.config.value;
        switch (op) {
            case 'exists':
                return raw !== undefined && raw !== null && raw !== '' && raw !== false;
            case 'not_exists':
                return raw === undefined || raw === null || raw === '' || raw === false;
            case 'eq':
                return String(raw) === String(target);
            case 'neq':
                return String(raw) !== String(target);
            case 'contains':
                return String(raw ?? '').toLowerCase().includes(String(target ?? '').toLowerCase());
            default:
                return false;
        }
    }

    private resolvePath(obj: any, path: string): any {
        if (!path) return undefined;
        return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
    }
}
