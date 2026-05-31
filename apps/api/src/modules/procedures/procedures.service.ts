import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import type {
    ProcedureDefinition,
    ProcedureStep,
    ProcedureStepType,
    ProcedureStatus,
} from '@parallext/shared';

const VALID_STEP_TYPES: ProcedureStepType[] = ['message', 'ask', 'tool', 'condition', 'handoff'];

const COMPILER_PROMPT = `Eres un compilador de procedimientos (SOP) para un agente conversacional de ventas y soporte en Latinoamérica.
El usuario te da un procedimiento escrito en lenguaje natural (en español). Debes convertirlo en un GRAFO DE PASOS determinístico que un motor ejecutará paso a paso. El agente de IA solo expresa los pasos con naturalidad; NUNCA decide el flujo.

Devuelve ÚNICAMENTE un JSON con este formato exacto (sin texto adicional):
{
  "name": "nombre corto del procedimiento",
  "description": "qué hace, en una frase",
  "trigger": { "keywords": ["palabra1", "palabra2"], "description": "cuándo se activa" },
  "steps": [
    { "id": "s1", "type": "message", "config": { "text": "Mensaje al cliente" } },
    { "id": "s2", "type": "ask", "config": { "field": "numero_orden", "question": "¿Cuál es tu número de orden?" } },
    { "id": "s3", "type": "tool", "config": { "tool": "get_order_status", "args": {}, "saveAs": "orden" } },
    { "id": "s4", "type": "condition", "config": { "conditionField": "orden.found", "operator": "eq", "value": "true", "then": "s5", "else": "s6" } },
    { "id": "s5", "type": "message", "config": { "text": "Tu orden está en camino." } },
    { "id": "s6", "type": "handoff", "config": { "reason": "No se encontró la orden" } }
  ]
}

Reglas:
- Tipos de paso válidos: "message" (comunica algo), "ask" (pide un dato al cliente y lo guarda en config.field), "tool" (ejecuta una herramienta y guarda el resultado en config.saveAs), "condition" (evalúa config.conditionField con operator eq/neq/contains/exists/not_exists y salta a config.then o config.else), "handoff" (escala a un humano con config.reason).
- Los pasos se ejecutan en orden salvo que un "condition" salte con then/else, o un paso tenga "next" explícito (id de otro paso).
- Usa ids cortos y únicos (s1, s2, ...). then/else/next deben referenciar ids existentes.
- Herramientas disponibles típicas: get_order_status, list_customer_orders, recommend_products, search_products, get_customer_context, list_active_offers, check_availability, apply_discount. Usa solo las que tengan sentido.
- Mantén los mensajes en el idioma del SOP (normalmente español), breves y naturales.
- "keywords" deben ser términos en minúscula que un cliente usaría para disparar este procedimiento (ej: "reembolso", "devolución").
Devuelve SOLO el JSON.`;

@Injectable()
export class ProceduresService {
    private readonly logger = new Logger(ProceduresService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly llmRouter: LLMRouterService,
    ) {}

    async ensureTables(schemaName: string): Promise<void> {
        const cacheKey = `procedures_cols:${schemaName}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

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
                this.logger.debug(`[Procedures ensureTables] Skip non-fatal database existence/concurrency error: ${msg}`);
                return;
            }
            throw err;
        };

        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE TABLE IF NOT EXISTS procedures (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name TEXT NOT NULL,
                    description TEXT,
                    trigger JSONB NOT NULL DEFAULT '{"keywords":[]}'::jsonb,
                    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
                    status VARCHAR(20) NOT NULL DEFAULT 'draft',
                    vertical VARCHAR(50),
                    version INTEGER NOT NULL DEFAULT 1,
                    source_sop TEXT,
                    created_by VARCHAR(120),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )`,
                [],
            );
        } catch (err) {
            ignoreDupError(err);
        }

        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE INDEX IF NOT EXISTS idx_procedures_status ON procedures(status)`,
                [],
            );
        } catch (err) {
            ignoreDupError(err);
        }

        await this.redis.set(cacheKey, '1', 86400);
    }

    private async schema(tenantId: string): Promise<string> {
        const s = await this.prisma.getTenantSchemaName(tenantId);
        if (!s) throw new NotFoundException('Tenant not found');
        return s;
    }

    /** Invalidate the engine's active-procedures cache for a tenant. */
    private async bustActiveCache(tenantId: string): Promise<void> {
        await this.redis.del(`procedures:active:${tenantId}`).catch(() => {});
    }

    async list(tenantId: string): Promise<ProcedureDefinition[]> {
        const schemaName = await this.schema(tenantId);
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, name, description, trigger, steps, status, vertical, version, source_sop, updated_at
             FROM procedures ORDER BY updated_at DESC`,
            [],
        );
        return (rows || []).map((r) => this.mapRow(r));
    }

    async get(tenantId: string, id: string): Promise<ProcedureDefinition | null> {
        const schemaName = await this.schema(tenantId);
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, name, description, trigger, steps, status, vertical, version, source_sop FROM procedures WHERE id = $1::uuid`,
            [id],
        );
        return rows?.[0] ? this.mapRow(rows[0]) : null;
    }

    async create(
        tenantId: string,
        dto: { name: string; description?: string; trigger?: any; steps?: ProcedureStep[]; vertical?: string; status?: ProcedureStatus; sourceSop?: string },
        createdBy?: string,
    ): Promise<ProcedureDefinition> {
        const schemaName = await this.schema(tenantId);
        await this.ensureTables(schemaName);
        if (!dto.name?.trim()) throw new BadRequestException('El nombre es obligatorio');

        const steps = this.validateSteps(dto.steps || []);
        const trigger = this.normalizeTrigger(dto.trigger);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO procedures (name, description, trigger, steps, status, vertical, version, source_sop, created_by)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, 1, $7, $8)
             RETURNING id, name, description, trigger, steps, status, vertical, version, source_sop`,
            [
                dto.name.trim(),
                dto.description || null,
                JSON.stringify(trigger),
                JSON.stringify(steps),
                dto.status === 'active' ? 'active' : 'draft',
                dto.vertical || null,
                dto.sourceSop || null,
                createdBy || null,
            ],
        );
        await this.bustActiveCache(tenantId);
        return this.mapRow(rows[0]);
    }

    async update(
        tenantId: string,
        id: string,
        dto: { name?: string; description?: string; trigger?: any; steps?: ProcedureStep[]; vertical?: string; status?: ProcedureStatus },
    ): Promise<ProcedureDefinition> {
        const schemaName = await this.schema(tenantId);
        await this.ensureTables(schemaName);
        const existing = await this.get(tenantId, id);
        if (!existing) throw new NotFoundException('Procedimiento no encontrado');

        const name = dto.name?.trim() ?? existing.name;
        const description = dto.description ?? existing.description ?? null;
        const trigger = dto.trigger !== undefined ? this.normalizeTrigger(dto.trigger) : existing.trigger;
        const steps = dto.steps !== undefined ? this.validateSteps(dto.steps) : existing.steps;
        const status = dto.status ?? existing.status;
        const vertical = dto.vertical ?? existing.vertical ?? null;

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE procedures
             SET name = $2, description = $3, trigger = $4::jsonb, steps = $5::jsonb,
                 status = $6, vertical = $7, version = version + 1, updated_at = NOW()
             WHERE id = $1::uuid
             RETURNING id, name, description, trigger, steps, status, vertical, version, source_sop`,
            [id, name, description, JSON.stringify(trigger), JSON.stringify(steps), status, vertical],
        );
        await this.bustActiveCache(tenantId);
        return this.mapRow(rows[0]);
    }

    async setStatus(tenantId: string, id: string, status: ProcedureStatus): Promise<ProcedureDefinition> {
        if (!['draft', 'active', 'inactive'].includes(status)) throw new BadRequestException('Estado inválido');
        const schemaName = await this.schema(tenantId);
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE procedures SET status = $2, updated_at = NOW() WHERE id = $1::uuid
             RETURNING id, name, description, trigger, steps, status, vertical, version, source_sop`,
            [id, status],
        );
        if (!rows?.length) throw new NotFoundException('Procedimiento no encontrado');
        await this.bustActiveCache(tenantId);
        return this.mapRow(rows[0]);
    }

    async remove(tenantId: string, id: string): Promise<void> {
        const schemaName = await this.schema(tenantId);
        await this.ensureTables(schemaName);
        await this.prisma.executeInTenantSchema(schemaName, `DELETE FROM procedures WHERE id = $1::uuid`, [id]);
        await this.bustActiveCache(tenantId);
    }

    /**
     * Compile a natural-language SOP into a deterministic step graph via the LLM
     * (high tier, one-shot) and save it as a DRAFT for human review before activation.
     */
    async compile(tenantId: string, sop: string, vertical?: string, createdBy?: string): Promise<ProcedureDefinition> {
        if (!sop?.trim()) throw new BadRequestException('El SOP no puede estar vacío');

        let raw = '';
        try {
            const res = await this.llmRouter.execute({
                task: 'tool_calling',
                allowedTiers: ['tier_1_premium', 'tier_2_standard'],
                messages: [{ role: 'user', content: sop.trim() }],
                systemPrompt: COMPILER_PROMPT,
                temperature: 0.2,
                maxTokens: 2500,
                tenantId,
            });
            raw = res.content || '';
        } catch (err: any) {
            this.logger.error(`[Procedures] Compile failed: ${err.message}`);
            throw new BadRequestException('No se pudo compilar el procedimiento');
        }

        const parsed = this.safeJsonObject(raw);
        if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
            throw new BadRequestException('La compilación no produjo pasos válidos. Reformula el SOP.');
        }

        return this.create(
            tenantId,
            {
                name: String(parsed.name || 'Procedimiento').slice(0, 120),
                description: parsed.description ? String(parsed.description).slice(0, 500) : undefined,
                trigger: parsed.trigger,
                steps: parsed.steps,
                vertical,
                status: 'draft',
                sourceSop: sop.trim(),
            },
            createdBy,
        );
    }

    // ── helpers ──────────────────────────────────────────────
    private mapRow(r: any): ProcedureDefinition {
        return {
            id: r.id,
            name: r.name,
            description: r.description || undefined,
            trigger: this.normalizeTrigger(r.trigger),
            steps: Array.isArray(r.steps) ? r.steps : [],
            status: r.status,
            vertical: r.vertical || undefined,
            version: Number(r.version) || 1,
            sourceSop: r.source_sop || undefined,
        };
    }

    private normalizeTrigger(trigger: any): { keywords: string[]; description?: string } {
        const keywords = Array.isArray(trigger?.keywords)
            ? trigger.keywords.map((k: any) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 30)
            : [];
        return { keywords, description: trigger?.description ? String(trigger.description).slice(0, 300) : undefined };
    }

    private validateSteps(steps: any[]): ProcedureStep[] {
        if (!Array.isArray(steps)) return [];
        const seen = new Set<string>();
        const out: ProcedureStep[] = [];
        steps.slice(0, 60).forEach((s: any, idx: number) => {
            const type: ProcedureStepType = VALID_STEP_TYPES.includes(s?.type) ? s.type : 'message';
            let id = String(s?.id || `s${idx + 1}`).trim() || `s${idx + 1}`;
            while (seen.has(id)) id = `${id}_${idx}`;
            seen.add(id);
            const cfg = s?.config && typeof s.config === 'object' ? s.config : {};
            out.push({
                id,
                type,
                config: {
                    text: cfg.text != null ? String(cfg.text) : undefined,
                    field: cfg.field != null ? String(cfg.field) : undefined,
                    question: cfg.question != null ? String(cfg.question) : undefined,
                    tool: cfg.tool != null ? String(cfg.tool) : undefined,
                    args: cfg.args && typeof cfg.args === 'object' ? cfg.args : undefined,
                    saveAs: cfg.saveAs != null ? String(cfg.saveAs) : undefined,
                    conditionField: cfg.conditionField != null ? String(cfg.conditionField) : undefined,
                    operator: ['eq', 'neq', 'contains', 'exists', 'not_exists'].includes(cfg.operator) ? cfg.operator : undefined,
                    value: cfg.value != null ? String(cfg.value) : undefined,
                    then: cfg.then != null ? String(cfg.then) : undefined,
                    else: cfg.else != null ? String(cfg.else) : undefined,
                    reason: cfg.reason != null ? String(cfg.reason) : undefined,
                },
                next: s?.next != null ? String(s.next) : undefined,
            });
        });
        return out;
    }

    private safeJsonObject(raw: string): any {
        try {
            const match = raw.match(/\{[\s\S]*\}/);
            return JSON.parse(match ? match[0] : raw);
        } catch {
            this.logger.warn('[Procedures] Failed to parse compiler JSON');
            return null;
        }
    }
}
