import { evaluate, fromLegacyRows } from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/load';
import { PROVENANCE_COLUMNS, SnapshotReader, TENANT_TABLE_COLUMNS, columnsFor, resolveCountryPack, type SqlJsonRunner } from './snapshot-reader';

const SCHEMA = 'tenant_spark_qa_dental_03_5f7883f07f09490698006a07dfe82dc7';

function fakeRunner(raw: Record<string, unknown>, columns: Record<string, string[]> = {}): SqlJsonRunner & { sql: string[] } {
    const sql: string[] = [];
    return {
        sql,
        async queryJson<T>(q: string): Promise<T> {
            sql.push(q);
            if (q.includes('information_schema.tables')) return Object.keys(TENANT_TABLE_COLUMNS).filter(t => t !== 'tour_inventory') as T;
            if (q.includes('information_schema.columns')) return columns as T;
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

    it('R1.1: lee los datos que el agente ya ve (dirección y financiación del listado, stock, idiomas del tour, campos de la reserva, agenda)', () => {
        expect(TENANT_TABLE_COLUMNS.real_estate_listings).toMatch(/\baddress\b/);
        expect(TENANT_TABLE_COLUMNS.real_estate_listings).toMatch(/\bfinancing_available\b/);
        // de metadata solo sale la privacidad declarada, nunca el JSON completo
        expect(TENANT_TABLE_COLUMNS.real_estate_listings).toContain("metadata->>'address_privacy' AS address_privacy");
        expect(TENANT_TABLE_COLUMNS.real_estate_listings).not.toMatch(/(^|,\s*)metadata\s*(,|$)/);
        expect(TENANT_TABLE_COLUMNS.products).toMatch(/\bstock\b/);
        expect(TENANT_TABLE_COLUMNS.tour_packages).toMatch(/\blanguages\b/);
        expect(TENANT_TABLE_COLUMNS.services).toMatch(/\brequired_fields\b/);
        expect(TENANT_TABLE_COLUMNS.availability_slots).toMatch(/day_of_week, start_time, end_time/);
    });

    it('R1.1: las filas nuevas llegan a la foto (horario desde la agenda, dirección y financiación por listado)', async () => {
        const rows = await new SnapshotReader(fakeRunner({
            ...raw,
            availability_slots: [{ id: 'a1', user_id: 'u1', day_of_week: 1, start_time: '08:00:00', end_time: '18:00:00', is_active: true, created_at: '2026-10-18 09:22:34' }],
            real_estate_listings: [{ id: 'l1', transaction_type: 'sale', address: 'Calle 9 # 1-2', address_privacy: null, financing_available: false, is_active: true, created_at: '2026-10-20 10:00:00', updated_at: '2026-10-21 10:00:00' }],
        }), () => new Date('2026-10-30T12:00:00Z')).readRows(SCHEMA);
        const snap = fromLegacyRows(rows);
        expect(snap.values['CORE.HOURS.REGULAR'][0]).toMatchObject({ status: 'seeded', legacyRule: 'L3', storage: expect.stringMatching(/^availability_slots/) });
        expect(snap.items.real_estate[0].fields).toMatchObject({ address: 'Calle 9 # 1-2', address_privacy: null });
        expect(snap.values['CORE.PAYMENT.FINANCING'][0]).toMatchObject({ scopeKey: 'item:l1', status: 'seeded', legacyRule: 'L4' });
    });

    it('entrega filas que el paquete convierte en una foto evaluable (subtipo canónico, pack de país)', async () => {
        const runner = fakeRunner(raw);
        const reader = new SnapshotReader(runner, () => new Date('2026-10-30T12:00:00Z'));
        const rows = await reader.readRows(SCHEMA);
        expect(runner.sql).toHaveLength(3);
        expect(rows).toMatchObject({ schema: 'business-spec/legacy-rows@1', capturedAt: '2026-10-30T12:00:00.000Z', country_pack: null });
        expect(rows.tenant.subtype).toBe('salud/dental');
        expect(rows.tour_inventory).toEqual([]);
        const result = evaluate(loadSpec(), fromLegacyRows(rows));
        expect(result.config.profileId).toBe('P08');
        expect(result.verdict).toBe('no_listo');
        expect(result.blockingGaps).toContain('CORE.IDENTITY.REGION');
    });

    it('resuelve el pack de país desde packages/shared (emergencias) y nunca inventa derechos del consumidor', () => {
        expect(resolveCountryPack(null)).toBeNull();
        const co = resolveCountryPack('CO');
        expect(co).toMatchObject({ country: 'CO', consumerRights: null });
        expect(co?.emergency?.medical).toBeTruthy();
    });

    it('R3: lee las columnas de procedencia solo si la tabla ya las tiene, y requirement_values', () => {
        expect(columnsFor('faqs')).toBe(TENANT_TABLE_COLUMNS.faqs); // tenant sin migrar: igual que antes
        const cols = columnsFor('services', { services: [...PROVENANCE_COLUMNS] });
        expect(cols).toMatch(/content_status, origin, confirmed_by::text AS confirmed_by, confirmed_at, source_ref, price_type$/);
        expect(cols.match(/\bprice_status\b/g)).toHaveLength(1); // services ya leía price_status
        expect(columnsFor('menu_items', { menu_items: ['origin', 'price_status'] })).toMatch(/, origin, price_status$/);
        expect(TENANT_TABLE_COLUMNS.requirement_values).toMatch(/requirement_id, scope_key, value, status, origin/);
        const sql = SnapshotReader.buildSql(SCHEMA, ['requirement_values', 'faqs'], { faqs: ['origin', 'source_ref'] });
        expect(sql).toContain('FROM "tenant_spark_qa_dental_03_5f7883f07f09490698006a07dfe82dc7"."requirement_values"');
        expect(sql).toMatch(/is_published, created_at, updated_at, origin, source_ref FROM/);
        expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    });

    it('R3: con procedencia real vigente la foto la usa; un valor escrito por el dueño manda sobre lo heredado', async () => {
        const stamped = '2026-10-18 09:22:34';
        const rows = await new SnapshotReader(fakeRunner({
            ...raw,
            services: [{ ...raw.services[0], updated_at: stamped, content_status: 'confirmed', origin: 'owner_form', price_type: 'fijo', price_status: 'confirmed', source_ref: { row_updated_at: '2026-10-18T09:22:34' } }],
            requirement_values: [{ id: 'rv1', requirement_id: 'CORE.IDENTITY.NAME', scope_key: '', value: { display_name: 'Clínica Sonrisa' }, status: 'confirmed', origin: 'owner_form', confirmed_at: '2026-10-29T10:00:00Z', source_ref: null, spec_version: loadSpec().specVersion, version: 3 }],
        }, { services: [...PROVENANCE_COLUMNS] }), () => new Date('2026-10-30T12:00:00Z')).readRows(SCHEMA);
        const snap = fromLegacyRows(rows);
        expect(snap.items.appointment[0]).toMatchObject({ contentStatus: 'confirmed', origin: 'owner_form', priceType: 'fijo', priceStatus: 'confirmed', legacyRule: null });
        expect(snap.values['CORE.IDENTITY.NAME']).toEqual([expect.objectContaining({ value: { display_name: 'Clínica Sonrisa' }, origin: 'owner_form', storage: 'requirement_values' })]);
    });
});
