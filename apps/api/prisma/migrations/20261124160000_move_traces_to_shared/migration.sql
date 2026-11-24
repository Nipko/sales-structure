-- Lote piloto de las tablas compartidas (ADR 0034, fase 1): las dos tablas de trazas pasan del schema de cada
-- tenant a `shared`.
--
-- Mismas columnas y tipos que tenían en `tenant-schema.sql`, más `tenant_id`, que toma por defecto el tenant de
-- la transacción (`app.tenant_id`, lo fijan los ayudantes de PrismaService). Los índices van encabezados por
-- `tenant_id`: toda consulta lleva ese filtro, puesto por la política de seguridad por fila.
--
-- Sin llave foránea hacia `conversations`: esa tabla sigue siendo por tenant hasta la fase 3 (ADR 0034, punto 6).
--
-- ADITIVA: dos tablas nuevas. No copia filas: no existe ningún tenant con datos (el VPS se retiró el 2026-11-24).
-- Un schema de tenant creado antes de este cambio conservaría su copia y la seguiría usando, porque va primero en
-- el `search_path`; `PrismaService.findShadowedSharedTables` lo informa en cada arranque.

CREATE TABLE IF NOT EXISTS shared.conversation_traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT current_setting('app.tenant_id')::uuid,
    conversation_id UUID NOT NULL,
    provider VARCHAR(40),
    model VARCHAR(80),
    tier VARCHAR(40),
    task VARCHAR(40),
    latency_ms INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    fallback_used BOOLEAN DEFAULT false,
    kb_sources JSONB DEFAULT '[]'::jsonb,
    stage VARCHAR(40),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ctrace_tenant_conversation
    ON shared.conversation_traces (tenant_id, conversation_id, created_at);
SELECT shared.apply_tenant_isolation('conversation_traces');

CREATE TABLE IF NOT EXISTS shared.turn_traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT current_setting('app.tenant_id')::uuid,
    conversation_id UUID NOT NULL,
    message_id UUID NULL,
    total_duration_ms INTEGER,
    step_count INTEGER,
    steps JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_turntrace_tenant_conversation
    ON shared.turn_traces (tenant_id, conversation_id, created_at);
-- La retención borra por antigüedad dentro de un tenant (`pruneTurnTraces`).
CREATE INDEX IF NOT EXISTS idx_turntrace_tenant_created
    ON shared.turn_traces (tenant_id, created_at);
SELECT shared.apply_tenant_isolation('turn_traces');
