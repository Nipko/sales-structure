/**
 * Propuestas del copiloto de onboarding (C0 §1.3 y §2.8, rebanada R6, ADR 0012).
 *
 * Viven en el ledger de Assist (`agent_content_proposals`, extendido): reutilizan su digest, su idempotencia por
 * `(requested_by, request_key)` y su relectura. Se distinguen por `operation` (`copilot.value`, `copilot.contradiction`,
 * `copilot.question`), que Assist no conoce: su `apply` las rechaza como operación desconocida.
 *
 * - Una propuesta nunca cuenta para la preparación: el motor no lee esta tabla.
 * - Aprobar (tal cual o editada) escribe por BusinessFactsService con `origin=copilot`, `confirmed_by` = la persona y
 *   `source_ref = {via, proposal_id, extraction_run_id, edited, evidence}`. Sin una persona no se aprueba.
 * - Rechazar deja `rejected` con quién y cuándo. Una propuesta más nueva del mismo requisito, o un valor escrito por otra
 *   puerta (formulario, bandeja de pendientes), deja las abiertas en `superseded`. A los 30 días caducan (`expired`).
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sameCopilotValue } from '@parallext/business-spec';
import { PrismaService } from '../prisma/prisma.service';
import { ensureContentProposalSchema } from '../copilot/agent-configuration-proposal-schema';
import { proposalHash } from '../copilot/agent-proposal-digest';
import { BusinessFactsService, type BusinessFactActor, type BusinessFactView } from '../readiness/business-facts.service';
import { ReadinessService } from '../readiness/readiness.service';

export const COPILOT_OPERATIONS = {
    value: 'copilot.value',
    contradiction: 'copilot.contradiction',
    question: 'copilot.question',
} as const;
export type CopilotProposalKind = keyof typeof COPILOT_OPERATIONS;
export type CopilotProposalStatus = 'proposed' | 'applied' | 'expired' | 'rejected' | 'superseded';

/** Caducidad de una propuesta de extracción (C0 §2.8). */
export const COPILOT_PROPOSAL_TTL_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_OF: Record<string, CopilotProposalKind> = Object.fromEntries(Object.entries(COPILOT_OPERATIONS).map(([k, op]) => [op, k as CopilotProposalKind]));
const STATUS_FILTERS = new Set(['open', 'all', 'proposed', 'applied', 'expired', 'rejected', 'superseded']);

export interface CopilotEvidenceView {
    sourceRef: string;
    origin: string;
    label: string;
    url: string | null;
    quote: string;
}

/** Lo que el copiloto guarda en `input`, según el tipo. */
export interface CopilotProposalInput {
    /** Valor propuesto (valor nuevo o la versión de la fuente en una contradicción con el valor confirmado). */
    value?: unknown;
    /** Valor confirmado hoy, en una contradicción con él. */
    current?: unknown;
    /** Versiones distintas en fuentes distintas: el dueño elige una (o escribe la suya). */
    alternatives?: { value: unknown; evidence: CopilotEvidenceView[] }[];
    /** Pregunta al dueño: `owner_question` (texto del copiloto) o `generic_faq` (contenido de plantilla o sin dato). */
    question?: { code: 'owner_question' | 'generic_faq'; text?: string; faq?: { id: string; question: string; reason: string } };
}

/** Una propuesta lista para guardar (sale de la ejecución, ya verificada). */
export interface CopilotProposalDraft {
    kind: CopilotProposalKind;
    requirementId: string;
    targetRef: string;
    input: CopilotProposalInput;
    evidence: CopilotEvidenceView[];
}

export interface CopilotProposalView {
    id: string;
    kind: CopilotProposalKind;
    requirementId: string;
    requirementTitle: string | null;
    targetRef: string;
    status: CopilotProposalStatus;
    value: unknown;
    current: unknown;
    alternatives: { value: unknown; evidence: CopilotEvidenceView[] }[];
    question: CopilotProposalInput['question'] | null;
    evidence: CopilotEvidenceView[];
    runId: string | null;
    createdAt: string;
    expiresAt: string;
    decidedAt: string | null;
    decisionNote: string | null;
    factId: string | null;
}

export interface CopilotApproveResult {
    fact: BusinessFactView;
    readiness: { verdictBefore: string | null; verdictAfter: string; requirement: unknown } | null;
    proposal: CopilotProposalView;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

@Injectable()
export class CopilotProposalsService {
    private readonly logger = new Logger(CopilotProposalsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly facts: BusinessFactsService,
        private readonly readiness: ReadinessService,
    ) {}

    /** Guarda las propuestas de una ejecución; cada una deja en `superseded` las abiertas del mismo requisito y objetivo. */
    async storeRun(tenantId: string, runId: string, requestedBy: string, drafts: CopilotProposalDraft[]): Promise<CopilotProposalView[]> {
        const schema = await this.schema(tenantId);
        const stored: CopilotProposalView[] = [];
        let index = 0;
        for (const draft of drafts) {
            const operation = COPILOT_OPERATIONS[draft.kind];
            await this.supersedeOpen(schema, draft.requirementId, draft.targetRef, 'newer_proposal');
            const input = { kind: draft.kind, ...draft.input };
            const digest = proposalHash({ operation, requestedBy, input });
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `INSERT INTO agent_content_proposals
                    (operation, requested_by, request_key, digest, input, expires_at, requirement_id, target_ref, evidence, extraction_run_id)
                 VALUES ($1, $2::uuid, $3, $4, $5::jsonb, NOW() + interval '${COPILOT_PROPOSAL_TTL_DAYS} days', $6, $7, $8::jsonb, $9::uuid)
                 ON CONFLICT (requested_by, request_key) DO NOTHING RETURNING *`,
                [operation, requestedBy, `copilot_${runId}_${index++}`, digest, JSON.stringify(input),
                    draft.requirementId, draft.targetRef, JSON.stringify(draft.evidence), runId]);
            if (rows[0]) stored.push(this.view(rows[0]));
        }
        return stored;
    }

    async list(tenantId: string, options: { status?: string; limit?: number } = {}): Promise<{ items: CopilotProposalView[]; counts: Record<CopilotProposalStatus, number> }> {
        const schema = await this.schema(tenantId);
        await this.expire(schema);
        const status = options.status && STATUS_FILTERS.has(options.status) ? options.status : 'open';
        const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100) || 100, 1), 300);
        const where = status === 'all' ? '' : 'AND status = $1';
        const params: unknown[] = status === 'all' ? [] : [status === 'open' ? 'proposed' : status];
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM agent_content_proposals WHERE operation LIKE 'copilot.%' ${where}
              ORDER BY created_at DESC LIMIT ${limit}`, params);
        const countRows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT status, COUNT(*)::int AS n FROM agent_content_proposals WHERE operation LIKE 'copilot.%' GROUP BY status`);
        const counts = { proposed: 0, applied: 0, expired: 0, rejected: 0, superseded: 0 } as Record<CopilotProposalStatus, number>;
        for (const r of countRows) if (r.status in counts) counts[r.status as CopilotProposalStatus] = Number(r.n);
        return { items: rows.map(r => this.view(r)), counts };
    }

    async get(tenantId: string, id: string): Promise<CopilotProposalView> {
        const schema = await this.schema(tenantId);
        await this.expire(schema);
        return this.view(await this.row(schema, id));
    }

    /**
     * Aprobar (C0 §4.1): `value` opcional = «editar y aprobar». Escribe por BusinessFactsService con `origin=copilot` y el
     * `confirmed_by` de la persona; devuelve el valor y el delta de la preparación, como el cajón.
     */
    async approve(tenantId: string, id: string, body: { value?: unknown; expectedVersion?: number }, actor: BusinessFactActor): Promise<CopilotApproveResult> {
        if (actor.kind !== 'user' || !actor.userId || !UUID.test(actor.userId)) {
            throw new ForbiddenException('una propuesta del copiloto la aprueba una persona');
        }
        const schema = await this.schema(tenantId);
        await this.expire(schema);
        const row = await this.row(schema, id);
        const view = this.view(row);
        if (view.kind === 'question') throw new BadRequestException('una pregunta se responde con el formulario del requisito, no se aprueba');
        if (view.status !== 'proposed') throw new ConflictException({ error: 'copilot_proposal_not_open', status: view.status });
        const edited = body && 'value' in body && body.value !== undefined;
        const value = edited ? body.value : view.value;
        if (value === undefined || value === null) {
            throw new BadRequestException('esta propuesta tiene varias versiones: elige una o escribe el valor');
        }

        // Se toma la propuesta ANTES de escribir (como el apply de Assist): dos aprobaciones a la vez no escriben dos veces.
        const claimed = await this.prisma.executeInTenantSchema<any[]>(schema,
            `UPDATE agent_content_proposals SET status = 'applied', applied_at = NOW(), applied_by = $2::uuid, decided_by = $2::uuid, decided_at = NOW()
              WHERE id = $1::uuid AND status = 'proposed' AND expires_at > NOW() RETURNING *`, [id, actor.userId]);
        if (!claimed[0]) throw new ConflictException({ error: 'copilot_proposal_not_open' });

        const before = await this.readiness.currentVerdict(tenantId).catch(() => null);
        let fact: BusinessFactView;
        try {
            fact = await this.facts.write(tenantId, {
                requirementId: view.requirementId, scopeKey: view.targetRef, value, origin: 'copilot', status: 'confirmed',
                sourceRef: {
                    via: 'copilot', proposal_id: view.id, extraction_run_id: view.runId,
                    edited: Boolean(edited) && !sameCopilotValue(value, view.value),
                    evidence: view.evidence.map(e => ({ origin: e.origin, url: e.url, quote: e.quote })),
                },
                ...(body?.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
            }, actor);
        } catch (err) {
            // La escritura no pasó (valor inválido, versión vieja): la propuesta vuelve a estar abierta.
            await this.prisma.executeInTenantSchema(schema,
                `UPDATE agent_content_proposals SET status = 'proposed', applied_at = NULL, applied_by = NULL, decided_by = NULL, decided_at = NULL
                  WHERE id = $1::uuid AND status = 'applied' AND created_object_id IS NULL`, [id]);
            throw err;
        }
        const editedNote = Boolean(edited) && !sameCopilotValue(value, view.value) ? 'edited' : null;
        const done = await this.prisma.executeInTenantSchema<any[]>(schema,
            'UPDATE agent_content_proposals SET created_object_id = $2::uuid, decision_note = $3 WHERE id = $1::uuid RETURNING *',
            [id, fact.id, editedNote]);
        await this.supersedeOpen(schema, view.requirementId, view.targetRef, 'approved_other', id);
        await this.audit(tenantId, actor, 'copilot.proposal_approved', view, { factId: fact.id, version: fact.version, edited: Boolean(editedNote) });

        const after = await this.readiness.evaluateTenant(tenantId, 'invalidated').catch(() => null);
        return {
            fact,
            readiness: after ? {
                verdictBefore: before, verdictAfter: after.result.verdict,
                requirement: after.result.requirements.find(r => r.id === view.requirementId) ?? null,
            } : null,
            proposal: this.view(done[0] ?? claimed[0]),
        };
    }

    async reject(tenantId: string, id: string, note: string | null, actor: BusinessFactActor): Promise<CopilotProposalView> {
        if (actor.kind !== 'user' || !actor.userId || !UUID.test(actor.userId)) throw new ForbiddenException('una propuesta la rechaza una persona');
        const schema = await this.schema(tenantId);
        await this.expire(schema);
        const view = this.view(await this.row(schema, id));
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `UPDATE agent_content_proposals SET status = 'rejected', decided_by = $2::uuid, decided_at = NOW(), decision_note = $3
              WHERE id = $1::uuid AND status = 'proposed' AND operation LIKE 'copilot.%' RETURNING *`,
            [id, actor.userId, note ? note.slice(0, 500) : null]);
        if (!rows[0]) throw new ConflictException({ error: 'copilot_proposal_not_open', status: view.status });
        await this.audit(tenantId, actor, 'copilot.proposal_rejected', view, {});
        return this.view(rows[0]);
    }

    /**
     * Un valor más nuevo llegó por otra puerta (formulario, bandeja de pendientes, defaults): las propuestas abiertas de
     * ese requisito quedan `superseded`. Lo llama el listener de `business_fact.written`.
     */
    async supersedeForWrittenValue(tenantId: string, requirementId: string, scopeKey: string): Promise<number> {
        const schema = await this.schema(tenantId);
        return (await this.supersedeOpen(schema, requirementId, scopeKey, 'newer_value')).length;
    }

    // ─────────────────────────── internos ───────────────────────────

    private async supersedeOpen(schema: string, requirementId: string, targetRef: string, note: string, exceptId?: string): Promise<string[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `UPDATE agent_content_proposals SET status = 'superseded', decided_at = NOW(), decision_note = $3
              WHERE operation LIKE 'copilot.%' AND status = 'proposed' AND requirement_id = $1 AND COALESCE(target_ref, '') = $2
                AND ($4::uuid IS NULL OR id <> $4::uuid)
              RETURNING id::text AS id`, [requirementId, targetRef, note, exceptId ?? null]);
        return rows.map(r => r.id);
    }

    /** Caducidad de 30 días: lo que nadie decidió a tiempo deja de ser aprobable. */
    private async expire(schema: string): Promise<void> {
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE agent_content_proposals SET status = 'expired'
              WHERE operation LIKE 'copilot.%' AND status = 'proposed' AND expires_at <= NOW()`);
    }

    private async row(schema: string, id: string): Promise<any> {
        if (!UUID.test(String(id ?? ''))) throw new BadRequestException('id inválido');
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM agent_content_proposals WHERE id = $1::uuid AND operation LIKE 'copilot.%'`, [id]);
        if (!rows[0]) throw new NotFoundException('propuesta no encontrada');
        return rows[0];
    }

    private async schema(tenantId: string): Promise<string> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new NotFoundException('Tenant not found');
        await ensureContentProposalSchema(this.prisma, schema);
        return schema;
    }

    private view(row: any): CopilotProposalView {
        const input = (row.input && typeof row.input === 'object' ? row.input : {}) as CopilotProposalInput;
        const requirementId = String(row.requirement_id ?? '');
        return {
            id: String(row.id),
            kind: KIND_OF[row.operation] ?? 'question',
            requirementId,
            requirementTitle: this.readiness.spec.requirements[requirementId]?.title ?? null,
            targetRef: String(row.target_ref ?? ''),
            status: row.status,
            value: input.value ?? null,
            current: input.current ?? null,
            alternatives: Array.isArray(input.alternatives) ? input.alternatives : [],
            question: input.question ?? null,
            evidence: Array.isArray(row.evidence) ? row.evidence : [],
            runId: row.extraction_run_id ?? null,
            createdAt: iso(row.created_at) as string,
            expiresAt: iso(row.expires_at) as string,
            decidedAt: iso(row.decided_at),
            decisionNote: row.decision_note ?? null,
            factId: row.created_object_id ?? null,
        };
    }

    private async audit(tenantId: string, actor: BusinessFactActor, action: string, view: CopilotProposalView, extra: Record<string, unknown>): Promise<void> {
        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId, userId: actor.kind === 'user' ? actor.userId : null, action,
                    resource: `agent_content_proposals/${view.id}`,
                    details: { requirementId: view.requirementId, kind: view.kind, runId: view.runId, ...extra, ...(actor.kind === 'user' ? actor.delegation ?? {} : {}) } as any,
                },
            });
        } catch (err) {
            this.logger.warn(`copilot: auditoría no registrada para ${view.id}: ${(err as Error).message}`);
        }
    }
}

/** Para pruebas y para la ejecución: un id de ejecución nuevo. */
export const newExtractionRunId = (): string => randomUUID();
