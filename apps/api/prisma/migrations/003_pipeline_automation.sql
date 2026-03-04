-- ============================================
-- Pipeline & Automation Tables (Entrega 2)
-- Sales pipeline stages, deals, and automation rules
-- ============================================

-- Pipeline stages (configurable per tenant)
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#3498db',
    position INTEGER NOT NULL DEFAULT 0,
    default_probability INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_tenant ON pipeline_stages(tenant_id);

-- Deals (sales opportunities)
CREATE TABLE IF NOT EXISTS deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES contacts(id),
    title VARCHAR(255) NOT NULL,
    value DECIMAL(14,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'COP',
    stage_id UUID REFERENCES pipeline_stages(id),
    probability INTEGER DEFAULT 0,
    expected_close_date DATE,
    assigned_agent_id UUID,
    notes TEXT DEFAULT '',
    tags TEXT[] DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'open',
    stage_entered_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);

-- Automation rules
CREATE TABLE IF NOT EXISTS automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,  -- auto_assign, auto_tag, sla_alert, auto_reply, follow_up
    trigger_event VARCHAR(100) NOT NULL, -- new_message, new_conversation, handoff, etc.
    conditions JSONB DEFAULT '{}',
    actions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    execution_count INTEGER DEFAULT 0,
    last_executed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_tenant ON automation_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_automation_type ON automation_rules(type);

-- Seed default pipeline stages for Gecko Aventura
INSERT INTO pipeline_stages (tenant_id, name, color, position, default_probability) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Lead nuevo', '#95a5a6', 0, 10),
    ('00000000-0000-0000-0000-000000000001', 'Contactado', '#3498db', 1, 25),
    ('00000000-0000-0000-0000-000000000001', 'Calificado', '#e67e22', 2, 50),
    ('00000000-0000-0000-0000-000000000001', 'Propuesta enviada', '#9b59b6', 3, 70),
    ('00000000-0000-0000-0000-000000000001', 'Negociación', '#f39c12', 4, 85),
    ('00000000-0000-0000-0000-000000000001', 'Cerrado ganado', '#2ecc71', 5, 100),
    ('00000000-0000-0000-0000-000000000001', 'Cerrado perdido', '#e74c3c', 6, 0)
ON CONFLICT DO NOTHING;

-- Seed default automation rules for Gecko Aventura
INSERT INTO automation_rules (tenant_id, name, type, trigger_event, conditions, actions, is_active) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Auto-asignar conversaciones nuevas', 'auto_assign', 'new_conversation',
     '{}', '{"method": "round_robin", "agent_pool": []}', true),
    ('00000000-0000-0000-0000-000000000001', 'Etiquetar interesados en rafting', 'auto_tag', 'new_message',
     '{"keywords": ["rafting", "río", "chicamocha", "rápidos"]}', '{"tag": "interesado-rafting"}', true),
    ('00000000-0000-0000-0000-000000000001', 'Etiquetar interesados en parapente', 'auto_tag', 'new_message',
     '{"keywords": ["parapente", "vuelo", "volar", "paragliding"]}', '{"tag": "interesado-parapente"}', true),
    ('00000000-0000-0000-0000-000000000001', 'SLA: Responder en 10 minutos', 'sla_alert', 'conversation_assigned',
     '{"max_response_minutes": 10}', '{"notify": "admin", "escalate_after_minutes": 20}', true)
ON CONFLICT DO NOTHING;
