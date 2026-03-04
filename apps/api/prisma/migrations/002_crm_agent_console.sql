-- ============================================
-- CRM Tables - Agent Console (Entrega 1)
-- Adds internal notes, canned responses,
-- conversation assignments, and contact enrichment
-- ============================================

-- Run this migration in each tenant schema
-- Replace {{SCHEMA_NAME}} with actual schema name

-- Internal notes (agent-only, not visible to customer)
CREATE TABLE IF NOT EXISTS internal_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    agent_id UUID NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_conversation ON internal_notes(conversation_id);

-- Canned responses (quick replies per tenant)
CREATE TABLE IF NOT EXISTS canned_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    shortcode VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(100) DEFAULT 'general',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canned_tenant ON canned_responses(tenant_id);

-- Conversation assignments (agent tracking)
CREATE TABLE IF NOT EXISTS conversation_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    agent_id UUID NOT NULL,
    assigned_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    first_response_at TIMESTAMP,
    sla_deadline TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assignments_conversation ON conversation_assignments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_assignments_agent ON conversation_assignments(agent_id);

-- Enrich contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS segment VARCHAR(50) DEFAULT 'new';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lifetime_value DECIMAL(12,2) DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_interaction TIMESTAMP;

-- Add sender_name to messages if not exists
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255);

-- Seed some example canned responses for Gecko Aventura
INSERT INTO canned_responses (tenant_id, shortcode, title, content, category) VALUES
    ('00000000-0000-0000-0000-000000000001', 'saludo', 'Saludo inicial', '¡Hola {{nombre}}! Soy del equipo de Gecko Aventura. ¿En qué puedo ayudarte hoy? 🏔️', 'general'),
    ('00000000-0000-0000-0000-000000000001', 'precio', 'Consulta de precio', 'El tour de {{producto}} tiene un precio de {{precio}} COP por persona. ¿Te gustaría reservar?', 'ventas'),
    ('00000000-0000-0000-0000-000000000001', 'reserva', 'Confirmación de reserva', '¡Excelente! Tu reserva para {{producto}} queda confirmada para el {{fecha}}. Te enviaremos los detalles por este medio. 🎉', 'ventas'),
    ('00000000-0000-0000-0000-000000000001', 'ubicacion', 'Ubicación', 'Nos encontramos en San Gil, Santander, Colombia. El punto de encuentro es en nuestras oficinas principales. Te envío la ubicación. 📍', 'info'),
    ('00000000-0000-0000-0000-000000000001', 'espera', 'En espera', '{{nombre}}, déjame consultar eso con el equipo. Te respondo en breve. ⏳', 'general')
ON CONFLICT DO NOTHING;
