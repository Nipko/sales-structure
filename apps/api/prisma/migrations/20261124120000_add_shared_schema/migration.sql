-- Tablas compartidas con tenant_id y seguridad por fila (ADR 0034), paso 0: el andamio, sin mover ninguna tabla.
--
-- 1. Schema `shared`: ahí vivirán las tablas de datos de tenant. Los ayudantes de PrismaService lo ponen en el
--    `search_path` entre el schema del tenant y `public`, y fijan `app.tenant_id` en la misma sentencia.
-- 2. Rol `parallext_app`: el rol con el que se conecta la aplicación. Sin SUPERUSER y sin BYPASSRLS, porque un rol
--    con cualquiera de los dos ignora las políticas y el aislamiento sería decorativo. Se crea SIN LOGIN y sin
--    contraseña: una migración no lleva secretos. El aprovisionamiento del entorno le da acceso con
--    `ALTER ROLE parallext_app LOGIN PASSWORD ...` y apunta `DATABASE_URL` a él; `DIRECT_DATABASE_URL` (migraciones)
--    sigue siendo el dueño de la base.
-- 3. `shared.apply_tenant_isolation(tabla)`: lo que hace compartida a una tabla, en un solo lugar. Cada migración
--    que cree una tabla en `shared` la llama; la prueba `shared-tables-isolation.postgres.spec.ts` comprueba que
--    ninguna tabla del schema se quede sin ello.
--
-- ADITIVA: un schema vacío, un rol que nadie usa todavía, permisos y una función. El código anterior no los conoce.

CREATE SCHEMA IF NOT EXISTS shared;

DO $shared_app_role$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parallext_app') THEN
        BEGIN
            CREATE ROLE parallext_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
        EXCEPTION WHEN duplicate_object THEN
            -- Otra base del mismo servidor lo creó en paralelo: los roles son del servidor, no de la base.
            NULL;
        END;
    END IF;
    -- El runtime crea el schema físico de cada tenant y, hasta que la fase 3 lo retire, sus tablas.
    EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO parallext_app', current_database());
END
$shared_app_role$;

-- `public`: las tablas globales de Prisma. Mismo alcance que tiene hoy la aplicación sobre ellas.
GRANT USAGE, CREATE ON SCHEMA public TO parallext_app;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO parallext_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO parallext_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO parallext_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO parallext_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO parallext_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO parallext_app;

-- `shared`: solo filas. Sin CREATE: la estructura de las tablas compartidas la define una migración, nunca el runtime.
GRANT USAGE ON SCHEMA shared TO parallext_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO parallext_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO parallext_app;

CREATE OR REPLACE FUNCTION shared.apply_tenant_isolation(target_table text)
RETURNS void
LANGUAGE plpgsql
AS $apply_tenant_isolation$
DECLARE
    tenant_column record;
BEGIN
    SELECT a.attnotnull AS not_null, format_type(a.atttypid, a.atttypmod) AS data_type,
           pg_get_expr(d.adbin, d.adrelid) AS default_expr
      INTO tenant_column
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = 'shared' AND c.relname = target_table
       AND a.attname = 'tenant_id' AND NOT a.attisdropped;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'shared.% has no tenant_id column', target_table;
    END IF;
    IF tenant_column.data_type <> 'uuid' OR NOT tenant_column.not_null THEN
        RAISE EXCEPTION 'shared.%.tenant_id must be uuid NOT NULL', target_table;
    END IF;
    IF tenant_column.default_expr IS NULL OR position('app.tenant_id' IN tenant_column.default_expr) = 0 THEN
        RAISE EXCEPTION 'shared.%.tenant_id must default to current_setting(''app.tenant_id'')::uuid', target_table;
    END IF;

    EXECUTE format('ALTER TABLE shared.%I ENABLE ROW LEVEL SECURITY', target_table);
    -- FORCE: sin esto el dueño de la tabla ignora la política.
    EXECUTE format('ALTER TABLE shared.%I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON shared.%I', target_table);
    -- El parámetro va dentro de (SELECT ...) para que el planificador lo evalúe una vez por consulta y no por fila.
    -- Sin contexto (o vacío) el cast falla: la consulta da error en vez de devolver filas de otro tenant.
    EXECUTE format(
        'CREATE POLICY tenant_isolation ON shared.%I
             USING (tenant_id = (SELECT current_setting(''app.tenant_id'')::uuid))
             WITH CHECK (tenant_id = (SELECT current_setting(''app.tenant_id'')::uuid))',
        target_table);
END
$apply_tenant_isolation$;

REVOKE ALL ON FUNCTION shared.apply_tenant_isolation(text) FROM PUBLIC;
