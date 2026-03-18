-- Migración V4: Carla AI Sales Agent

CREATE TABLE IF NOT EXISTS carla_personality_profiles (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "tone" VARCHAR(50) DEFAULT 'professional',
    "language" VARCHAR(10) DEFAULT 'es',
    "objectives_json" JSONB DEFAULT '[]',
    "rules_json" JSONB DEFAULT '[]',
    "disclaimers" TEXT,
    "active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carla_prompt_templates (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "campaign_id" UUID,
    "course_id" UUID,
    "template_type" VARCHAR(50) DEFAULT 'system',
    "content" TEXT NOT NULL,
    "version" INTEGER DEFAULT 1,
    "active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carla_conversation_context (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL,
    "lead_id" UUID,
    "intent_primary" VARCHAR(100),
    "intent_secondary" VARCHAR(100),
    "confidence" DECIMAL(5, 2),
    "score_delta" INTEGER DEFAULT 0,
    "should_handoff" BOOLEAN DEFAULT false,
    "handoff_reason" TEXT,
    "summary_for_agent" TEXT,
    "tags_to_apply" TEXT[] DEFAULT '{}',
    "suggested_stage" VARCHAR(50),
    "context_json" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carla_ctx_conv ON carla_conversation_context("conversation_id");
