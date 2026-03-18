-- Migración V4: Motor de Automatización y Workflows
-- Tablas necesarias para evaluar reglas y ejecutar acciones basándose en eventos de dominio.

-- 1. Reglas de Automatización
CREATE TABLE IF NOT EXISTS automation_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(100) NOT NULL, -- Ej: 'lead.captured', 'opportunity.stage_changed'
    conditions_json JSONB DEFAULT '{}', -- Reglas para filtrar (ej. campaign_id = X)
    actions_json JSONB NOT NULL DEFAULT '[]', -- Matriz de acciones a ejecutar: [{ "type": "sendTemplate", "config": {...} }, ...]
    active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indice para búsquedas rápidas por tenant_id y trigger
CREATE INDEX IF NOT EXISTS idx_automation_rules_tenant_trigger ON automation_rules(tenant_id, trigger_type);

-- 2. Ejecución Auditada de Reglas
CREATE TABLE IF NOT EXISTS automation_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL, -- Ej: 'lead', 'opportunity'
    entity_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, success, failed
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE,
    result_json JSONB DEFAULT '{}'
);

-- Índices para trazabilidad de ejecuciones
CREATE INDEX IF NOT EXISTS idx_automation_executions_rule ON automation_executions(rule_id);
CREATE INDEX IF NOT EXISTS idx_automation_executions_entity ON automation_executions(entity_type, entity_id);

-- 3. Cola de Espera (Wait Jobs) para retrasos programados o reintentos
CREATE TABLE IF NOT EXISTS wait_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL,
    job_type VARCHAR(50) NOT NULL, -- Ej: 'delayed_action'
    run_at TIMESTAMP WITH TIME ZONE NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indice vital para que el worker (polling / scheduler) encuentre trabajos pendientes rápidamente
CREATE INDEX IF NOT EXISTS idx_wait_jobs_status_run_at ON wait_jobs(status, run_at);
