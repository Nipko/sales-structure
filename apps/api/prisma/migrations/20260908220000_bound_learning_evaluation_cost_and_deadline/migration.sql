-- La evaluación de aprendizaje tenía relevo de worker por CAS y recuperación
-- tras un crash, pero ninguna cota: ni de gasto ni de reloj. Un intento podía
-- llamar al proveedor tantas veces como su bucle quisiera, nadie anotaba cuánto
-- había gastado, y un worker vivo pero colgado retenía la release para siempre
-- y todavía podía aterrizar su resultado horas después.
--
-- Esta migración agrega las dos cotas:
--
--   * `learning_releases.evaluation_deadline_at` — la cota de reloj del intento
--     en curso. Va en la fila de la release porque es la fila que toda
--     escritura ya bloquea con FOR UPDATE: el vencimiento lo decide la misma
--     autoridad y la misma transacción que decide si el worker sigue siendo el
--     dueño, no un temporizador del proceso que se muere junto con él.
--
--   * `learning_evaluation_budget` — el techo de gasto por intento y su
--     contabilidad. Es una tabla y no un contador dentro de
--     `learning_releases.evaluation` porque ese JSONB se reemplaza entero al
--     finalizar la evaluación: un contador ahí perdería exactamente el costo de
--     las corridas abandonadas a mitad, que son las que más caro salen. El cobro
--     es un UPDATE condicional de una sola sentencia, así que dos workers sobre
--     el mismo intento no pueden entrar los dos bajo el mismo techo.
--
-- Enteramente ADITIVA: ADD COLUMN nullable, CREATE TABLE y CREATE INDEX, todos
-- con IF NOT EXISTS y sin escribir ninguna fila. El código viejo ignora la
-- columna y la tabla nuevas durante el rolling restart, que es lo que exige
-- expand-contract. `evaluation_status` NO se toca: un valor nuevo en su CHECK
-- llegaría al dashboard como una etiqueta sin traducir, así que el abandono se
-- distingue por `learning_evaluation_budget.outcome` y por el código de razón
-- que queda en `evaluation->>'error'`.
--
-- SQL dinámico porque las tablas viven en el schema de cada tenant.
DO $learning_budget$
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

        -- ── Contabilidad del gasto por intento ───────────────────────────────
        -- No depende de `learning_releases`: un tenant que todavía no usó
        -- aprendizaje recibe la tabla igual, y el bootstrap perezoso encuentra
        -- su CREATE IF NOT EXISTS ya satisfecho.
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."learning_evaluation_budget" (
                attempt_id UUID PRIMARY KEY,
                release_id UUID NOT NULL,
                agent_id UUID NOT NULL,
                budget_day DATE NOT NULL DEFAULT CURRENT_DATE,
                units_used INTEGER NOT NULL DEFAULT 0 CHECK (units_used >= 0),
                units_max INTEGER NOT NULL CHECK (units_max > 0),
                outcome VARCHAR(40) CHECK (outcome IN ('evaluated','failed','budget_exhausted','deadline_exceeded')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())
        $ddl$, target);
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_learning_evaluation_budget_release ON %s."learning_evaluation_budget"(release_id, created_at DESC)', target);

        -- ── Ensanchamiento ───────────────────────────────────────────────────
        -- Fuera de cualquier CREATE y con su propio IF EXISTS: en un tenant cuya
        -- tabla ya existe el CREATE no agrega nada, y es exactamente ese tenant
        -- el que necesita la columna.
        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
            WHERE "table_schema" = tenant_record."schema_name" AND "table_name" = 'learning_releases') THEN
            EXECUTE format(
                'ALTER TABLE %s."learning_releases" ADD COLUMN IF NOT EXISTS evaluation_deadline_at TIMESTAMPTZ', target);
        END IF;
    END LOOP;
END
$learning_budget$;
