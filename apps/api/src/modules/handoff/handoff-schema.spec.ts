import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('tenant handoff summary schema', () => {
    const tenantSchemaSql = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');

    it.each([
        ['handoff_summary', 'JSONB'],
        ['handoff_trace_id', 'VARCHAR(128)'],
        ['handoff_summary_generated_at', 'TIMESTAMPTZ'],
    ])('defines %s for new schemas and adds it idempotently to existing schemas', (column, type) => {
        expect(tenantSchemaSql).toContain(`"${column}" ${type}`);
        expect(tenantSchemaSql).toContain(
            `ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "${column}" ${type}`,
        );
    });
});
