-- ============================================
-- Pipeline SLA Tracking & Stage Transitions (Entrega 3)
-- Adds SLA tracking columns to pipeline_stages and deals,
-- plus a stage_transitions audit table for deals.
-- ============================================

-- Add SLA and terminal columns to pipeline_stages
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS sla_hours INTEGER;
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS is_terminal BOOLEAN DEFAULT false;

-- Add SLA tracking columns to deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS sla_status VARCHAR(20) DEFAULT 'on_track';
-- sla_status: on_track, at_risk, breached, no_sla

-- Add deal_id to opportunities for linking
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;

-- Stage transitions audit table for deals
CREATE TABLE IF NOT EXISTS stage_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
    from_stage TEXT,
    to_stage TEXT NOT NULL,
    changed_by TEXT NOT NULL DEFAULT 'system',
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stage_transitions_deal ON stage_transitions(deal_id, created_at);

-- Update existing pipeline_stages with slug and SLA config
-- Only update rows that don't already have a slug set
UPDATE pipeline_stages SET slug = 'nuevo', sla_hours = 1, is_terminal = false
    WHERE LOWER(name) LIKE '%nuevo%' AND slug IS NULL;
UPDATE pipeline_stages SET slug = 'contactado', sla_hours = 4, is_terminal = false
    WHERE LOWER(name) LIKE '%contactado%' AND slug IS NULL;
UPDATE pipeline_stages SET slug = 'calificado', sla_hours = 48, is_terminal = false
    WHERE LOWER(name) LIKE '%calificado%' AND slug IS NULL;
UPDATE pipeline_stages SET slug = 'propuesta_enviada', sla_hours = 72, is_terminal = false
    WHERE LOWER(name) LIKE '%propuesta%' AND slug IS NULL;
UPDATE pipeline_stages SET slug = 'negociacion', sla_hours = 72, is_terminal = false
    WHERE LOWER(name) LIKE '%negociaci%' AND slug IS NULL;
UPDATE pipeline_stages SET slug = 'ganado', is_terminal = true
    WHERE LOWER(name) LIKE '%ganado%' AND slug IS NULL;
UPDATE pipeline_stages SET slug = 'perdido', is_terminal = true
    WHERE LOWER(name) LIKE '%perdido%' AND slug IS NULL;

-- Create index on sla_deadline for the cron job
CREATE INDEX IF NOT EXISTS idx_deals_sla_deadline ON deals(sla_deadline) WHERE status = 'open' AND sla_deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_sla_status ON deals(sla_status) WHERE status = 'open';
