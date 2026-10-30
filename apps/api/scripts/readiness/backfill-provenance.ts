/**
 * backfill-provenance (C0 §2.9, rebanada R3). Lanza con scripts/readiness/backfill-provenance.cjs.
 *
 * Aplica las reglas L1–L7 UNA vez por tenant y deja escrita la procedencia real:
 * - columnas de procedencia (C0 §2.2) en las filas de catálogos y textos que aún no la tienen;
 * - `requirement_values` con los valores que hoy deducen las reglas (expand: `settings.businessHours`, `policies`,
 *   `companies`, la configuración de la persona… quedan donde están; R3b mueve a sus lectores y escritores).
 *
 * El plan lo calcula el paquete (`planProvenanceBackfill`, la misma función que usa la lectura) y se escribe con las
 * sentencias de BusinessFactsService (`business-facts.statements.ts`). Por esquema:
 * 1. lee las filas (SnapshotReader, solo lectura);
 * 2. calcula el plan y lo aplica EN MEMORIA: el veredicto y el resultHash del motor antes y después deben ser
 *    idénticos (prueba de equivalencia, R3 #3). Si no lo son, el esquema NO se escribe;
 * 3. sin `--dry-run`, ejecuta todas las sentencias del esquema en UNA transacción y vuelve a leer: el plan restante
 *    debe quedar vacío.
 *
 * Idempotente: una fila con procedencia vigente o un valor que ya tiene fila no se vuelven a escribir.
 * Las FAQs sembradas (L3) quedan `content_status = seeded`; despublicarlas exige avisar al dueño antes (D5) y no lo hace
 * este script: el informe las cuenta.
 *
 *   node scripts/readiness/backfill-provenance.cjs --psql "<comando psql>" --all-qa --dry-run [--out-json F] [--out-md F]
 *   node scripts/readiness/backfill-provenance.cjs --psql "<comando psql>" --tenant tenant_x --apply
 *   node scripts/readiness/backfill-provenance.cjs --psql "<comando psql>" --all --dry-run
 *   node scripts/readiness/backfill-provenance.cjs --fixtures packages/business-spec/test/fixtures/qa-tenants --dry-run
 *
 * El comando psql recibe el SQL por stdin y debe imprimir una línea JSON (-At), p. ej.
 *   ssh -o ConnectTimeout=10 root@HOST 'docker exec -i parallext-postgres psql -U parallext -d parallext_engine -At'
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    PROVENANCE_TABLES, applyBackfillPlan, evaluate, fromLegacyRows, planProvenanceBackfill,
    type BackfillPlan, type CompiledSpec, type LegacyTenantRows,
} from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/src/load';
import { requirementValueWriteStatement, rowProvenanceStatement } from '../../src/modules/readiness/business-facts.statements';
import { PROVENANCE_COLUMNS, SnapshotReader, type SqlJsonRunner } from '../../src/modules/readiness/snapshot-reader';
import { QA_TENANT_SCHEMAS, psqlRunner } from '../readiness-report';

type Row = Record<string, any>;

export const BACKFILL_ACTOR = { kind: 'script', name: 'backfill-provenance' } as const;
const SCHEMA_NAME = /^tenant_[a-z0-9_]+$/;
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Tablas con procedencia que la foto aún no lee: la migración también las cubre (L1, L3/L6, L7). */
const EXTRA_TABLES = Object.keys(PROVENANCE_TABLES).filter(t => !['services', 'menu_items', 'products', 'tour_packages', 'properties', 'real_estate_listings', 'faqs', 'knowledge_documents'].includes(t));

export interface SchemaReport {
    schema: string;
    tenant: string;
    mode: 'dry-run' | 'apply' | 'fixture';
    migrated: boolean;
    equivalent: boolean;
    verdict: { before: string; after: string };
    resultHash: { before: string; after: string };
    planned: { values: number; rows: number };
    counts: BackfillPlan['counts'];
    skipped: BackfillPlan['skipped'];
    seededPublishedFaqs: number;
    applied: boolean;
    remainingAfterApply: { values: number; rows: number } | null;
    note?: string;
}

/** Sustituye $n por literales SQL (para psql, que no tiene parámetros). Una sola pasada: un literal nunca se re-sustituye. */
export function inlineParams(sql: string, params: readonly unknown[]): string {
    return sql.replace(/\$(\d+)(?!\d)/g, (_m, n: string) => {
        const v = params[Number(n) - 1];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        return quoteLiteral(String(v));
    });
}

/** Las sentencias del plan para un esquema, en una transacción (psql corta al primer error). */
export function planToSql(schema: string, plan: BackfillPlan): string {
    if (!SCHEMA_NAME.test(schema)) throw new Error(`nombre de esquema inválido: ${schema}`);
    const statements: string[] = [];
    for (const row of plan.rows) {
        const s = rowProvenanceStatement(row);
        statements.push(inlineParams(s.sql, s.params));
    }
    for (const v of plan.values) {
        const s = requirementValueWriteStatement({
            requirementId: v.requirementId, scopeKey: v.scopeKey, value: v.value, status: v.status, origin: v.origin,
            confirmedBy: null, confirmedAt: v.confirmedAt, sourceRef: v.sourceRef, validUntil: null, specVersion: v.specVersion,
            actor: BACKFILL_ACTOR,
        }, 'insert_if_absent');
        statements.push(inlineParams(s.sql, s.params));
    }
    return ['\\set ON_ERROR_STOP on', 'BEGIN;', `SET LOCAL search_path TO "${schema}", public;`, ...statements.map(s => `${s};`), 'COMMIT;', ''].join('\n');
}

/** Filas de las tablas con procedencia que la foto no lee (id, fechas, precio, estado de precio y procedencia). */
async function readExtraTables(runner: SqlJsonRunner, schema: string, columns: Record<string, string[]>): Promise<Record<string, Row[]>> {
    const parts = EXTRA_TABLES.filter(t => columns[t]?.includes('updated_at')).map(t => {
        const cfg = PROVENANCE_TABLES[t];
        const cols = ['id::text AS id', 'created_at', 'updated_at', ...(cfg.price ? [cfg.price] : []),
            ...PROVENANCE_COLUMNS.filter(c => columns[t].includes(c)).map(c => (c === 'confirmed_by' ? 'confirmed_by::text AS confirmed_by' : c))];
        return `'${t}', (SELECT coalesce(json_agg(x), '[]'::json) FROM (SELECT ${[...new Set(cols)].join(', ')} FROM "${schema}"."${t}") x)`;
    });
    if (!parts.length) return {};
    return (await runner.queryJson<Record<string, Row[]>>(`SELECT json_build_object(${parts.join(', ')})`)) ?? {};
}

async function columnsOf(runner: SqlJsonRunner, schema: string): Promise<Record<string, string[]>> {
    const tables = [...Object.keys(PROVENANCE_TABLES), 'requirement_values', 'requirement_value_versions'];
    return (await runner.queryJson<Record<string, string[]>>(
        `SELECT coalesce(json_object_agg(table_name, cols), '{}'::json) FROM (SELECT table_name, json_agg(column_name::text) AS cols
           FROM information_schema.columns WHERE table_schema = ${quoteLiteral(schema)} AND table_name IN (${tables.map(quoteLiteral).join(', ')})
          GROUP BY table_name) c`)) ?? {};
}

/** ¿El esquema ya tiene las tablas y columnas de R3 (migración 20261030140000 o tenant-schema.sql)? */
export function isMigrated(columns: Record<string, string[]>): boolean {
    if (!columns.requirement_values || !columns.requirement_value_versions) return false;
    return Object.entries(PROVENANCE_TABLES).every(([t, cfg]) => !columns[t]
        || (['origin', 'source_ref', 'content_status'].every(c => columns[t].includes(c)) && (cfg.kind === 'text' || columns[t].includes('price_type'))));
}

/** Plan + prueba de equivalencia en memoria. */
export function planAndCheck(spec: CompiledSpec, rows: LegacyTenantRows, extraTables: Record<string, Row[]>, now: Date) {
    const plan = planProvenanceBackfill(spec, rows, { extraTables, now });
    const before = evaluate(spec, fromLegacyRows(rows), now);
    const after = evaluate(spec, fromLegacyRows(applyBackfillPlan(rows, plan)), now);
    const seededPublishedFaqs = plan.rows.filter(r => r.table === 'faqs' && r.contentStatus === 'seeded'
        && rows.faqs.find(f => String(f.id) === r.id)?.is_published !== false).length;
    return { plan, before, after, equivalent: before.verdict === after.verdict && before.resultHash === after.resultHash, seededPublishedFaqs };
}

function arg(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
}

function runPsqlScript(command: string, script: string): void {
    const res = spawnSync(command, { input: script, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0) throw new Error(`psql falló (${res.status}): ${res.stderr?.trim()}`);
}

function renderMarkdown(reports: SchemaReport[]): string {
    const lines = [
        '# Migración de procedencia (backfill-provenance, C0 §2.9)', '',
        '| Esquema | Modo | Migrado | Equivalente | Veredicto | Valores | Filas | Omitidos | FAQs sembradas publicadas | Escrito | Pendiente tras escribir |',
        '|---|---|---|---|---|---|---|---|---|---|---|',
        ...reports.map(r => `| ${r.schema} | ${r.mode} | ${r.migrated ? 'sí' : 'no'} | ${r.equivalent ? 'sí' : '**NO**'} | ${r.verdict.before}${r.verdict.before === r.verdict.after ? '' : ` → ${r.verdict.after}`} | ${r.planned.values} | ${r.planned.rows} | ${r.skipped.length} | ${r.seededPublishedFaqs} | ${r.applied ? 'sí' : 'no'} | ${r.remainingAfterApply ? `${r.remainingAfterApply.values}/${r.remainingAfterApply.rows}` : '—'} |`),
        '',
    ];
    for (const r of reports) {
        lines.push(`## ${r.schema}`, '', `- Valores por regla: ${JSON.stringify(r.counts.values)}`, `- Filas por tabla y regla: ${JSON.stringify(r.counts.rows)}`);
        if (r.note) lines.push(`- Nota: ${r.note}`);
        for (const s of r.skipped) lines.push(`- Omitido ${s.requirementId}${s.scopeKey ? ` (${s.scopeKey})` : ''} desde ${s.storage}: ${s.reason}`);
        lines.push('');
    }
    return lines.join('\n');
}

export async function main(argv: string[]): Promise<SchemaReport[]> {
    const dryRun = argv.includes('--dry-run');
    const apply = argv.includes('--apply');
    if (dryRun === apply) throw new Error('indica exactamente uno: --dry-run (no escribe) o --apply (escribe)');
    const spec = loadSpec();
    const now = new Date();
    const reports: SchemaReport[] = [];
    const fixtures = arg(argv, '--fixtures');

    if (fixtures) {
        if (apply) throw new Error('--fixtures solo admite --dry-run');
        for (const f of fs.readdirSync(fixtures).filter(x => x.endsWith('.snapshot.json')).sort()) {
            const rows = JSON.parse(fs.readFileSync(path.join(fixtures, f), 'utf8')) as LegacyTenantRows;
            const at = new Date(rows.capturedAt);
            const c = planAndCheck(spec, rows, {}, at);
            reports.push({
                schema: rows.tenant.slug, tenant: rows.tenant.ref, mode: 'fixture', migrated: true, equivalent: c.equivalent,
                verdict: { before: c.before.verdict, after: c.after.verdict }, resultHash: { before: c.before.resultHash, after: c.after.resultHash },
                planned: { values: c.plan.values.length, rows: c.plan.rows.length }, counts: c.plan.counts, skipped: c.plan.skipped,
                seededPublishedFaqs: c.seededPublishedFaqs, applied: false, remainingAfterApply: null,
            });
        }
    } else {
        const psql = arg(argv, '--psql') ?? process.env.READINESS_PSQL;
        if (!psql) throw new Error('falta --psql "<comando>" (o READINESS_PSQL) o --fixtures <dir>');
        const runner = psqlRunner(psql);
        let schemas: string[];
        if (argv.includes('--all-qa')) schemas = [...QA_TENANT_SCHEMAS];
        else if (argv.includes('--all')) {
            schemas = (await runner.queryJson<string[]>(`SELECT coalesce(json_agg(schema_name ORDER BY schema_name), '[]'::json) FROM public.tenants
                WHERE schema_name IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.schemata s WHERE s.schema_name = tenants.schema_name)`)) ?? [];
        } else schemas = argv.flatMap((a, i) => (a === '--tenant' && argv[i + 1] ? [argv[i + 1]] : []));
        if (!schemas.length) throw new Error('indica --tenant <schema> (repetible), --all-qa o --all');
        const reader = new SnapshotReader(runner, () => now);

        for (const schema of schemas) {
            if (!SCHEMA_NAME.test(schema)) throw new Error(`nombre de esquema inválido: ${schema}`);
            const columns = await columnsOf(runner, schema);
            const migrated = isMigrated(columns);
            const rows = await reader.readRows(schema);
            const extra = await readExtraTables(runner, schema, columns);
            const c = planAndCheck(spec, rows, extra, now);
            const report: SchemaReport = {
                schema, tenant: rows.tenant.slug, mode: dryRun ? 'dry-run' : 'apply', migrated, equivalent: c.equivalent,
                verdict: { before: c.before.verdict, after: c.after.verdict }, resultHash: { before: c.before.resultHash, after: c.after.resultHash },
                planned: { values: c.plan.values.length, rows: c.plan.rows.length }, counts: c.plan.counts, skipped: c.plan.skipped,
                seededPublishedFaqs: c.seededPublishedFaqs, applied: false, remainingAfterApply: null,
            };
            if (apply) {
                if (!migrated) report.note = 'el esquema aún no tiene las tablas y columnas de R3 (falta desplegar la migración 20261030140000); no se escribe';
                else if (!c.equivalent) report.note = 'el veredicto con procedencia difiere del de las reglas L; no se escribe (revisar antes)';
                else if (c.plan.values.length || c.plan.rows.length) {
                    runPsqlScript(psql, planToSql(schema, c.plan));
                    report.applied = true;
                    const again = planAndCheck(spec, await reader.readRows(schema), await readExtraTables(runner, schema, columns), now);
                    report.remainingAfterApply = { values: again.plan.values.length, rows: again.plan.rows.length };
                } else report.note = 'nada que migrar (ya migrado)';
            }
            reports.push(report);
        }
    }

    const outJson = arg(argv, '--out-json');
    const outMd = arg(argv, '--out-md');
    if (outJson) fs.writeFileSync(outJson, `${JSON.stringify(reports, null, 2)}\n`);
    const md = renderMarkdown(reports);
    if (outMd) fs.writeFileSync(outMd, md);
    else process.stdout.write(md);
    const bad = reports.filter(r => !r.equivalent || (r.remainingAfterApply && (r.remainingAfterApply.values || r.remainingAfterApply.rows)));
    if (bad.length) process.exitCode = 2;
    return reports;
}
