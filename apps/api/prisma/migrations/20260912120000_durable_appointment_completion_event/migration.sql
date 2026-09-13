-- Completing an appointment and admitting its follow-up automation used to be
-- two unrelated effects: the first was committed, then an in-memory event was
-- emitted and its asynchronous listener was not awaited. A process or queue
-- failure in that gap permanently lost the post-visit workflow.
--
-- Both additions are nullable and safe while the previous binary is running.
-- `completion_event_at` is the durable acknowledgement; NULL means the event
-- is still owed. `event_key` makes replay adopt the same rule execution.

DO $durable_appointment_completion$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN
        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"
    LOOP
        target := quote_ident(tenant_record."schema_name");
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM "information_schema"."schemata"
             WHERE "schema_name" = tenant_record."schema_name"
        );

        IF to_regclass(target || '.appointments') IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE %s."appointments" ADD COLUMN IF NOT EXISTS "completion_event_at" TIMESTAMPTZ',
                target);
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS "idx_appointments_completion_event_due"'
                || ' ON %s."appointments" ("completed_at", "id")'
                || ' WHERE "status" = ''completed'' AND "completed_by" = ''auto'''
                || ' AND "completion_event_at" IS NULL',
                target);
        END IF;

        IF to_regclass(target || '.automation_executions') IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE %s."automation_executions" ADD COLUMN IF NOT EXISTS "event_key" TEXT',
                target);
            EXECUTE format(
                'CREATE UNIQUE INDEX IF NOT EXISTS "uidx_automation_executions_event_key"'
                || ' ON %s."automation_executions" ("event_key")'
                || ' WHERE "event_key" IS NOT NULL',
                target);
        END IF;
    END LOOP;
END
$durable_appointment_completion$;
