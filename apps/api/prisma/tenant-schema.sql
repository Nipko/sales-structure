-- ============================================
-- Parallext Engine - Tenant Schema Template
-- This SQL is executed when a new tenant is created.
-- Replace {{SCHEMA_NAME}} with the actual tenant schema name.
-- ============================================

-- Enable required extensions manually or globally via primary migrations

-- Create tenant schema
CREATE SCHEMA IF NOT EXISTS "{{SCHEMA_NAME}}";

-- ---- Contacts ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."contacts" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "external_id" VARCHAR(255) NOT NULL,
    "channel_type" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255),
    "phone" VARCHAR(50),
    "phone_normalized" VARCHAR(20),
    "email" VARCHAR(255),
    "avatar_url" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "tags" TEXT[] DEFAULT '{}',
    "first_contact_at" TIMESTAMP DEFAULT NOW(),
    "last_contact_at" TIMESTAMP DEFAULT NOW(),
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_contacts_channel_type_external_id" ON "{{SCHEMA_NAME}}"."contacts" ("channel_type", "external_id");
CREATE INDEX IF NOT EXISTS "idx_contacts_phone_normalized" ON "{{SCHEMA_NAME}}"."contacts" ("phone_normalized");

-- ---- Conversations ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."conversations" (
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
CREATE INDEX IF NOT EXISTS "idx_conversations_contact_id" ON "{{SCHEMA_NAME}}"."conversations" ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_conversations_status" ON "{{SCHEMA_NAME}}"."conversations" ("status");
CREATE INDEX IF NOT EXISTS "idx_conversations_created_at" ON "{{SCHEMA_NAME}}"."conversations" ("created_at");

-- ---- Messages ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."messages" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE CASCADE,
    "direction" VARCHAR(20) NOT NULL, -- inbound, outbound
    "content_type" VARCHAR(50) NOT NULL DEFAULT 'text',
    "content_text" TEXT,
    "media_url" TEXT,
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
CREATE INDEX IF NOT EXISTS "idx_messages_conversation_id_created_at" ON "{{SCHEMA_NAME}}"."messages" ("conversation_id", "created_at");
-- Inbound idempotency: external_id holds the PROVIDER's message id (wamid, IG/FB
-- mid, Telegram update, Twilio sid, email Message-ID). The partial unique index
-- lets the inbound INSERT use ON CONFLICT DO NOTHING, so a redelivery or a retry
-- can never store the same customer message twice — nor re-run the turn that
-- would reply to it. Partial (WHERE NOT NULL) because paths without a provider
-- id (widget, test messages) legitimately insert many NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_messages_external_id" ON "{{SCHEMA_NAME}}"."messages" ("external_id") WHERE "external_id" IS NOT NULL;

-- ---- Persona Config ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."persona_config" (
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
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."knowledge_documents" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "title" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(500),
    "file_url" TEXT,
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

-- ---- Knowledge Documents extra columns (URL crawling + categories) ----
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_documents"
    ADD COLUMN IF NOT EXISTS "source_type" VARCHAR(20) DEFAULT 'upload',
    ADD COLUMN IF NOT EXISTS "source_url" VARCHAR(2000),
    ADD COLUMN IF NOT EXISTS "last_crawled_at" TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "crawl_hash" VARCHAR(64),
    ADD COLUMN IF NOT EXISTS "category" VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "is_public" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "slug" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "excerpt" TEXT,
    ADD COLUMN IF NOT EXISTS "auto_recrawl" BOOLEAN DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_kd_category_{{SCHEMA_NAME}} ON "{{SCHEMA_NAME}}"."knowledge_documents" ("category") WHERE "status" = 'ready';
CREATE INDEX IF NOT EXISTS idx_kd_public_{{SCHEMA_NAME}} ON "{{SCHEMA_NAME}}"."knowledge_documents" ("is_public") WHERE "is_public" = true AND "status" = 'ready';

-- ---- Knowledge Documents Phase 4 columns (language + versioning) ----
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_documents"
    ADD COLUMN IF NOT EXISTS "language" VARCHAR(10) DEFAULT 'auto',
    ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 1;

-- ---- Knowledge Document Versions ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."knowledge_document_versions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "document_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."knowledge_documents"("id") ON DELETE CASCADE,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(500),
    "content_text" TEXT,
    "chunk_count" INTEGER DEFAULT 0,
    "changed_by" VARCHAR(255),
    "change_summary" VARCHAR(500),
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kdv_doc_{{SCHEMA_NAME}} ON "{{SCHEMA_NAME}}"."knowledge_document_versions" ("document_id", "version" DESC);

-- ---- KB Retrieval Analytics ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."kb_retrieval_log" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "document_id" UUID REFERENCES "{{SCHEMA_NAME}}"."knowledge_documents"("id") ON DELETE SET NULL,
    "chunk_id" UUID,
    "query" TEXT NOT NULL,
    "score" DECIMAL(5,4),
    "was_used" BOOLEAN DEFAULT false,
    "conversation_id" UUID,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_krl_doc_{{SCHEMA_NAME}} ON "{{SCHEMA_NAME}}"."kb_retrieval_log" ("document_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS idx_krl_created_{{SCHEMA_NAME}} ON "{{SCHEMA_NAME}}"."kb_retrieval_log" ("created_at" DESC);

-- ---- KB Unanswered Queries ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."kb_unanswered_queries" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "query" TEXT NOT NULL,
    "query_hash" VARCHAR(64) NOT NULL,
    "occurrences" INTEGER DEFAULT 1,
    "last_seen_at" TIMESTAMP DEFAULT NOW(),
    "resolved" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kuq_hash_{{SCHEMA_NAME}} ON "{{SCHEMA_NAME}}"."kb_unanswered_queries" ("query_hash") WHERE resolved = false;

-- ---- Conversation Memory (Long-term summaries) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."conversation_memory" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE CASCADE,
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE SET NULL,
    "summary" TEXT NOT NULL,
    "key_facts" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_conversation_memory_contact_id_created_at" ON "{{SCHEMA_NAME}}"."conversation_memory" ("contact_id", "created_at");

-- ---- Products / Inventory ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."products" (
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
CREATE INDEX IF NOT EXISTS "idx_products_category" ON "{{SCHEMA_NAME}}"."products" ("category");
CREATE INDEX IF NOT EXISTS "idx_products_is_available" ON "{{SCHEMA_NAME}}"."products" ("is_available");

-- ---- Product Categories ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."product_categories" (
    "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(50) DEFAULT '#6c5ce7',
    "sort_order" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP DEFAULT NOW()
);

-- ---- Stock Movements ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."stock_movements" (
    "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "product_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL, -- inbound, outbound, adjustment
    "quantity" INTEGER NOT NULL,
    "previous_stock" INTEGER,
    "new_stock" INTEGER,
    "reason" TEXT,
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_stock_movements_product" ON "{{SCHEMA_NAME}}"."stock_movements" ("product_id", "created_at" DESC);

-- ---- Orders ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."orders" (
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
CREATE INDEX IF NOT EXISTS "idx_orders_contact_id" ON "{{SCHEMA_NAME}}"."orders" ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_orders_status" ON "{{SCHEMA_NAME}}"."orders" ("status");

-- ---- Order Items ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."order_items" (
    "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "product_name" VARCHAR(500),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(15, 2) NOT NULL DEFAULT 0,
    "total_price" DECIMAL(15, 2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_order_items_order" ON "{{SCHEMA_NAME}}"."order_items" ("order_id");

-- ---- Tool Configs ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tool_configs" (
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
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."business_rules" (
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
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."analytics_events" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "event_type" VARCHAR(100) NOT NULL,
    "conversation_id" UUID,
    "contact_id" UUID,
    "data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_analytics_events_event_type_created_at" ON "{{SCHEMA_NAME}}"."analytics_events" ("event_type", "created_at");
CREATE INDEX IF NOT EXISTS "idx_analytics_events_conversation_id" ON "{{SCHEMA_NAME}}"."analytics_events" ("conversation_id");

-- ============================================
-- PARALLLY — Commercial Domain (Phase 2)
-- ============================================

-- ---- Courses (Catalog per tenant) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."courses" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "code"            VARCHAR(50),
    "name"            VARCHAR(500) NOT NULL,
    "slug"            VARCHAR(255) NOT NULL UNIQUE,
    "description"     TEXT,
    "price"           DECIMAL(15, 2) NOT NULL DEFAULT 0,
    "currency"        VARCHAR(10) DEFAULT 'COP',
    "duration_hours"  INTEGER,
    "modality"        VARCHAR(50) DEFAULT 'presencial',  -- presencial, virtual, hibrido
    "brochure_url"    TEXT,
    "faq_version"     INTEGER DEFAULT 1,
    "policy_version"  INTEGER DEFAULT 1,
    "is_active"       BOOLEAN DEFAULT true,
    "metadata"        JSONB DEFAULT '{}',
    "created_at"      TIMESTAMP DEFAULT NOW(),
    "updated_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_courses_is_active" ON "{{SCHEMA_NAME}}"."courses" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_courses_code" ON "{{SCHEMA_NAME}}"."courses" ("code");

-- ---- Campaigns ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."campaigns" (
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
CREATE INDEX IF NOT EXISTS "idx_campaigns_status" ON "{{SCHEMA_NAME}}"."campaigns" ("status");
CREATE INDEX IF NOT EXISTS "idx_campaigns_course_id" ON "{{SCHEMA_NAME}}"."campaigns" ("course_id");
CREATE INDEX IF NOT EXISTS "idx_campaigns_code" ON "{{SCHEMA_NAME}}"."campaigns" ("code");

-- ---- Campaign ↔ Courses (Many-to-Many) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."campaign_courses" (
    "campaign_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."campaigns"("id") ON DELETE CASCADE,
    "course_id"   UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE CASCADE,
    "is_primary"  BOOLEAN DEFAULT false,
    PRIMARY KEY ("campaign_id", "course_id")
);

-- ---- Commercial Offers ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."commercial_offers" (
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
CREATE INDEX IF NOT EXISTS "idx_commercial_offers_course_id" ON "{{SCHEMA_NAME}}"."commercial_offers" ("course_id");
CREATE INDEX IF NOT EXISTS "idx_commercial_offers_active" ON "{{SCHEMA_NAME}}"."commercial_offers" ("active");

-- ---- Companies ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."companies" (
    "id"          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name"        VARCHAR(500) NOT NULL,
    "industry"    VARCHAR(255),
    "city"        VARCHAR(255),
    "country"     VARCHAR(100) DEFAULT 'CO',
    "website"     TEXT,
    "metadata"    JSONB DEFAULT '{}',
    "created_at"  TIMESTAMP DEFAULT NOW(),
    "updated_at"  TIMESTAMP DEFAULT NOW()
);

-- ---- Leads (replaces/extends contacts for commercial flows) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."leads" (
    "id"                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id"          UUID REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE SET NULL,
    "company_id"          UUID REFERENCES "{{SCHEMA_NAME}}"."companies"("id") ON DELETE SET NULL,
    "first_name"          VARCHAR(255),
    "last_name"           VARCHAR(255),
    "phone"               VARCHAR(50) NOT NULL,          -- E.164 format
    "phone_normalized"    VARCHAR(20),                   -- E.164 normalized for dedup matching
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
    "referrer_url"        TEXT,
    "gclid"               TEXT,
    "fbclid"              TEXT,
    -- Operational
    "assigned_to"         VARCHAR(255),                  -- agent user id
    "opted_out"           BOOLEAN DEFAULT false,
    "opted_out_at"        TIMESTAMP,
    "last_contacted_at"   TIMESTAMP,
    "metadata"            JSONB DEFAULT '{}',
    "archived_at"         TIMESTAMP DEFAULT NULL,
    "created_at"          TIMESTAMP DEFAULT NOW(),
    "updated_at"          TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_leads_phone" ON "{{SCHEMA_NAME}}"."leads" ("phone");
CREATE INDEX IF NOT EXISTS "idx_leads_phone_normalized" ON "{{SCHEMA_NAME}}"."leads" ("phone_normalized");
CREATE INDEX IF NOT EXISTS "idx_leads_stage" ON "{{SCHEMA_NAME}}"."leads" ("stage");
CREATE INDEX IF NOT EXISTS "idx_leads_score" ON "{{SCHEMA_NAME}}"."leads" ("score");
CREATE INDEX IF NOT EXISTS "idx_leads_campaign_id" ON "{{SCHEMA_NAME}}"."leads" ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_leads_course_id" ON "{{SCHEMA_NAME}}"."leads" ("course_id");
CREATE INDEX IF NOT EXISTS "idx_leads_opted_out" ON "{{SCHEMA_NAME}}"."leads" ("opted_out");
CREATE INDEX IF NOT EXISTS "idx_leads_archived_at" ON "{{SCHEMA_NAME}}"."leads" ("archived_at") WHERE archived_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_leads_phone_campaign_id" ON "{{SCHEMA_NAME}}"."leads" ("phone", "campaign_id") WHERE campaign_id IS NOT NULL;

-- ---- Opportunities (CRM deal tracking) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."opportunities" (
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
    "approval_status" VARCHAR(20) DEFAULT NULL,    -- pending, approved, rejected
    "approval_stage"  VARCHAR(50) DEFAULT NULL,    -- target stage awaiting approval
    "approved_by"     VARCHAR(255),
    "metadata"        JSONB DEFAULT '{}',
    "created_at"      TIMESTAMP DEFAULT NOW(),
    "updated_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_opportunities_lead_id" ON "{{SCHEMA_NAME}}"."opportunities" ("lead_id");
CREATE INDEX IF NOT EXISTS "idx_opportunities_stage" ON "{{SCHEMA_NAME}}"."opportunities" ("stage");
CREATE INDEX IF NOT EXISTS "idx_opportunities_campaign_id" ON "{{SCHEMA_NAME}}"."opportunities" ("campaign_id");

-- ---- Consent Records ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."consent_records" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "lead_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE SET NULL,
    "channel"         VARCHAR(50) NOT NULL DEFAULT 'web_form',
    "legal_version"   VARCHAR(50) NOT NULL,              -- e.g. "v1.0", "2026-01-01"
    "legal_text_hash" VARCHAR(64),                       -- SHA-256 of the consent text shown
    "ip_address"      VARCHAR(45),
    "user_agent"      TEXT,
    "origin_url"      TEXT,
    "created_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_consent_records_lead_id" ON "{{SCHEMA_NAME}}"."consent_records" ("lead_id");

-- ---- Opt-Out Records ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."opt_out_records" (
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
CREATE INDEX IF NOT EXISTS "idx_opt_out_records_phone" ON "{{SCHEMA_NAME}}"."opt_out_records" ("phone");
CREATE INDEX IF NOT EXISTS "idx_opt_out_records_lead_id" ON "{{SCHEMA_NAME}}"."opt_out_records" ("lead_id");
CREATE INDEX IF NOT EXISTS "idx_opt_out_records_status" ON "{{SCHEMA_NAME}}"."opt_out_records" ("status");
ALTER TABLE "{{SCHEMA_NAME}}"."opt_out_records" ADD COLUMN IF NOT EXISTS "detected_from" VARCHAR(20) DEFAULT 'keyword';
ALTER TABLE "{{SCHEMA_NAME}}"."opt_out_records" ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) DEFAULT 'pending';
ALTER TABLE "{{SCHEMA_NAME}}"."opt_out_records" ADD COLUMN IF NOT EXISTS "reviewed_by" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."opt_out_records" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP;
ALTER TABLE "{{SCHEMA_NAME}}"."opt_out_records" ADD COLUMN IF NOT EXISTS "review_notes" TEXT;

-- ---- Tags (controlled catalog per tenant) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tags" (
    "id"          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name"        VARCHAR(100) NOT NULL UNIQUE,
    "color"       VARCHAR(20) DEFAULT '#6c5ce7',
    "created_at"  TIMESTAMP DEFAULT NOW()
);

-- ---- Lead Tags (M2M) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."lead_tags" (
    "lead_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE CASCADE,
    "tag_id"  UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."tags"("id") ON DELETE CASCADE,
    PRIMARY KEY ("lead_id", "tag_id")
);

-- ---- Tasks ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tasks" (
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
CREATE INDEX IF NOT EXISTS "idx_tasks_lead_id" ON "{{SCHEMA_NAME}}"."tasks" ("lead_id");
CREATE INDEX IF NOT EXISTS "idx_tasks_status" ON "{{SCHEMA_NAME}}"."tasks" ("status");
CREATE INDEX IF NOT EXISTS "idx_tasks_due_at" ON "{{SCHEMA_NAME}}"."tasks" ("due_at");

-- ---- Notes (internal, not visible to lead) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."notes" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "lead_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE CASCADE,
    "opportunity_id"  UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE CASCADE,
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE SET NULL,
    "content"         TEXT NOT NULL,
    "created_by"      VARCHAR(255),
    "created_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_notes_lead_id" ON "{{SCHEMA_NAME}}"."notes" ("lead_id");

-- ---- Stage History (audit trail of pipeline transitions) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."stage_history" (
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
CREATE INDEX IF NOT EXISTS "idx_stage_history_lead_id_created_at" ON "{{SCHEMA_NAME}}"."stage_history" ("lead_id", "created_at");

-- ---- Pipeline Stages (configurable per tenant) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."pipeline_stages" (
    "id"                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id"           UUID NOT NULL,
    "name"                VARCHAR(100) NOT NULL,
    "slug"                VARCHAR(100),
    "color"               VARCHAR(20) DEFAULT '#3498db',
    "position"            INTEGER NOT NULL DEFAULT 0,
    "default_probability" INTEGER DEFAULT 0,
    "sla_hours"           INTEGER,
    "is_terminal"         BOOLEAN DEFAULT false,
    "transition_rules"    JSONB DEFAULT '[]'::jsonb,
    "created_at"          TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_pipeline_stages_tenant_id" ON "{{SCHEMA_NAME}}"."pipeline_stages" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_pipeline_stages_position" ON "{{SCHEMA_NAME}}"."pipeline_stages" ("position");

-- ---- Deals (sales pipeline tracking) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."deals" (
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
CREATE INDEX IF NOT EXISTS "idx_deals_stage_id" ON "{{SCHEMA_NAME}}"."deals" ("stage_id");
CREATE INDEX IF NOT EXISTS "idx_deals_contact_id" ON "{{SCHEMA_NAME}}"."deals" ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_deals_status" ON "{{SCHEMA_NAME}}"."deals" ("status");
CREATE INDEX IF NOT EXISTS "idx_deals_sla_deadline" ON "{{SCHEMA_NAME}}"."deals" ("sla_deadline") WHERE status = 'open' AND sla_deadline IS NOT NULL;

-- ---- Stage Transitions (audit trail for deal pipeline moves) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."stage_transitions" (
    "id"          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "deal_id"     UUID REFERENCES "{{SCHEMA_NAME}}"."deals"("id") ON DELETE CASCADE,
    "from_stage"  TEXT,
    "to_stage"    TEXT NOT NULL,
    "changed_by"  TEXT NOT NULL DEFAULT 'system',
    "reason"      TEXT,
    "created_at"  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_stage_transitions_deal_id_created_at" ON "{{SCHEMA_NAME}}"."stage_transitions" ("deal_id", "created_at");

-- ---- Automation Rules (see V4 section below) ----

-- ============================================
-- PARALLLY — WhatsApp Platform Manager (WABA)
-- ============================================

-- ---- WhatsApp Channels ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."whatsapp_channels" (
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
    "webhook_callback_url" TEXT,
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
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."whatsapp_templates" (
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
CREATE INDEX IF NOT EXISTS "idx_whatsapp_templates_channel_id" ON "{{SCHEMA_NAME}}"."whatsapp_templates" ("channel_id");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_templates_name" ON "{{SCHEMA_NAME}}"."whatsapp_templates" ("name");

-- ---- WhatsApp Webhook Events ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."whatsapp_webhook_events" (
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
CREATE INDEX IF NOT EXISTS "idx_whatsapp_webhook_events_processing_status" ON "{{SCHEMA_NAME}}"."whatsapp_webhook_events" ("processing_status");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_webhook_events_dedupe_key" ON "{{SCHEMA_NAME}}"."whatsapp_webhook_events" ("dedupe_key");

-- ---- WhatsApp Message Logs ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."whatsapp_message_logs" (
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
CREATE INDEX IF NOT EXISTS "idx_whatsapp_message_logs_channel_id_status" ON "{{SCHEMA_NAME}}"."whatsapp_message_logs" ("channel_id", "status");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_message_logs_provider_message_id" ON "{{SCHEMA_NAME}}"."whatsapp_message_logs" ("provider_message_id");

-- ============================================
-- PARALLLY — Intake / Landing Module (V4)
-- ============================================

-- ---- Landing Pages ----
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
CREATE INDEX IF NOT EXISTS "idx_landing_pages_slug" ON "{{SCHEMA_NAME}}"."landing_pages" ("slug");
CREATE INDEX IF NOT EXISTS "idx_landing_pages_status" ON "{{SCHEMA_NAME}}"."landing_pages" ("status");

-- ---- Form Definitions ----
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
CREATE INDEX IF NOT EXISTS "idx_form_definitions_landing_page_id" ON "{{SCHEMA_NAME}}"."form_definitions" ("landing_page_id");

-- ---- Form Submissions ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."form_submissions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "landing_page_id" UUID REFERENCES "{{SCHEMA_NAME}}"."landing_pages"("id") ON DELETE SET NULL,
    "form_definition_id" UUID REFERENCES "{{SCHEMA_NAME}}"."form_definitions"("id") ON DELETE SET NULL,
    "campaign_id" UUID REFERENCES "{{SCHEMA_NAME}}"."campaigns"("id") ON DELETE SET NULL,
    "course_id" UUID REFERENCES "{{SCHEMA_NAME}}"."courses"("id") ON DELETE SET NULL,
    "lead_id" UUID REFERENCES "{{SCHEMA_NAME}}"."leads"("id") ON DELETE SET NULL,
    "raw_payload_json" JSONB NOT NULL,
    "normalized_payload_json" JSONB,
    "source_url" TEXT,
    "referrer" TEXT,
    "utm_json" JSONB DEFAULT '{}',
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_form_submissions_landing_page_id" ON "{{SCHEMA_NAME}}"."form_submissions" ("landing_page_id");
CREATE INDEX IF NOT EXISTS "idx_form_submissions_lead_id" ON "{{SCHEMA_NAME}}"."form_submissions" ("lead_id");
CREATE INDEX IF NOT EXISTS "idx_form_submissions_created_at" ON "{{SCHEMA_NAME}}"."form_submissions" ("created_at");

-- ---- Intake Sources ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."intake_sources" (
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
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."automation_executions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "rule_id" UUID REFERENCES "{{SCHEMA_NAME}}"."automation_rules"("id") ON DELETE CASCADE,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "status" VARCHAR(50) DEFAULT 'pending', -- pending, success, failed
    "started_at" TIMESTAMP DEFAULT NOW(),
    "finished_at" TIMESTAMP,
    "result_json" JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS "idx_automation_executions_rule_id" ON "{{SCHEMA_NAME}}"."automation_executions" ("rule_id");
CREATE INDEX IF NOT EXISTS "idx_automation_executions_entity_type_entity_id" ON "{{SCHEMA_NAME}}"."automation_executions" ("entity_type", "entity_id");

-- ---- Wait Jobs ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."wait_jobs" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "job_type" VARCHAR(50) NOT NULL,
    "run_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "payload_json" JSONB DEFAULT '{}',
    "status" VARCHAR(50) DEFAULT 'pending',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_wait_jobs_status_run_at" ON "{{SCHEMA_NAME}}"."wait_jobs" ("status", "run_at");

-- ============================================
-- PARALLLY — Compliance & Audit (V4)
-- ============================================

-- ---- Legal Text Versions ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."legal_text_versions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL DEFAULT '',
    "description" TEXT DEFAULT '',
    "type" VARCHAR(50) NOT NULL DEFAULT 'general',
    "channel" VARCHAR(50) NOT NULL DEFAULT 'web',
    "channels" TEXT[] DEFAULT '{web}',
    "agent_ids" UUID[] DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "text" TEXT NOT NULL,
    "active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_legal_text_versions_tenant_id_type_active" ON "{{SCHEMA_NAME}}"."legal_text_versions" ("tenant_id", "type", "active");

-- (consent_records and opt_out_records already defined above in CRM section)

-- ---- Deletion Requests ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."deletion_requests" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "lead_id" UUID,
    "requested_by" VARCHAR(255),
    "status" VARCHAR(50) DEFAULT 'pending',
    "requested_at" TIMESTAMP DEFAULT NOW(),
    "processed_at" TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_deletion_requests_status" ON "{{SCHEMA_NAME}}"."deletion_requests" ("status");

-- ============================================
-- PARALLLY — Analytics Aggregates (V4)
-- ============================================

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."daily_metrics" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "metric_date" DATE NOT NULL,
    "dimension_type" VARCHAR(50) NOT NULL,
    "dimension_id" VARCHAR(255),
    "metrics_json" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_daily_metrics_metric_date_dimension_type" ON "{{SCHEMA_NAME}}"."daily_metrics" ("metric_date", "dimension_type");
CREATE INDEX IF NOT EXISTS "idx_daily_metrics_tenant_id_metric_date" ON "{{SCHEMA_NAME}}"."daily_metrics" ("tenant_id", "metric_date");

-- ============================================
-- PARALLLY — Carla AI Sales Agent (V4)
-- ============================================

-- ---- Personality Profiles ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."carla_personality_profiles" (
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
CREATE INDEX IF NOT EXISTS "idx_carla_personality_profiles_tenant_id_active" ON "{{SCHEMA_NAME}}"."carla_personality_profiles" ("tenant_id", "active");

-- ---- Prompt Templates ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."carla_prompt_templates" (
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
CREATE INDEX IF NOT EXISTS "idx_carla_prompt_templates_tenant_id_template_type_active" ON "{{SCHEMA_NAME}}"."carla_prompt_templates" ("tenant_id", "template_type", "active");

-- ---- Conversation Context Snapshots ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."carla_conversation_context" (
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
CREATE INDEX IF NOT EXISTS "idx_carla_conversation_context_conversation_id" ON "{{SCHEMA_NAME}}"."carla_conversation_context" ("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_carla_conversation_context_lead_id" ON "{{SCHEMA_NAME}}"."carla_conversation_context" ("lead_id");

-- ============================================
-- PARALLLY — Knowledge Base / RAG (V4)
-- ============================================

-- ---- Knowledge Resources ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."knowledge_resources" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'manual',
    "title" VARCHAR(500) NOT NULL,
    "source" VARCHAR(100),
    "source_url" TEXT,
    "content" TEXT,
    "content_hash" VARCHAR(64),
    "course_id" UUID,
    "campaign_id" UUID,
    "version" INTEGER DEFAULT 1,
    "status" VARCHAR(50) DEFAULT 'draft',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_knowledge_resources_tenant_id_status" ON "{{SCHEMA_NAME}}"."knowledge_resources" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_knowledge_resources_course_id" ON "{{SCHEMA_NAME}}"."knowledge_resources" ("course_id");

-- ---- Knowledge Chunks ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."knowledge_chunks" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "resource_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "metadata_json" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_knowledge_chunks_resource_id" ON "{{SCHEMA_NAME}}"."knowledge_chunks" ("resource_id");

-- ---- Knowledge Approvals ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."knowledge_approvals" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "resource_id" UUID NOT NULL,
    "approved_by" VARCHAR(255),
    "approved_at" TIMESTAMP DEFAULT NOW(),
    "notes" TEXT
);
CREATE INDEX IF NOT EXISTS "idx_knowledge_approvals_resource_id" ON "{{SCHEMA_NAME}}"."knowledge_approvals" ("resource_id");

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
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."conversation_assignments" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE CASCADE,
    "agent_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP DEFAULT NOW(),
    "first_response_at" TIMESTAMP,
    "resolved_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_conversation_assignments_conversation_id" ON "{{SCHEMA_NAME}}"."conversation_assignments" ("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_conversation_assignments_agent_id" ON "{{SCHEMA_NAME}}"."conversation_assignments" ("agent_id");
CREATE INDEX IF NOT EXISTS "idx_conversation_assignments_resolved_at" ON "{{SCHEMA_NAME}}"."conversation_assignments" ("resolved_at");

-- ---- CSAT Surveys ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."csat_surveys" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE CASCADE,
    "contact_id" UUID REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE SET NULL,
    "agent_id" UUID,
    "rating" INTEGER NOT NULL CHECK ("rating" >= 1 AND "rating" <= 5),
    "feedback" TEXT,
    "created_at" TIMESTAMP DEFAULT NOW(),
    UNIQUE ("conversation_id")
);
CREATE INDEX IF NOT EXISTS "idx_csat_surveys_agent_id" ON "{{SCHEMA_NAME}}"."csat_surveys" ("agent_id");
CREATE INDEX IF NOT EXISTS "idx_csat_surveys_rating" ON "{{SCHEMA_NAME}}"."csat_surveys" ("rating");

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
ALTER TABLE "{{SCHEMA_NAME}}"."csat_surveys" ADD COLUMN IF NOT EXISTS "appointment_id" UUID;

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

-- ---- Custom Attribute Values ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."custom_attribute_values" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "definition_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."custom_attribute_definitions"("id") ON DELETE CASCADE,
    "entity_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL DEFAULT 'lead',
    "value_text" TEXT,
    "value_number" DECIMAL(15, 4),
    "value_boolean" BOOLEAN,
    "value_date" TIMESTAMP,
    "value_json" JSONB,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW(),
    UNIQUE ("definition_id", "entity_id")
);
CREATE INDEX IF NOT EXISTS "idx_custom_attribute_values_entity_id_entity_type" ON "{{SCHEMA_NAME}}"."custom_attribute_values" ("entity_id", "entity_type");

-- ---- Scoring Configuration (per tenant) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."scoring_config" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" UUID NOT NULL,
    "weights" JSONB NOT NULL DEFAULT '{"engagement":0.25,"intent":0.30,"recency":0.20,"stageProgress":0.15,"profileCompleteness":0.10}',
    "purchase_keywords" TEXT[] DEFAULT '{}',
    "decay_enabled" BOOLEAN DEFAULT false,
    "decay_days" INTEGER DEFAULT 30,
    "decay_factor" DECIMAL(3,2) DEFAULT 0.50,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- ---- Contact Segments (C2) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."contact_segments" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "filter_rules" JSONB NOT NULL DEFAULT '[]',
    "contact_count" INTEGER DEFAULT 0,
    "is_dynamic" BOOLEAN DEFAULT false,
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
    "language" VARCHAR(10) DEFAULT 'es',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
-- Multi-language: templates are unique per (slug, language). Spanish ('es') is
-- the canonical base; other languages fall back to 'es' at read time.
ALTER TABLE "{{SCHEMA_NAME}}"."email_templates" ADD COLUMN IF NOT EXISTS "language" VARCHAR(10) DEFAULT 'es';
DROP INDEX IF EXISTS "{{SCHEMA_NAME}}"."et_slug_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "et_slug_lang_idx" ON "{{SCHEMA_NAME}}"."email_templates" ("slug", "language");
ALTER TABLE "{{SCHEMA_NAME}}"."email_templates" ADD COLUMN IF NOT EXISTS "subject" VARCHAR(500);
ALTER TABLE "{{SCHEMA_NAME}}"."email_templates" ADD COLUMN IF NOT EXISTS "body_html" TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."email_templates" ADD COLUMN IF NOT EXISTS "body_json" JSONB DEFAULT '{}';
ALTER TABLE "{{SCHEMA_NAME}}"."email_templates" ADD COLUMN IF NOT EXISTS "variables" TEXT[] DEFAULT '{}';

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

-- Add columns to services if not exist
ALTER TABLE "{{SCHEMA_NAME}}"."services" ADD COLUMN IF NOT EXISTS "category" VARCHAR(100);
ALTER TABLE "{{SCHEMA_NAME}}"."services" ADD COLUMN IF NOT EXISTS "location_type" VARCHAR(50) DEFAULT 'in_person';
ALTER TABLE "{{SCHEMA_NAME}}"."services" ADD COLUMN IF NOT EXISTS "max_concurrent" INTEGER DEFAULT 1;
ALTER TABLE "{{SCHEMA_NAME}}"."services" ADD COLUMN IF NOT EXISTS "required_fields" JSONB DEFAULT '["name","phone"]';
ALTER TABLE "{{SCHEMA_NAME}}"."services" ADD COLUMN IF NOT EXISTS "is_public" BOOLEAN DEFAULT true;
ALTER TABLE "{{SCHEMA_NAME}}"."services" ADD COLUMN IF NOT EXISTS "meeting_link" TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."services" ADD COLUMN IF NOT EXISTS "location_address" TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."services" ADD COLUMN IF NOT EXISTS "duration_type" VARCHAR(20) DEFAULT 'fixed';
ALTER TABLE "{{SCHEMA_NAME}}"."services" ADD COLUMN IF NOT EXISTS "duration_minutes_max" INTEGER;
-- Cada cuántos días conviene volver por ESTE servicio. NULL = no aplica (una
-- consulta puntual no se re-agenda sola). Es lo que convierte el recordatorio de
-- re-reserva en algo del negocio y no en un promedio inventado: una keratina son
-- ~90 días, unas raíces ~28, una limpieza dental ~180. El evaluador temporal
-- (`rebooking.due`) lo lee por servicio y cae a su ventana genérica si está NULL.
ALTER TABLE "{{SCHEMA_NAME}}"."services" ADD COLUMN IF NOT EXISTS "rebook_after_days" INTEGER;

-- ---- Service Staff Assignment (many-to-many) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."service_staff" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "service_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."services"("id") ON DELETE CASCADE,
    "user_id" UUID NOT NULL,
    "is_primary" BOOLEAN DEFAULT false,
    "sort_order" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "ss_service_user_idx" ON "{{SCHEMA_NAME}}"."service_staff" ("service_id", "user_id");

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
-- Multi-calendar: drop old unique constraint (allow multiple calendars per user+provider)
DROP INDEX IF EXISTS "{{SCHEMA_NAME}}"."ci_user_idx";

-- Multi-calendar: assignment model
ALTER TABLE "{{SCHEMA_NAME}}"."calendar_integrations" ADD COLUMN IF NOT EXISTS "label" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."calendar_integrations" ADD COLUMN IF NOT EXISTS "assignment_type" VARCHAR(20) DEFAULT 'general';
ALTER TABLE "{{SCHEMA_NAME}}"."calendar_integrations" ADD COLUMN IF NOT EXISTS "assignment_id" UUID;

-- Non-unique index for lookups
CREATE INDEX IF NOT EXISTS "ci_user_provider_idx" ON "{{SCHEMA_NAME}}"."calendar_integrations" ("user_id", "provider");
CREATE INDEX IF NOT EXISTS "ci_assignment_idx" ON "{{SCHEMA_NAME}}"."calendar_integrations" ("assignment_type", "assignment_id") WHERE "is_active" = true;

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
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "reminder_24h_sent" BOOLEAN DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "reminder_1h_sent" BOOLEAN DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "reminder_2h_sent" BOOLEAN DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "source" VARCHAR(50) DEFAULT 'manual';
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "no_show_followed_up" BOOLEAN DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "completed_by" VARCHAR(50) DEFAULT NULL;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "rating" INTEGER;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "rating_feedback" TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "recurring_group_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "recurrence_rule" JSONB;
CREATE INDEX IF NOT EXISTS "appt_recurring_idx" ON "{{SCHEMA_NAME}}"."appointments" ("recurring_group_id") WHERE "recurring_group_id" IS NOT NULL;

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

-- ---- Dashboard Widget Preferences ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."dashboard_preferences" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "user_id" UUID NOT NULL,
    "layout_json" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "dp_user_idx" ON "{{SCHEMA_NAME}}"."dashboard_preferences" ("user_id");

-- ============================================
-- PARALLLY — Multi-Agent System
-- ============================================

-- ---- Agent Personas (multi-agent per tenant) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."agent_personas" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "template_id" VARCHAR(100),
    "is_active" BOOLEAN DEFAULT true,
    "is_default" BOOLEAN DEFAULT false,
    "config_json" JSONB NOT NULL,
    "channels" TEXT[] DEFAULT '{}',
    "channel_bindings" TEXT[] DEFAULT '{}',
    "schedule_mode" VARCHAR(20) DEFAULT '24_7',
    "version" INTEGER DEFAULT 1,
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS does not add columns to tenant schemas created
-- before multi-account channel bindings were introduced.
ALTER TABLE "{{SCHEMA_NAME}}"."agent_personas"
    ADD COLUMN IF NOT EXISTS "channel_bindings" TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "idx_agent_personas_active" ON "{{SCHEMA_NAME}}"."agent_personas" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_agent_personas_channels" ON "{{SCHEMA_NAME}}"."agent_personas" USING GIN ("channels");
CREATE INDEX IF NOT EXISTS "idx_agent_personas_bindings" ON "{{SCHEMA_NAME}}"."agent_personas" USING GIN ("channel_bindings");
CREATE INDEX IF NOT EXISTS "idx_agent_personas_default" ON "{{SCHEMA_NAME}}"."agent_personas" ("is_default") WHERE "is_default" = true;

-- ---- Agent Templates (reusable persona configs) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."agent_templates" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(50) DEFAULT 'bot',
    "config_json" JSONB NOT NULL,
    "is_builtin" BOOLEAN DEFAULT false,
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- PARALLLY — Business Knowledge (Apr 2026 refactor)
-- ============================================

-- ---- Business Identity (extends existing companies table) ----
ALTER TABLE "{{SCHEMA_NAME}}"."companies" ADD COLUMN IF NOT EXISTS "phone"         VARCHAR(50);
ALTER TABLE "{{SCHEMA_NAME}}"."companies" ADD COLUMN IF NOT EXISTS "email"         VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."companies" ADD COLUMN IF NOT EXISTS "about"         TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."companies" ADD COLUMN IF NOT EXISTS "address"       TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."companies" ADD COLUMN IF NOT EXISTS "logo_url"      VARCHAR(500);
ALTER TABLE "{{SCHEMA_NAME}}"."companies" ADD COLUMN IF NOT EXISTS "social_links"  JSONB DEFAULT '{}';
ALTER TABLE "{{SCHEMA_NAME}}"."companies" ADD COLUMN IF NOT EXISTS "is_primary"    BOOLEAN DEFAULT false;

-- Only one company per tenant can be marked as primary (the source of truth for the agent).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_companies_primary" ON "{{SCHEMA_NAME}}"."companies" ("is_primary") WHERE "is_primary" = true;

-- ---- FAQs (first-class Q&A pairs — used by the agent via search_faqs tool) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."faqs" (
    "id"            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "question"      TEXT NOT NULL,
    "answer"        TEXT NOT NULL,
    "category"      VARCHAR(100),
    "tags"          TEXT[] DEFAULT '{}',
    "order_index"   INTEGER DEFAULT 0,
    "is_published"  BOOLEAN DEFAULT true,
    "views"         INTEGER DEFAULT 0,
    "search_tsv"    TSVECTOR,
    "created_at"    TIMESTAMP DEFAULT NOW(),
    "updated_at"    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_faqs_published"    ON "{{SCHEMA_NAME}}"."faqs" ("is_published");
CREATE INDEX IF NOT EXISTS "idx_faqs_category"     ON "{{SCHEMA_NAME}}"."faqs" ("category");
CREATE INDEX IF NOT EXISTS "idx_faqs_order"        ON "{{SCHEMA_NAME}}"."faqs" ("order_index");
CREATE INDEX IF NOT EXISTS "idx_faqs_tsv"          ON "{{SCHEMA_NAME}}"."faqs" USING GIN ("search_tsv");
CREATE INDEX IF NOT EXISTS "idx_faqs_tags"         ON "{{SCHEMA_NAME}}"."faqs" USING GIN ("tags");

-- ---- Policies (versioned legal / operational policies) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."policies" (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "type"            VARCHAR(50) NOT NULL,  -- shipping | return | warranty | cancellation | terms | privacy
    "title"           VARCHAR(500) NOT NULL,
    "content"         TEXT NOT NULL,
    "version"         INTEGER NOT NULL DEFAULT 1,
    "effective_from"  TIMESTAMP DEFAULT NOW(),
    "effective_to"    TIMESTAMP,
    "is_active"       BOOLEAN DEFAULT true,
    "created_by"      VARCHAR(255),
    "created_at"      TIMESTAMP DEFAULT NOW(),
    "updated_at"      TIMESTAMP DEFAULT NOW()
);

-- Only one active version per policy type
CREATE UNIQUE INDEX IF NOT EXISTS "idx_policies_active_type" ON "{{SCHEMA_NAME}}"."policies" ("type") WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "idx_policies_type_version" ON "{{SCHEMA_NAME}}"."policies" ("type", "version" DESC);

-- ============================================
-- PARALLLY — WhatsApp Template seeding (Apr 2026)
-- ============================================
-- Extend whatsapp_templates to track Meta's template lifecycle + seeds.
ALTER TABLE "{{SCHEMA_NAME}}"."whatsapp_templates" ADD COLUMN IF NOT EXISTS "meta_template_id"  VARCHAR(100);
ALTER TABLE "{{SCHEMA_NAME}}"."whatsapp_templates" ADD COLUMN IF NOT EXISTS "rejected_reason"   VARCHAR(100);
ALTER TABLE "{{SCHEMA_NAME}}"."whatsapp_templates" ADD COLUMN IF NOT EXISTS "is_seed"           BOOLEAN DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."whatsapp_templates" ADD COLUMN IF NOT EXISTS "submitted_at"      TIMESTAMP;
CREATE INDEX IF NOT EXISTS "idx_wa_templates_meta_id" ON "{{SCHEMA_NAME}}"."whatsapp_templates" ("meta_template_id");
CREATE INDEX IF NOT EXISTS "idx_wa_templates_pending" ON "{{SCHEMA_NAME}}"."whatsapp_templates" ("approval_status") WHERE "approval_status" = 'PENDING';

-- Idempotency flag on the WABA channel itself — prevents double-seeding if the
-- embedded signup callback fires twice.
ALTER TABLE "{{SCHEMA_NAME}}"."whatsapp_channels" ADD COLUMN IF NOT EXISTS "seeds_submitted"    BOOLEAN DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."whatsapp_channels" ADD COLUMN IF NOT EXISTS "seeds_submitted_at" TIMESTAMP;

-- ── Broadcast Campaign Recipients ─────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."campaign_recipients" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID,
    "phone" VARCHAR(50),
    "status" VARCHAR(30) DEFAULT 'pending',
    "error_message" TEXT,
    "sent_at" TIMESTAMP,
    "delivered_at" TIMESTAMP,
    "read_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_campaign_recipients_campaign" ON "{{SCHEMA_NAME}}"."campaign_recipients" ("campaign_id", "status");

-- ============================================
-- EXTERNAL CRM SYNC — Field mapping + correlation + log
-- ============================================
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."crm_field_mappings" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "provider"       VARCHAR(50) NOT NULL,
    "entity"         VARCHAR(20) NOT NULL,
    "parallly_field" VARCHAR(100) NOT NULL,
    "external_field" VARCHAR(200) NOT NULL,
    "direction"      VARCHAR(20) NOT NULL DEFAULT 'outbound',
    "transform"      VARCHAR(50),
    "is_active"      BOOLEAN DEFAULT true,
    "created_at"     TIMESTAMP DEFAULT NOW(),
    "updated_at"     TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_field_map_unique" ON "{{SCHEMA_NAME}}"."crm_field_mappings" ("provider", "entity", "parallly_field");

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."crm_external_links" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "provider"       VARCHAR(50) NOT NULL,
    "entity"         VARCHAR(20) NOT NULL,
    "internal_id"    UUID NOT NULL,
    "external_id"    VARCHAR(200) NOT NULL,
    "external_url"   TEXT,
    "last_synced_at" TIMESTAMP,
    "checksum"       VARCHAR(64),
    "created_at"     TIMESTAMP DEFAULT NOW(),
    "updated_at"     TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_links_internal" ON "{{SCHEMA_NAME}}"."crm_external_links" ("provider", "entity", "internal_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_links_external" ON "{{SCHEMA_NAME}}"."crm_external_links" ("provider", "entity", "external_id");

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."crm_sync_log" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "provider"       VARCHAR(50) NOT NULL,
    "entity"         VARCHAR(20) NOT NULL,
    "internal_id"    UUID,
    "external_id"    VARCHAR(200),
    "operation"      VARCHAR(20) NOT NULL,
    "direction"      VARCHAR(20) NOT NULL DEFAULT 'outbound',
    "status"         VARCHAR(20) NOT NULL,
    "error_message"  TEXT,
    "duration_ms"    INTEGER,
    "created_at"     TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_crm_sync_log_recent" ON "{{SCHEMA_NAME}}"."crm_sync_log" ("provider", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_crm_sync_log_failed" ON "{{SCHEMA_NAME}}"."crm_sync_log" ("status") WHERE "status" = 'failed';

-- crm_imports tracks bulk import jobs (initial backfill of existing CRM data).
-- One row per import attempt. Status drives the progress bar in the dashboard.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."crm_imports" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "provider"       VARCHAR(50) NOT NULL,
    "connection_id"  UUID NOT NULL,
    "entity"         VARCHAR(20) NOT NULL DEFAULT 'contact',
    "status"         VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending|running|completed|failed|cancelled
    "cursor"         VARCHAR(500),                              -- opaque pagination token from provider
    "total_pulled"   INTEGER DEFAULT 0,
    "matched"        INTEGER DEFAULT 0,                         -- linked to existing contact
    "created"        INTEGER DEFAULT 0,                         -- new contact inserted
    "skipped"        INTEGER DEFAULT 0,                         -- missing phone+email or invalid
    "errors"         INTEGER DEFAULT 0,
    "last_error"     TEXT,
    "started_by"     UUID,
    "started_at"     TIMESTAMP DEFAULT NOW(),
    "completed_at"   TIMESTAMP,
    "updated_at"     TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_crm_imports_recent" ON "{{SCHEMA_NAME}}"."crm_imports" ("started_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_crm_imports_running" ON "{{SCHEMA_NAME}}"."crm_imports" ("status") WHERE "status" = 'running';

-- ============================================
-- VACATION RENTAL — Properties & iCal Sync
-- ============================================

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."properties" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "city" VARCHAR(255),
    "max_guests" INTEGER DEFAULT 4,
    "bedrooms" INTEGER DEFAULT 1,
    "bathrooms" INTEGER DEFAULT 1,
    "night_price" DECIMAL(15,2) DEFAULT 0,
    "cleaning_fee" DECIMAL(15,2) DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "min_nights" INTEGER DEFAULT 1,
    "check_in_time" TIME DEFAULT '15:00',
    "check_out_time" TIME DEFAULT '11:00',
    "amenities" JSONB DEFAULT '[]',
    "house_rules" TEXT,
    "check_in_instructions" TEXT,
    "images" JSONB DEFAULT '[]',
    "is_active" BOOLEAN DEFAULT true,
    "sort_order" INTEGER DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."ical_blocks" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "property_id" UUID NOT NULL,
    "external_uid" TEXT NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "summary" TEXT,
    "last_seen_at" TIMESTAMP DEFAULT NOW(),
    "is_deleted" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ical_blocks_uid" ON "{{SCHEMA_NAME}}"."ical_blocks" ("property_id", "external_uid");
CREATE INDEX IF NOT EXISTS "idx_ical_blocks_dates" ON "{{SCHEMA_NAME}}"."ical_blocks" ("property_id", "check_in", "check_out") WHERE "is_deleted" = false;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."ical_feeds" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "property_id" UUID NOT NULL,
    "feed_name" VARCHAR(100),
    "source" VARCHAR(50) NOT NULL,
    "import_url" TEXT,
    "export_token" VARCHAR(255) NOT NULL DEFAULT uuid_generate_v4()::text,
    "is_active" BOOLEAN DEFAULT true,
    "last_sync_at" TIMESTAMP,
    "last_sync_status" VARCHAR(20) DEFAULT 'pending',
    "last_sync_error" TEXT,
    "events_imported" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_ical_feeds_property" ON "{{SCHEMA_NAME}}"."ical_feeds" ("property_id") WHERE "is_active" = true;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."property_bookings" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "property_id" UUID NOT NULL,
    "contact_id" UUID,
    "conversation_id" UUID,
    "guest_name" VARCHAR(255),
    "guest_email" VARCHAR(255),
    "guest_phone" VARCHAR(50),
    "guests_count" INTEGER DEFAULT 1,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "night_price" DECIMAL(15,2),
    "cleaning_fee" DECIMAL(15,2) DEFAULT 0,
    "total_price" DECIMAL(15,2),
    "currency" VARCHAR(10) DEFAULT 'COP',
    "status" VARCHAR(50) DEFAULT 'pending',
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_bookings_property" ON "{{SCHEMA_NAME}}"."property_bookings" ("property_id", "check_in", "check_out") WHERE "status" != 'cancelled';

-- =====================================================================
-- Tours & Travel Packages (turismo sub-types: tours, agencia_viajes)
-- =====================================================================
-- Unified table for both daily experiences (city tours, snorkel, parapente)
-- and multi-day packages (Cartagena 3 days). The duration_type column
-- distinguishes them: 'hours' for same-day tours, 'days' for packages.
-- Inventory is optional — packages without rows in tour_inventory are
-- treated as unlimited (e.g. "any-date" customisable trips).
-- =====================================================================

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tour_packages" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "duration_type" VARCHAR(10) NOT NULL DEFAULT 'hours',
    "duration_value" INTEGER NOT NULL DEFAULT 1,
    "price" DECIMAL(15,2) DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "max_capacity" INTEGER DEFAULT 10,
    "min_party_size" INTEGER DEFAULT 1,
    "departure_location" TEXT,
    "destination" VARCHAR(255),
    "languages" JSONB DEFAULT '[]',
    "includes" JSONB DEFAULT '[]',
    "excludes" JSONB DEFAULT '[]',
    "what_to_bring" TEXT,
    "child_discount_pct" INTEGER DEFAULT 0,
    "cancellation_policy" TEXT,
    "images" JSONB DEFAULT '[]',
    "tags" JSONB DEFAULT '[]',
    "is_active" BOOLEAN DEFAULT true,
    "sort_order" INTEGER DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_tour_packages_active" ON "{{SCHEMA_NAME}}"."tour_packages" ("is_active", "sort_order") WHERE "is_active" = true;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tour_inventory" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "package_id" UUID NOT NULL,
    "departure_date" DATE NOT NULL,
    "departure_time" TIME,
    "available_seats" INTEGER NOT NULL DEFAULT 0,
    "total_seats" INTEGER NOT NULL DEFAULT 0,
    "price_override" DECIMAL(15,2),
    "is_active" BOOLEAN DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tour_inventory_unique" ON "{{SCHEMA_NAME}}"."tour_inventory" ("package_id", "departure_date", "departure_time");
CREATE INDEX IF NOT EXISTS "idx_tour_inventory_date" ON "{{SCHEMA_NAME}}"."tour_inventory" ("package_id", "departure_date") WHERE "is_active" = true;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tour_bookings" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "package_id" UUID NOT NULL,
    "inventory_id" UUID,
    "contact_id" UUID,
    "conversation_id" UUID,
    "guest_name" VARCHAR(255),
    "guest_email" VARCHAR(255),
    "guest_phone" VARCHAR(50),
    "departure_date" DATE NOT NULL,
    "departure_time" TIME,
    "party_size" INTEGER NOT NULL DEFAULT 1,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER DEFAULT 0,
    "unit_price" DECIMAL(15,2),
    "total_price" DECIMAL(15,2),
    "currency" VARCHAR(10) DEFAULT 'COP',
    "language" VARCHAR(10),
    "special_requests" TEXT,
    "status" VARCHAR(50) DEFAULT 'reserved',
    "payment_status" VARCHAR(50) DEFAULT 'pending',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_tour_bookings_package_date" ON "{{SCHEMA_NAME}}"."tour_bookings" ("package_id", "departure_date") WHERE "status" != 'cancelled';
CREATE INDEX IF NOT EXISTS "idx_tour_bookings_contact" ON "{{SCHEMA_NAME}}"."tour_bookings" ("contact_id") WHERE "contact_id" IS NOT NULL;

-- =====================================================================
-- Treatment Plans (salud sub-type: dental, fisioterapia, estética)
-- =====================================================================
-- Multi-session treatments where one customer pays for / commits to a series
-- of sessions over time. Tracks total vs completed, per-session status, and
-- next recall date so the AI can answer "how many sessions left?" / "when
-- is my next appointment?" without asking the human team.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."treatment_plans" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,                      -- e.g. "Ortodoncia 18 meses"
    "plan_type" VARCHAR(100),                          -- ortodoncia, fisioterapia, blanqueamiento, etc.
    "total_sessions" INTEGER NOT NULL DEFAULT 1,
    "completed_sessions" INTEGER NOT NULL DEFAULT 0,
    "frequency_days" INTEGER,                          -- nominal cadence between sessions (e.g. 30 for monthly)
    "total_cost" DECIMAL(15,2),
    "currency" VARCHAR(10) DEFAULT 'COP',
    "started_at" DATE,
    "expected_end_at" DATE,
    "completed_at" DATE,
    "status" VARCHAR(50) DEFAULT 'active',             -- active | completed | paused | cancelled
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_treatment_plans_contact" ON "{{SCHEMA_NAME}}"."treatment_plans" ("contact_id") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "idx_treatment_plans_status" ON "{{SCHEMA_NAME}}"."treatment_plans" ("status");

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."treatment_sessions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "plan_id" UUID NOT NULL,
    "appointment_id" UUID,                             -- optional link to actual appointment
    "session_number" INTEGER NOT NULL,                 -- 1, 2, 3, ...
    "scheduled_at" TIMESTAMP,
    "completed_at" TIMESTAMP,
    "status" VARCHAR(50) DEFAULT 'pending',            -- pending | scheduled | completed | cancelled | no_show
    "notes" TEXT,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_treatment_sessions_plan" ON "{{SCHEMA_NAME}}"."treatment_sessions" ("plan_id", "session_number");
CREATE INDEX IF NOT EXISTS "idx_treatment_sessions_appt" ON "{{SCHEMA_NAME}}"."treatment_sessions" ("appointment_id") WHERE "appointment_id" IS NOT NULL;

-- =====================================================================
-- Recall: column on contacts to track "next recall date" so the
-- time_since_last_appointment trigger can run a single indexed query
-- across a tenant instead of computing this from appointments every time.
-- Updated by appointment lifecycle events (created/completed).
-- =====================================================================
ALTER TABLE "{{SCHEMA_NAME}}"."contacts" ADD COLUMN IF NOT EXISTS "last_appointment_at" TIMESTAMP;
ALTER TABLE "{{SCHEMA_NAME}}"."contacts" ADD COLUMN IF NOT EXISTS "next_recall_at" TIMESTAMP;
CREATE INDEX IF NOT EXISTS "idx_contacts_recall" ON "{{SCHEMA_NAME}}"."contacts" ("next_recall_at") WHERE "next_recall_at" IS NOT NULL;

-- =====================================================================
-- Real Estate Listings (inmobiliaria sub-types: venta, arriendo,
-- comercial, construccion). Distinct from vacation-rental.properties
-- which is for short-term stays — these are long-term sale/rent listings
-- with the operational fields a real estate agent actually uses.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."real_estate_listings" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,                         -- internal reference / listing title
    "transaction_type" VARCHAR(20) NOT NULL,              -- 'sale' | 'rent'
    "property_kind" VARCHAR(50) NOT NULL DEFAULT 'apartment',  -- apartment | house | commercial | land | office
    "price" DECIMAL(15,2),
    "currency" VARCHAR(10) DEFAULT 'COP',
    "rent_period" VARCHAR(20) DEFAULT 'monthly',          -- monthly | yearly (only relevant for rent)
    "hoa_fee" DECIMAL(15,2),                              -- administración / cuota condominio
    "deposit" DECIMAL(15,2),                              -- security deposit (rent)
    "min_rental_months" INTEGER,                          -- minimum lease term
    "financing_available" BOOLEAN DEFAULT false,          -- sale: bank financing / VIS, etc.
    "bedrooms" INTEGER DEFAULT 1,
    "bathrooms" DECIMAL(3,1) DEFAULT 1,                   -- 1.5 = half bath
    "area_m2" DECIMAL(10,2),
    "parking_spots" INTEGER DEFAULT 0,
    "stratum" INTEGER,                                    -- LatAm-specific socioeconomic stratum
    "year_built" INTEGER,
    "address" TEXT,
    "neighborhood" VARCHAR(255),                          -- barrio / zona — used for routing
    "city" VARCHAR(255),
    "country" VARCHAR(10) DEFAULT 'CO',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "description" TEXT,
    "amenities" JSONB DEFAULT '[]',                       -- gym, piscina, BBQ, etc.
    "images" JSONB DEFAULT '[]',
    "external_url" VARCHAR(500),                          -- listing on Finca Raíz, Metrocuadrado, etc.
    "status" VARCHAR(20) DEFAULT 'available',             -- available | reserved | sold | rented | inactive
    "assigned_agent_id" UUID,                             -- which user owns this listing
    "is_active" BOOLEAN DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_listings_search" ON "{{SCHEMA_NAME}}"."real_estate_listings" ("transaction_type", "city", "neighborhood", "status") WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "idx_listings_price" ON "{{SCHEMA_NAME}}"."real_estate_listings" ("transaction_type", "price") WHERE "is_active" = true AND "status" = 'available';
CREATE INDEX IF NOT EXISTS "idx_listings_agent" ON "{{SCHEMA_NAME}}"."real_estate_listings" ("assigned_agent_id") WHERE "assigned_agent_id" IS NOT NULL;

-- Zone routing: maps a neighborhood to a default agent. When a lead asks
-- about properties in a given zone, the AI / pipeline can use this to
-- assign the conversation to the right agent automatically.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."listing_zone_agents" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "neighborhood" VARCHAR(255) NOT NULL,
    "city" VARCHAR(255),
    "agent_id" UUID NOT NULL,
    "created_at" TIMESTAMP DEFAULT NOW()
);
-- El índice original era ("neighborhood", "city") a secas, y `city` es NULLABLE:
-- en Postgres los NULL son DISTINTOS entre sí dentro de un índice único, así que
-- dos filas con el mismo barrio y ciudad NULL entraban las dos y el ON CONFLICT
-- del upsert de zonas no disparaba nunca. Se indexa sobre COALESCE para que "sin
-- ciudad" sea un valor comparable y el upsert funcione.
-- Nombre nuevo a propósito: `CREATE ... IF NOT EXISTS` con el nombre viejo no
-- habría cambiado nada en los tenants ya creados.
DROP INDEX IF EXISTS "{{SCHEMA_NAME}}"."idx_zone_agents_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_zone_agents_unique_v2" ON "{{SCHEMA_NAME}}"."listing_zone_agents" ("neighborhood", COALESCE("city", ''));

-- =====================================================================
-- Pets (veterinaria vertical)
-- =====================================================================
-- A contact (the tutor / pet owner) can have multiple pets. The "patient"
-- in vet workflows is the pet, NOT the contact — appointments and notes
-- often need to specify which pet they apply to. Vaccination calendar
-- lives in pet_vaccinations and is queried by the AI to remind tutors
-- when a vaccine is due.
-- =====================================================================
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."pets" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID NOT NULL,                            -- the tutor / owner
    "name" VARCHAR(255) NOT NULL,
    "species" VARCHAR(50) NOT NULL DEFAULT 'dog',          -- dog | cat | bird | rabbit | reptile | rodent | fish | other
    "breed" VARCHAR(255),
    "sex" VARCHAR(20),                                     -- male | female | unknown
    "is_neutered" BOOLEAN,
    "birth_date" DATE,
    "weight_kg" DECIMAL(6,2),
    "color" VARCHAR(100),
    "microchip_id" VARCHAR(100),
    "allergies" TEXT,
    "chronic_conditions" TEXT,                             -- diabetes, heart, kidney, etc.
    "current_medications" TEXT,
    "photo_url" VARCHAR(500),
    "is_active" BOOLEAN DEFAULT true,                      -- false = deceased / lost / soft-deleted
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_pets_contact" ON "{{SCHEMA_NAME}}"."pets" ("contact_id") WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "idx_pets_microchip" ON "{{SCHEMA_NAME}}"."pets" ("microchip_id") WHERE "microchip_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."pet_vaccinations" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "pet_id" UUID NOT NULL,
    "vaccine_name" VARCHAR(255) NOT NULL,                  -- e.g. Rabia, Sextuple, Triple felina
    "applied_at" DATE NOT NULL,
    "next_due_at" DATE,                                    -- next dose / booster
    "lot_number" VARCHAR(100),
    "vet_name" VARCHAR(255),
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_pet_vaccinations_pet" ON "{{SCHEMA_NAME}}"."pet_vaccinations" ("pet_id", "applied_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_pet_vaccinations_due" ON "{{SCHEMA_NAME}}"."pet_vaccinations" ("next_due_at") WHERE "next_due_at" IS NOT NULL;

-- =====================================================================
-- Restaurantes vertical
-- =====================================================================
-- The menu is the catalog. Categories group items (entradas, platos
-- fuertes, postres, bebidas). Items have price, description, image,
-- allergens, prep time, and visibility flag. Reservations reuse the
-- generic appointments table — orders are their own thing because the
-- semantics are different (line items + delivery vs in-place + status
-- transitions: received → preparing → ready → delivered).
-- =====================================================================
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."menu_categories" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_menu_categories_active" ON "{{SCHEMA_NAME}}"."menu_categories" ("is_active", "sort_order") WHERE "is_active" = true;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."menu_items" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "category_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "image_url" VARCHAR(500),
    "allergens" JSONB DEFAULT '[]',                        -- ['gluten', 'lactosa', 'mariscos', 'mani']
    "tags" JSONB DEFAULT '[]',                             -- ['vegetariano', 'vegano', 'sin_gluten', 'picante']
    "prep_time_minutes" INTEGER,
    "calories" INTEGER,
    "is_available" BOOLEAN DEFAULT true,                   -- runtime sold-out flag
    "is_active" BOOLEAN DEFAULT true,                      -- catalog soft delete
    "sort_order" INTEGER DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_menu_items_category" ON "{{SCHEMA_NAME}}"."menu_items" ("category_id", "sort_order") WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "idx_menu_items_search" ON "{{SCHEMA_NAME}}"."menu_items" ("is_active", "is_available") WHERE "is_active" = true;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."food_orders" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID,
    "conversation_id" UUID,
    "order_type" VARCHAR(20) NOT NULL DEFAULT 'delivery', -- delivery | pickup | dine_in
    "customer_name" VARCHAR(255),
    "customer_phone" VARCHAR(50),
    "delivery_address" TEXT,
    "delivery_notes" TEXT,
    "table_number" VARCHAR(50),                            -- for dine_in
    "subtotal" DECIMAL(10,2) DEFAULT 0,
    "delivery_fee" DECIMAL(10,2) DEFAULT 0,
    "discount" DECIMAL(10,2) DEFAULT 0,
    "total" DECIMAL(10,2) DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "payment_method" VARCHAR(50),                          -- cash | card | mp | pse | transfer
    "payment_status" VARCHAR(20) DEFAULT 'pending',        -- pending | paid | refunded
    "status" VARCHAR(20) DEFAULT 'received',               -- received | preparing | ready | delivered | cancelled
    "estimated_delivery_at" TIMESTAMP,
    "notes" TEXT,                                          -- staff-facing notes
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_food_orders_status" ON "{{SCHEMA_NAME}}"."food_orders" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_food_orders_contact" ON "{{SCHEMA_NAME}}"."food_orders" ("contact_id", "created_at" DESC) WHERE "contact_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."food_order_items" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "order_id" UUID NOT NULL,
    "menu_item_id" UUID,
    "name_snapshot" VARCHAR(255) NOT NULL,                 -- copy at order time so renames don't rewrite history
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "modifiers" JSONB DEFAULT '[]',                        -- [{name: 'sin cebolla', delta: 0}, ...]
    "special_instructions" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_food_order_items_order" ON "{{SCHEMA_NAME}}"."food_order_items" ("order_id");

-- Promotions runtime catalog — used by the AI tool get_promotions and
-- can be displayed on the public menu. Distinct from the generic
-- offers module so restaurants get a domain-specific surface.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."menu_promotions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "discount_type" VARCHAR(20) DEFAULT 'percent',         -- percent | flat
    "discount_value" DECIMAL(10,2) DEFAULT 0,
    "valid_from" TIMESTAMP,
    "valid_to" TIMESTAMP,
    "applicable_days" JSONB DEFAULT '[]',                  -- ['mon','tue',...] empty = all days
    "applicable_hours" VARCHAR(50),                        -- '11:00-14:00' for happy hour etc.
    "min_order_amount" DECIMAL(10,2),
    "is_active" BOOLEAN DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_menu_promotions_active" ON "{{SCHEMA_NAME}}"."menu_promotions" ("is_active", "valid_to") WHERE "is_active" = true;

-- =====================================================================
-- Gimnasios vertical
-- =====================================================================
-- Membership plans are the catalog of what a gym sells (mensual,
-- trimestral, anual, drop-in). Members link to a contact + an active
-- plan with a frozen window. Fitness classes are the schedule;
-- class_bookings tracks who reserved which class. Check-ins record
-- physical visits for retention analytics.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."membership_plans" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "duration_days" INTEGER NOT NULL,                       -- 30, 90, 365 — used for renewal calculations
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "class_credits_per_period" INTEGER,                     -- NULL = unlimited
    "personal_training_credits" INTEGER DEFAULT 0,
    "guest_passes" INTEGER DEFAULT 0,
    "freeze_allowance_days" INTEGER DEFAULT 0,              -- max days the member can freeze per period
    "perks" JSONB DEFAULT '[]',                             -- ['locker', 'spa', 'wifi', 'parking']
    "is_active" BOOLEAN DEFAULT true,
    "sort_order" INTEGER DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_membership_plans_active" ON "{{SCHEMA_NAME}}"."membership_plans" ("is_active", "sort_order") WHERE "is_active" = true;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."members" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID NOT NULL,
    "plan_id" UUID,
    "member_number" VARCHAR(50),                            -- gym-internal ID printed on the card
    "joined_at" DATE,
    "current_period_start" DATE,
    "current_period_end" DATE,
    "frozen_from" DATE,                                     -- when frozen, period_end shifts forward
    "frozen_until" DATE,
    "frozen_days_used" INTEGER DEFAULT 0,
    "class_credits_remaining" INTEGER,
    "personal_training_remaining" INTEGER DEFAULT 0,
    "guest_passes_remaining" INTEGER DEFAULT 0,
    "auto_renew" BOOLEAN DEFAULT false,
    "status" VARCHAR(20) DEFAULT 'active',                  -- active | frozen | expired | cancelled
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_members_contact" ON "{{SCHEMA_NAME}}"."members" ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_members_status" ON "{{SCHEMA_NAME}}"."members" ("status", "current_period_end") WHERE "status" IN ('active', 'frozen');
CREATE INDEX IF NOT EXISTS "idx_members_number" ON "{{SCHEMA_NAME}}"."members" ("member_number") WHERE "member_number" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."fitness_classes" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "class_type" VARCHAR(100),                              -- yoga, crossfit, spinning, pilates, hiit
    "instructor_name" VARCHAR(255),
    "instructor_user_id" UUID,
    "scheduled_at" TIMESTAMP NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "max_capacity" INTEGER NOT NULL DEFAULT 20,
    "available_spots" INTEGER NOT NULL DEFAULT 20,
    "room" VARCHAR(100),
    "level" VARCHAR(50),                                    -- principiante | intermedio | avanzado
    "credits_required" INTEGER DEFAULT 1,
    "is_cancelled" BOOLEAN DEFAULT false,
    "cancellation_reason" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_fitness_classes_schedule" ON "{{SCHEMA_NAME}}"."fitness_classes" ("scheduled_at" DESC) WHERE "is_cancelled" = false;
CREATE INDEX IF NOT EXISTS "idx_fitness_classes_type" ON "{{SCHEMA_NAME}}"."fitness_classes" ("class_type", "scheduled_at") WHERE "is_cancelled" = false;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."class_bookings" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "class_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "contact_id" UUID,
    "status" VARCHAR(20) DEFAULT 'confirmed',               -- confirmed | waitlist | cancelled | attended | no_show
    "booked_at" TIMESTAMP DEFAULT NOW(),
    "cancelled_at" TIMESTAMP,
    "credits_used" INTEGER DEFAULT 1,
    "metadata" JSONB DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_class_bookings_unique" ON "{{SCHEMA_NAME}}"."class_bookings" ("class_id", "member_id") WHERE "status" IN ('confirmed', 'waitlist', 'attended');
CREATE INDEX IF NOT EXISTS "idx_class_bookings_member" ON "{{SCHEMA_NAME}}"."class_bookings" ("member_id", "booked_at" DESC);

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."member_check_ins" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "member_id" UUID NOT NULL,
    "checked_in_at" TIMESTAMP DEFAULT NOW(),
    "method" VARCHAR(20) DEFAULT 'manual',                  -- manual | qr | rfid | facial
    "class_id" UUID,
    "metadata" JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS "idx_member_check_ins_member" ON "{{SCHEMA_NAME}}"."member_check_ins" ("member_id", "checked_in_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_member_check_ins_date" ON "{{SCHEMA_NAME}}"."member_check_ins" ("checked_in_at" DESC);

-- =====================================================================
-- Education vertical (escuelas de idiomas / cursos / capacitación)
-- =====================================================================
-- Courses are the catalog. course_cohorts are scheduled instances of
-- a course (specific dates + instructor + capacity). Enrollments link
-- a contact to a cohort. placement_tests is a slim record of the
-- nivelación stage that often precedes enrollment.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."courses" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "subject" VARCHAR(100),                                -- ingles, frances, programacion, contabilidad
    "level" VARCHAR(50),                                   -- A1, A2, B1, B2, principiante, intermedio, avanzado
    "modality" VARCHAR(20) DEFAULT 'presencial',           -- presencial | online | hybrid
    "duration_hours" INTEGER,                              -- total course hours (e.g. 60h for an A2 module)
    "duration_weeks" INTEGER,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "certification" VARCHAR(255),                          -- e.g. 'Cambridge Preliminary', 'Internal certificate'
    "prerequisites" TEXT,
    "syllabus_url" VARCHAR(500),
    "image_url" VARCHAR(500),
    "is_active" BOOLEAN DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
-- La tabla legacy del catálogo (más arriba, línea ~312) gana por IF NOT EXISTS,
-- así que TODO el shape de education debe llegar por ALTER. Con solo subject y
-- level parchados, createCourse fallaba (insertaba 5 columnas inexistentes) y
-- get_course_schedule reventaba — la vertical education entera estaba rota.
ALTER TABLE "{{SCHEMA_NAME}}"."courses" ADD COLUMN IF NOT EXISTS "subject" VARCHAR(100);
ALTER TABLE "{{SCHEMA_NAME}}"."courses" ADD COLUMN IF NOT EXISTS "level" VARCHAR(50);
ALTER TABLE "{{SCHEMA_NAME}}"."courses" ADD COLUMN IF NOT EXISTS "duration_weeks" INTEGER;
ALTER TABLE "{{SCHEMA_NAME}}"."courses" ADD COLUMN IF NOT EXISTS "certification" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."courses" ADD COLUMN IF NOT EXISTS "prerequisites" TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."courses" ADD COLUMN IF NOT EXISTS "syllabus_url" VARCHAR(500);
ALTER TABLE "{{SCHEMA_NAME}}"."courses" ADD COLUMN IF NOT EXISTS "image_url" VARCHAR(500);
-- El slug NOT NULL de la tabla legacy rompería el INSERT de education (que no
-- lo envía). Relajarlo es seguro: el catálogo legacy que lo usaba genera el
-- slug en el servicio, no depende de la restricción.
ALTER TABLE "{{SCHEMA_NAME}}"."courses" ALTER COLUMN "slug" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_courses_subject" ON "{{SCHEMA_NAME}}"."courses" ("subject", "level") WHERE "is_active" = true;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."course_cohorts" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "course_id" UUID NOT NULL,
    "cohort_code" VARCHAR(100),                            -- e.g. '2026-A2-MORN' for Morning batch
    "instructor_name" VARCHAR(255),
    "instructor_user_id" UUID,
    "starts_at" DATE NOT NULL,
    "ends_at" DATE,
    "schedule" VARCHAR(255),                               -- 'Lun-Mie 18:00-20:00' free-text
    "max_capacity" INTEGER NOT NULL DEFAULT 20,
    "available_seats" INTEGER NOT NULL DEFAULT 20,
    "room" VARCHAR(100),
    "meeting_url" VARCHAR(500),                            -- for online cohorts
    "status" VARCHAR(20) DEFAULT 'open',                   -- open | full | cancelled | finished
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_course_cohorts_course" ON "{{SCHEMA_NAME}}"."course_cohorts" ("course_id", "starts_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_course_cohorts_open" ON "{{SCHEMA_NAME}}"."course_cohorts" ("status", "starts_at") WHERE "status" = 'open';

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."enrollments" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "cohort_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "contact_id" UUID,
    "student_name" VARCHAR(255) NOT NULL,
    "student_email" VARCHAR(255),
    "student_phone" VARCHAR(50),
    "enrolled_at" TIMESTAMP DEFAULT NOW(),
    "status" VARCHAR(20) DEFAULT 'enrolled',               -- enrolled | active | completed | dropped | refunded
    "payment_status" VARCHAR(20) DEFAULT 'pending',        -- pending | partial | paid | refunded
    "amount_paid" DECIMAL(10,2) DEFAULT 0,
    "completion_percent" INTEGER DEFAULT 0,
    "final_grade" VARCHAR(20),
    "completed_at" DATE,
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_enrollments_cohort" ON "{{SCHEMA_NAME}}"."enrollments" ("cohort_id", "status");
CREATE INDEX IF NOT EXISTS "idx_enrollments_contact" ON "{{SCHEMA_NAME}}"."enrollments" ("contact_id") WHERE "contact_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."placement_tests" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID,
    "subject" VARCHAR(100),
    "scheduled_at" TIMESTAMP,
    "completed_at" TIMESTAMP,
    "result_level" VARCHAR(50),
    "score" DECIMAL(5,2),
    "test_url" VARCHAR(500),
    "status" VARCHAR(20) DEFAULT 'pending',                -- pending | scheduled | completed | expired
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_placement_tests_contact" ON "{{SCHEMA_NAME}}"."placement_tests" ("contact_id", "created_at" DESC) WHERE "contact_id" IS NOT NULL;

-- =====================================================================
-- Seguros vertical
-- =====================================================================
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."insurance_plans" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "insurance_type" VARCHAR(50) NOT NULL,                  -- vida | salud | auto | hogar | empresarial | viaje
    "coverage_level" VARCHAR(50),                           -- basico | medio | premium
    "monthly_premium_min" DECIMAL(10,2),                    -- starting price; final depends on quote
    "monthly_premium_max" DECIMAL(10,2),
    "deductible" DECIMAL(10,2),
    "max_coverage" DECIMAL(15,2),
    "currency" VARCHAR(10) DEFAULT 'COP',
    "covers" JSONB DEFAULT '[]',                            -- list of covered events / items
    "excludes" JSONB DEFAULT '[]',
    "min_age" INTEGER,
    "max_age" INTEGER,
    "is_active" BOOLEAN DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_insurance_plans_type" ON "{{SCHEMA_NAME}}"."insurance_plans" ("insurance_type", "coverage_level") WHERE "is_active" = true;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."insurance_quotes" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID,
    "plan_id" UUID,
    "applicant_name" VARCHAR(255),
    "applicant_age" INTEGER,
    "applicant_email" VARCHAR(255),
    "applicant_phone" VARCHAR(50),
    "applicant_data" JSONB DEFAULT '{}',                    -- type-specific: vehicle data, dependents, etc.
    "monthly_premium" DECIMAL(10,2),
    "annual_premium" DECIMAL(10,2),
    "currency" VARCHAR(10) DEFAULT 'COP',
    "valid_until" DATE,
    "status" VARCHAR(20) DEFAULT 'draft',                   -- draft | sent | accepted | rejected | expired
    "agent_user_id" UUID,
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_insurance_quotes_contact" ON "{{SCHEMA_NAME}}"."insurance_quotes" ("contact_id", "status", "created_at" DESC) WHERE "contact_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_insurance_quotes_status" ON "{{SCHEMA_NAME}}"."insurance_quotes" ("status", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."insurance_policies" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "policy_number" VARCHAR(100) NOT NULL UNIQUE,
    "contact_id" UUID,
    "plan_id" UUID,
    "quote_id" UUID,
    "policyholder_name" VARCHAR(255) NOT NULL,
    "monthly_premium" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "starts_at" DATE NOT NULL,
    "ends_at" DATE,
    "status" VARCHAR(20) DEFAULT 'active',                  -- active | suspended | expired | cancelled
    "next_payment_at" DATE,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_insurance_policies_status" ON "{{SCHEMA_NAME}}"."insurance_policies" ("status", "next_payment_at");

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."insurance_claims" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "policy_id" UUID NOT NULL,
    "claim_number" VARCHAR(100),
    "incident_type" VARCHAR(100),
    "incident_at" DATE,
    "description" TEXT,
    "claimed_amount" DECIMAL(15,2),
    "approved_amount" DECIMAL(15,2),
    "status" VARCHAR(30) DEFAULT 'submitted',               -- submitted | reviewing | approved | paid | rejected
    "filed_via" VARCHAR(20) DEFAULT 'whatsapp',
    "documents" JSONB DEFAULT '[]',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_insurance_claims_policy" ON "{{SCHEMA_NAME}}"."insurance_claims" ("policy_id", "created_at" DESC);

-- =====================================================================
-- Tier 3 — Home services dispatch
-- =====================================================================
-- Generic service request table for home-services tenants (plomería,
-- electricidad, fumigación, limpieza). Other Tier 3 verticals (pet
-- services, photography) reuse the existing services + appointments
-- engine — no new tables for those.
-- =====================================================================
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."service_requests" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID,
    "conversation_id" UUID,
    "service_type" VARCHAR(100) NOT NULL,                   -- plomeria | electricidad | fumigacion | limpieza | jardineria | other
    "urgency" VARCHAR(20) DEFAULT 'normal',                 -- emergencia | alta | normal | flexible
    "customer_name" VARCHAR(255),
    "customer_phone" VARCHAR(50),
    "address" TEXT,
    "address_notes" TEXT,
    "city" VARCHAR(100),
    "issue_description" TEXT,
    "preferred_date" DATE,
    "preferred_time_window" VARCHAR(50),                    -- 'mañana', 'tarde', '14:00-16:00'
    "estimated_duration_minutes" INTEGER,
    "estimated_cost" DECIMAL(10,2),
    "currency" VARCHAR(10) DEFAULT 'COP',
    "assigned_technician_id" UUID,
    "assigned_technician_name" VARCHAR(255),
    "scheduled_at" TIMESTAMP,
    "completed_at" TIMESTAMP,
    "status" VARCHAR(30) DEFAULT 'pending',                 -- pending | quoted | scheduled | dispatched | in_progress | completed | cancelled
    "photos" JSONB DEFAULT '[]',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_service_requests_status" ON "{{SCHEMA_NAME}}"."service_requests" ("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "idx_service_requests_contact" ON "{{SCHEMA_NAME}}"."service_requests" ("contact_id", "created_at" DESC) WHERE "contact_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_service_requests_urgency" ON "{{SCHEMA_NAME}}"."service_requests" ("urgency", "scheduled_at") WHERE "status" IN ('pending', 'scheduled', 'dispatched');

-- ─── Photography vertical ───────────────────────────────────────────
-- Photo sessions: differentiates fotografia tenants from generic appointments
-- by adding session-type, package, and gallery delivery tracking.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."photo_sessions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID,
    "conversation_id" UUID,
    "session_type" VARCHAR(50) NOT NULL,                    -- wedding | portrait | event | product | family | newborn | other
    "package_name" VARCHAR(255),
    "package_description" TEXT,
    "client_name" VARCHAR(255),
    "client_phone" VARCHAR(50),
    "scheduled_at" TIMESTAMP,
    "duration_minutes" INTEGER,
    "location" TEXT,
    "deliverables" JSONB DEFAULT '[]',                      -- e.g. ["50 fotos editadas", "1 video 2min"]
    "deliverable_count" INTEGER,                            -- expected delivered photo count
    "delivered_count" INTEGER DEFAULT 0,
    "gallery_url" TEXT,                                     -- link to client gallery (Pixieset, Pic-Time, Drive)
    "gallery_password" VARCHAR(100),
    "delivery_due_at" DATE,
    "delivered_at" TIMESTAMP,
    "price" DECIMAL(10,2),
    "currency" VARCHAR(10) DEFAULT 'COP',
    "deposit_paid" DECIMAL(10,2) DEFAULT 0,
    "status" VARCHAR(30) DEFAULT 'scheduled',               -- scheduled | in_progress | delivered | cancelled
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_photo_sessions_status" ON "{{SCHEMA_NAME}}"."photo_sessions" ("status", "scheduled_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_photo_sessions_contact" ON "{{SCHEMA_NAME}}"."photo_sessions" ("contact_id", "scheduled_at" DESC) WHERE "contact_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_photo_sessions_delivery" ON "{{SCHEMA_NAME}}"."photo_sessions" ("delivery_due_at") WHERE "status" IN ('scheduled', 'in_progress');

-- ============================================================
-- Lazy/runtime tables folded into the canonical template (2026-06-23).
-- These per-tenant tables/columns were previously created on first feature
-- access via ensure*Tables() in services, so a brand-new tenant lacked them
-- until the feature ran. They are now created up-front. The service ensure*
-- methods remain as idempotent safety nets. Everything here is IF NOT EXISTS.
-- (PUBLIC-schema lazy tables — widget_*, push_subscriptions, email_channel_configs
--  — are created at app boot via onModuleInit and stay out of this per-tenant file.)
-- ============================================================

-- ---- Staff scheduling (verticals) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."staff_members" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT DEFAULT 'stylist',
    "avatar_url" TEXT,
    "specialties" TEXT[] DEFAULT '{}',
    "is_active" BOOLEAN DEFAULT true,
    "sort_order" INT DEFAULT 0,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."staff_schedules" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."staff_members"("id") ON DELETE CASCADE,
    "day_of_week" INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    UNIQUE("staff_id", "day_of_week")
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."staff_service_links" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."staff_members"("id") ON DELETE CASCADE,
    "service_id" UUID NOT NULL,
    "duration_override_min" INT,
    "price_override" INT,
    UNIQUE("staff_id", "service_id")
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."staff_breaks" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."staff_members"("id") ON DELETE CASCADE,
    "date" DATE NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "reason" TEXT
);

-- ---- Vehicle inventory (verticals) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."vehicles" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INT NOT NULL,
    "trim_level" TEXT,
    "vin" TEXT,
    "license_plate" TEXT,
    "color" TEXT,
    "fuel_type" TEXT DEFAULT 'gasoline',
    "transmission" TEXT DEFAULT 'automatic',
    "mileage_km" INT DEFAULT 0,
    "condition" TEXT DEFAULT 'new',
    "price_cents" INT NOT NULL,
    "currency" TEXT DEFAULT 'COP',
    "status" TEXT DEFAULT 'available',
    "category" TEXT DEFAULT 'sedan',
    "features" TEXT[] DEFAULT '{}',
    "photos" TEXT[] DEFAULT '{}',
    "description" TEXT,
    "location" TEXT,
    "is_featured" BOOLEAN DEFAULT false,
    "acquired_at" DATE,
    "sold_at" DATE,
    "sold_price_cents" INT,
    "buyer_contact_id" UUID,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_vehicles_status" ON "{{SCHEMA_NAME}}"."vehicles"("status");
CREATE INDEX IF NOT EXISTS "idx_vehicles_make_model" ON "{{SCHEMA_NAME}}"."vehicles"("make", "model");
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."vehicle_inquiries" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."vehicles"("id") ON DELETE CASCADE,
    "contact_id" UUID,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "inquiry_type" TEXT DEFAULT 'info',
    "notes" TEXT,
    "status" TEXT DEFAULT 'new',
    "assigned_to" UUID,
    "created_at" TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."test_drives" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."vehicles"("id") ON DELETE CASCADE,
    "contact_id" UUID,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT,
    "scheduled_date" DATE NOT NULL,
    "scheduled_time" TIME NOT NULL,
    "duration_min" INT DEFAULT 30,
    "status" TEXT DEFAULT 'scheduled',
    "notes" TEXT,
    "assigned_to" UUID,
    "created_at" TIMESTAMPTZ DEFAULT now()
);

-- ---- E-commerce ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."ecommerce_products" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "external_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "handle" TEXT,
    "vendor" TEXT,
    "product_type" TEXT,
    "price_cents" INT,
    "currency" TEXT DEFAULT 'USD',
    "compare_at_price_cents" INT,
    "image_url" TEXT,
    "images" TEXT[] DEFAULT '{}',
    "variants" JSONB DEFAULT '[]',
    "tags" TEXT[] DEFAULT '{}',
    "status" TEXT DEFAULT 'active',
    "inventory_quantity" INT DEFAULT 0,
    "synced_at" TIMESTAMPTZ DEFAULT now(),
    "created_at" TIMESTAMPTZ DEFAULT now(),
    UNIQUE(external_id, provider)
);
CREATE INDEX IF NOT EXISTS "idx_ecommerce_products_status" ON "{{SCHEMA_NAME}}"."ecommerce_products" ("status");
CREATE INDEX IF NOT EXISTS "idx_ecommerce_products_provider" ON "{{SCHEMA_NAME}}"."ecommerce_products" ("provider");
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."abandoned_carts" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "external_id" TEXT,
    "provider" TEXT NOT NULL,
    "contact_id" UUID,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "items" JSONB DEFAULT '[]',
    "total_cents" INT DEFAULT 0,
    "currency" TEXT DEFAULT 'USD',
    "checkout_url" TEXT,
    "status" TEXT DEFAULT 'abandoned',
    "recovery_sent_at" TIMESTAMPTZ,
    "recovered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_abandoned_carts_contact" ON "{{SCHEMA_NAME}}"."abandoned_carts" ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_abandoned_carts_status" ON "{{SCHEMA_NAME}}"."abandoned_carts" ("status");

-- ---- Channel manager (vacation rental) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."cm_listings" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "external_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "check_in_time" TEXT DEFAULT '15:00',
    "check_out_time" TEXT DEFAULT '11:00',
    "max_guests" INT DEFAULT 4,
    "base_price_cents" INT DEFAULT 0,
    "currency" TEXT DEFAULT 'USD',
    "status" TEXT DEFAULT 'active',
    "amenities" TEXT[] DEFAULT '{}',
    "photos" TEXT[] DEFAULT '{}',
    "property_id" UUID,
    "last_synced_at" TIMESTAMPTZ DEFAULT now(),
    "created_at" TIMESTAMPTZ DEFAULT now(),
    UNIQUE(external_id, provider)
);
CREATE INDEX IF NOT EXISTS "idx_cm_listings_provider" ON "{{SCHEMA_NAME}}"."cm_listings" ("provider");
CREATE INDEX IF NOT EXISTS "idx_cm_listings_status" ON "{{SCHEMA_NAME}}"."cm_listings" ("status");
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."cm_reservations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."cm_listings"("id") ON DELETE CASCADE,
    "external_id" TEXT,
    "provider" TEXT NOT NULL,
    "guest_name" TEXT NOT NULL,
    "guest_email" TEXT,
    "guest_phone" TEXT,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "guests" INT DEFAULT 1,
    "total_cents" INT DEFAULT 0,
    "currency" TEXT DEFAULT 'USD',
    "status" TEXT DEFAULT 'confirmed',
    "source" TEXT,
    "notes" TEXT,
    "contact_id" UUID,
    "synced_at" TIMESTAMPTZ DEFAULT now(),
    "created_at" TIMESTAMPTZ DEFAULT now(),
    UNIQUE(external_id, provider)
);
CREATE INDEX IF NOT EXISTS "idx_cm_reservations_listing_id" ON "{{SCHEMA_NAME}}"."cm_reservations" ("listing_id");
CREATE INDEX IF NOT EXISTS "idx_cm_reservations_status" ON "{{SCHEMA_NAME}}"."cm_reservations" ("status");
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."cm_availability" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."cm_listings"("id") ON DELETE CASCADE,
    "date" DATE NOT NULL,
    "is_available" BOOLEAN DEFAULT true,
    "price_cents" INT,
    "min_nights" INT DEFAULT 1,
    "notes" TEXT,
    UNIQUE(listing_id, date)
);
CREATE INDEX IF NOT EXISTS "idx_cm_availability_listing_id" ON "{{SCHEMA_NAME}}"."cm_availability" ("listing_id");

-- ---- Email channel (per-tenant thread metadata) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."email_threads" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "subject" TEXT,
    "message_id_header" TEXT,
    "in_reply_to" TEXT,
    "references_header" TEXT,
    "cc" TEXT[],
    "bcc" TEXT[],
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_email_threads_conversation_id" ON "{{SCHEMA_NAME}}"."email_threads" ("conversation_id");

-- ---- Drip sequences (automation) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."drip_sequences" (
    "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "trigger_event" VARCHAR(100) NOT NULL,
    "trigger_conditions" JSONB DEFAULT '{}',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."drip_enrollments" (
    "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "sequence_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."drip_sequences"("id") ON DELETE CASCADE,
    "contact_id" UUID NOT NULL,
    "conversation_id" UUID,
    "current_step" INTEGER DEFAULT 0,
    "status" VARCHAR(50) DEFAULT 'active',
    "enrolled_at" TIMESTAMPTZ DEFAULT NOW(),
    "last_step_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "stop_reason" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_drip_enrollments_active" ON "{{SCHEMA_NAME}}"."drip_enrollments" ("sequence_id", "contact_id") WHERE "status" = 'active';

-- ---- CTWA attribution ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."ctwa_attributions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "contact_id" UUID NOT NULL,
    "conversation_id" UUID,
    "source_id" TEXT NOT NULL,
    "source_type" TEXT,
    "source_url" TEXT,
    "headline" TEXT,
    "body" TEXT,
    "media_type" TEXT,
    "ctwa_clid" TEXT,
    "captured_at" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE("contact_id", "source_id")
);
CREATE INDEX IF NOT EXISTS "idx_ctwa_captured" ON "{{SCHEMA_NAME}}"."ctwa_attributions"("captured_at");

-- ---- Procedures (deterministic SOP engine) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."procedures" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" JSONB NOT NULL DEFAULT '{"keywords":[]}',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "vertical" VARCHAR(50),
    "version" INTEGER NOT NULL DEFAULT 1,
    "source_sop" TEXT,
    "created_by" VARCHAR(120),
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_procedures_status" ON "{{SCHEMA_NAME}}"."procedures"("status");

-- ---- Broadcast A/B test variants ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."campaign_variants" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "percentage" INTEGER NOT NULL DEFAULT 50,
    "is_winner" BOOLEAN DEFAULT false,
    "stats" JSONB DEFAULT '{"sent":0,"delivered":0,"read":0,"responded":0,"failed":0}',
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_campaign_variants_campaign" ON "{{SCHEMA_NAME}}"."campaign_variants"("campaign_id");

-- ---- Knowledge feedback ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."kb_feedback" (
    "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "conversation_id" UUID,
    "message_id" UUID,
    "document_id" UUID,
    "query" TEXT,
    "rating" SMALLINT NOT NULL,
    "is_false_positive" BOOLEAN DEFAULT false,
    "comment" TEXT,
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_kb_feedback_document" ON "{{SCHEMA_NAME}}"."kb_feedback"("document_id");
CREATE INDEX IF NOT EXISTS "idx_kb_feedback_rating" ON "{{SCHEMA_NAME}}"."kb_feedback"("rating");

-- ---- KB health issues ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."kb_health_issues" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" VARCHAR(30) NOT NULL,
    "document_id" UUID,
    "related_document_id" UUID,
    "detail" TEXT,
    "suggestion" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_kbhealth_status" ON "{{SCHEMA_NAME}}"."kb_health_issues"("status", "created_at");

-- ---- Customer memory (Mem0-style) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."customer_memories" (
    "contact_id" UUID PRIMARY KEY,
    "facts" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "summary" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."customer_memory_facts" (
    "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "owner_kind" VARCHAR(16) NOT NULL DEFAULT 'profile',
    "owner_id" UUID NOT NULL,
    "fact_text" TEXT NOT NULL,
    "embedding" vector(1536),
    "seen_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_cmf_owner" ON "{{SCHEMA_NAME}}"."customer_memory_facts" ("owner_kind", "owner_id");

-- ---- Saved reports (analytics) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."saved_reports" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "is_favorite" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- ---- Observability: traces + quality scores ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."conversation_traces" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
CREATE INDEX IF NOT EXISTS idx_ctrace_conversation ON "{{SCHEMA_NAME}}"."conversation_traces"(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."turn_traces" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    message_id UUID NULL,
    total_duration_ms INTEGER,
    step_count INTEGER,
    steps JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_turntrace_conv ON "{{SCHEMA_NAME}}"."turn_traces"(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."conversation_quality_scores" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    overall_score NUMERIC,
    resolution_score NUMERIC,
    tone_score NUMERIC,
    accuracy_score NUMERIC,
    empathy_score NUMERIC,
    flags JSONB DEFAULT '[]'::jsonb,
    resolution_type VARCHAR(50),
    resolution_verified BOOLEAN,
    verification_reason TEXT,
    scored_by VARCHAR(20) DEFAULT 'ai',
    rubric_version VARCHAR(20) DEFAULT 'v1',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cqs_conversation ON "{{SCHEMA_NAME}}"."conversation_quality_scores"(conversation_id);
CREATE INDEX IF NOT EXISTS idx_cqs_created ON "{{SCHEMA_NAME}}"."conversation_quality_scores"(created_at);

-- ---- Simulation + eval gate ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."simulation_runs" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID,
    channel_type VARCHAR(40) DEFAULT 'whatsapp',
    persona_version INTEGER,
    persona_snapshot JSONB,
    scenario_source VARCHAR(20) NOT NULL DEFAULT 'synthetic',
    vertical VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    scenario_count INTEGER DEFAULT 0,
    avg_score NUMERIC,
    resolved_rate NUMERIC,
    results JSONB DEFAULT '[]'::jsonb,
    summary JSONB,
    baseline_run_id UUID,
    error TEXT,
    created_by VARCHAR(120),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_simruns_created ON "{{SCHEMA_NAME}}"."simulation_runs"(created_at);
CREATE INDEX IF NOT EXISTS idx_simruns_agent ON "{{SCHEMA_NAME}}"."simulation_runs"(agent_id);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."eval_scenarios" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    vertical TEXT,
    language TEXT NOT NULL DEFAULT 'es',
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    criteria TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE "{{SCHEMA_NAME}}"."eval_scenarios" ADD COLUMN IF NOT EXISTS expected_actions JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."eval_runs" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID,
    k INT NOT NULL DEFAULT 1,
    threshold NUMERIC,
    passed BOOLEAN,
    avg_score NUMERIC,
    eval_activable BOOLEAN NOT NULL DEFAULT false,
    results JSONB NOT NULL DEFAULT '[]'::jsonb,
    trigger TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_agent ON "{{SCHEMA_NAME}}"."eval_runs" (agent_id);

-- ---- Google Business Profile reviews ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."gbp_reviews" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_name TEXT UNIQUE NOT NULL,
    reviewer_name TEXT,
    reviewer_photo TEXT,
    rating INTEGER,
    comment TEXT,
    create_time TIMESTAMPTZ,
    reply_comment TEXT,
    reply_status VARCHAR(20) DEFAULT 'none',
    ai_suggestion TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gbp_created ON "{{SCHEMA_NAME}}"."gbp_reviews"(create_time);

-- ---- Vertical integrations cache ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."vi_items" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(20) NOT NULL,
    item_type VARCHAR(40) NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT,
    subtitle TEXT,
    price_cents INTEGER,
    currency VARCHAR(10),
    data JSONB DEFAULT '{}'::jsonb,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, item_type, external_id)
);
CREATE INDEX IF NOT EXISTS idx_vi_items_lookup ON "{{SCHEMA_NAME}}"."vi_items"(provider, item_type);

-- ---- Outbound webhooks ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."webhook_endpoints" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}',
    secret TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."webhook_deliveries" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."webhook_endpoints"(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status_code INT,
    response_body TEXT,
    error TEXT,
    attempt INT NOT NULL DEFAULT 1,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- Column additions to existing template tables (idempotent) ----
ALTER TABLE "{{SCHEMA_NAME}}"."campaigns" ADD COLUMN IF NOT EXISTS "is_ab_test" BOOLEAN DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."campaigns" ADD COLUMN IF NOT EXISTS "ab_test_config" JSONB DEFAULT '{}';
ALTER TABLE "{{SCHEMA_NAME}}"."campaigns" ADD COLUMN IF NOT EXISTS "scheduled_at" TIMESTAMPTZ;
ALTER TABLE "{{SCHEMA_NAME}}"."campaign_recipients" ADD COLUMN IF NOT EXISTS "variant_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."campaign_recipients" ADD COLUMN IF NOT EXISTS "email" VARCHAR(255) DEFAULT '';
ALTER TABLE "{{SCHEMA_NAME}}"."campaign_recipients" ADD COLUMN IF NOT EXISTS "channel" VARCHAR(50) DEFAULT 'whatsapp';
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_documents" ADD COLUMN IF NOT EXISTS "satisfaction_score" DECIMAL(3,2);
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_documents" ADD COLUMN IF NOT EXISTS "feedback_count" INTEGER DEFAULT 0;
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "was_handed_off" BOOLEAN DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "handoff_at" TIMESTAMPTZ;
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "ai_message_count" INTEGER DEFAULT 0;
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "resolution_type" VARCHAR(50);
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "resolution_verified" BOOLEAN;
ALTER TABLE "{{SCHEMA_NAME}}"."pipeline_stages" ADD COLUMN IF NOT EXISTS "pipeline_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."deals" ADD COLUMN IF NOT EXISTS "pipeline_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."companies" ADD COLUMN IF NOT EXISTS "size" VARCHAR(50);
ALTER TABLE "{{SCHEMA_NAME}}"."companies" ADD COLUMN IF NOT EXISTS "domain" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."companies" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- ============================================
-- PARALLLY — Vertical bootstrap idempotency (conflict targets)
-- ============================================
-- The per-industry seeder (verticals.service.ts) inserts pipeline stages,
-- services and FAQs with ON CONFLICT DO NOTHING. Without a unique index that
-- clause can never fire, so any re-seed (industry change, retry, a future
-- re-bootstrap endpoint) silently duplicates the seeded content. The indexes
-- below are the conflict targets the seeder points at.
--
-- Additive only (expand-contract safe): a duplicate cleanup plus
-- CREATE UNIQUE INDEX. Nothing is renamed or dropped.
--
-- Ordering note: this block lives at the end of the template on purpose — it
-- references appointments / service_staff / staff_service_links / deals and the
-- pipeline_id column added above, all of which must already exist.
--
-- Pre-existing duplicates: the cleanup below only removes rows that nothing
-- else references, so it can never cascade away staff assignments or orphan an
-- appointment. When a duplicate IS referenced it survives and the
-- CREATE UNIQUE INDEX fails for that tenant. That is deliberate and safe: all
-- three paths that apply this template tolerate per-statement failures
-- (prisma.service.ts splitSqlStatements, scripts/migrate-tenants.js and the
-- psql pass in deploy.yml), so the deploy continues and only that one tenant is
-- left without the index. Destroying referenced tenant data to gain an index
-- would be a far worse trade.

-- ---- pipeline_stages: unique per (pipeline_id, slug) ----
-- NOT keyed on slug alone: pipeline_stages.pipeline_id exists (multi-pipeline,
-- plan-gated via maxPipelines) and a second pipeline legitimately reuses the
-- same slugs ("ganado", "perdido"), which are auto-derived from the stage name.
-- A unique on slug alone would turn that paid flow into an untranslated 23505.
-- NULLS NOT DISTINCT (PG15+) is what makes the index still bite for tenants
-- whose stages have pipeline_id NULL — exactly where the bootstrap writes.
DELETE FROM "{{SCHEMA_NAME}}"."pipeline_stages" a
USING "{{SCHEMA_NAME}}"."pipeline_stages" b
WHERE a."slug" IS NOT NULL
  AND a."slug" = b."slug"
  AND a."pipeline_id" IS NOT DISTINCT FROM b."pipeline_id"
  AND (COALESCE(a."created_at", 'epoch'::timestamp), a."id") > (COALESCE(b."created_at", 'epoch'::timestamp), b."id")
  AND NOT EXISTS (SELECT 1 FROM "{{SCHEMA_NAME}}"."deals" d WHERE d."stage_id" = a."id");
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_pipeline_stages_pipeline_slug" ON "{{SCHEMA_NAME}}"."pipeline_stages" ("pipeline_id", "slug") NULLS NOT DISTINCT;

-- ---- services: unique per name ----
-- The booking engine reads services back to the customer as a plain numbered
-- list, so two rows with the same name are indistinguishable to them anyway.
DELETE FROM "{{SCHEMA_NAME}}"."services" a
USING "{{SCHEMA_NAME}}"."services" b
WHERE a."name" = b."name"
  AND (COALESCE(a."created_at", 'epoch'::timestamp), a."id") > (COALESCE(b."created_at", 'epoch'::timestamp), b."id")
  AND NOT EXISTS (SELECT 1 FROM "{{SCHEMA_NAME}}"."appointments" ap WHERE ap."service_id" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "{{SCHEMA_NAME}}"."service_staff" ss WHERE ss."service_id" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "{{SCHEMA_NAME}}"."staff_service_links" sl WHERE sl."service_id" = a."id");
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_services_name" ON "{{SCHEMA_NAME}}"."services" ("name");

-- ---- faqs: unique per question ----
-- No table references faqs, so an exact-duplicate question can be dropped
-- outright. Oldest row wins.
DELETE FROM "{{SCHEMA_NAME}}"."faqs" a
USING "{{SCHEMA_NAME}}"."faqs" b
WHERE a."question" = b."question"
  AND (COALESCE(a."created_at", 'epoch'::timestamp), a."id") > (COALESCE(b."created_at", 'epoch'::timestamp), b."id");
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_faqs_question" ON "{{SCHEMA_NAME}}"."faqs" ("question");

-- =====================================================================
-- iCal sync hardening (jul 2026)
-- =====================================================================
-- ADD COLUMN, never inside the CREATE TABLE above: `CREATE TABLE IF NOT
-- EXISTS` is a no-op on schemas that already have the table, so putting
-- these there would only fix brand-new tenants. The deploy re-applies this
-- file per tenant, which is what carries them to existing ones.

-- Cancellations used to be scoped by `source`, a free-text label. Two feeds
-- sharing a source on one property made each sync tombstone the other's
-- blocks. feed_id is the real owner.
ALTER TABLE "{{SCHEMA_NAME}}"."ical_blocks" ADD COLUMN IF NOT EXISTS "feed_id" UUID;

-- When a feed first asks to free most of what it holds, the clock starts here
-- instead of the sweep running. A poll count would be no protection at all
-- (three clicks of "sync" would satisfy it); wall-clock cannot be rushed.
-- NULL means nothing is on hold. See SWEEP_HOLD_MINUTES in ical-sync.service.ts.
ALTER TABLE "{{SCHEMA_NAME}}"."ical_feeds" ADD COLUMN IF NOT EXISTS "sweep_hold_since" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "idx_ical_blocks_feed" ON "{{SCHEMA_NAME}}"."ical_blocks" ("feed_id") WHERE "is_deleted" = false;

-- Best-effort backfill by (property_id, source) — the pairing the old sweep
-- already assumed. Deliberately skips rows whose source is claimed by more
-- than one active feed: attributing those by guess would let one feed sweep
-- the other's blocks. They stay NULL and are handled by the equally-cautious
-- `feed_id IS NULL` arm in ical-sync.service.ts, then adopt a feed_id the next
-- time their own feed re-exports them. 'Manual' blocks are never attributed to
-- a feed — a feed may legally be named "Manual", and hand-made blocks must
-- stay unreachable from any sync.
UPDATE "{{SCHEMA_NAME}}"."ical_blocks" b
   SET "feed_id" = f."id"
  FROM "{{SCHEMA_NAME}}"."ical_feeds" f
 WHERE b."feed_id" IS NULL
   AND b."source" <> 'Manual'
   AND b."property_id" = f."property_id"
   AND b."source" = f."source"
   AND f."is_active" = true
   AND NOT EXISTS (
     SELECT 1 FROM "{{SCHEMA_NAME}}"."ical_feeds" f2
      WHERE f2."property_id" = f."property_id" AND f2."source" = f."source"
        AND f2."is_active" = true AND f2."id" <> f."id"
   );
