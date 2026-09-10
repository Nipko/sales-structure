-- La tabla que guarda adónde fue una nota empujada al CRM del tenant.
--
-- Enteramente ADITIVA: CREATE TABLE / CREATE INDEX con IF NOT EXISTS y ni una
-- fila escrita, así que el código viejo la ignora durante el rolling restart,
-- que es lo que exige expand-contract.
--
-- Una nota empujada antes de esto no dejó recibo y no se inventa uno: no hay
-- de dónde sacar el id que devolvió el proveedor. Lo que cambia es de acá en
-- adelante.
--
-- SQL dinámico porque la tabla vive en el schema de cada tenant.
DO $crm_note_receipts$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN
        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"
    LOOP
        target := quote_ident(tenant_record."schema_name");
        -- Un schema nombrado en `tenants` que ya no existe no detiene al resto.
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM "information_schema"."schemata"
            WHERE "schema_name" = tenant_record."schema_name"
        );
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."crm_note_receipts" (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        connection_id TEXT NOT NULL,
                        provider TEXT NOT NULL,
                        source_kind TEXT NOT NULL,
                        source_id TEXT NOT NULL,
                        conversation_id UUID,
                        contact_id UUID,
                        external_id TEXT NOT NULL,
                        external_url TEXT,
                        state TEXT NOT NULL DEFAULT 'recorded',
                        attempts INTEGER NOT NULL DEFAULT 0,
                        retract_reason TEXT,
                        last_error TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT crm_note_receipts_state CHECK (state IN
                            ('recorded','retract_pending','retracted','rejected','unknown')),
                        CONSTRAINT crm_note_receipts_attempts CHECK (attempts >= 0)
                    )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE UNIQUE INDEX IF NOT EXISTS uidx_crm_note_receipt_source
                        ON %s."crm_note_receipts" (connection_id, source_kind, source_id)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_crm_note_receipt_contact
                        ON %s."crm_note_receipts" (contact_id) WHERE state <> 'retracted'
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_crm_note_receipt_pending
                        ON %s."crm_note_receipts" (updated_at) WHERE state = 'retract_pending'
        $ddl$, target);
    END LOOP;
END
$crm_note_receipts$;
