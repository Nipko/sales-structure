import { evaluate, fromLegacyRows, type LegacyTenantRows } from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/src/load';
import { SnapshotReader, TENANT_TABLE_COLUMNS, resolveCountryPack, type LegacyTenantRowsDto, type SqlJsonRunner } from './snapshot-reader';

// Comprobación de tipos (la corre `tsc -p apps/api/tsconfig.json`): las filas del lector son las que el paquete espera.
const assignable = (rows: LegacyTenantRowsDto): LegacyTenantRows => rows;
const assignableBack = (rows: LegacyTenantRows): LegacyTenantRowsDto => rows;

const SCHEMA = 'tenant_spark_qa_dental_03_5f7883f07f09490698006a07dfe82dc7';

function fakeRunner(raw: Record<string, unknown>): SqlJsonRunner & { sql: string[] } {
    const sql: string[] = [];
    return {
        sql,
        async queryJson<T>(q: string): Promise<T> {
            sql.push(q);
            if (q.includes('information_schema.tables')) return Object.keys(TENANT_TABLE_COLUMNS).filter(t => t !== 'tour_inventory') as T;
            return raw as T;
        },
    };
}

const raw = {
    tenant: {
        ref: '5f7883f0', slug: 'spark-qa-dental-03', name: 'Spark QA Dental 03', industry: 'salud', language: 'es-CO',
        created_at: '2026-10-18T09:22:30.11+00:00',
        settings: { subType: 'dental', customerTypes: ['b2c'], verticalProvisioning: { completedAt: '2026-10-18T09:22:35.118Z' } },
        operating_country: null, operating_timezone: null, operating_currency: null, default_locale: null,
        country_pack_id: null, country_pack_version: null, regional_provenance: {},
    },
    companies: [{ id: 'c1', name: 'Spark QA Dental 03', about: null, is_primary: true, created_at: '2026-10-18 09:22:34', updated_at: '2026-10-18 09:22:34' }],
    services: [{ id: 's1', name: 'Consulta general', price: 80000, price_status: 'example', is_active: true, created_at: '2026-10-18 09:22:34', updated_at: '2026-10-18 09:22:34' }],
    users: [{ id: 'u1', role: 'tenant_admin', is_active: true, email_verified: true, handoff_notifications: true }],
    payment_provider_configured: false,
};

describe('SnapshotReader (solo lectura)', () => {
    it('arma un único SELECT de solo lectura, sin columnas sensibles y con los esquemas validados', () => {
        const sql = SnapshotReader.buildSql(SCHEMA, Object.keys(TENANT_TABLE_COLUMNS));
        expect(sql.trimStart().startsWith('SELECT')).toBe(true);
        expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|GRANT)\b/i);
        expect(sql).not.toMatch(/password|secret|two_factor|backup_codes|auth_credentials|wompi_public_key|config\b/i);
        expect(() => SnapshotReader.buildSql("tenant_x; DROP TABLE users", [])).toThrow(/inválido/);
        expect(SnapshotReader.buildSql(SCHEMA, [])).toContain("'faqs', '[]'::json");
    });

    it('entrega filas que el paquete convierte en una foto evaluable (subtipo canónico, pack de país)', async () => {
        const runner = fakeRunner(raw);
        const reader = new SnapshotReader(runner, () => new Date('2026-10-30T12:00:00Z'));
        const rows = await reader.readRows(SCHEMA);
        expect(runner.sql).toHaveLength(2);
        expect(rows).toMatchObject({ schema: 'business-spec/legacy-rows@1', capturedAt: '2026-10-30T12:00:00.000Z', country_pack: null });
        expect(rows.tenant.subtype).toBe('salud/dental');
        expect(rows.tour_inventory).toEqual([]);
        const result = evaluate(loadSpec(), fromLegacyRows(assignable(rows)));
        expect(result.config.profileId).toBe('P08');
        expect(result.verdict).toBe('no_listo');
        expect(result.blockingGaps).toContain('CORE.IDENTITY.REGION');
        expect(assignableBack(assignable(rows))).toBe(rows);
    });

    it('resuelve el pack de país desde packages/shared (emergencias) y nunca inventa derechos del consumidor', () => {
        expect(resolveCountryPack(null)).toBeNull();
        const co = resolveCountryPack('CO');
        expect(co).toMatchObject({ country: 'CO', consumerRights: null });
        expect(co?.emergency?.medical).toBeTruthy();
    });
});
