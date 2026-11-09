import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { LlmKeyService } from '../../settings/llm-key.service';
import type { ILLMProvider } from '../interfaces/illm-provider.interface';
import {
    activeLlmCatalog, CATALOG_ROLES, CATALOG_TASKS, catalogContent, catalogHeadChanges, catalogIntegrityProblems, catalogModel,
    parseLlmCatalogSnapshot, sameCatalogContent, SEED_LLM_CATALOG, setActiveLlmCatalog,
    type LlmCatalogSnapshot, type ModelConfig,
} from '../router/llm-catalog';

/** Número de la versión activa. Publicar lo cambia; cada proceso lo mira como mucho cada 10 s (ADR-0030 §2). */
export const LLM_CATALOG_VERSION_KEY = 'llm:catalog:active_version';
export const LLM_CATALOG_REFRESH_MS = 10_000;
const PROBE_TIMEOUT_MS = 30_000;
const PUBLISH_LOCK = 'llm_catalog_versions';

export type CatalogVersionStatus = 'draft' | 'active' | 'superseded';

export interface CatalogVersionRow {
    id: string;
    version: number;
    status: CatalogVersionStatus;
    snapshot: unknown;
    parent_version: number | null;
    reason: string;
    created_by: string | null;
    published_by: string | null;
    created_at: Date;
    published_at: Date | null;
    validation: CatalogValidation | null;
}

export interface CatalogProbe {
    model: string;
    provider: string;
    turn: 'ok' | 'failed';
    tools?: 'ok' | 'failed';
    error?: string;
}

/** El resultado de las validaciones de §4, guardado en `validation`. */
export interface CatalogValidation {
    checkedAt: string;
    /** Versión activa contra la que se comparó (cabezas y modelos nuevos). */
    againstVersion: string;
    valid: boolean;
    blocking: string[];
    warnings: string[];
    headChanges: string[];
    /** Se publicó un cambio de cabeza sin medición (emergencia). El panel lo muestra en rojo. */
    unmeasured: boolean;
    probes: CatalogProbe[];
}

export interface ValidateOptions {
    /** «Publicar sin medición»: un cambio de cabeza deja de bloquear y queda marcado. */
    unmeasured?: boolean;
    /** Volver a una versión que ya rigió: su orden ya fue aceptado, así que la regla de medición no aplica. */
    restoring?: boolean;
}

export interface CatalogActor {
    userId?: string;
    delegation?: Record<string, unknown>;
}

const PROBE_TOOL = Object.freeze({
    name: 'record_probe',
    description: 'Registra el resultado de la sonda del catálogo.',
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
});

/**
 * Catálogo LLM configurable sin desplegar (ADR-0030 fase 2).
 *
 * - Al arrancar carga la versión `active` de `llm_catalog_versions` y la pone a
 *   regir con `setActiveLlmCatalog`. Si la tabla está vacía guarda la semilla de
 *   código como versión 1. Si Postgres no responde, sigue con la semilla.
 * - Cada 10 s compara `llm:catalog:active_version` con la versión cargada y, si
 *   cambió, recarga. Así una publicación llega a la API y al worker sin reiniciar.
 *   Si la recarga falla, conserva la última versión cargada.
 * - Borradores, validación y publicación son del super admin (`LlmCatalogController`).
 */
@Injectable()
export class LlmCatalogService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(LlmCatalogService.name);
    private timer?: ReturnType<typeof setInterval>;
    private loadedVersion: number | null = null;
    private refreshing = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly llmKeys: LlmKeyService,
        @Inject('LLM_PROVIDERS') private readonly providers: ILLMProvider[],
        @Optional() private readonly config?: ConfigService,
    ) { }

    /** `LLM_CATALOG_SOURCE=seed` fuerza la semilla de código (interruptor de emergencia). */
    private get seedOnly(): boolean {
        return String(this.config?.get('LLM_CATALOG_SOURCE') ?? process.env.LLM_CATALOG_SOURCE ?? '').trim().toLowerCase() === 'seed';
    }

    async onModuleInit(): Promise<void> {
        if (this.seedOnly) {
            this.logger.warn('LLM_CATALOG_SOURCE=seed: rige la semilla de código y se ignoran las versiones publicadas');
            return;
        }
        await this.loadActive('startup');
        this.timer = setInterval(() => void this.refresh(), LLM_CATALOG_REFRESH_MS);
        this.timer.unref?.();
    }

    onModuleDestroy(): void {
        if (this.timer) clearInterval(this.timer);
    }

    /** La versión que rige en este proceso. */
    get active(): LlmCatalogSnapshot {
        return activeLlmCatalog();
    }

    /** Compara la clave Redis con la versión cargada y recarga si cambió. */
    async refresh(): Promise<void> {
        if (this.refreshing) return;
        this.refreshing = true;
        try {
            const raw = await this.redis.get(LLM_CATALOG_VERSION_KEY);
            if (raw == null) {
                // Redis perdió la clave (reinicio sin persistencia): la base manda y se vuelve a escribir.
                await this.loadActive('redis_missing');
            } else if (Number(raw) !== this.loadedVersion) {
                await this.loadActive('published');
            }
        } catch (e: any) {
            this.logger.warn(`Catalog refresh failed, keeping v${activeLlmCatalog().version}: ${e?.message}`);
        } finally {
            this.refreshing = false;
        }
    }

    /** Carga la versión activa de la base. Nunca lanza: ante un fallo conserva la versión que rige. */
    async loadActive(reason: 'startup' | 'published' | 'redis_missing'): Promise<void> {
        try {
            let row = await this.activeRow();
            if (!row) row = await this.bootstrapSeed();
            if (!row) return;
            const parsed = parseLlmCatalogSnapshot(row.snapshot, String(row.version));
            if (!parsed.snapshot) {
                this.logger.error(`Active catalog v${row.version} is malformed (${parsed.problems.join(', ')}); keeping v${activeLlmCatalog().version}`);
                return;
            }
            const previous = activeLlmCatalog().version;
            setActiveLlmCatalog(parsed.snapshot);
            this.loadedVersion = row.version;
            await this.redis.getClient().set(LLM_CATALOG_VERSION_KEY, String(row.version), 'NX').catch(() => undefined);
            if (previous !== parsed.snapshot.version) {
                const drift = sameCatalogContent(parsed.snapshot, SEED_LLM_CATALOG) ? '' : ' (distinta de la semilla de código)';
                this.logger.log(`LLM catalog v${row.version} active (${reason}; before: ${previous})${drift}`);
            }
        } catch (e: any) {
            const level = reason === 'startup' ? 'warn' : 'debug';
            this.logger[level](`LLM catalog load failed (${reason}), keeping v${activeLlmCatalog().version}: ${e?.message}`);
        }
    }

    private async activeRow(): Promise<CatalogVersionRow | undefined> {
        const rows = await this.prisma.$queryRaw<CatalogVersionRow[]>`
            SELECT * FROM "public"."llm_catalog_versions" WHERE "status" = 'active' LIMIT 1`;
        return rows[0];
    }

    /** Base vacía: la semilla de código pasa a ser la versión 1. Dos procesos a la vez no la duplican. */
    private async bootstrapSeed(): Promise<CatalogVersionRow | undefined> {
        const snapshot = JSON.stringify(catalogContent(SEED_LLM_CATALOG));
        const validation = JSON.stringify(this.integrityOnly(SEED_LLM_CATALOG));
        await this.prisma.$executeRaw`
            INSERT INTO "public"."llm_catalog_versions" ("version", "status", "snapshot", "reason", "published_at", "validation")
            SELECT 1, 'active', ${snapshot}::jsonb, 'Semilla de código (llm-catalog.ts) al crear el catálogo versionado', NOW(), ${validation}::jsonb
            WHERE NOT EXISTS (SELECT 1 FROM "public"."llm_catalog_versions")
            ON CONFLICT DO NOTHING`;
        const row = await this.activeRow();
        if (row?.version === 1) this.logger.log('LLM catalog: seed stored as version 1');
        return row;
    }

    /** La versión activa según la base (la de memoria puede ir hasta 10 s atrasada); la de memoria si la base no responde. */
    private async currentFromDb(): Promise<LlmCatalogSnapshot> {
        const row = await this.activeRow().catch(() => undefined);
        const parsed = row ? parseLlmCatalogSnapshot(row.snapshot, String(row.version)) : undefined;
        return parsed?.snapshot ?? activeLlmCatalog();
    }

    private integrityOnly(snapshot: LlmCatalogSnapshot): CatalogValidation {
        const blocking = catalogIntegrityProblems(snapshot);
        return { checkedAt: new Date().toISOString(), againstVersion: 'seed', valid: !blocking.length, blocking, warnings: [], headChanges: [], unmeasured: false, probes: [] };
    }

    // ── Lectura ──────────────────────────────────────────────────────────

    async listVersions(limit = 50): Promise<Omit<CatalogVersionRow, 'snapshot'>[]> {
        const n = Math.max(1, Math.min(Math.trunc(limit) || 50, 200));
        return this.prisma.$queryRaw<Omit<CatalogVersionRow, 'snapshot'>[]>`
            SELECT "id", "version", "status", "parent_version", "reason", "created_by", "published_by",
                   "created_at", "published_at", "validation"
            FROM "public"."llm_catalog_versions" ORDER BY "version" DESC LIMIT ${n}`;
    }

    async getVersion(version: number): Promise<CatalogVersionRow> {
        const rows = await this.prisma.$queryRaw<CatalogVersionRow[]>`
            SELECT * FROM "public"."llm_catalog_versions" WHERE "version" = ${version} LIMIT 1`;
        if (!rows[0]) throw new NotFoundException(`catalog_version_not_found:${version}`);
        return rows[0];
    }

    // ── Borradores ───────────────────────────────────────────────────────

    /** Un borrador nuevo: el snapshot dado, o una copia de `fromVersion` (por defecto la activa). */
    async createDraft(input: { reason: string; fromVersion?: number; snapshot?: unknown }, actor: CatalogActor): Promise<CatalogVersionRow> {
        const reason = requireReason(input.reason);
        const base = input.fromVersion != null ? await this.getVersion(input.fromVersion) : await this.activeRow();
        const content = input.snapshot ?? base?.snapshot ?? catalogContent(SEED_LLM_CATALOG);
        const parsed = parseOrThrow(content);
        const snapshot = JSON.stringify(catalogContent(parsed));
        return this.prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${PUBLISH_LOCK}, 0))::text`;
            const rows = await tx.$queryRaw<CatalogVersionRow[]>`
                INSERT INTO "public"."llm_catalog_versions" ("version", "status", "snapshot", "parent_version", "reason", "created_by")
                SELECT COALESCE(MAX("version"), 0) + 1, 'draft', ${snapshot}::jsonb, ${base?.version ?? null}::int, ${reason}, ${actor.userId ?? null}::uuid
                FROM "public"."llm_catalog_versions"
                RETURNING *`;
            return rows[0];
        });
    }

    /** Reemplaza el snapshot de un borrador. Lo publicado no se edita. */
    async updateDraft(version: number, input: { snapshot?: unknown; reason?: string }): Promise<CatalogVersionRow> {
        const row = await this.getVersion(version);
        if (row.status !== 'draft') throw new ConflictException(`catalog_version_not_draft:${version}:${row.status}`);
        const snapshot = input.snapshot !== undefined ? JSON.stringify(catalogContent(parseOrThrow(input.snapshot))) : null;
        const reason = input.reason !== undefined ? requireReason(input.reason) : null;
        const rows = await this.prisma.$queryRaw<CatalogVersionRow[]>`
            UPDATE "public"."llm_catalog_versions"
            SET "snapshot" = COALESCE(${snapshot}::jsonb, "snapshot"), "reason" = COALESCE(${reason}, "reason"), "validation" = NULL
            WHERE "version" = ${version} AND "status" = 'draft'
            RETURNING *`;
        if (!rows[0]) throw new ConflictException(`catalog_version_not_draft:${version}`);
        return rows[0];
    }

    // ── Validación (ADR-0030 §4) ─────────────────────────────────────────

    async validateDraft(version: number, options: ValidateOptions = {}): Promise<CatalogValidation> {
        const row = await this.getVersion(version);
        if (row.status !== 'draft') throw new ConflictException(`catalog_version_not_draft:${version}:${row.status}`);
        const validation = await this.validate(parseOrThrow(row.snapshot, String(row.version)), options);
        await this.prisma.$executeRaw`
            UPDATE "public"."llm_catalog_versions" SET "validation" = ${JSON.stringify(validation)}::jsonb
            WHERE "version" = ${version} AND "status" = 'draft'`;
        return validation;
    }

    /**
     * Las validaciones bloqueantes contra la versión que rige:
     * 1, 2, 5, 6, 7 → `catalogIntegrityProblems`;
     * 3 → una llamada real a cada modelo nuevo, con cambios que afectan la llamada, o que pasa a encabezar algo;
     * 4 → cada cadena con al menos dos proveedores con clave configurada.
     * Cambiar una cabeza exige medición: hasta la fase 4 no hay tabla de mediciones,
     * así que sólo pasa con «publicar sin medición» o al volver a una versión anterior.
     */
    async validate(candidate: LlmCatalogSnapshot, options: ValidateOptions = {}): Promise<CatalogValidation> {
        const current = await this.currentFromDb();
        const blocking = catalogIntegrityProblems(candidate);
        const warnings: string[] = [];

        const configured = new Map<string, boolean>();
        for (const provider of new Set(candidate.models.map(m => m.provider))) {
            configured.set(provider, await this.llmKeys.isConfigured(provider).catch(() => false));
        }
        for (const task of CATALOG_TASKS) {
            const providers = new Set(candidate.chains[task]
                .map(id => catalogModel(id, candidate)?.provider)
                .filter((p): p is string => !!p && configured.get(p) === true));
            if (providers.size < 2) blocking.push(`chain_configured_providers:${task}:${providers.size}`);
        }

        const headChanges = catalogHeadChanges(current, candidate);
        let unmeasured = false;
        if (headChanges.length && !options.restoring) {
            if (options.unmeasured) {
                unmeasured = true;
                warnings.push(...headChanges.map(c => `unmeasured_head_change:${c}`));
            } else {
                blocking.push(...headChanges.map(c => `head_change_requires_measurement:${c}`));
            }
        }

        const probes: CatalogProbe[] = [];
        // Sin probar si la forma ya falló: un modelo con familia desconocida daría 400 igual.
        const toProbe = blocking.some(p => p.startsWith('unknown_family:')) ? [] : modelsToProbe(current, candidate);
        for (const model of toProbe) {
            if (!configured.get(model.provider)) {
                warnings.push(`probe_skipped_no_key:${model.id}`);
                continue;
            }
            const probe = await this.probe(model);
            probes.push(probe);
            if (probe.turn !== 'ok' || probe.tools === 'failed') blocking.push(`probe_failed:${model.id}:${probe.error ?? 'unknown'}`);
        }

        return {
            checkedAt: new Date().toISOString(),
            againstVersion: current.version,
            valid: blocking.length === 0,
            blocking: [...new Set(blocking)],
            warnings: [...new Set(warnings)],
            headChanges,
            unmeasured,
            probes,
        };
    }

    /** Llamada real con el adaptador del proveedor: un turno corto y, si el modelo tiene herramientas, una llamada a herramienta. */
    async probe(model: Readonly<ModelConfig>): Promise<CatalogProbe> {
        const provider = this.providers.find(p => p.providerName === model.provider);
        const out: CatalogProbe = { model: model.id, provider: model.provider, turn: 'failed' };
        if (!provider) return { ...out, error: 'no_adapter' };
        try {
            const reply = await withTimeout(provider.generate({
                model: model.id, temperature: 0, maxTokens: 256,
                messages: [{ role: 'user', content: 'Responde sólo con la palabra: ok' }],
            }), PROBE_TIMEOUT_MS);
            if (!reply?.content?.trim()) return { ...out, error: 'empty_reply' };
            out.turn = 'ok';
            if (model.supportsTools) {
                out.tools = 'failed';
                const call = await withTimeout(provider.generate({
                    model: model.id, temperature: 0, maxTokens: 256, tools: [PROBE_TOOL],
                    messages: [{ role: 'user', content: 'Llama a la herramienta record_probe con value igual a "ok". No escribas texto.' }],
                }), PROBE_TIMEOUT_MS);
                const first = call?.toolCalls?.[0];
                if (first?.function?.name !== PROBE_TOOL.name) return { ...out, error: 'no_tool_call' };
                let args: any;
                try { args = JSON.parse(first.function.arguments || '{}'); } catch { return { ...out, error: 'tool_args_not_json' }; }
                if (typeof args?.value !== 'string') return { ...out, error: 'tool_args_invalid' };
                out.tools = 'ok';
            }
            return out;
        } catch (e: any) {
            const status = e?.status ?? e?.response?.status;
            return { ...out, error: `${status ? `${status} ` : ''}${String(e?.message ?? e).slice(0, 200)}` };
        }
    }

    // ── Publicación ──────────────────────────────────────────────────────

    /**
     * Valida de nuevo (el estado de los proveedores pudo cambiar desde «Validar») y, si
     * nada bloquea, la publica en una transacción: la activa pasa a `superseded` y el
     * borrador a `active`. Después cambia la clave Redis y la aplica en este proceso;
     * los demás la toman en ≤10 s.
     */
    async publish(version: number, options: ValidateOptions & { reason?: string }, actor: CatalogActor): Promise<{ version: CatalogVersionRow; validation: CatalogValidation }> {
        if (options.unmeasured && !options.reason?.trim()) throw new BadRequestException('unmeasured_requires_reason');
        const row = await this.getVersion(version);
        if (row.status !== 'draft') throw new ConflictException(`catalog_version_not_draft:${version}:${row.status}`);
        const candidate = parseOrThrow(row.snapshot, String(row.version));
        const validation = await this.validate(candidate, options);
        const stored = { ...validation, ...(options.reason?.trim() ? { publishReason: options.reason.trim() } : {}) };
        await this.prisma.$executeRaw`
            UPDATE "public"."llm_catalog_versions" SET "validation" = ${JSON.stringify(stored)}::jsonb
            WHERE "version" = ${version} AND "status" = 'draft'`;
        if (!validation.valid) throw new ConflictException({ message: 'catalog_validation_failed', validation });

        const published = await this.prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${PUBLISH_LOCK}, 0))::text`;
            const active = await tx.$queryRaw<{ version: number }[]>`
                SELECT "version" FROM "public"."llm_catalog_versions" WHERE "status" = 'active' FOR UPDATE`;
            // Otro super admin publicó entre la validación y este punto: la validación ya no vale.
            if (String(active[0]?.version ?? 'seed') !== validation.againstVersion) {
                throw new ConflictException(`catalog_active_changed:${validation.againstVersion}->${active[0].version}`);
            }
            await tx.$executeRaw`
                UPDATE "public"."llm_catalog_versions" SET "status" = 'superseded' WHERE "status" = 'active'`;
            const rows = await tx.$queryRaw<CatalogVersionRow[]>`
                UPDATE "public"."llm_catalog_versions"
                SET "status" = 'active', "published_by" = ${actor.userId ?? null}::uuid, "published_at" = NOW()
                WHERE "version" = ${version} AND "status" = 'draft'
                RETURNING *`;
            if (!rows[0]) throw new ConflictException(`catalog_version_not_draft:${version}`);
            await tx.auditLog.create({
                data: {
                    userId: actor.userId ?? null,
                    tenantId: null,
                    action: 'llm_catalog.published',
                    resource: `llm_catalog_versions/${version}`,
                    details: {
                        version, previous: active[0]?.version ?? null, reason: row.reason, publishReason: options.reason?.trim() || null,
                        headChanges: validation.headChanges, unmeasured: validation.unmeasured, restoring: !!options.restoring,
                        ...(actor.delegation ?? {}),
                    } as any,
                },
            });
            return rows[0];
        });

        await this.redis.set(LLM_CATALOG_VERSION_KEY, String(version)).catch(e => this.logger.warn(`Catalog version key not updated: ${e?.message}`));
        setActiveLlmCatalog(candidate);
        this.loadedVersion = version;
        this.logger.warn(`LLM catalog v${version} published by ${actor.userId ?? 'unknown'}${validation.unmeasured ? ' WITHOUT measurement' : ''}`
            + `${validation.headChanges.length ? ` (heads: ${validation.headChanges.join(', ')})` : ''}`);
        return { version: published, validation };
    }

    /** Volver a una versión anterior: una versión nueva con su snapshot, publicada en el acto. */
    async restore(version: number, reason: string, actor: CatalogActor): Promise<{ version: CatalogVersionRow; validation: CatalogValidation }> {
        const source = await this.getVersion(version);
        if (source.status === 'draft') throw new ConflictException(`catalog_restore_requires_published:${version}`);
        const draft = await this.createDraft({ reason: `${requireReason(reason)} (vuelve a v${version})`, snapshot: source.snapshot }, actor);
        return this.publish(draft.version, { restoring: true, reason }, actor);
    }
}

/** Modelos a llamar al validar: nuevos, con cambios que afectan la llamada, o que pasan a encabezar una cadena o rol. */
export function modelsToProbe(current: LlmCatalogSnapshot, candidate: LlmCatalogSnapshot): Readonly<ModelConfig>[] {
    const referenced = new Set<string>([
        ...CATALOG_TASKS.flatMap(t => candidate.chains[t]),
        ...CATALOG_ROLES.flatMap(r => candidate.roles[r]),
    ]);
    const heads = new Set<string>([
        ...CATALOG_TASKS.filter(t => current.chains[t][0] !== candidate.chains[t][0]).map(t => candidate.chains[t][0]),
        ...CATALOG_ROLES.filter(r => current.roles[r][0] !== candidate.roles[r][0]).map(r => candidate.roles[r][0]),
    ]);
    return candidate.models.filter(m => {
        if (m.retired || !referenced.has(m.id)) return false;
        const before = catalogModel(m.id, current);
        return !before || before.retired || before.provider !== m.provider || before.supportsTools !== m.supportsTools || heads.has(m.id);
    });
}

function requireReason(reason: unknown): string {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (!text) throw new BadRequestException('reason_required');
    if (text.length > 2000) throw new BadRequestException('reason_too_long');
    return text;
}

function parseOrThrow(raw: unknown, version = 'draft'): LlmCatalogSnapshot {
    const parsed = parseLlmCatalogSnapshot(raw, version);
    if (!parsed.snapshot) throw new BadRequestException({ message: 'catalog_snapshot_malformed', problems: parsed.problems });
    return parsed.snapshot;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout_${ms}ms`)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
