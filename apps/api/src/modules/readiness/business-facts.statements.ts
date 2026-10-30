/**
 * Sentencias de escritura de los valores del negocio (C0 §2.1 y §2.2, rebanada R3). Son parte de BusinessFactsService:
 * viven aparte, sin dependencias de Nest ni de Prisma, para que la migración de procedencia
 * (scripts/readiness/backfill-provenance.ts) escriba con exactamente el mismo SQL. business-facts-writes.spec.ts
 * admite escrituras sobre `requirement_values` solo en este archivo y en business-facts.service.ts.
 */
import { PROVENANCE_TABLES, type LegacyPatch, type PlannedRow, type StoredStatus } from '@parallext/business-spec';

/** Quién escribe. Una persona (con su delegación si actúa por suplantación) o un script de la plataforma. */
export type BusinessFactActor =
    | { kind: 'user'; userId: string | null; role?: string | null; delegation?: Record<string, unknown> }
    | { kind: 'script'; name: string };

export interface BusinessFactView {
    id: string;
    requirementId: string;
    scopeKey: string;
    value: unknown;
    status: StoredStatus;
    origin: string;
    confirmedBy: string | null;
    confirmedAt: string | null;
    sourceRef: unknown;
    validUntil: string | null;
    specVersion: string;
    version: number;
    updatedAt: string;
}

export interface BusinessFactVersionView extends Omit<BusinessFactView, 'id' | 'updatedAt'> {
    valueId: string;
    actor: unknown;
    createdAt: string;
}

// ─────────────────────────── sentencias (única fuente del SQL de escritura) ───────────────────────────

export interface RequirementValueStatementInput {
    requirementId: string;
    scopeKey: string;
    value: unknown;
    status: StoredStatus;
    origin: string;
    confirmedBy: string | null;
    confirmedAt: string | null;
    sourceRef: unknown;
    validUntil: string | null;
    specVersion: string;
    actor: BusinessFactActor;
    expectedVersion?: number | null;
}

export const VIEW_COLUMNS = `id::text AS id, requirement_id, scope_key, value, status, origin, confirmed_by::text AS confirmed_by, confirmed_at,
       source_ref, valid_until, spec_version, version, updated_at`;

/**
 * Una sola sentencia: escribe el valor (o no, si `insert_if_absent` y ya existe) y su versión. Las sentencias de
 * datos dentro de un WITH se ejecutan siempre y en la misma instantánea, así que no hay valor sin versión.
 */
export function requirementValueWriteStatement(input: RequirementValueStatementInput, mode: 'upsert' | 'insert_if_absent'): { sql: string; params: unknown[] } {
    const conflict = mode === 'insert_if_absent'
        ? 'ON CONFLICT (requirement_id, scope_key) DO NOTHING'
        : `ON CONFLICT (requirement_id, scope_key) DO UPDATE SET
              value = EXCLUDED.value, status = EXCLUDED.status, origin = EXCLUDED.origin, confirmed_by = EXCLUDED.confirmed_by,
              confirmed_at = EXCLUDED.confirmed_at, source_ref = EXCLUDED.source_ref, valid_until = EXCLUDED.valid_until,
              spec_version = EXCLUDED.spec_version, version = rv.version + 1, updated_at = now()
            WHERE $12::int IS NULL OR rv.version = $12::int`;
    const sql = `WITH written AS (
    INSERT INTO requirement_values AS rv
        (requirement_id, scope_key, value, status, origin, confirmed_by, confirmed_at, source_ref, valid_until, spec_version, version, updated_at)
    VALUES ($1, $2, $3::jsonb, $4, $5, $6::uuid, $7::timestamptz, $8::jsonb, $9::timestamptz, $10, 1, now())
    ${conflict}
    RETURNING *
), versioned AS (
    INSERT INTO requirement_value_versions
        (value_id, requirement_id, scope_key, value, status, origin, confirmed_by, confirmed_at, source_ref, valid_until, spec_version, version, actor)
    SELECT id, requirement_id, scope_key, value, status, origin, confirmed_by, confirmed_at, source_ref, valid_until, spec_version, version, $11::jsonb
      FROM written
    RETURNING value_id
)
SELECT ${VIEW_COLUMNS} FROM written`;
    const params: unknown[] = [
        input.requirementId, input.scopeKey, JSON.stringify(input.value ?? null), input.status, input.origin, input.confirmedBy,
        input.confirmedAt, input.sourceRef === null || input.sourceRef === undefined ? null : JSON.stringify(input.sourceRef),
        input.validUntil, input.specVersion, JSON.stringify(input.actor),
    ];
    if (mode === 'upsert') params.push(input.expectedVersion ?? null);
    return { sql, params };
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Procedencia de una fila de catálogo o texto (C0 §2.2). Estampa `source_ref.row_updated_at` con el `updated_at` de
 * la fila: si después la edita una pantalla que no conoce estas columnas, la lectura vuelve a las reglas L. Solo toca
 * filas sin procedencia vigente (idempotente) y nunca cambia `updated_at`.
 */
export function rowProvenanceStatement(row: PlannedRow): { sql: string; params: unknown[] } {
    const cfg = PROVENANCE_TABLES[row.table];
    if (!cfg) throw new Error(`tabla sin columnas de procedencia: ${row.table}`);
    const sets = [
        'content_status = $2', 'origin = $3',
        `confirmed_at = CASE WHEN $2 = 'confirmed' THEN coalesce(updated_at, created_at) ELSE NULL END`,
        `source_ref = $4::jsonb || jsonb_build_object('row_updated_at', to_jsonb(updated_at))`,
    ];
    const params: unknown[] = [row.id, row.contentStatus, row.origin, JSON.stringify({ backfill: row.sourceRef.backfill, legacy_rule: row.sourceRef.legacy_rule })];
    if (cfg.kind === 'item') { params.push(row.priceType); sets.push(`price_type = $${params.length}`); }
    if (cfg.kind === 'item' && !cfg.legacyPriceStatus && row.priceStatus !== undefined) { params.push(row.priceStatus); sets.push(`price_status = $${params.length}`); }
    return {
        sql: `UPDATE ${quoteIdent(row.table)} SET ${sets.join(', ')}
 WHERE id = $1::uuid AND (origin IS NULL OR source_ref->'row_updated_at' IS DISTINCT FROM to_jsonb(updated_at))`,
        params,
    };
}

export const toIso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

export function toView(r: Record<string, any>): BusinessFactView {
    return {
        id: r.id, requirementId: r.requirement_id, scopeKey: r.scope_key, value: r.value ?? null, status: r.status, origin: r.origin,
        confirmedBy: r.confirmed_by ?? null, confirmedAt: toIso(r.confirmed_at), sourceRef: r.source_ref ?? null,
        validUntil: toIso(r.valid_until), specVersion: r.spec_version, version: Number(r.version), updatedAt: toIso(r.updated_at) as string,
    };
}

// ─────────────────────────── proyección al almacenamiento viejo (R3b, expand) ───────────────────────────

/**
 * Sentencias que escriben la proyección de un valor en su almacenamiento de hoy (C0 §2 expand-contract, ADR 0009), en
 * la MISMA transacción que el valor: si la escritura del valor falla (409 por versión), la proyección se deshace. Se
 * ejecutan con `search_path` en el esquema del tenant; `public.tenants` va calificado.
 *
 * - horario → `tenants.settings.businessHours` (y sube `agent_personas.version`, como la pantalla de horario: la
 *   configuración que sirve el agente cambió);
 * - nombre → `tenants.name`;
 * - descripción, sede principal y contacto → la fila `is_primary` de `companies` (se crea si no hay), y el público en
 *   `settings.customerTypes`;
 * - políticas → una versión nueva y activa en `policies` (la anterior queda inactiva, como en PoliciesService).
 *
 * Se retiran en la release siguiente, cuando nadie lea el almacenamiento viejo (docs/domain/business-readiness-runtime.md).
 */
export function legacyPatchStatements(tenantId: string, patch: LegacyPatch, actorLabel: string): { sql: string; params: unknown[] }[] {
    switch (patch.kind) {
        case 'settings.businessHours':
            return [
                {
                    sql: `UPDATE public.tenants SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('businessHours', $2::jsonb), updated_at = NOW()
 WHERE id = $1::uuid RETURNING id`,
                    params: [tenantId, JSON.stringify(patch.businessHours)],
                },
                { sql: 'UPDATE agent_personas SET version = COALESCE(version, 0) + 1, updated_at = NOW() RETURNING id', params: [] },
            ];
        case 'tenants.name':
            return [{ sql: 'UPDATE public.tenants SET name = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING id', params: [tenantId, patch.name] }];
        case 'companies': {
            const cols = Object.keys(patch.fields).filter(c => COMPANY_COLUMNS.has(c));
            const values = cols.map(c => (c === 'social_links' ? JSON.stringify(patch.fields[c] ?? {}) : patch.fields[c] ?? null));
            const cast = (c: string, i: number) => (c === 'social_links' ? `$${i}::jsonb` : `$${i}`);
            const out: { sql: string; params: unknown[] }[] = [];
            if (cols.length) {
                out.push({
                    sql: `WITH updated AS (
    UPDATE companies SET ${cols.map((c, i) => `${c} = ${cast(c, i + 2)}`).join(', ')}, updated_at = NOW() WHERE is_primary = true RETURNING id
)
INSERT INTO companies (name, is_primary, ${cols.join(', ')}, updated_at)
SELECT (SELECT name FROM public.tenants WHERE id = $1::uuid), true, ${cols.map((c, i) => cast(c, i + 2)).join(', ')}, NOW()
 WHERE NOT EXISTS (SELECT 1 FROM updated)
RETURNING id`,
                    params: [tenantId, ...values],
                });
            }
            if (patch.customerTypes) {
                out.push({
                    sql: `UPDATE public.tenants SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('customerTypes', $2::jsonb), updated_at = NOW()
 WHERE id = $1::uuid RETURNING id`,
                    params: [tenantId, JSON.stringify(patch.customerTypes)],
                });
            }
            return out;
        }
        case 'policies':
            return [
                { sql: 'UPDATE policies SET is_active = false, effective_to = NOW(), updated_at = NOW() WHERE type = $1 AND is_active = true RETURNING id', params: [patch.type] },
                {
                    sql: `INSERT INTO policies (type, title, content, version, is_active, created_by)
SELECT $1, $2, $3, COALESCE(MAX(version), 0) + 1, true, $4 FROM policies WHERE type = $1
RETURNING id`,
                    params: [patch.type, patch.title, patch.content, actorLabel],
                },
            ];
    }
}

/** Columnas de `companies` que puede escribir una proyección (lista cerrada: el nombre de columna va en el SQL). */
const COMPANY_COLUMNS: ReadonlySet<string> = new Set(['about', 'address', 'city', 'country', 'phone', 'email', 'website', 'social_links']);
