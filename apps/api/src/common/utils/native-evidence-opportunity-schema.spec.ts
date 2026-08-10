import { readFileSync } from 'fs';
import { resolve } from 'path';

const schemaSql = readFileSync(
    resolve(__dirname, '../../../prisma/tenant-schema.sql'),
    'utf8',
);
const prismaServiceSource = readFileSync(
    resolve(__dirname, '../../modules/prisma/prisma.service.ts'),
    'utf8',
);
const ordersServiceSource = readFileSync(
    resolve(__dirname, '../../modules/orders/orders.service.ts'),
    'utf8',
);

const TABLES = [
    'appointments',
    'tour_bookings',
    'property_bookings',
    'service_requests',
    'food_orders',
    'photo_sessions',
    'resource_rentals',
    'orders',
] as const;

function createTableBody(table: string): string {
    const start = schemaSql.indexOf(`CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."${table}"`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = schemaSql.indexOf('\n);', start);
    expect(end).toBeGreaterThan(start);
    return schemaSql.slice(start, end + 3);
}

describe('native evidence opportunity schema contract', () => {
    it.each(TABLES)('%s declares an opportunity owner column', (table) => {
        expect(createTableBody(table)).toContain('"opportunity_id" UUID');
    });

    it('does not reference opportunities before that table exists', () => {
        const orders = createTableBody('orders');
        const ordersOffset = schemaSql.indexOf('CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."orders"');
        const opportunitiesOffset = schemaSql.indexOf('CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."opportunities"');

        expect(ordersOffset).toBeLessThan(opportunitiesOffset);
        expect(orders).toContain('"opportunity_id" UUID');
        expect(orders).not.toContain('"opportunity_id" UUID REFERENCES');
    });

    it('adds historical columns without an eager validating FK scan', () => {
        const hardeningStart = schemaSql.indexOf('-- Native operational evidence belongs');
        const hardening = schemaSql.slice(hardeningStart);
        for (const table of TABLES) {
            expect(hardening).toContain(
                `ALTER TABLE "{{SCHEMA_NAME}}"."${table}" ADD COLUMN IF NOT EXISTS "opportunity_id" UUID;`,
            );
        }
        expect(hardening).toContain('ON DELETE RESTRICT NOT VALID');
        expect(hardening).not.toContain('ON DELETE SET NULL NOT VALID');
    });

    it('creates one partial owner index and one guarded trigger per evidence table', () => {
        for (const table of TABLES) {
            expect(schemaSql).toContain(`"idx_${table}_opportunity_id"`);
        }
        expect(schemaSql).toContain("trigger_name := evidence_table || '_opportunity_owner_guard'");
        expect(schemaSql).toContain('native evidence opportunity does not belong to contact');
        expect(schemaSql).toContain('FROM "{{SCHEMA_NAME}}"."contact_identities" evidence_identity');
        expect(schemaSql).toContain('lead_identity.customer_profile_id = evidence_identity.customer_profile_id');
        expect(schemaSql).toContain('native evidence opportunity ownership is immutable');
        expect(schemaSql).toContain("OLD.opportunity_id IS NOT NULL");
        expect(schemaSql).toContain("NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id");
    });

    it('migrates existing schemas atomically and fails startup loudly on a partial migration', () => {
        expect(prismaServiceSource).toContain('ensureNativeEvidenceOpportunityOwnership()');
        expect(prismaServiceSource).toContain('REFERENCES opportunities(id) ON DELETE RESTRICT NOT VALID');
        expect(prismaServiceSource).toContain("triggerName = `${table}_opportunity_owner_guard`");
        expect(prismaServiceSource).not.toContain(
            'DROP TRIGGER IF EXISTS "${triggerName}" ON "${table}"',
        );
        expect(prismaServiceSource).toContain('if (failures.length > 0)');
        expect(prismaServiceSource).toContain('Native evidence ownership migration failed for');
    });

    it('hardens a lazily created orders table before publishing its versioned cache marker', () => {
        expect(prismaServiceSource).toContain('ensureNativeEvidenceOpportunityOwnershipForTable(');
        expect(prismaServiceSource).toContain('REFERENCES opportunities(id) ON DELETE RESTRICT NOT VALID');
        expect(prismaServiceSource).toContain('Native evidence table ${schemaName}.${table} does not exist');

        const hardeningCall = ordersServiceSource.indexOf(
            "ensureNativeEvidenceOpportunityOwnershipForTable(schema, 'orders')",
        );
        const cacheWrite = ordersServiceSource.indexOf("redis.set(cacheKey, 'true', 86400)");
        expect(ordersServiceSource).toContain('orders:tables:v2:${schema}');
        expect(hardeningCall).toBeGreaterThanOrEqual(0);
        expect(cacheWrite).toBeGreaterThan(hardeningCall);
        expect(ordersServiceSource).toContain('throw error;');
    });
});
