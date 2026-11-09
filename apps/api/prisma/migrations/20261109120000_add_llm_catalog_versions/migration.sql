-- Catálogo LLM versionado (ADR-0030 fase 2).
--
-- `public.llm_catalog_versions`: cada versión del catálogo (modelos con precios, cadenas por tarea y roles) es una fila
-- inmutable una vez publicada. `snapshot` guarda el contenido; `validation`, el resultado de las validaciones
-- bloqueantes de §4 la última vez que se pidieron. Hay una sola versión `active` (índice único parcial); publicar pasa la
-- anterior a `superseded` en la misma transacción. Volver atrás es publicar una versión nueva con el snapshot copiado,
-- así que nada se borra y el historial muestra el retroceso.
--
-- ADITIVA: una tabla nueva, ni una fila escrita. La versión 1 (la semilla de `llm-catalog.ts`) la escribe la API al
-- arrancar si la tabla está vacía, para que la semilla tenga una sola definición. El binario anterior no conoce la tabla
-- y el nuevo usa la semilla de código si falta, así que el orden migración → contenedores es seguro en los dos sentidos,
-- y revertir es `DROP TABLE` (se pierde sólo el historial de versiones del catálogo).

CREATE TABLE IF NOT EXISTS "public"."llm_catalog_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "snapshot" JSONB NOT NULL,
    "parent_version" INTEGER,
    "reason" TEXT NOT NULL,
    "created_by" UUID,
    "published_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "published_at" TIMESTAMPTZ(6),
    "validation" JSONB,
    CONSTRAINT "llm_catalog_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "llm_catalog_versions_status_check" CHECK ("status" IN ('draft', 'active', 'superseded')),
    CONSTRAINT "llm_catalog_versions_reason_check" CHECK (length(btrim("reason")) > 0),
    CONSTRAINT "llm_catalog_versions_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "llm_catalog_versions_version_key" ON "public"."llm_catalog_versions"("version");
CREATE UNIQUE INDEX IF NOT EXISTS "llm_catalog_versions_one_active" ON "public"."llm_catalog_versions"("status")
    WHERE "status" = 'active';
