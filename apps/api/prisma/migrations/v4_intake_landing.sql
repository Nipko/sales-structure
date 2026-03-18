-- Migration for V4 Intake/Landing Module
-- Apply to existing tenants

-- Landing Pages
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."landing_pages" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "slug" VARCHAR(255) NOT NULL UNIQUE,
    "course_id" UUID REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE SET NULL,
    "campaign_id" UUID REFERENCES "{{SCHEMA_NAME}}"."campaigns"("id") ON DELETE SET NULL,
    "title" VARCHAR(500) NOT NULL,
    "subtitle" TEXT,
    "hero_json" JSONB DEFAULT '{}',
    "sections_json" JSONB DEFAULT '[]',
    "status" VARCHAR(50) DEFAULT 'draft', -- draft, published, archived
    "published_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."landing_pages" ("slug");
CREATE INDEX ON "{{SCHEMA_NAME}}"."landing_pages" ("status");

-- Form Definitions
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."form_definitions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "landing_page_id" UUID REFERENCES "{{SCHEMA_NAME}}"."landing_pages"("id") ON DELETE CASCADE,
    "name" VARCHAR(255) NOT NULL,
    "version" INTEGER DEFAULT 1,
    "fields_json" JSONB DEFAULT '[]',
    "consent_text_version" VARCHAR(50),
    "active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."form_definitions" ("landing_page_id");

-- Form Submissions
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."form_submissions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "landing_page_id" UUID REFERENCES "{{SCHEMA_NAME}}"."landing_pages"("id") ON DELETE SET NULL,
    "form_definition_id" UUID REFERENCES "{{SCHEMA_NAME}}"."form_definitions"("id") ON DELETE SET NULL,
    "campaign_id" UUID REFERENCES "{{SCHEMA_NAME}}"."campaigns"("id") ON DELETE SET NULL,
    "course_id" UUID REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE SET NULL,
    "lead_id" UUID REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE SET NULL,
    "raw_payload_json" JSONB NOT NULL,
    "normalized_payload_json" JSONB,
    "source_url" VARCHAR(500),
    "referrer" VARCHAR(500),
    "utm_json" JSONB DEFAULT '{}',
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."form_submissions" ("landing_page_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."form_submissions" ("lead_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."form_submissions" ("created_at");

-- Intake Sources (Generic endpoints for Webhooks/API)
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."intake_sources" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255),
    "type" VARCHAR(50) NOT NULL, -- webhook, api, manual
    "name" VARCHAR(255) NOT NULL,
    "config_json" JSONB DEFAULT '{}',
    "active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW()
);
