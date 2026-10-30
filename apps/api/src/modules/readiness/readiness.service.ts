/**
 * ReadinessService (C0 §1.1 y §2.7, rebanada R2): la preparación del negocio de un tenant.
 *
 * Solo E/S alrededor del motor puro de @parallext/business-spec: lee la foto (SnapshotReader, solo lectura),
 * evalúa, guarda el historial (`readiness_evaluations`, una fila por resultado distinto) y deja la última
 * evaluación en Redis. Ninguna regla de preparación vive aquí.
 */
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
    evaluate, formFor, formRequirementIds, fromLegacyRows, resolveValue, screenTargetsFor,
    type CompiledSpec, type FormDescriptor, type ReadinessResult, type RequirementEvaluation, type TenantSnapshot, type ValueRecord,
    type ValueState, type Verdict,
} from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/load';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SnapshotReader, type SqlJsonRunner } from './snapshot-reader';

/** Quién pidió la evaluación (columna `trigger`). */
export type ReadinessTrigger = 'on_demand' | 'refresh' | 'invalidated';

export interface ReadinessView {
    /** Fila de `readiness_evaluations` con este resultado; null si el historial no se pudo escribir. */
    evaluationId: string | null;
    evaluatedAt: string;
    trigger: ReadinessTrigger;
    /** true si la respuesta salió de la caché. */
    cached: boolean;
    result: ReadinessResult;
}

export interface ReadinessHistoryEntry {
    id: string;
    specVersion: string;
    verdict: Verdict;
    resultHash: string;
    counts: ReadinessResult['counts'];
    blockingGaps: string[];
    trigger: string;
    createdAt: string;
}

export interface RequirementDetail {
    specVersion: string;
    definition: {
        id: string; title: string; layer: string; kind: string; level: string; rule: string;
        predicate: string; whenMissing: { code: string; behavior: string; never: string[] };
        uiToday: string; uiTarget: string | null; platform: boolean;
        answers: { id: string; title: string }[];
    };
    evaluation: RequirementEvaluation | null;
    evaluatedAt: string;
    /** Descriptor del formulario del cajón (C0 §1.6, `formFor`): lo sirve la API para que el panel no se desfase. */
    form: FormDescriptor;
    /**
     * El valor que lee el motor ahora (alcance global), con su procedencia: el de `requirement_values` o el heredado
     * de las pantallas actuales (reglas L). El cajón lo usa para precargar el formulario.
     */
    current: { state: ValueState; record: ValueRecord | null; conflicts: ValueRecord[] };
}

/** La caché vive poco: los escritores de hoy no avisan todos (R3 agrega `business_fact.written`). */
export const READINESS_CACHE_TTL_SECONDS = 10 * 60;
export const READINESS_HISTORY_MAX = 100;
const UNDEFINED_TABLE = '42P01';

export const readinessCacheKey = (tenantId: string, specVersion: string) => `readiness:${tenantId}:${specVersion}`;

/** SQL de solo lectura por Prisma: una transacción READ ONLY que devuelve un único valor JSON. */
export function prismaJsonRunner(prisma: PrismaService): SqlJsonRunner {
    return {
        async queryJson<T>(sql: string): Promise<T> {
            const rows = await prisma.$transaction(async (tx: any) => {
                await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
                return tx.$queryRawUnsafe(`SELECT q.v::jsonb AS v FROM (${sql.trim().replace(/;\s*$/, '')}) AS q(v)`);
            }, { timeout: 15_000, maxWait: 10_000 }) as Array<{ v: T }>;
            return rows[0]?.v as T;
        },
    };
}

const isUndefinedTable = (err: unknown) => (err as { code?: string; meta?: { code?: string } })?.code === UNDEFINED_TABLE
    || (err as { meta?: { code?: string } })?.meta?.code === UNDEFINED_TABLE
    || /relation .*readiness_evaluations.* does not exist/i.test(String((err as Error)?.message ?? ''));

@Injectable()
export class ReadinessService {
    private readonly logger = new Logger(ReadinessService.name);
    private specCache: CompiledSpec | null = null;
    /** Una evaluación en curso por tenant: dos pedidos simultáneos comparten la misma. */
    private readonly inflight = new Map<string, Promise<ReadinessView>>();
    private formIds: string[] | null = null;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        @Optional() private readonly events?: EventEmitter2,
    ) {}

    /** La hora de la evaluación (los tests la fijan). */
    protected now(): Date {
        return new Date();
    }

    get spec(): CompiledSpec {
        this.specCache ??= loadSpec();
        return this.specCache;
    }

    /** Última evaluación: de la caché si la hay y no se pide `refresh`; si no, evalúa ahora. */
    async getCurrent(tenantId: string, options: { refresh?: boolean } = {}): Promise<ReadinessView> {
        if (!options.refresh) {
            const cached = await this.readCache(tenantId);
            if (cached) return { ...cached, cached: true };
        }
        return this.evaluateTenant(tenantId, options.refresh ? 'refresh' : 'on_demand');
    }

    /** Veredicto actual, o null si no se pudo leer (nunca lanza: lo usan superficies que no deben caerse). */
    async currentVerdict(tenantId: string): Promise<Verdict | null> {
        try {
            return (await this.getCurrent(tenantId)).result.verdict;
        } catch (err) {
            this.logger.warn(`readiness: veredicto no disponible para ${tenantId}: ${(err as Error).message}`);
            return null;
        }
    }

    /** Lee la foto, evalúa, guarda si cambió y deja el resultado en caché. */
    evaluateTenant(tenantId: string, trigger: ReadinessTrigger): Promise<ReadinessView> {
        const running = this.inflight.get(tenantId);
        if (running) return running;
        const job = this.runEvaluation(tenantId, trigger).finally(() => this.inflight.delete(tenantId));
        this.inflight.set(tenantId, job);
        return job;
    }

    /** Borra la caché: el próximo pedido reevalúa. */
    async invalidate(tenantId: string): Promise<void> {
        await this.redis.del(readinessCacheKey(tenantId, this.spec.specVersion));
    }

    async readSnapshot(tenantId: string): Promise<TenantSnapshot> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        const rows = await new SnapshotReader(prismaJsonRunner(this.prisma), () => this.now()).readRows(schema);
        return fromLegacyRows(rows);
    }

    async getHistory(tenantId: string, limit = 30): Promise<ReadinessHistoryEntry[]> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        const n = Math.min(Math.max(Math.trunc(limit) || 30, 1), READINESS_HISTORY_MAX);
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT id::text AS id, spec_version, verdict, result_hash, counts, result->'blockingGaps' AS blocking_gaps, "trigger", created_at
                   FROM readiness_evaluations ORDER BY created_at DESC, id DESC LIMIT $1`, [n]);
            return rows.map(r => ({
                id: r.id, specVersion: r.spec_version, verdict: r.verdict, resultHash: r.result_hash, counts: r.counts,
                blockingGaps: Array.isArray(r.blocking_gaps) ? r.blocking_gaps : [], trigger: r.trigger,
                createdAt: new Date(r.created_at).toISOString(),
            }));
        } catch (err) {
            if (isUndefinedTable(err)) return [];
            throw err;
        }
    }

    /** Pantalla del dato de catálogo según los objetos habilitados del tenant (`screenTargetsFor`). */
    screenTargets(result: ReadinessResult): Record<string, string> {
        return screenTargetsFor(this.spec, result.config.objects.map(o => o.object));
    }

    /** Requisitos que se completan en el cajón del panel (el resto enlaza a su pantalla). */
    get formRequirementIds(): string[] {
        this.formIds ??= formRequirementIds(this.spec);
        return this.formIds;
    }

    async getRequirement(tenantId: string, requirementId: string): Promise<RequirementDetail> {
        const req = this.spec.requirements[requirementId];
        if (!req) throw new NotFoundException(`requisito desconocido: ${requirementId}`);
        const [view, snapshot] = await Promise.all([this.getCurrent(tenantId), this.readSnapshot(tenantId)]);
        const resolved = resolveValue(snapshot.values[requirementId], this.now());
        return {
            specVersion: this.spec.specVersion,
            definition: {
                id: req.id, title: req.title, layer: req.layer, kind: req.kind, level: req.level, rule: req.rule,
                predicate: req.predicate, whenMissing: req.whenMissing, uiToday: req.uiToday, uiTarget: req.uiTarget,
                platform: req.platform,
                answers: req.answers.map(id => ({ id, title: this.spec.intents[id]?.title ?? id })),
            },
            evaluation: view.result.requirements.find(r => r.id === requirementId) ?? null,
            evaluatedAt: view.evaluatedAt,
            form: formFor(req, this.spec),
            current: { state: resolved.state, record: resolved.record, conflicts: resolved.conflicts },
        };
    }

    private async runEvaluation(tenantId: string, trigger: ReadinessTrigger): Promise<ReadinessView> {
        const snapshot = await this.readSnapshot(tenantId);
        const result = evaluate(this.spec, snapshot, this.now());
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        const stored = await this.persist(schema, result, trigger);
        const view: ReadinessView = { evaluationId: stored.id, evaluatedAt: result.asOf, trigger, cached: false, result };
        await this.writeCache(tenantId, view);
        this.events?.emit('readiness.evaluated', { tenantId, verdict: result.verdict, resultHash: result.resultHash, changed: stored.inserted });
        if (stored.inserted && stored.previousVerdict && stored.previousVerdict !== result.verdict) {
            this.events?.emit('readiness.verdict_changed', { tenantId, from: stored.previousVerdict, to: result.verdict });
        }
        return view;
    }

    /**
     * Inserta solo si el `resultHash` difiere de la última fila (C0 §2.7): cada fila del historial es un cambio real.
     * Sin la tabla (tenant aún no migrado) no falla: la preparación se sigue mostrando, sin historial.
     */
    private async persist(schema: string, result: ReadinessResult, trigger: ReadinessTrigger)
        : Promise<{ id: string | null; inserted: boolean; previousVerdict: Verdict | null }> {
        try {
            return await this.prisma.transactionInTenantSchema(schema, async query => {
                const latest = await query<Array<{ id: string; result_hash: string; verdict: Verdict }>>(
                    `SELECT id::text AS id, result_hash, verdict FROM readiness_evaluations ORDER BY created_at DESC, id DESC LIMIT 1`);
                if (latest[0]?.result_hash === result.resultHash) return { id: latest[0].id, inserted: false, previousVerdict: latest[0].verdict };
                const inserted = await query<Array<{ id: string }>>(
                    `INSERT INTO readiness_evaluations (spec_version, snapshot_hash, result_hash, verdict, counts, result, "trigger")
                     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7) RETURNING id::text AS id`,
                    [result.specVersion, result.snapshotHash, result.resultHash, result.verdict,
                        JSON.stringify(result.counts), JSON.stringify(result), trigger]);
                return { id: inserted[0]?.id ?? null, inserted: true, previousVerdict: latest[0]?.verdict ?? null };
            });
        } catch (err) {
            if (!isUndefinedTable(err)) throw err;
            this.logger.warn(`readiness: ${schema} sin readiness_evaluations (falta migrar el tenant); se muestra sin historial`);
            return { id: null, inserted: false, previousVerdict: null };
        }
    }

    private async readCache(tenantId: string): Promise<ReadinessView | null> {
        try {
            const raw = await this.redis.get(readinessCacheKey(tenantId, this.spec.specVersion));
            return raw ? JSON.parse(raw) as ReadinessView : null;
        } catch (err) {
            this.logger.warn(`readiness: caché ilegible para ${tenantId}: ${(err as Error).message}`);
            return null;
        }
    }

    private async writeCache(tenantId: string, view: ReadinessView): Promise<void> {
        try {
            await this.redis.set(readinessCacheKey(tenantId, this.spec.specVersion), JSON.stringify(view), READINESS_CACHE_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`readiness: no se pudo guardar la caché de ${tenantId}: ${(err as Error).message}`);
        }
    }
}
