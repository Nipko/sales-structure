-- ============================================
-- Parallext Engine - Tenant Schema Template
-- This SQL is executed when a new tenant is created.
-- Replace {{SCHEMA_NAME}} with the actual tenant schema name.
-- ============================================

-- Enable required extensions manually or globally via primary migrations

-- Create tenant schema
CREATE SCHEMA IF NOT EXISTS "{{SCHEMA_NAME}}";

-- ---- Contacts ----
CREATE TABLE "{{SCHEMA_NAME}}"."contacts" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "external_id" VARCHAR(255) NOT NULL,
    "channel_type" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255),
    "phone" VARCHAR(50),
    "email" VARCHAR(255),
    "avatar_url" VARCHAR(500),
    "metadata" JSONB DEFAULT '{}',
    "tags" TEXT[] DEFAULT '{}',
    "first_contact_at" TIMESTAMP DEFAULT NOW(),
    "last_contact_at" TIMESTAMP DEFAULT NOW(),
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX ON "{{SCHEMA_NAME}}"."contacts" ("channel_type", "external_id");

-- ---- Conversations ----
CREATE TABLE "{{SCHEMA_NAME}}"."conversations" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE CASCADE,
    "channel_type" VARCHAR(50) NOT NULL,
    "channel_account_id" VARCHAR(255) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'active',  -- active, waiting_human, with_human, resolved, archived
    "stage" VARCHAR(50) DEFAULT 'greeting', -- greeting, discovery, negotiation, closing, support, complaint
    "assigned_to" VARCHAR(255),
    "summary" TEXT,
    "estimated_ticket_value" DECIMAL(15, 2) DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "resolved_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."conversations" ("contact_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."conversations" ("status");
CREATE INDEX ON "{{SCHEMA_NAME}}"."conversations" ("created_at");

-- ---- Messages ----
CREATE TABLE "{{SCHEMA_NAME}}"."messages" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE CASCADE,
    "direction" VARCHAR(20) NOT NULL, -- inbound, outbound
    "content_type" VARCHAR(50) NOT NULL DEFAULT 'text',
    "content_text" TEXT,
    "media_url" VARCHAR(500),
    "media_mime_type" VARCHAR(100),
    "caption" TEXT,
    "status" VARCHAR(50) DEFAULT 'pending', -- pending, sent, delivered, read, failed
    "llm_model_used" VARCHAR(100),
    "llm_tokens_used" INTEGER DEFAULT 0,
    "llm_cost" DECIMAL(10, 6) DEFAULT 0,
    "routing_tier" VARCHAR(50),
    "routing_score" DECIMAL(5, 2),
    "external_id" VARCHAR(255),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."messages" ("conversation_id", "created_at");

-- ---- Persona Config ----
CREATE TABLE "{{SCHEMA_NAME}}"."persona_config" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "version" INTEGER DEFAULT 1,
    "is_active" BOOLEAN DEFAULT true,
    "config_yaml" TEXT NOT NULL,
    "config_json" JSONB NOT NULL,
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- ---- Knowledge Documents (RAG) ----
CREATE TABLE "{{SCHEMA_NAME}}"."knowledge_documents" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "title" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(500),
    "file_url" VARCHAR(500),
    "file_type" VARCHAR(50),
    "file_size" INTEGER DEFAULT 0,
    "content_text" TEXT,
    "chunk_count" INTEGER DEFAULT 0,
    "status" VARCHAR(50) DEFAULT 'pending', -- pending, processing, ready, error
    "error_message" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- ---- Knowledge Embeddings (Vector search via pgvector) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."knowledge_embeddings" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "document_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."knowledge_documents"("id") ON DELETE CASCADE,
    "chunk_index" INTEGER NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ke_embedding_{{SCHEMA_NAME}} ON "{{SCHEMA_NAME}}"."knowledge_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- ---- Conversation Memory (Long-term summaries) ----
CREATE TABLE "{{SCHEMA_NAME}}"."conversation_memory" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE CASCADE,
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE SET NULL,
    "summary" TEXT NOT NULL,
    "key_facts" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."conversation_memory" ("contact_id", "created_at");

-- ---- Products / Inventory ----
CREATE TABLE "{{SCHEMA_NAME}}"."products" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(255),
    "price" DECIMAL(15, 2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "is_available" BOOLEAN DEFAULT true,
    "stock" INTEGER,
    "images" TEXT[] DEFAULT '{}',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."products" ("category");
CREATE INDEX ON "{{SCHEMA_NAME}}"."products" ("is_available");

-- ---- Orders ----
CREATE TABLE "{{SCHEMA_NAME}}"."orders" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id"),
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id"),
    "items" JSONB NOT NULL DEFAULT '[]',
    "total_amount" DECIMAL(15, 2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "status" VARCHAR(50) DEFAULT 'pending', -- pending, confirmed, processing, completed, cancelled, refunded
    "payment_status" VARCHAR(50) DEFAULT 'pending', -- pending, paid, failed, refunded
    "payment_reference" VARCHAR(255),
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."orders" ("contact_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."orders" ("status");

-- ---- Tool Configs ----
CREATE TABLE "{{SCHEMA_NAME}}"."tool_configs" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type" VARCHAR(50) NOT NULL DEFAULT 'internal', -- internal, external
    "endpoint" VARCHAR(500),
    "auth_type" VARCHAR(50),
    "auth_credentials" TEXT, -- Encrypted
    "parameters_schema" JSONB DEFAULT '{}',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- ---- Business Rules ----
CREATE TABLE "{{SCHEMA_NAME}}"."business_rules" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "rule_type" VARCHAR(100) NOT NULL, -- greeting, faq, escalation, routing, validation
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- ---- Analytics Events ----
CREATE TABLE "{{SCHEMA_NAME}}"."analytics_events" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "event_type" VARCHAR(100) NOT NULL,
    "conversation_id" UUID,
    "contact_id" UUID,
    "data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."analytics_events" ("event_type", "created_at");
CREATE INDEX ON "{{SCHEMA_NAME}}"."analytics_events" ("conversation_id");

-- ============================================
-- PARALLLY — Commercial Domain (Phase 2)
-- ============================================

-- ---- Courses (Catalog per tenant) ----
CREATE TABLE "{{SCHEMA_NAME}}"."courses" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "code"            VARCHAR(50),
    "name"            VARCHAR(500) NOT NULL,
    "slug"            VARCHAR(255) NOT NULL UNIQUE,
    "description"     TEXT,
    "price"           DECIMAL(15, 2) NOT NULL DEFAULT 0,
    "currency"        VARCHAR(10) DEFAULT 'COP',
    "duration_hours"  INTEGER,
    "modality"        VARCHAR(50) DEFAULT 'presencial',  -- presencial, virtual, hibrido
    "brochure_url"    VARCHAR(500),
    "faq_version"     INTEGER DEFAULT 1,
    "policy_version"  INTEGER DEFAULT 1,
    "is_active"       BOOLEAN DEFAULT true,
    "metadata"        JSONB DEFAULT '{}',
    "created_at"      TIMESTAMP DEFAULT NOW(),
    "updated_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."courses" ("is_active");
CREATE INDEX ON "{{SCHEMA_NAME}}"."courses" ("code");

-- ---- Campaigns ----
CREATE TABLE "{{SCHEMA_NAME}}"."campaigns" (
    "id"                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "code"              VARCHAR(50),
    "name"              VARCHAR(500) NOT NULL,
    "course_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE SET NULL,
    "source_type"       VARCHAR(50) DEFAULT 'landing',   -- landing, csv, api, meta_ads
    "channel"           VARCHAR(50) DEFAULT 'whatsapp',  -- whatsapp, email, mixed
    "wa_template_name"  VARCHAR(255),                    -- Meta approved template name
    "status"            VARCHAR(50) DEFAULT 'draft',     -- draft, active, paused, finished
    "starts_at"         TIMESTAMP,
    "ends_at"           TIMESTAMP,
    "schedule_json"     JSONB DEFAULT '{}',              -- office hours, days, timezone
    "office_hours_start" INTEGER DEFAULT 8,
    "office_hours_end"   INTEGER DEFAULT 20,
    "default_owner_rule" VARCHAR(255),                   -- round-robin, specific-user, etc.
    "automation_profile_id" UUID,                        -- FK to automation_rules if needed
    "max_attempts"      INTEGER DEFAULT 3,
    "retry_delay_hours" INTEGER DEFAULT 24,
    "fallback_email"    BOOLEAN DEFAULT false,
    "metadata"          JSONB DEFAULT '{}',
    "created_at"        TIMESTAMP DEFAULT NOW(),
    "updated_at"        TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."campaigns" ("status");
CREATE INDEX ON "{{SCHEMA_NAME}}"."campaigns" ("course_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."campaigns" ("code");

-- ---- Campaign ↔ Courses (Many-to-Many) ----
CREATE TABLE "{{SCHEMA_NAME}}"."campaign_courses" (
    "campaign_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."campaigns"("id") ON DELETE CASCADE,
    "course_id"   UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE CASCADE,
    "is_primary"  BOOLEAN DEFAULT false,
    PRIMARY KEY ("campaign_id", "course_id")
);

-- ---- Commercial Offers ----
CREATE TABLE "{{SCHEMA_NAME}}"."commercial_offers" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id"       VARCHAR(255),
    "course_id"       UUID REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE CASCADE,
    "campaign_id"     UUID REFERENCES "{{SCHEMA_NAME}}"."campaigns"("id") ON DELETE SET NULL,
    "offer_type"      VARCHAR(100) NOT NULL,  -- discount, promo, bundle
    "title"           VARCHAR(500) NOT NULL,
    "conditions_json" JSONB DEFAULT '{}',
    "valid_from"      TIMESTAMP,
    "valid_to"        TIMESTAMP,
    "active"          BOOLEAN DEFAULT true,
    "created_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."commercial_offers" ("course_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."commercial_offers" ("active");

-- ---- Companies ----
CREATE TABLE "{{SCHEMA_NAME}}"."companies" (
    "id"          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name"        VARCHAR(500) NOT NULL,
    "industry"    VARCHAR(255),
    "city"        VARCHAR(255),
    "country"     VARCHAR(100) DEFAULT 'CO',
    "website"     VARCHAR(500),
    "metadata"    JSONB DEFAULT '{}',
    "created_at"  TIMESTAMP DEFAULT NOW(),
    "updated_at"  TIMESTAMP DEFAULT NOW()
);

-- ---- Leads (replaces/extends contacts for commercial flows) ----
CREATE TABLE "{{SCHEMA_NAME}}"."leads" (
    "id"                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id"          UUID REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE SET NULL,
    "company_id"          UUID REFERENCES "{{SCHEMA_NAME}}"."companies"("id") ON DELETE SET NULL,
    "first_name"          VARCHAR(255),
    "last_name"           VARCHAR(255),
    "phone"               VARCHAR(50) NOT NULL,          -- E.164 format
    "email"               VARCHAR(255),
    "score"               INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 10),
    "stage"               VARCHAR(50) DEFAULT 'nuevo',   -- nuevo, contactado, respondio, calificado, tibio, caliente, listo_cierre, ganado, perdido, no_interesado
    "primary_intent"      VARCHAR(100),                  -- precio, fecha, modalidad, duracion, certificacion, financiacion, objecion_economica, objecion_tiempo, hablar_humano, no_interesado
    "secondary_intent"    VARCHAR(100),
    "is_vip"              BOOLEAN DEFAULT false,          -- grupo, varios cursos o alto valor
    "preferred_contact"   VARCHAR(50) DEFAULT 'whatsapp', -- whatsapp, email, phone
    "campaign_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."campaigns"("id") ON DELETE SET NULL,
    "course_id"           UUID REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE SET NULL,
    -- UTM Attribution
    "utm_source"          VARCHAR(255),
    "utm_medium"          VARCHAR(255),
    "utm_campaign"        VARCHAR(255),
    "utm_content"         VARCHAR(255),
    "referrer_url"        VARCHAR(500),
    "gclid"               VARCHAR(500),
    "fbclid"              VARCHAR(500),
    -- Operational
    "assigned_to"         VARCHAR(255),                  -- agent user id
    "opted_out"           BOOLEAN DEFAULT false,
    "opted_out_at"        TIMESTAMP,
    "last_contacted_at"   TIMESTAMP,
    "metadata"            JSONB DEFAULT '{}',
    "created_at"          TIMESTAMP DEFAULT NOW(),
    "updated_at"          TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."leads" ("phone");
CREATE INDEX ON "{{SCHEMA_NAME}}"."leads" ("stage");
CREATE INDEX ON "{{SCHEMA_NAME}}"."leads" ("score");
CREATE INDEX ON "{{SCHEMA_NAME}}"."leads" ("campaign_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."leads" ("course_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."leads" ("opted_out");
CREATE UNIQUE INDEX ON "{{SCHEMA_NAME}}"."leads" ("phone", "campaign_id") WHERE campaign_id IS NOT NULL;

-- ---- Opportunities (CRM deal tracking) ----
CREATE TABLE "{{SCHEMA_NAME}}"."opportunities" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "lead_id"         UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE CASCADE,
    "course_id"       UUID REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE SET NULL,
    "campaign_id"     UUID REFERENCES "{{SCHEMA_NAME}}"."campaigns"("id") ON DELETE SET NULL,
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE SET NULL,
    "stage"           VARCHAR(50) DEFAULT 'nuevo',       -- same stages as lead
    "score"           INTEGER DEFAULT 0,                 -- snapshot at creation/update
    "estimated_value" DECIMAL(15, 2),
    "currency"        VARCHAR(10) DEFAULT 'COP',
    "sla_deadline"    TIMESTAMP,
    "won_at"          TIMESTAMP,
    "lost_at"         TIMESTAMP,
    "loss_reason"     TEXT,
    "assigned_to"     VARCHAR(255),
    "metadata"        JSONB DEFAULT '{}',
    "created_at"      TIMESTAMP DEFAULT NOW(),
    "updated_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."opportunities" ("lead_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."opportunities" ("stage");
CREATE INDEX ON "{{SCHEMA_NAME}}"."opportunities" ("campaign_id");

-- ---- Consent Records ----
CREATE TABLE "{{SCHEMA_NAME}}"."consent_records" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "lead_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE SET NULL,
    "channel"         VARCHAR(50) NOT NULL DEFAULT 'web_form',
    "legal_version"   VARCHAR(50) NOT NULL,              -- e.g. "v1.0", "2026-01-01"
    "legal_text_hash" VARCHAR(64),                       -- SHA-256 of the consent text shown
    "ip_address"      VARCHAR(45),
    "user_agent"      TEXT,
    "origin_url"      VARCHAR(500),
    "created_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."consent_records" ("lead_id");

-- ---- Opt-Out Records ----
CREATE TABLE "{{SCHEMA_NAME}}"."opt_out_records" (
    "id"          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "lead_id"     UUID REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE SET NULL,
    "phone"       VARCHAR(50),
    "channel"     VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
    "trigger_msg" TEXT,                                  -- original message that triggered opt-out
    "detected_from" VARCHAR(20) DEFAULT 'keyword',       -- keyword, ai, manual
    "status"      VARCHAR(20) DEFAULT 'pending',          -- pending, confirmed, rejected (false positive)
    "reviewed_by" UUID,                                   -- user who reviewed
    "reviewed_at" TIMESTAMP,
    "review_notes" TEXT,
    "created_at"  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."opt_out_records" ("phone");
CREATE INDEX ON "{{SCHEMA_NAME}}"."opt_out_records" ("lead_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."opt_out_records" ("status");
ALTER TABLE "{{SCHEMA_NAME}}"."opt_out_records" ADD COLUMN IF NOT EXISTS "detected_from" VARCHAR(20) DEFAULT 'keyword';
ALTER TABLE "{{SCHEMA_NAME}}"."opt_out_records" ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) DEFAULT 'pending';
ALTER TABLE "{{SCHEMA_NAME}}"."opt_out_records" ADD COLUMN IF NOT EXISTS "reviewed_by" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."opt_out_records" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP;
ALTER TABLE "{{SCHEMA_NAME}}"."opt_out_records" ADD COLUMN IF NOT EXISTS "review_notes" TEXT;

-- ---- Tags (controlled catalog per tenant) ----
CREATE TABLE "{{SCHEMA_NAME}}"."tags" (
    "id"          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name"        VARCHAR(100) NOT NULL UNIQUE,
    "color"       VARCHAR(20) DEFAULT '#6c5ce7',
    "created_at"  TIMESTAMP DEFAULT NOW()
);

-- ---- Lead Tags (M2M) ----
CREATE TABLE "{{SCHEMA_NAME}}"."lead_tags" (
    "lead_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE CASCADE,
    "tag_id"  UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."tags"("id") ON DELETE CASCADE,
    PRIMARY KEY ("lead_id", "tag_id")
);

-- ---- Tasks ----
CREATE TABLE "{{SCHEMA_NAME}}"."tasks" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "lead_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE CASCADE,
    "opportunity_id"  UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE CASCADE,
    "title"           VARCHAR(500) NOT NULL,
    "description"     TEXT,
    "type"            VARCHAR(50) DEFAULT 'follow_up',  -- follow_up, call, meeting, email, handoff
    "status"          VARCHAR(50) DEFAULT 'pending',    -- pending, in_progress, done, cancelled
    "due_at"          TIMESTAMP,
    "completed_at"    TIMESTAMP,
    "assigned_to"     VARCHAR(255),
    "created_by"      VARCHAR(255),
    "created_at"      TIMESTAMP DEFAULT NOW(),
    "updated_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."tasks" ("lead_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."tasks" ("status");
CREATE INDEX ON "{{SCHEMA_NAME}}"."tasks" ("due_at");

-- ---- Notes (internal, not visible to lead) ----
CREATE TABLE "{{SCHEMA_NAME}}"."notes" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "lead_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE CASCADE,
    "opportunity_id"  UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE CASCADE,
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE SET NULL,
    "content"         TEXT NOT NULL,
    "created_by"      VARCHAR(255),
    "created_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."notes" ("lead_id");

-- ---- Stage History (audit trail of pipeline transitions) ----
CREATE TABLE "{{SCHEMA_NAME}}"."stage_history" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "lead_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE CASCADE,
    "opportunity_id"  UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE CASCADE,
    "from_stage"      VARCHAR(50),
    "to_stage"        VARCHAR(50) NOT NULL,
    "reason"          TEXT,
    "triggered_by"    VARCHAR(50) DEFAULT 'system',     -- system, agent, ai
    "agent_id"        VARCHAR(255),
    "created_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."stage_history" ("lead_id", "created_at");

-- ---- Pipeline Stages (configurable per tenant) ----
CREATE TABLE "{{SCHEMA_NAME}}"."pipeline_stages" (
    "id"                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id"           UUID NOT NULL,
    "name"                VARCHAR(100) NOT NULL,
    "slug"                VARCHAR(100),
    "color"               VARCHAR(20) DEFAULT '#3498db',
    "position"            INTEGER NOT NULL DEFAULT 0,
    "default_probability" INTEGER DEFAULT 0,
    "sla_hours"           INTEGER,
    "is_terminal"         BOOLEAN DEFAULT false,
    "created_at"          TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."pipeline_stages" ("tenant_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."pipeline_stages" ("position");

-- ---- Deals (sales pipeline tracking) ----
CREATE TABLE "{{SCHEMA_NAME}}"."deals" (
    "id"                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id"          UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id"),
    "title"               VARCHAR(255) NOT NULL,
    "value"               DECIMAL(14,2) DEFAULT 0,
    "currency"            VARCHAR(10) DEFAULT 'COP',
    "stage_id"            UUID REFERENCES "{{SCHEMA_NAME}}"."pipeline_stages"("id"),
    "probability"         INTEGER DEFAULT 0,
    "expected_close_date" DATE,
    "assigned_agent_id"   UUID,
    "notes"               TEXT DEFAULT '',
    "tags"                TEXT[] DEFAULT '{}',
    "status"              VARCHAR(20) DEFAULT 'open',
    "sla_deadline"        TIMESTAMPTZ,
    "sla_status"          VARCHAR(20) DEFAULT 'on_track',
    "stage_entered_at"    TIMESTAMP DEFAULT NOW(),
    "created_at"          TIMESTAMP DEFAULT NOW(),
    "updated_at"          TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."deals" ("stage_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."deals" ("contact_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."deals" ("status");
CREATE INDEX ON "{{SCHEMA_NAME}}"."deals" ("sla_deadline") WHERE status = 'open' AND sla_deadline IS NOT NULL;

-- ---- Stage Transitions (audit trail for deal pipeline moves) ----
CREATE TABLE "{{SCHEMA_NAME}}"."stage_transitions" (
    "id"          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "deal_id"     UUID REFERENCES "{{SCHEMA_NAME}}"."deals"("id") ON DELETE CASCADE,
    "from_stage"  TEXT,
    "to_stage"    TEXT NOT NULL,
    "changed_by"  TEXT NOT NULL DEFAULT 'system',
    "reason"      TEXT,
    "created_at"  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."stage_transitions" ("deal_id", "created_at");

-- ---- Automation Rules (see V4 section below) ----

-- ============================================
-- PARALLLY — WhatsApp Platform Manager (WABA)
-- ============================================

-- ---- WhatsApp Channels ----
CREATE TABLE "{{SCHEMA_NAME}}"."whatsapp_channels" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "provider_type" VARCHAR(50) DEFAULT 'meta_cloud',
    "meta_business_id" VARCHAR(255),
    "meta_waba_id" VARCHAR(255),
    "phone_number_id" VARCHAR(255),
    "display_phone_number" VARCHAR(50),
    "display_name" VARCHAR(255),
    "display_name_status" VARCHAR(50),
    "quality_rating" VARCHAR(50),
    "messaging_limit_tier" VARCHAR(50),
    "access_token_ref" TEXT, -- Encrypted or reference
    "app_id" VARCHAR(255),
    "webhook_verify_token_ref" VARCHAR(255),
    "webhook_callback_url" VARCHAR(500),
    "webhook_subscription_status" VARCHAR(50),
    "channel_status" VARCHAR(50) DEFAULT 'pending', -- pending, connected, disconnected, restricted
    "is_coexistence" BOOLEAN DEFAULT false,
    "coexistence_status" VARCHAR(50), -- null, acknowledged, migrating, active
    "onboarding_id" UUID, -- references public.whatsapp_onboardings(id)
    "connected_at" TIMESTAMP,
    "last_healthcheck_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- ---- WhatsApp Templates ----
CREATE TABLE "{{SCHEMA_NAME}}"."whatsapp_templates" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "channel_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."whatsapp_channels"("id") ON DELETE CASCADE,
    "course_id" UUID REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE SET NULL,
    "campaign_id" UUID REFERENCES "{{SCHEMA_NAME}}"."campaigns"("id") ON DELETE SET NULL,
    "name" VARCHAR(255) NOT NULL,
    "language" VARCHAR(10) DEFAULT 'es',
    "category" VARCHAR(50),
    "components_json" JSONB DEFAULT '[]',
    "approval_status" VARCHAR(50) DEFAULT 'PENDING',
    "last_sync_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."whatsapp_templates" ("channel_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."whatsapp_templates" ("name");

-- ---- WhatsApp Webhook Events ----
CREATE TABLE "{{SCHEMA_NAME}}"."whatsapp_webhook_events" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "channel_id" UUID REFERENCES "{{SCHEMA_NAME}}"."whatsapp_channels"("id") ON DELETE SET NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "dedupe_key" VARCHAR(255) UNIQUE,
    "processing_status" VARCHAR(50) DEFAULT 'pending', -- pending, processed, failed
    "processing_result" TEXT,
    "processed_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."whatsapp_webhook_events" ("processing_status");
CREATE INDEX ON "{{SCHEMA_NAME}}"."whatsapp_webhook_events" ("dedupe_key");

-- ---- WhatsApp Message Logs ----
CREATE TABLE "{{SCHEMA_NAME}}"."whatsapp_message_logs" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "channel_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."whatsapp_channels"("id") ON DELETE CASCADE,
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE SET NULL,
    "provider_message_id" VARCHAR(255),
    "template_name" VARCHAR(255),
    "direction" VARCHAR(20) NOT NULL, -- inbound, outbound
    "status" VARCHAR(50) DEFAULT 'pending', -- pending, sent, delivered, read, failed
    "error_code" VARCHAR(50),
    "error_message" TEXT,
    "request_payload_json" JSONB,
    "response_payload_json" JSONB,
    "sent_at" TIMESTAMP,
    "delivered_at" TIMESTAMP,
    "read_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."whatsapp_message_logs" ("channel_id", "status");
CREATE INDEX ON "{{SCHEMA_NAME}}"."whatsapp_message_logs" ("provider_message_id");

-- ============================================
-- PARALLLY — Intake / Landing Module (V4)
-- ============================================

-- ---- Landing Pages ----
CREATE TABLE "{{SCHEMA_NAME}}"."landing_pages" (
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

-- ---- Form Definitions ----
CREATE TABLE "{{SCHEMA_NAME}}"."form_definitions" (
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

-- ---- Form Submissions ----
CREATE TABLE "{{SCHEMA_NAME}}"."form_submissions" (
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

-- ---- Intake Sources ----
CREATE TABLE "{{SCHEMA_NAME}}"."intake_sources" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255),
    "type" VARCHAR(50) NOT NULL, -- webhook, api, manual
    "name" VARCHAR(255) NOT NULL,
    "config_json" JSONB DEFAULT '{}',
    "active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- PARALLLY — Workflow & Automation (V4)
-- ============================================

-- ---- Automation Rules ----
-- Migrate old schema if it exists (rename columns to match V4 service code)
DO $$
BEGIN
    -- If old column "type" exists, this is the V3 schema — migrate it
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = '{{SCHEMA_NAME}}' AND table_name = 'automation_rules' AND column_name = 'type'
    ) THEN
        -- Rename columns to match V4 code expectations
        ALTER TABLE "{{SCHEMA_NAME}}"."automation_rules" RENAME COLUMN "type" TO "trigger_type";
        ALTER TABLE "{{SCHEMA_NAME}}"."automation_rules" RENAME COLUMN "trigger_event" TO "trigger_type_legacy";
        ALTER TABLE "{{SCHEMA_NAME}}"."automation_rules" RENAME COLUMN "conditions" TO "conditions_json";
        ALTER TABLE "{{SCHEMA_NAME}}"."automation_rules" RENAME COLUMN "actions" TO "actions_json";
        ALTER TABLE "{{SCHEMA_NAME}}"."automation_rules" RENAME COLUMN "is_active" TO "active";
        -- Add missing updated_at column
        ALTER TABLE "{{SCHEMA_NAME}}"."automation_rules" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT NOW();
        -- Alter tenant_id to VARCHAR to match V4
        ALTER TABLE "{{SCHEMA_NAME}}"."automation_rules" ALTER COLUMN "tenant_id" TYPE VARCHAR(255) USING tenant_id::text;
        -- Drop legacy column
        ALTER TABLE "{{SCHEMA_NAME}}"."automation_rules" DROP COLUMN IF EXISTS "trigger_type_legacy";
        -- Drop old indexes (ignore errors)
        DROP INDEX IF EXISTS "{{SCHEMA_NAME}}"."automation_rules_tenant_id_idx";
        DROP INDEX IF EXISTS "{{SCHEMA_NAME}}"."automation_rules_type_idx";
    END IF;
END $$;
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."automation_rules" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "trigger_type" VARCHAR(100) NOT NULL,
    "conditions_json" JSONB DEFAULT '{}',
    "actions_json" JSONB DEFAULT '[]',
    "active" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "automation_rules_trigger_type_idx" ON "{{SCHEMA_NAME}}"."automation_rules" ("trigger_type");

-- ---- Automation Executions ----
CREATE TABLE "{{SCHEMA_NAME}}"."automation_executions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "rule_id" UUID REFERENCES "{{SCHEMA_NAME}}"."automation_rules"("id") ON DELETE CASCADE,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "status" VARCHAR(50) DEFAULT 'pending', -- pending, success, failed
    "started_at" TIMESTAMP DEFAULT NOW(),
    "finished_at" TIMESTAMP,
    "result_json" JSONB DEFAULT '{}'
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."automation_executions" ("rule_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."automation_executions" ("entity_type", "entity_id");

-- ---- Wait Jobs ----
CREATE TABLE "{{SCHEMA_NAME}}"."wait_jobs" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "job_type" VARCHAR(50) NOT NULL,
    "run_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "payload_json" JSONB DEFAULT '{}',
    "status" VARCHAR(50) DEFAULT 'pending',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."wait_jobs" ("status", "run_at");

-- ============================================
-- PARALLLY — Compliance & Audit (V4)
-- ============================================

-- ---- Legal Text Versions ----
CREATE TABLE "{{SCHEMA_NAME}}"."legal_text_versions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "channel" VARCHAR(50) NOT NULL DEFAULT 'web',
    "version" INTEGER NOT NULL DEFAULT 1,
    "text" TEXT NOT NULL,
    "active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."legal_text_versions" ("tenant_id", "channel", "active");

-- (consent_records and opt_out_records already defined above in CRM section)

-- ---- Deletion Requests ----
CREATE TABLE "{{SCHEMA_NAME}}"."deletion_requests" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "lead_id" UUID,
    "requested_by" VARCHAR(255),
    "status" VARCHAR(50) DEFAULT 'pending',
    "requested_at" TIMESTAMP DEFAULT NOW(),
    "processed_at" TIMESTAMP
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."deletion_requests" ("status");

-- ============================================
-- PARALLLY — Analytics Aggregates (V4)
-- ============================================

CREATE TABLE "{{SCHEMA_NAME}}"."daily_metrics" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "metric_date" DATE NOT NULL,
    "dimension_type" VARCHAR(50) NOT NULL,
    "dimension_id" VARCHAR(255),
    "metrics_json" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."daily_metrics" ("metric_date", "dimension_type");
CREATE INDEX ON "{{SCHEMA_NAME}}"."daily_metrics" ("tenant_id", "metric_date");

-- ============================================
-- PARALLLY — Carla AI Sales Agent (V4)
-- ============================================

-- ---- Personality Profiles ----
CREATE TABLE "{{SCHEMA_NAME}}"."carla_personality_profiles" (
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
CREATE INDEX ON "{{SCHEMA_NAME}}"."carla_personality_profiles" ("tenant_id", "active");

-- ---- Prompt Templates ----
CREATE TABLE "{{SCHEMA_NAME}}"."carla_prompt_templates" (
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
CREATE INDEX ON "{{SCHEMA_NAME}}"."carla_prompt_templates" ("tenant_id", "template_type", "active");

-- ---- Conversation Context Snapshots ----
CREATE TABLE "{{SCHEMA_NAME}}"."carla_conversation_context" (
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
CREATE INDEX ON "{{SCHEMA_NAME}}"."carla_conversation_context" ("conversation_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."carla_conversation_context" ("lead_id");

-- ============================================
-- PARALLLY — Knowledge Base / RAG (V4)
-- ============================================

-- ---- Knowledge Resources ----
CREATE TABLE "{{SCHEMA_NAME}}"."knowledge_resources" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'manual',
    "title" VARCHAR(500) NOT NULL,
    "source" VARCHAR(100),
    "source_url" VARCHAR(500),
    "content" TEXT,
    "content_hash" VARCHAR(64),
    "course_id" UUID,
    "campaign_id" UUID,
    "version" INTEGER DEFAULT 1,
    "status" VARCHAR(50) DEFAULT 'draft',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."knowledge_resources" ("tenant_id", "status");
CREATE INDEX ON "{{SCHEMA_NAME}}"."knowledge_resources" ("course_id");

-- ---- Knowledge Chunks ----
CREATE TABLE "{{SCHEMA_NAME}}"."knowledge_chunks" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "resource_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "metadata_json" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."knowledge_chunks" ("resource_id");

-- ---- Knowledge Approvals ----
CREATE TABLE "{{SCHEMA_NAME}}"."knowledge_approvals" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "resource_id" UUID NOT NULL,
    "approved_by" VARCHAR(255),
    "approved_at" TIMESTAMP DEFAULT NOW(),
    "notes" TEXT
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."knowledge_approvals" ("resource_id");

-- ============================================
-- Agent Console — Internal Notes, Canned Responses, Assignments & CSAT
-- ============================================

-- ---- Internal Notes ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."internal_notes" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE CASCADE,
    "agent_id" UUID,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "internal_notes_conversation_idx" ON "{{SCHEMA_NAME}}"."internal_notes" ("conversation_id");

-- ---- Canned Responses ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."canned_responses" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255),
    "shortcode" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "category" VARCHAR(100) DEFAULT 'general',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "canned_responses_shortcode_idx" ON "{{SCHEMA_NAME}}"."canned_responses" ("shortcode");

-- ---- Conversation Assignments ----
CREATE TABLE "{{SCHEMA_NAME}}"."conversation_assignments" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE CASCADE,
    "agent_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP DEFAULT NOW(),
    "first_response_at" TIMESTAMP,
    "resolved_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."conversation_assignments" ("conversation_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."conversation_assignments" ("agent_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."conversation_assignments" ("resolved_at");

-- ---- CSAT Surveys ----
CREATE TABLE "{{SCHEMA_NAME}}"."csat_surveys" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE CASCADE,
    "contact_id" UUID REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE SET NULL,
    "agent_id" UUID,
    "rating" INTEGER NOT NULL CHECK ("rating" >= 1 AND "rating" <= 5),
    "feedback" TEXT,
    "created_at" TIMESTAMP DEFAULT NOW(),
    UNIQUE ("conversation_id")
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."csat_surveys" ("agent_id");
CREATE INDEX ON "{{SCHEMA_NAME}}"."csat_surveys" ("rating");

-- ============================================
-- Identity Service — Unified Customer Profiles
-- ============================================

-- ---- Customer Profiles (unified identity across channels) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."customer_profiles" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "display_name" VARCHAR(255),
    "phone" VARCHAR(50),
    "email" VARCHAR(255),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "cp_phone_idx" ON "{{SCHEMA_NAME}}"."customer_profiles" ("phone");
CREATE INDEX IF NOT EXISTS "cp_email_idx" ON "{{SCHEMA_NAME}}"."customer_profiles" ("email");

-- ---- Contact Identities (links contacts to unified profiles) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."contact_identities" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "customer_profile_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."customer_profiles"("id") ON DELETE CASCADE,
    "contact_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE CASCADE,
    "channel_type" VARCHAR(50) NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "is_primary" BOOLEAN DEFAULT false,
    "linked_at" TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "ci_contact_idx" ON "{{SCHEMA_NAME}}"."contact_identities" ("contact_id");
CREATE INDEX IF NOT EXISTS "ci_profile_idx" ON "{{SCHEMA_NAME}}"."contact_identities" ("customer_profile_id");

-- ---- Merge Suggestions (pending approval for cross-channel identity merge) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."merge_suggestions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "customer_profile_id_a" UUID REFERENCES "{{SCHEMA_NAME}}"."customer_profiles"("id") ON DELETE SET NULL,
    "customer_profile_id_b" UUID REFERENCES "{{SCHEMA_NAME}}"."customer_profiles"("id") ON DELETE SET NULL,
    "contact_id_a" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE CASCADE,
    "contact_id_b" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE CASCADE,
    "match_type" VARCHAR(50) NOT NULL,
    "confidence" DECIMAL(3,2) DEFAULT 0.00,
    "status" VARCHAR(20) DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "ms_status_idx" ON "{{SCHEMA_NAME}}"."merge_suggestions" ("status");

-- ============================================
-- CRM Features V2 — Custom Attributes, Segments, Macros, Snooze, CSAT, Pre-Chat, KB
-- ============================================

-- ---- Conversation Snooze (A2) ----
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "snoozed_until" TIMESTAMP;
CREATE INDEX IF NOT EXISTS "conv_snoozed_idx" ON "{{SCHEMA_NAME}}"."conversations" ("snoozed_until") WHERE snoozed_until IS NOT NULL;

-- ---- CSAT Survey extensions (B1) ----
ALTER TABLE "{{SCHEMA_NAME}}"."csat_surveys" ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP;
ALTER TABLE "{{SCHEMA_NAME}}"."csat_surveys" ADD COLUMN IF NOT EXISTS "responded_at" TIMESTAMP;

-- ---- Macros (A3) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."macros" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255),
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "actions_json" JSONB NOT NULL DEFAULT '[]',
    "visibility" VARCHAR(50) DEFAULT 'team',
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "macros_tenant_idx" ON "{{SCHEMA_NAME}}"."macros" ("tenant_id");

-- ---- Custom Attribute Definitions (C1) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."custom_attribute_definitions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL DEFAULT 'contact',
    "attribute_key" VARCHAR(100) NOT NULL,
    "attribute_label" VARCHAR(255) NOT NULL,
    "attribute_type" VARCHAR(50) NOT NULL,
    "options" JSONB DEFAULT '[]',
    "required" BOOLEAN DEFAULT false,
    "position" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW(),
    UNIQUE ("tenant_id", "entity_type", "attribute_key")
);
CREATE INDEX IF NOT EXISTS "cad_entity_idx" ON "{{SCHEMA_NAME}}"."custom_attribute_definitions" ("tenant_id", "entity_type");

-- ---- Contact Segments (C2) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."contact_segments" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "filter_rules" JSONB NOT NULL DEFAULT '[]',
    "contact_count" INTEGER DEFAULT 0,
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "cs_tenant_idx" ON "{{SCHEMA_NAME}}"."contact_segments" ("tenant_id");

-- ---- Pre-Chat Forms (D1) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."pre_chat_forms" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) DEFAULT 'default',
    "fields_json" JSONB NOT NULL DEFAULT '[]',
    "greeting_message" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- ---- Knowledge Base Public Portal (D2) ----
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_resources" ADD COLUMN IF NOT EXISTS "category" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_resources" ADD COLUMN IF NOT EXISTS "is_public" BOOLEAN DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_resources" ADD COLUMN IF NOT EXISTS "slug" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_resources" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP;
CREATE INDEX IF NOT EXISTS "kr_public_idx" ON "{{SCHEMA_NAME}}"."knowledge_resources" ("is_public", "status");

-- ============================================
-- PARALLLY — Media, Email Templates & Appointments
-- ============================================

-- ---- Media Files ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."media_files" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "entity_type" VARCHAR(50) NOT NULL DEFAULT 'general',  -- general, product, tenant_logo, course, email_template
    "entity_id" UUID,
    "original_name" VARCHAR(500),
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "thumbnail_name" VARCHAR(255),
    "label" VARCHAR(255),
    "description" TEXT,
    "tags" TEXT[] DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "mf_entity_idx" ON "{{SCHEMA_NAME}}"."media_files" ("entity_type", "entity_id");
ALTER TABLE "{{SCHEMA_NAME}}"."media_files" ADD COLUMN IF NOT EXISTS "label" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."media_files" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."media_files" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT '{}';

-- ---- Email Templates ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."email_templates" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "body_html" TEXT NOT NULL,
    "body_json" JSONB DEFAULT '{}',
    "variables" TEXT[] DEFAULT '{}',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "et_slug_idx" ON "{{SCHEMA_NAME}}"."email_templates" ("slug");

-- ---- Bookable Services ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."services" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(15, 2) DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "color" VARCHAR(20) DEFAULT '#6c5ce7',
    "is_active" BOOLEAN DEFAULT true,
    "sort_order" INTEGER DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- ---- Calendar Integrations (per agent) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."calendar_integrations" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'google',
    "encrypted_refresh_token" TEXT NOT NULL,
    "calendar_id" VARCHAR(255) DEFAULT 'primary',
    "account_email" VARCHAR(255),
    "sync_token" TEXT,
    "watch_channel_id" VARCHAR(255),
    "watch_resource_id" VARCHAR(255),
    "watch_expiration" TIMESTAMP,
    "is_active" BOOLEAN DEFAULT true,
    "connected_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "ci_user_idx" ON "{{SCHEMA_NAME}}"."calendar_integrations" ("user_id", "provider");

-- ---- Appointments ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."appointments" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE SET NULL,
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE SET NULL,
    "assigned_to" UUID,
    "service_id" UUID,
    "service_name" VARCHAR(500),
    "start_at" TIMESTAMP NOT NULL,
    "end_at" TIMESTAMP NOT NULL,
    "status" VARCHAR(50) DEFAULT 'pending',  -- pending, confirmed, cancelled, completed, no_show
    "location" VARCHAR(500),
    "notes" TEXT,
    "reminder_sent" BOOLEAN DEFAULT false,
    "google_event_id" VARCHAR(255),
    "outlook_event_id" VARCHAR(255),
    "customer_name" VARCHAR(255),
    "customer_email" VARCHAR(255),
    "customer_phone" VARCHAR(50),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "appt_contact_idx" ON "{{SCHEMA_NAME}}"."appointments" ("contact_id");
CREATE INDEX IF NOT EXISTS "appt_assigned_idx" ON "{{SCHEMA_NAME}}"."appointments" ("assigned_to");
CREATE INDEX IF NOT EXISTS "appt_start_idx" ON "{{SCHEMA_NAME}}"."appointments" ("start_at");
CREATE INDEX IF NOT EXISTS "appt_status_idx" ON "{{SCHEMA_NAME}}"."appointments" ("status");
-- Add columns for existing tenants (safe for new tenants too — columns already exist from CREATE TABLE)
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "service_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "google_event_id" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "outlook_event_id" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "customer_email" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "customer_phone" VARCHAR(50);
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "customer_name" VARCHAR(255);

-- ---- Availability Slots (weekly schedule per agent) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."availability_slots" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "user_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,  -- 0=Sunday, 1=Monday, ..., 6=Saturday
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "avs_user_idx" ON "{{SCHEMA_NAME}}"."availability_slots" ("user_id", "day_of_week");

-- ---- Blocked Dates (holidays, vacations) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."blocked_dates" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "user_id" UUID,
    "blocked_date" DATE NOT NULL,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "bd_user_date_idx" ON "{{SCHEMA_NAME}}"."blocked_dates" ("user_id", "blocked_date");

-- ============================================
-- Analytics — Alert Rules & Scheduled Reports
-- ============================================

-- ---- Alert Rules (threshold-based notifications) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."alert_rules" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "metric" VARCHAR(100) NOT NULL,
    "operator" VARCHAR(20) NOT NULL,
    "threshold" DECIMAL(15, 2) NOT NULL,
    "channel" VARCHAR(50) DEFAULT 'in_app',
    "notify_emails" TEXT[] DEFAULT '{}',
    "is_active" BOOLEAN DEFAULT true,
    "last_triggered_at" TIMESTAMP,
    "cooldown_minutes" INTEGER DEFAULT 60,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "ar_tenant_active_idx" ON "{{SCHEMA_NAME}}"."alert_rules" ("tenant_id", "is_active");

-- ---- Alert History ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."alert_history" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "rule_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."alert_rules"("id") ON DELETE CASCADE,
    "metric_value" DECIMAL(15, 2) NOT NULL,
    "threshold" DECIMAL(15, 2) NOT NULL,
    "notified_via" VARCHAR(50) DEFAULT 'in_app',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "ah_rule_idx" ON "{{SCHEMA_NAME}}"."alert_history" ("rule_id", "created_at");

-- ---- Scheduled Reports config ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."scheduled_reports" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "frequency" VARCHAR(20) NOT NULL DEFAULT 'weekly',
    "recipients" TEXT[] NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "last_sent_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "sr_tenant_idx" ON "{{SCHEMA_NAME}}"."scheduled_reports" ("tenant_id");
