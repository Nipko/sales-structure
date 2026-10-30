import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LegacyTenantRows } from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/load';
import { inlineParams, isMigrated, planAndCheck, planToSql } from '../../../scripts/readiness/backfill-provenance';

/**
 * scripts/readiness/backfill-provenance (C0 §2.9): el SQL que escribe por esquema y su guarda de equivalencia.
 * La equivalencia en los 7 tenants QA la prueba el paquete (packages/business-spec/test/provenance.spec.ts); aquí, que
 * el script la exige y que escribe con las sentencias de BusinessFactsService, en una transacción.
 */
const FIXTURES = path.resolve(__dirname, '../../../../../packages/business-spec/test/fixtures/qa-tenants');
const fixture = (slug: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${slug}.snapshot.json`), 'utf8')) as LegacyTenantRows;
const SCHEMA = 'tenant_spark_qa_dental_03_5f7883f07f09490698006a07dfe82dc7';
const spec = loadSpec();

describe('backfill-provenance', () => {
    it('inlineParams: literales seguros en una sola pasada', () => {
        expect(inlineParams('SELECT $1, $2::jsonb, $3, $10', ['a\'b', '{"x":"$3"}', null, 7, 0, 0, 0, 0, 0, 'z']))
            .toBe(`SELECT 'a''b', '{"x":"$3"}'::jsonb, NULL, 'z'`);
    });

    it('el plan de un tenant QA es equivalente y se escribe en UNA transacción con las sentencias del servicio', () => {
        const rows = fixture('spark-qa-dental-03');
        const c = planAndCheck(spec, rows, {}, new Date(rows.capturedAt));
        expect(c.equivalent).toBe(true);
        expect(c.seededPublishedFaqs).toBe(10);
        const sql = planToSql(SCHEMA, c.plan);
        expect(sql.startsWith('\\set ON_ERROR_STOP on\nBEGIN;\nSET LOCAL search_path TO "tenant_spark_qa_dental_03_5f7883f07f09490698006a07dfe82dc7", public;')).toBe(true);
        expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
        expect(sql.match(/ON CONFLICT \(requirement_id, scope_key\) DO NOTHING/g)).toHaveLength(c.plan.values.length);
        expect(sql.match(/^UPDATE "(services|faqs)" SET/gm)).toHaveLength(c.plan.rows.length);
        expect(sql).toContain('"kind":"script","name":"backfill-provenance"');
        expect(sql).not.toMatch(/\$\d/); // todo parámetro quedó como literal
        expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b/i);
        expect(() => planToSql('tenant_x; DROP SCHEMA public', c.plan)).toThrow(/inválido/);
    });

    it('solo escribe en esquemas con las tablas y columnas de R3', () => {
        const full = Object.fromEntries(['services', 'faqs', 'menu_items'].map(t => [t, ['origin', 'source_ref', 'content_status', ...(t === 'faqs' ? [] : ['price_type'])]]));
        expect(isMigrated({ ...full, requirement_values: ['id'], requirement_value_versions: ['id'] })).toBe(true);
        expect(isMigrated(full)).toBe(false);
        expect(isMigrated({ ...full, services: ['origin'], requirement_values: ['id'], requirement_value_versions: ['id'] })).toBe(false);
    });
});
