/**
 * Plan de la migración de procedencia (C0 §2.9, rebanada R3): aplica las reglas L1–L7 UNA vez y deja escrito el
 * resultado como procedencia real. Puro: recibe las filas de un tenant y devuelve qué escribir; la escritura la hace
 * `apps/api/scripts/readiness/backfill-provenance.ts` con las sentencias de `BusinessFactsService`.
 *
 * - Ítems y textos (§2.2): cada fila sin procedencia vigente recibe `content_status`, `origin`, `price_type`,
 *   `price_status` (salvo en las tablas cuyo `price_status` heredado mantienen sus pantallas) y `source_ref` con la
 *   estampa `row_updated_at`. Es exactamente `legacyRowProvenance`, la misma función que usa la lectura.
 * - Valores (§2.1): cada valor que hoy dedujeron las reglas se copia a `requirement_values` (expand: el almacenamiento
 *   de hoy queda donde está) con `source_ref = {migrated_from, migrated_hash}`. Por requisito y alcance se copia uno:
 *   el que manda según §7.2; si dos confirmados se contradicen, el más reciente, y `contradiction_with` nombra al otro
 *   (que se sigue leyendo con reglas L, así la contradicción sigue a la vista hasta que el dueño elija).
 * - No se copian: L4 (valor por defecto de columna: el requisito sigue ausente), la región (C0 §2.3 reutiliza
 *   `tenants.operating_*`), el horario deducido de la agenda y las promociones (son tablas de catálogo, no valores).
 *
 * Idempotente: una fila con procedencia vigente y un valor que ya tiene fila no se vuelven a planear.
 */
import { legacyContextOf, legacyRowProvenance, fromLegacyRows, type LegacyTenantRows } from './legacy-status';
import {
    BACKFILL_MARK, PROVENANCE_TABLES, realRowProvenance, valueFingerprint, type MigratedSourceRef,
} from './provenance';
import { resolveValue } from './status';
import type { CompiledSpec, LegacyRule, PriceType, StoredStatus, ValueRecord } from './types';
import { validateRequirementValue } from './validate-value';

type Row = Record<string, any>;

export interface PlannedValue {
    requirementId: string;
    scopeKey: string;
    value: unknown;
    status: StoredStatus;
    origin: string;
    confirmedAt: string | null;
    sourceRef: MigratedSourceRef;
    specVersion: string;
}

export interface PlannedRow {
    table: string;
    id: string;
    contentStatus: StoredStatus;
    origin: string;
    priceType: PriceType | null;
    /** `undefined` = no se toca (`price_status` heredado de services y membership_plans: lo siguen escribiendo sus pantallas). */
    priceStatus?: 'confirmed' | 'example' | null;
    confirmedAt: string | null;
    sourceRef: { backfill: string; legacy_rule: LegacyRule | null; row_updated_at: unknown };
}

export interface SkippedValue { requirementId: string; scopeKey: string; storage: string; reason: string }

export interface BackfillPlan {
    schema: 'business-spec/provenance-backfill@1';
    tenantRef: string;
    specVersion: string;
    values: PlannedValue[];
    rows: PlannedRow[];
    skipped: SkippedValue[];
    /** Conteos para el informe por esquema: valores por regla y filas por tabla y regla. */
    counts: { values: Record<string, number>; rows: Record<string, Record<string, number>> };
}

/** Almacenamientos de hoy que no se copian a `requirement_values` (ver cabecera). */
const NOT_MIGRATED: ReadonlyArray<{ prefix: string; reason: string }> = [
    { prefix: 'tenants.operating_', reason: 'región: se reutiliza tenants.operating_* y regional_provenance (C0 §2.3)' },
    { prefix: 'availability_slots', reason: 'horario deducido de la agenda: la agenda sigue siendo del profesional, no el horario del negocio' },
    { prefix: 'menu_promotions', reason: 'promociones: viven en sus tablas de catálogo' },
];

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/** Filas de las tablas con procedencia que lee la foto (`LegacyTenantRows`) más las que la foto aún no lee. */
function tableRows(rows: LegacyTenantRows, extra: Record<string, Row[]>): Array<[string, Row[]]> {
    return Object.keys(PROVENANCE_TABLES)
        .map(t => [t, ((rows as unknown as Record<string, Row[] | undefined>)[t] ?? extra[t] ?? [])] as [string, Row[]])
        .filter(([, list]) => Array.isArray(list) && list.length > 0);
}

export function planProvenanceBackfill(
    spec: CompiledSpec, rows: LegacyTenantRows, options: { extraTables?: Record<string, Row[]>; now?: Date } = {},
): BackfillPlan {
    const now = options.now ?? new Date(rows.capturedAt);
    const ctx = legacyContextOf(rows);
    const plan: BackfillPlan = {
        schema: 'business-spec/provenance-backfill@1', tenantRef: rows.tenant.ref, specVersion: spec.specVersion,
        values: [], rows: [], skipped: [], counts: { values: {}, rows: {} },
    };

    // ítems y textos
    for (const [table, list] of tableRows(rows, options.extraTables ?? {})) {
        const cfg = PROVENANCE_TABLES[table];
        for (const row of list) {
            if (realRowProvenance(table, row)) continue;
            const p = legacyRowProvenance(table, row, ctx);
            plan.rows.push({
                table, id: String(row.id), contentStatus: p.contentStatus, origin: p.origin, priceType: cfg.kind === 'item' ? p.priceType : null,
                ...(cfg.kind === 'item' && !cfg.legacyPriceStatus ? { priceStatus: p.priceStatus } : {}),
                confirmedAt: p.contentStatus === 'confirmed' ? (row.updated_at ?? row.created_at ?? null) : null,
                sourceRef: { backfill: BACKFILL_MARK, legacy_rule: p.legacyRule, row_updated_at: row.updated_at ?? null },
            });
            bump(plan.counts.rows[table] ??= {}, p.legacyRule ?? 'real');
        }
    }

    // valores: lo que deducen hoy las reglas L, sin mirar requirement_values
    const legacy = fromLegacyRows({ ...rows, requirement_values: [] });
    const existing = new Set((rows.requirement_values ?? []).map(r => `${r.requirement_id}|${r.scope_key ?? ''}`));
    for (const [requirementId, records] of Object.entries(legacy.values)) {
        const scopes = [...new Set(records.map(r => r.scopeKey ?? ''))];
        for (const scopeKey of scopes) {
            const group = records.filter(r => (r.scopeKey ?? '') === scopeKey);
            const migratable: ValueRecord[] = [];
            for (const r of group) {
                const storage = String(r.storage ?? '');
                const why = r.legacyRule === 'L4' ? 'L4: valor por defecto de columna, el requisito sigue ausente'
                    : NOT_MIGRATED.find(n => storage.startsWith(n.prefix))?.reason;
                if (why) plan.skipped.push({ requirementId, scopeKey, storage, reason: why });
                else migratable.push(r);
            }
            if (!migratable.length) continue;
            if (existing.has(`${requirementId}|${scopeKey}`)) {
                plan.skipped.push({ requirementId, scopeKey, storage: 'requirement_values', reason: 'ya tiene fila (migrada o escrita por el dueño)' });
                continue;
            }
            const resolved = resolveValue(migratable, now, scopeKey);
            const newest = [...resolved.conflicts].sort((a, b) => String(b.confirmedAt ?? '').localeCompare(String(a.confirmedAt ?? '')))[0];
            const pick = resolved.record ?? newest ?? migratable[0];
            const contradiction = resolved.state === 'contradictorio' ? resolved.conflicts.filter(c => c !== pick).map(c => String(c.storage)) : [];
            const issues = validateRequirementValue(spec, requirementId, { value: pick.value, status: pick.status, origin: pick.origin, scopeKey });
            if (issues.length) {
                plan.skipped.push({ requirementId, scopeKey, storage: String(pick.storage), reason: `no valida contra la especificación: ${issues.map(i => i.message).join('; ')}` });
                continue;
            }
            plan.values.push({
                requirementId, scopeKey, value: pick.value, status: pick.status, origin: pick.origin, confirmedAt: pick.confirmedAt ?? null,
                specVersion: spec.specVersion,
                sourceRef: {
                    backfill: BACKFILL_MARK, migrated_from: String(pick.storage), migrated_hash: valueFingerprint(pick.value),
                    legacy_rule: pick.legacyRule ?? null, ...(contradiction.length ? { contradiction_with: contradiction } : {}),
                },
            });
            bump(plan.counts.values, pick.legacyRule ?? 'real');
        }
    }
    return plan;
}

/**
 * El plan aplicado en memoria a las filas (lo que quedaría en la base): lo usan el `--dry-run` y la prueba de
 * equivalencia. Las filas de `extraTables` no están en `LegacyTenantRows` y no se tocan.
 */
export function applyBackfillPlan(rows: LegacyTenantRows, plan: BackfillPlan): LegacyTenantRows {
    const copy = JSON.parse(JSON.stringify(rows)) as LegacyTenantRows;
    const byTable = copy as unknown as Record<string, Row[] | undefined>;
    for (const p of plan.rows) {
        const row = byTable[p.table]?.find(r => String(r.id) === p.id);
        if (!row) continue;
        row.content_status = p.contentStatus;
        row.origin = p.origin;
        row.confirmed_at = p.confirmedAt;
        row.source_ref = p.sourceRef;
        if (PROVENANCE_TABLES[p.table]?.kind === 'item') row.price_type = p.priceType;
        if (p.priceStatus !== undefined) row.price_status = p.priceStatus;
    }
    copy.requirement_values = [
        ...(copy.requirement_values ?? []),
        ...plan.values.map((v, i) => ({
            id: `backfill-${i + 1}`, requirement_id: v.requirementId, scope_key: v.scopeKey, value: v.value, status: v.status,
            origin: v.origin, confirmed_by: null, confirmed_at: v.confirmedAt, source_ref: v.sourceRef, valid_until: null,
            spec_version: v.specVersion, version: 1,
        })),
    ];
    return copy;
}
