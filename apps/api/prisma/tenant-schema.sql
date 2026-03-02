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
