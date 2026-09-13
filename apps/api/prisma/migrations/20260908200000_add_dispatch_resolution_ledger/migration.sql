-- Resolver un efecto incierto es una decisión irreversible: `delivered` y
-- `not_delivered` cierran la fila para siempre y `retry` manda otro mensaje a un
-- cliente real. Esa decisión no tenía dónde vivir. El `actorId` llegaba al
-- resolutor y se descartaba (`void input.actorId`), la evidencia se recortaba a
-- ~110 caracteres dentro de `error_code` —borrando de paso el fallo del
-- proveedor que justificaba la reconciliación— y la única constancia del autor
-- era una fila en `public.audit_logs` escrita FUERA de la transacción y con su
-- fallo descartado en silencio.
--
-- Esta tabla guarda la decisión en la misma transacción que el cambio que
-- autoriza. `exported_at` convierte al log global en una copia recuperable de
-- esta fila en vez de un segundo original que se puede perder.
--
-- Enteramente ADITIVA: CREATE TABLE / CREATE INDEX con IF NOT EXISTS.
DO $agent_dispatch_resolutions_backfill$
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
            CREATE TABLE IF NOT EXISTS %s."agent_dispatch_resolutions" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                dispatch_id UUID NOT NULL,
                resolution TEXT NOT NULL,
                evidence TEXT NOT NULL,
                actor_id TEXT NOT NULL,
                actor_role TEXT,
                receipt TEXT,
                previous_state TEXT NOT NULL,
                previous_error_code TEXT,
                new_state TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                exported_at TIMESTAMPTZ,
                CONSTRAINT agent_dispatch_resolutions_kind
                    CHECK (resolution IN ('delivered','not_delivered','retry')),
                CONSTRAINT agent_dispatch_resolutions_evidence
                    CHECK (char_length(evidence) BETWEEN 1 AND 500),
                CONSTRAINT agent_dispatch_resolutions_actor CHECK (char_length(actor_id) BETWEEN 1 AND 200)
            )
        $ddl$, target);

        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_dispatch_resolutions_dispatch
                ON %s."agent_dispatch_resolutions"(dispatch_id, created_at DESC)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_dispatch_resolutions_unexported
                ON %s."agent_dispatch_resolutions"(created_at) WHERE exported_at IS NULL
        $ddl$, target);
    END LOOP;
END
$agent_dispatch_resolutions_backfill$;
