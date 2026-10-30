/**
 * BusinessFactsService (C0 §2.1, §2.5 y §4.1, rebanada R3): la ÚNICA puerta de escritura de `requirement_values`.
 *
 * Cada escritura:
 * 1. valida el valor contra la especificación compilada (@parallext/business-spec `validateRequirementValue`);
 * 2. sube `version` y deja la versión, con su actor, en `requirement_value_versions` (append-only), en UNA sentencia;
 * 3. emite `business_fact.written`, que invalida la caché de la preparación (ReadinessInvalidationListener).
 *
 * Escribir por SQL directo está prohibido: business-facts-writes.spec.ts falla si aparece un INSERT o UPDATE sobre
 * `requirement_values` fuera de este archivo y de sus sentencias, o cualquier UPDATE o DELETE sobre
 * `requirement_value_versions`. La
 * migración de procedencia (scripts/readiness/backfill-provenance.ts) usa las mismas sentencias (business-facts.statements.ts).
 */
import {
    BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
    MIGRATION_ORIGINS, validateRequirementValue, type CompiledSpec, type StoredStatus, type ValueIssue,
} from '@parallext/business-spec';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from './readiness.service';
import {
    VIEW_COLUMNS, requirementValueWriteStatement, toIso, toView, type BusinessFactActor, type BusinessFactView, type BusinessFactVersionView,
} from './business-facts.statements';

export { requirementValueWriteStatement, rowProvenanceStatement } from './business-facts.statements';
export type { BusinessFactActor, BusinessFactView, BusinessFactVersionView, RequirementValueStatementInput } from './business-facts.statements';

export interface BusinessFactWrite {
    requirementId: string;
    scopeKey?: string;
    value: unknown;
    status?: StoredStatus;
    origin?: string;
    sourceRef?: Record<string, unknown> | null;
    validUntil?: string | null;
    /** Concurrencia optimista: la versión que el formulario leyó. Si otra escritura llegó antes, 409. */
    expectedVersion?: number;
}

/** Evento que invalida la caché de la preparación (C0 §4.1). */
export const BUSINESS_FACT_WRITTEN = 'business_fact.written';
export interface BusinessFactWrittenEvent { tenantId: string; requirementId: string; scopeKey: string; version: number; origin: string }

const UNDEFINED_TABLE = '42P01';
const REQUIREMENT_ID = /^[A-Z][A-Z0-9_]*(\.[A-Z0-9_*]+)+$/;
const isUndefinedTable = (err: unknown) => (err as { code?: string })?.code === UNDEFINED_TABLE
    || (err as { meta?: { code?: string } })?.meta?.code === UNDEFINED_TABLE
    || /relation .*requirement_value.* does not exist/i.test(String((err as Error)?.message ?? ''));

// ─────────────────────────── servicio ───────────────────────────

@Injectable()
export class BusinessFactsService {
    private readonly logger = new Logger(BusinessFactsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly readiness: ReadinessService,
        @Optional() private readonly events?: EventEmitter2,
    ) {}

    protected now(): Date {
        return new Date();
    }

    private get spec(): CompiledSpec {
        return this.readiness.spec;
    }

    /** Valida y escribe un valor. Lanza 400 con `issues` si no cumple la especificación. */
    async write(tenantId: string, input: BusinessFactWrite, actor: BusinessFactActor): Promise<BusinessFactView> {
        const requirementId = String(input.requirementId ?? '');
        if (!REQUIREMENT_ID.test(requirementId)) throw new BadRequestException(`requisito inválido: ${requirementId}`);
        const scopeKey = String(input.scopeKey ?? '');
        const origin = input.origin ?? 'owner_form';
        const status = input.status ?? 'confirmed';
        if (MIGRATION_ORIGINS.has(origin) && actor.kind !== 'script') {
            throw new BadRequestException(`el origen ${origin} solo lo escribe la migración de procedencia`);
        }
        const issues = validateRequirementValue(this.spec, requirementId, { value: input.value, status, origin, scopeKey });
        this.raiseIssues(requirementId, issues);
        const userId = actor.kind === 'user' ? actor.userId : null;
        const at = this.now().toISOString();
        const { sql, params } = requirementValueWriteStatement({
            requirementId, scopeKey, value: input.value, status, origin,
            confirmedBy: status === 'confirmed' ? userId : null, confirmedAt: status === 'confirmed' ? at : null,
            sourceRef: input.sourceRef ?? null, validUntil: input.validUntil ?? null, specVersion: this.spec.specVersion,
            actor, expectedVersion: input.expectedVersion ?? null,
        }, 'upsert');
        const rows = await this.run<Record<string, any>[]>(tenantId, sql, params);
        if (!rows[0]) {
            throw new ConflictException({ message: 'otra escritura cambió este valor; vuelve a cargarlo', requirementId, expectedVersion: input.expectedVersion });
        }
        const view = toView(rows[0]);
        this.emitWritten(tenantId, view);
        return view;
    }

    /**
     * Acepta los valores por defecto de la plataforma (C0 §2.5): una fila `origin=default_accepted` con la
     * `spec_version` vigente por requisito. No pisa un valor que el negocio ya configuró.
     */
    async acceptDefaults(tenantId: string, ids: string[], specVersion: string, actor: BusinessFactActor)
        : Promise<{ specVersion: string; accepted: string[]; skipped: { id: string; reason: string }[] }> {
        if (specVersion !== this.spec.specVersion) {
            throw new ConflictException({ message: 'la especificación cambió: vuelve a revisar los valores por defecto', specVersion: this.spec.specVersion });
        }
        const unique = [...new Set((ids ?? []).map(String))];
        if (!unique.length) throw new BadRequestException('ids vacío');
        const current = new Map((await this.list(tenantId)).map(f => [`${f.requirementId}|${f.scopeKey}`, f]));
        const accepted: string[] = [];
        const skipped: { id: string; reason: string }[] = [];
        for (const id of unique) {
            const issues = validateRequirementValue(this.spec, id, { value: null, status: 'confirmed', origin: 'default_accepted', scopeKey: '' });
            if (issues.length) { skipped.push({ id, reason: issues.map(i => i.message).join('; ') }); continue; }
            const existing = current.get(`${id}|`);
            if (existing && existing.status === 'confirmed' && !MIGRATION_ORIGINS.has(existing.origin) && existing.origin !== 'default_accepted') {
                skipped.push({ id, reason: `ya configurado (${existing.origin})` });
                continue;
            }
            await this.write(tenantId, { requirementId: id, value: null, origin: 'default_accepted', status: 'confirmed' }, actor);
            accepted.push(id);
        }
        return { specVersion: this.spec.specVersion, accepted, skipped };
    }

    async list(tenantId: string): Promise<BusinessFactView[]> {
        const rows = await this.read<Record<string, any>[]>(tenantId,
            `SELECT ${VIEW_COLUMNS} FROM requirement_values ORDER BY requirement_id, scope_key`, []);
        return rows.map(toView);
    }

    async get(tenantId: string, requirementId: string, scopeKey = ''): Promise<{ specVersion: string; requirementId: string; scopeKey: string; fact: BusinessFactView | null }> {
        if (!this.spec.requirements[requirementId]) throw new NotFoundException(`requisito desconocido: ${requirementId}`);
        const rows = await this.read<Record<string, any>[]>(tenantId,
            `SELECT ${VIEW_COLUMNS} FROM requirement_values WHERE requirement_id = $1 AND scope_key = $2`, [requirementId, scopeKey]);
        return { specVersion: this.spec.specVersion, requirementId, scopeKey, fact: rows[0] ? toView(rows[0]) : null };
    }

    /** Versiones de un valor, la más reciente primero (quién y cuándo). */
    async history(tenantId: string, requirementId: string, scopeKey = '', limit = 50): Promise<BusinessFactVersionView[]> {
        const n = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
        const rows = await this.read<Record<string, any>[]>(tenantId,
            `SELECT value_id::text AS value_id, requirement_id, scope_key, value, status, origin, confirmed_by::text AS confirmed_by, confirmed_at,
                    source_ref, valid_until, spec_version, version, actor, created_at
               FROM requirement_value_versions WHERE requirement_id = $1 AND scope_key = $2
              ORDER BY version DESC LIMIT $3`, [requirementId, scopeKey, n]);
        return rows.map(r => {
            const { id: _id, updatedAt: _u, ...rest } = toView({ ...r, id: r.value_id, updated_at: r.created_at });
            return { ...rest, valueId: r.value_id, actor: r.actor, createdAt: toIso(r.created_at) as string };
        });
    }

    private raiseIssues(requirementId: string, issues: ValueIssue[]): void {
        if (!issues.length) return;
        if (issues.some(i => i.code === 'unknown_requirement')) throw new NotFoundException(`requisito desconocido: ${requirementId}`);
        throw new BadRequestException({ message: `el valor de ${requirementId} no cumple la especificación`, issues });
    }

    private emitWritten(tenantId: string, view: BusinessFactView): void {
        const event: BusinessFactWrittenEvent = { tenantId, requirementId: view.requirementId, scopeKey: view.scopeKey, version: view.version, origin: view.origin };
        this.events?.emit(BUSINESS_FACT_WRITTEN, event);
    }

    private async run<T>(tenantId: string, sql: string, params: unknown[]): Promise<T> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        try {
            return await this.prisma.executeInTenantSchema<T>(schema, sql, params as any[]);
        } catch (err) {
            if (isUndefinedTable(err)) {
                this.logger.warn(`business-facts: ${schema} sin requirement_values (falta migrar el tenant)`);
                throw new ServiceUnavailableException('el negocio aún no tiene la tabla de valores; reintenta después del despliegue');
            }
            throw err;
        }
    }

    /** Lectura: sin la tabla (tenant aún no migrado) no hay valores. */
    private async read<T extends unknown[]>(tenantId: string, sql: string, params: unknown[]): Promise<T> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        try {
            return await this.prisma.executeInTenantSchema<T>(schema, sql, params as any[]);
        } catch (err) {
            if (isUndefinedTable(err)) return [] as unknown as T;
            throw err;
        }
    }
}
