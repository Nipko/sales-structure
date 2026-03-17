-- ============================================
-- Parallext Engine - Tenant Schema Template
-- This SQL is executed when a new tenant is created.
-- Replace {{SCHEMA_NAME}} with the actual tenant schema name.
-- ============================================

-- Enable required extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

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

-- ---- Knowledge Embeddings (Vector search) ----
CREATE TABLE "{{SCHEMA_NAME}}"."knowledge_embeddings" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "document_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."knowledge_documents"("id") ON DELETE CASCADE,
    "chunk_index" INTEGER NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."knowledge_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

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
    "name"            VARCHAR(500) NOT NULL,
    "slug"            VARCHAR(255) NOT NULL UNIQUE,
    "description"     TEXT,
    "price"           DECIMAL(15, 2) NOT NULL DEFAULT 0,
    "currency"        VARCHAR(10) DEFAULT 'COP',
    "duration_hours"  INTEGER,
    "modality"        VARCHAR(50) DEFAULT 'presencial',  -- presencial, virtual, hibrido
    "is_active"       BOOLEAN DEFAULT true,
    "metadata"        JSONB DEFAULT '{}',
    "created_at"      TIMESTAMP DEFAULT NOW(),
    "updated_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."courses" ("is_active");

-- ---- Campaigns ----
CREATE TABLE "{{SCHEMA_NAME}}"."campaigns" (
    "id"                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name"              VARCHAR(500) NOT NULL,
    "course_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE SET NULL,
    "channel"           VARCHAR(50) DEFAULT 'whatsapp',  -- whatsapp, email, mixed
    "wa_template_name"  VARCHAR(255),                    -- Meta approved template name
    "status"            VARCHAR(50) DEFAULT 'draft',     -- draft, active, paused, finished
    "starts_at"         TIMESTAMP,
    "ends_at"           TIMESTAMP,
    "office_hours_start" INTEGER DEFAULT 8,              -- hour 0-23
    "office_hours_end"   INTEGER DEFAULT 20,
    "max_attempts"      INTEGER DEFAULT 3,
    "retry_delay_hours" INTEGER DEFAULT 24,
    "fallback_email"    BOOLEAN DEFAULT false,
    "metadata"          JSONB DEFAULT '{}',
    "created_at"        TIMESTAMP DEFAULT NOW(),
    "updated_at"        TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."campaigns" ("status");
CREATE INDEX ON "{{SCHEMA_NAME}}"."campaigns" ("course_id");

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
    "created_at"  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON "{{SCHEMA_NAME}}"."opt_out_records" ("phone");
CREATE INDEX ON "{{SCHEMA_NAME}}"."opt_out_records" ("lead_id");

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
