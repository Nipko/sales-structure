-- Uso de las tools del agente para el panel de superadmin `admin/tools`.
--
-- `public.platform_tool_usage_daily`: una fila por (día UTC, tenant, tool, modo, canal, resultado) con llamadas,
-- latencia total/máxima, cubos de latencia (<100, <300, <1000, <3000, <10000, >=10000 ms), última llamada y último
-- código de error. Hasta acá sólo las escrituras dejaban rastro (`<tenant>.tool_execution_ledger`); las lecturas no
-- dejaban ninguno. La escribe `ToolUsageRecorder` cada ~60 s con un upsert ADITIVO (`calls = calls + EXCLUDED.calls`),
-- así que varias réplicas de API y worker suman sin pisarse. Retención: 400 días, la aplica el mismo recorder.
--
-- ADITIVA: una tabla nueva, ni una fila escrita. Sin FK a `tenants` a propósito (un volcado en vuelo no falla por un
-- tenant borrado); la purga del tenant la borra (`TENANT_PUBLIC_PURGE_ORDER`). El binario anterior no conoce la tabla y
-- el nuevo sólo pierde conteos (warn limitado) si falta, así que el orden migración → contenedores es seguro en los dos
-- sentidos, y revertir es `DROP TABLE` sin pérdida de datos de negocio.

CREATE TABLE IF NOT EXISTS "public"."platform_tool_usage_daily" (
    "day" DATE NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tool_name" VARCHAR(120) NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "total_ms" BIGINT NOT NULL DEFAULT 0,
    "max_ms" INTEGER NOT NULL DEFAULT 0,
    "lat_lt_100" INTEGER NOT NULL DEFAULT 0,
    "lat_lt_300" INTEGER NOT NULL DEFAULT 0,
    "lat_lt_1000" INTEGER NOT NULL DEFAULT 0,
    "lat_lt_3000" INTEGER NOT NULL DEFAULT 0,
    "lat_lt_10000" INTEGER NOT NULL DEFAULT 0,
    "lat_ge_10000" INTEGER NOT NULL DEFAULT 0,
    "last_at" TIMESTAMPTZ(6) NOT NULL,
    "last_error_code" VARCHAR(80),
    CONSTRAINT "platform_tool_usage_daily_pkey" PRIMARY KEY ("day", "tenant_id", "tool_name", "mode", "channel", "outcome")
);

CREATE INDEX IF NOT EXISTS "platform_tool_usage_daily_day_idx" ON "public"."platform_tool_usage_daily"("day");
CREATE INDEX IF NOT EXISTS "platform_tool_usage_daily_tenant_day_idx" ON "public"."platform_tool_usage_daily"("tenant_id", "day");
CREATE INDEX IF NOT EXISTS "platform_tool_usage_daily_tool_day_idx" ON "public"."platform_tool_usage_daily"("tool_name", "day");
