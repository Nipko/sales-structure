-- El recibo del handoff llevaba un solo objeto `effects` con cuatro claves
-- agregadas, y `announced` era UN booleano que cubría el aviso a seis consumidores
-- distintos: el socket del inbox, un CRM externo, los webhooks del tenant, push,
-- Slack y SMS. Con `emitAsync`, que un consumidor falle rechaza la llamada entera,
-- así que la bandera nunca se escribe y una transferencia reanudada vuelve a
-- avisarles a los seis: un segundo mensaje de Slack, una segunda nota en el CRM,
-- un segundo SMS pago. Con `emit`, la bandera puede quedar escrita antes de saber
-- si los consumidores terminaron.
--
-- Una fila por efecto y destino sí puede decirlo. `admitted` es permiso para UN
-- intento y confirma antes de la llamada externa; un lease vencido NO vuelve a
-- estar disponible, porque el efecto pudo haber ocurrido.
--
-- Enteramente ADITIVA: CREATE TABLE / CREATE INDEX con IF NOT EXISTS, sin escribir
-- ninguna fila. El código viejo la ignora durante el rolling restart.
DO $agent_handoff_effects_backfill$
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

        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."agent_handoff_effects" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                receipt_id UUID NOT NULL,
                destination TEXT NOT NULL,
                state TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                lease_token UUID,
                lease_expires_at TIMESTAMPTZ,
                receipt TEXT,
                error_code TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT agent_handoff_effects_identity UNIQUE (receipt_id, destination),
                CONSTRAINT agent_handoff_effects_state
                    CHECK (state IN ('prepared','admitted','accepted','rejected','unknown')),
                CONSTRAINT agent_handoff_effects_destination
                    CHECK (destination IN ('assignment','cache','inbox','crm','webhooks','push','slack','sms','email')),
                CONSTRAINT agent_handoff_effects_attempts CHECK (attempts >= 0),
                CONSTRAINT agent_handoff_effects_lease
                    CHECK ((state = 'admitted') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
            )
        $ddl$, target);

        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_handoff_effects_receipt
                ON %s."agent_handoff_effects"(receipt_id, destination)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_handoff_effects_unsettled
                ON %s."agent_handoff_effects"(updated_at) WHERE state NOT IN ('accepted','unknown')
        $ddl$, target);
    END LOOP;
END
$agent_handoff_effects_backfill$;
