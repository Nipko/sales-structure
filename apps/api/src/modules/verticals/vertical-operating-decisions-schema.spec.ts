import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('vertical operating decisions schema contract', () => {
    const tenantSchema = readFileSync(
        resolve(__dirname, '../../../prisma/tenant-schema.sql'),
        'utf8',
    );
    const publicMigration = readFileSync(
        resolve(
            __dirname,
            '../../../prisma/migrations/20260808000000_add_tenant_operating_currency/migration.sql',
        ),
        'utf8',
    );
    const toolAuthorityRuntime = readFileSync(
        resolve(__dirname, '../conversations/tool-execution-control.service.ts'),
        'utf8',
    );
    const paymentRuntime = readFileSync(
        resolve(__dirname, '../conversations/payment-operation.service.ts'),
        'utf8',
    );

    it.each([
        'tool_execution_ledger',
        'tool_approval_tickets',
        'tool_approval_outbox',
        'payment_operation_ledger',
        'money_lineage',
        'operational_locations',
        'operational_resources',
        'staff_operational_bindings',
        'staff_resource_assignments',
        'calendar_sync_outbox',
        'vertical_migrations',
        'vertical_migration_archives',
        'vertical_migration_outbox',
    ])('ships tenant table %s in the canonical template', (table) => {
        expect(tenantSchema).toContain(`"{{SCHEMA_NAME}}"."${table}"`);
    });

    it.each([
        'calendar_integration_id',
        'calendar_owner_id',
        'calendar_provider',
        'calendar_event_id',
        'calendar_sync_state',
        'calendar_sync_revision',
        'calendar_sync_error',
        'calendar_synced_at',
    ])('ships appointment calendar column %s for existing tenants', (column) => {
        expect(tenantSchema).toMatch(
            new RegExp(`ALTER TABLE "\\{\\{SCHEMA_NAME\\}\\}"\\."appointments" ADD COLUMN IF NOT EXISTS "${column}"`),
        );
    });

    it('ships the public operating-currency migration and immutable lock', () => {
        expect(publicMigration).toContain('ADD COLUMN IF NOT EXISTS operating_currency VARCHAR(3)');
        expect(publicMigration).toContain('ADD COLUMN IF NOT EXISTS operating_currency_locked_at TIMESTAMPTZ');
        expect(publicMigration).toContain('tenants_operating_currency_lock_chk');
    });

    it('keeps vertical migration evidence and calendar work durable', () => {
        expect(tenantSchema).toContain('"preview_payload" JSONB NOT NULL');
        expect(tenantSchema).toContain('"source_fingerprint" CHAR(64) NOT NULL');
        expect(tenantSchema).toContain('"lease_token" UUID');
        expect(tenantSchema).toContain('"idempotency_key" VARCHAR(240) NOT NULL UNIQUE');
    });

    it('keeps lazy legacy-schema DDL at parity with central authority constraints', () => {
        for (const constraint of [
            'tool_execution_ledger_assurance_chk',
            'tool_execution_ledger_status_chk',
            'tool_approval_tickets_status_chk',
            'tool_execution_ledger_approval_fk',
        ]) {
            expect(tenantSchema).toContain(constraint);
            expect(toolAuthorityRuntime).toContain(constraint);
        }
        for (const constraint of [
            'payment_operation_ledger_kind_chk',
            'payment_operation_ledger_status_chk',
        ]) {
            expect(tenantSchema).toContain(constraint);
            expect(paymentRuntime).toContain(constraint);
        }
    });

    it('ships A4 resume, freshness and execution leases in canonical and lazy DDL', () => {
        for (const column of [
            'approval_source_message_id',
            'resume_state',
            'resume_lease_token',
            'resume_lease_expires_at',
            'execution_lease_token',
            'execution_lease_expires_at',
        ]) {
            expect(tenantSchema).toContain(`"${column}"`);
            expect(toolAuthorityRuntime).toContain(column);
        }
        expect(tenantSchema).toContain('tool_approval_outbox_status_chk');
        expect(toolAuthorityRuntime).toContain('tool_approval_outbox_status_chk');
        expect(toolAuthorityRuntime).toContain("last_error_code = 'execution_lease_expired'");
        expect(toolAuthorityRuntime).toContain('approval_stale_due_to_new_inbound');
    });
});
