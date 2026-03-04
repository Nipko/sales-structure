-- ============================================
-- CSAT Surveys Table (Entrega 3)
-- Customer Satisfaction tracking
-- ============================================

CREATE TABLE IF NOT EXISTS csat_surveys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    contact_id UUID NOT NULL REFERENCES contacts(id),
    agent_id UUID NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    feedback TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_csat_per_conversation UNIQUE (conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_csat_agent ON csat_surveys(agent_id);
CREATE INDEX IF NOT EXISTS idx_csat_rating ON csat_surveys(rating);
CREATE INDEX IF NOT EXISTS idx_csat_created ON csat_surveys(created_at);
