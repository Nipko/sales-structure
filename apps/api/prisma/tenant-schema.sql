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
    -- Prospective attribution only. Existing rows deliberately remain NULL.
    "agent_persona_id" UUID,
    "agent_config_version" INTEGER,
    -- True when more than one agent/config version actually handled this
    -- conversation. Mixed conversations are never credited to either version.
    "agent_attribution_conflicted" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(50) DEFAULT 'active',  -- active, waiting_human, with_human, resolved, archived
    "stage" VARCHAR(50) DEFAULT 'greeting', -- greeting, discovery, negotiation, closing, support, complaint
    "assigned_to" VARCHAR(255),
    "summary" TEXT,
    "handoff_summary" JSONB,
    "handoff_trace_id" VARCHAR(128),
    "handoff_summary_generated_at" TIMESTAMPTZ,
    "estimated_ticket_value" DECIMAL(15, 2) DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "resolved_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
ALTER TABLE "{{SCHEMA_NAME}}"."conversations"
    ADD COLUMN IF NOT EXISTS "agent_persona_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."conversations"
    ADD COLUMN IF NOT EXISTS "agent_config_version" INTEGER;
ALTER TABLE "{{SCHEMA_NAME}}"."conversations"
    ADD COLUMN IF NOT EXISTS "agent_attribution_conflicted" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "idx_conversations_contact_id" ON "{{SCHEMA_NAME}}"."conversations" ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_conversations_status" ON "{{SCHEMA_NAME}}"."conversations" ("status");
CREATE INDEX IF NOT EXISTS "idx_conversations_created_at" ON "{{SCHEMA_NAME}}"."conversations" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_conversations_agent_created" ON "{{SCHEMA_NAME}}"."conversations" ("agent_persona_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_conversations_agent_version_created" ON "{{SCHEMA_NAME}}"."conversations" ("agent_persona_id", "agent_config_version", "created_at" DESC) WHERE "agent_persona_id" IS NOT NULL;

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

-- ---- Central AI Tool Authority / Idempotency (DEC-08/09) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tool_execution_ledger" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "idempotency_key" VARCHAR(128) NOT NULL UNIQUE,
    "tool_name" VARCHAR(160) NOT NULL,
    "args_hash" CHAR(64) NOT NULL,
    "request_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "channel_type" VARCHAR(40),
    "contact_id" UUID REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE SET NULL,
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE SET NULL,
    "assurance_level" VARCHAR(2) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "confirmation_token" TEXT,
    "request_source_message_id" UUID REFERENCES "{{SCHEMA_NAME}}"."messages"("id") ON DELETE SET NULL,
    "confirmation_source_message_id" UUID REFERENCES "{{SCHEMA_NAME}}"."messages"("id") ON DELETE SET NULL,
    "confirmed_by_message_id" UUID REFERENCES "{{SCHEMA_NAME}}"."messages"("id") ON DELETE SET NULL,
    "confirmation_expires_at" TIMESTAMPTZ,
    "confirmed_at" TIMESTAMPTZ,
    "approval_ticket_id" UUID,
    "response_payload" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "execution_lease_token" UUID,
    "execution_lease_expires_at" TIMESTAMPTZ,
    "last_error_code" VARCHAR(80),
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE "{{SCHEMA_NAME}}"."tool_execution_ledger" ADD COLUMN IF NOT EXISTS "request_payload" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_execution_ledger" ADD COLUMN IF NOT EXISTS "channel_type" VARCHAR(40);
ALTER TABLE "{{SCHEMA_NAME}}"."tool_execution_ledger" ADD COLUMN IF NOT EXISTS "execution_lease_token" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_execution_ledger" ADD COLUMN IF NOT EXISTS "execution_lease_expires_at" TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS "idx_tool_execution_ledger_status" ON "{{SCHEMA_NAME}}"."tool_execution_ledger" ("status", "updated_at");

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tool_approval_tickets" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "execution_ledger_id" UUID NOT NULL UNIQUE REFERENCES "{{SCHEMA_NAME}}"."tool_execution_ledger"("id") ON DELETE CASCADE,
    "tool_name" VARCHAR(160) NOT NULL,
    "contact_id" UUID REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE SET NULL,
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE SET NULL,
    "approval_source_message_id" UUID REFERENCES "{{SCHEMA_NAME}}"."messages"("id") ON DELETE SET NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "decided_at" TIMESTAMPTZ,
    "decided_by" UUID,
    "decision_reason" TEXT,
    "resume_state" VARCHAR(20) NOT NULL DEFAULT 'not_requested',
    "resume_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_resume_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "resume_lease_token" UUID,
    "resume_lease_expires_at" TIMESTAMPTZ,
    "resumed_at" TIMESTAMPTZ,
    "resume_result" JSONB,
    "resume_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD COLUMN IF NOT EXISTS "resume_state" VARCHAR(20) NOT NULL DEFAULT 'not_requested';
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD COLUMN IF NOT EXISTS "approval_source_message_id" UUID REFERENCES "{{SCHEMA_NAME}}"."messages"("id") ON DELETE SET NULL;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD COLUMN IF NOT EXISTS "resume_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD COLUMN IF NOT EXISTS "next_resume_at" TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD COLUMN IF NOT EXISTS "resume_lease_token" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD COLUMN IF NOT EXISTS "resume_lease_expires_at" TIMESTAMPTZ;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD COLUMN IF NOT EXISTS "resumed_at" TIMESTAMPTZ;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD COLUMN IF NOT EXISTS "resume_result" JSONB;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD COLUMN IF NOT EXISTS "resume_error" TEXT;
CREATE INDEX IF NOT EXISTS "idx_tool_approval_tickets_status" ON "{{SCHEMA_NAME}}"."tool_approval_tickets" ("status", "expires_at");

-- NOT VALID preserves legacy rows while enforcing the closed-world state
-- machines for every new write.
ALTER TABLE "{{SCHEMA_NAME}}"."tool_execution_ledger" DROP CONSTRAINT IF EXISTS "tool_execution_ledger_assurance_chk";
ALTER TABLE "{{SCHEMA_NAME}}"."tool_execution_ledger" ADD CONSTRAINT "tool_execution_ledger_assurance_chk" CHECK ("assurance_level" IN ('A0', 'A1', 'A2', 'A3', 'A4')) NOT VALID;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_execution_ledger" DROP CONSTRAINT IF EXISTS "tool_execution_ledger_status_chk";
ALTER TABLE "{{SCHEMA_NAME}}"."tool_execution_ledger" ADD CONSTRAINT "tool_execution_ledger_status_chk" CHECK ("status" IN ('awaiting_confirmation', 'awaiting_approval', 'ready', 'executing', 'succeeded', 'failed', 'handoff_required', 'reconciliation_required', 'rejected')) NOT VALID;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" DROP CONSTRAINT IF EXISTS "tool_approval_tickets_status_chk";
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD CONSTRAINT "tool_approval_tickets_status_chk" CHECK ("status" IN ('pending', 'approved', 'rejected', 'expired')) NOT VALID;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" DROP CONSTRAINT IF EXISTS "tool_approval_tickets_resume_state_chk";
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_tickets" ADD CONSTRAINT "tool_approval_tickets_resume_state_chk" CHECK ("resume_state" IN ('not_requested', 'pending', 'processing', 'completed', 'failed')) NOT VALID;
ALTER TABLE "{{SCHEMA_NAME}}"."tool_execution_ledger" DROP CONSTRAINT IF EXISTS "tool_execution_ledger_approval_fk";
ALTER TABLE "{{SCHEMA_NAME}}"."tool_execution_ledger" ADD CONSTRAINT "tool_execution_ledger_approval_fk" FOREIGN KEY ("approval_ticket_id") REFERENCES "{{SCHEMA_NAME}}"."tool_approval_tickets"("id") ON DELETE SET NULL NOT VALID;
CREATE INDEX IF NOT EXISTS "idx_tool_approval_tickets_resume" ON "{{SCHEMA_NAME}}"."tool_approval_tickets" ("resume_state", "next_resume_at") WHERE "status" = 'approved' AND "resume_state" IN ('pending', 'processing', 'failed');

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tool_approval_outbox" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "ticket_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."tool_approval_tickets"("id") ON DELETE CASCADE,
    "event_type" VARCHAR(80) NOT NULL,
    "event_key" VARCHAR(240) NOT NULL UNIQUE,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_outbox" DROP CONSTRAINT IF EXISTS "tool_approval_outbox_status_chk";
ALTER TABLE "{{SCHEMA_NAME}}"."tool_approval_outbox" ADD CONSTRAINT "tool_approval_outbox_status_chk" CHECK ("status" IN ('pending', 'processing', 'published', 'failed')) NOT VALID;
CREATE INDEX IF NOT EXISTS "idx_tool_approval_outbox_due" ON "{{SCHEMA_NAME}}"."tool_approval_outbox" ("status", "next_attempt_at") WHERE "status" IN ('pending', 'failed');

-- ---- Provider-neutral customer payment operations (DEC-10) ----
-- No provider is implied by this table. An adapter must be explicitly bound,
-- and a provider response is never success until reconciliation confirms it.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."payment_operation_ledger" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "execution_ledger_id" UUID NOT NULL UNIQUE REFERENCES "{{SCHEMA_NAME}}"."tool_execution_ledger"("id") ON DELETE RESTRICT,
    "operation_kind" VARCHAR(30) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "provider" VARCHAR(80),
    "provider_operation_id" VARCHAR(255),
    "canonical_reference" VARCHAR(180),
    "request_hash" CHAR(64) NOT NULL,
    "request_payload" JSONB NOT NULL DEFAULT '{}',
    "response_payload" JSONB,
    "reconciliation_status" VARCHAR(80) NOT NULL,
    "reconciled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE "{{SCHEMA_NAME}}"."payment_operation_ledger" ADD COLUMN IF NOT EXISTS "canonical_reference" VARCHAR(180);
CREATE INDEX IF NOT EXISTS "idx_payment_operation_ledger_status" ON "{{SCHEMA_NAME}}"."payment_operation_ledger" ("status", "updated_at");
ALTER TABLE "{{SCHEMA_NAME}}"."payment_operation_ledger" DROP CONSTRAINT IF EXISTS "payment_operation_ledger_kind_chk";
ALTER TABLE "{{SCHEMA_NAME}}"."payment_operation_ledger" ADD CONSTRAINT "payment_operation_ledger_kind_chk" CHECK ("operation_kind" IN ('payment_link', 'refund', 'discount')) NOT VALID;
ALTER TABLE "{{SCHEMA_NAME}}"."payment_operation_ledger" DROP CONSTRAINT IF EXISTS "payment_operation_ledger_status_chk";
ALTER TABLE "{{SCHEMA_NAME}}"."payment_operation_ledger" ADD CONSTRAINT "payment_operation_ledger_status_chk" CHECK ("status" IN ('requested', 'processing', 'succeeded', 'handoff_required', 'reconciliation_required', 'failed')) NOT VALID;

-- ---- Durable tenant -> customer payment lifecycle ----
-- These rows contain only canonical purchase snapshots and provider identifiers.
-- Provider credentials remain encrypted in the global tenant settings document;
-- customer/provider payloads (which can contain PII) are deliberately not stored.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tenant_payment_intents" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "provider" VARCHAR(30) NOT NULL,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "canonical_reference" VARCHAR(180) NOT NULL,
    "contact_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" VARCHAR(250) NOT NULL,
    "resource_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "provider_link_id" VARCHAR(255),
    "checkout_url" TEXT,
    "provider_transaction_id" VARCHAR(255),
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "tenant_payment_intents_provider_idem_uq" UNIQUE ("provider", "idempotency_key"),
    CONSTRAINT "tenant_payment_intents_amount_chk" CHECK ("amount_cents" > 0),
    CONSTRAINT "tenant_payment_intents_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "tenant_payment_intents_provider_chk" CHECK ("provider" IN ('mercadopago', 'wompi')),
    CONSTRAINT "tenant_payment_intents_status_chk" CHECK ("status" IN ('pending', 'paid', 'failed', 'refunded', 'expired', 'requires_review', 'ambiguous'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_tenant_payment_intents_provider_link"
    ON "{{SCHEMA_NAME}}"."tenant_payment_intents" ("provider", "provider_link_id")
    WHERE "provider_link_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_tenant_payment_intents_unresolved_reference"
    ON "{{SCHEMA_NAME}}"."tenant_payment_intents" ("canonical_reference")
    WHERE "status" IN ('pending', 'requires_review', 'ambiguous');
CREATE INDEX IF NOT EXISTS "idx_tenant_payment_intents_contact_reference"
    ON "{{SCHEMA_NAME}}"."tenant_payment_intents" ("contact_id", "canonical_reference", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_tenant_payment_intents_transaction"
    ON "{{SCHEMA_NAME}}"."tenant_payment_intents" ("provider", "provider_transaction_id")
    WHERE "provider_transaction_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tenant_payment_attempts" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "intent_id" UUID REFERENCES "{{SCHEMA_NAME}}"."tenant_payment_intents"("id") ON DELETE RESTRICT,
    "provider" VARCHAR(30) NOT NULL,
    "provider_event_key" CHAR(64) NOT NULL,
    "provider_link_id" VARCHAR(255),
    "provider_transaction_id" VARCHAR(255),
    "provider_status" VARCHAR(40),
    "normalized_status" VARCHAR(30) NOT NULL,
    "amount_cents" BIGINT,
    "currency" CHAR(3),
    "event_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "validation_error" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "tenant_payment_attempts_event_uq" UNIQUE ("provider", "provider_event_key"),
    CONSTRAINT "tenant_payment_attempts_provider_chk" CHECK ("provider" IN ('mercadopago', 'wompi')),
    CONSTRAINT "tenant_payment_attempts_status_chk" CHECK ("normalized_status" IN ('pending', 'paid', 'failed', 'refunded', 'requires_review', 'ambiguous'))
);
CREATE INDEX IF NOT EXISTS "idx_tenant_payment_attempts_intent"
    ON "{{SCHEMA_NAME}}"."tenant_payment_attempts" ("intent_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_tenant_payment_attempts_transaction"
    ON "{{SCHEMA_NAME}}"."tenant_payment_attempts" ("provider", "provider_transaction_id", "created_at" DESC);

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

-- ---- Knowledge Documents: jurisdiction, authority and validity ----
--
-- Retrieval had language and nothing else, and language was only a ranking
-- boost, never a filter. So a Colombian regulation answered a Mexican tenant's
-- customer because both documents are `es` — and it answered confidently, with
-- a citation. In health, finance, insurance and legal that is not a relevance
-- problem, it is a wrong answer with a source attached.
--
-- NULL means "not declared", which for a general document is correct and
-- harmless: only documents marked `is_regulated` are filtered hard.
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_documents"
    -- ISO 3166-1 alpha-2 the document applies to. NULL = applies anywhere.
    ADD COLUMN IF NOT EXISTS "jurisdiction" VARCHAR(2),
    -- Who issued it: DIAN, SIC, PROFECO, ANVISA, the tenant itself…
    ADD COLUMN IF NOT EXISTS "authority" VARCHAR(120),
    ADD COLUMN IF NOT EXISTS "valid_from" DATE,
    ADD COLUMN IF NOT EXISTS "valid_to" DATE,
    -- When true, a jurisdiction mismatch EXCLUDES the document instead of
    -- down-ranking it. Off by default so nothing existing changes silently.
    ADD COLUMN IF NOT EXISTS "is_regulated" BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_kd_jurisdiction_{{SCHEMA_NAME}}
    ON "{{SCHEMA_NAME}}"."knowledge_documents" ("jurisdiction")
    WHERE "status" = 'ready';
CREATE INDEX IF NOT EXISTS idx_kd_regulated_{{SCHEMA_NAME}}
    ON "{{SCHEMA_NAME}}"."knowledge_documents" ("is_regulated")
    WHERE "is_regulated" = true AND "status" = 'ready';

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
CREATE INDEX IF NOT EXISTS idx_krl_conversation_created_{{SCHEMA_NAME}} ON "{{SCHEMA_NAME}}"."kb_retrieval_log" ("conversation_id", "created_at" DESC) WHERE "conversation_id" IS NOT NULL;

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
    "contact_id" UUID REFERENCES "{{SCHEMA_NAME}}"."contacts"("id"),
    -- `orders` is defined before `opportunities`; the FK is added in the
    -- native-evidence hardening block after every referenced table exists.
    "opportunity_id" UUID,
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
ALTER TABLE "{{SCHEMA_NAME}}"."orders" ALTER COLUMN "contact_id" DROP NOT NULL;
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
    "channel_type" VARCHAR(50),
    "channel_account_id" VARCHAR(255),
    "channel_account_label" VARCHAR(255),
    "attribution_source" VARCHAR(32) NOT NULL DEFAULT 'unattributed',
    "data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
ALTER TABLE "{{SCHEMA_NAME}}"."analytics_events" ADD COLUMN IF NOT EXISTS "channel_type" VARCHAR(50);
ALTER TABLE "{{SCHEMA_NAME}}"."analytics_events" ADD COLUMN IF NOT EXISTS "channel_account_id" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."analytics_events" ADD COLUMN IF NOT EXISTS "channel_account_label" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."analytics_events" ADD COLUMN IF NOT EXISTS "attribution_source" VARCHAR(32) NOT NULL DEFAULT 'unattributed';
CREATE INDEX IF NOT EXISTS "idx_analytics_events_event_type_created_at" ON "{{SCHEMA_NAME}}"."analytics_events" ("event_type", "created_at");
CREATE INDEX IF NOT EXISTS "idx_analytics_events_conversation_id" ON "{{SCHEMA_NAME}}"."analytics_events" ("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_analytics_events_channel_account_created_at" ON "{{SCHEMA_NAME}}"."analytics_events" ("channel_type", "channel_account_id", "created_at" DESC);

-- ---- Granular provider/resource ownership bindings (P31) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."integration_resource_bindings" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "connection_id" VARCHAR(255) NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" VARCHAR(255) NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "scope_type" VARCHAR(64),
    "scope_id" VARCHAR(255),
    "state" VARCHAR(24) NOT NULL DEFAULT 'active' CHECK ("state" IN ('active', 'conflict', 'tombstoned')),
    "generation" INTEGER NOT NULL DEFAULT 1 CHECK ("generation" > 0),
    "conflict_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "tombstoned_at" TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_integration_resource_binding_local_active"
    ON "{{SCHEMA_NAME}}"."integration_resource_bindings"
    ("provider", "connection_id", "resource_type", "resource_id")
    WHERE "state" <> 'tombstoned';
CREATE INDEX IF NOT EXISTS "idx_integration_resource_binding_external"
    ON "{{SCHEMA_NAME}}"."integration_resource_bindings"
    ("provider", "connection_id", "resource_type", "external_id")
    WHERE "state" <> 'tombstoned';
CREATE INDEX IF NOT EXISTS "idx_integration_resource_binding_state"
    ON "{{SCHEMA_NAME}}"."integration_resource_bindings" ("state", "updated_at" DESC);

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
    "stage"               VARCHAR(50) DEFAULT 'nuevo',   -- canonical stage slugs include listo_para_cierre (listo_cierre is read-only legacy input)
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
    "policy_id"       UUID,
    "policy_type"     VARCHAR(50),
    "policy_version"  INTEGER,
    "consent_scope"   VARCHAR(80),
    "conversation_id" UUID,
    "execution_ledger_id" UUID,
    "capture_mode"    VARCHAR(50),
    "ip_address"      VARCHAR(45),
    "user_agent"      TEXT,
    "origin_url"      TEXT,
    "created_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_consent_records_lead_id" ON "{{SCHEMA_NAME}}"."consent_records" ("lead_id");
ALTER TABLE "{{SCHEMA_NAME}}"."consent_records" ADD COLUMN IF NOT EXISTS "policy_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."consent_records" ADD COLUMN IF NOT EXISTS "policy_type" VARCHAR(50);
ALTER TABLE "{{SCHEMA_NAME}}"."consent_records" ADD COLUMN IF NOT EXISTS "policy_version" INTEGER;
ALTER TABLE "{{SCHEMA_NAME}}"."consent_records" ADD COLUMN IF NOT EXISTS "consent_scope" VARCHAR(80);
ALTER TABLE "{{SCHEMA_NAME}}"."consent_records" ADD COLUMN IF NOT EXISTS "conversation_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."consent_records" ADD COLUMN IF NOT EXISTS "execution_ledger_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."consent_records" ADD COLUMN IF NOT EXISTS "capture_mode" VARCHAR(50);
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_consent_execution_ledger" ON "{{SCHEMA_NAME}}"."consent_records" ("execution_ledger_id") WHERE "execution_ledger_id" IS NOT NULL;

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

-- ---- Pipelines (multi-pipeline ownership) ----
-- Created in the canonical template so fresh tenants never depend on lazy DDL
-- from a request path. Legacy schemas are repaired by PipelineService/startup.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."pipelines" (
    "id"          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id"   UUID NOT NULL,
    "name"        VARCHAR(255) NOT NULL,
    "description" TEXT,
    "is_default"  BOOLEAN DEFAULT false,
    "is_active"   BOOLEAN DEFAULT true,
    "created_at"  TIMESTAMPTZ DEFAULT NOW(),
    "updated_at"  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_pipelines_tenant" ON "{{SCHEMA_NAME}}"."pipelines" ("tenant_id", "is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_pipelines_default_per_tenant"
    ON "{{SCHEMA_NAME}}"."pipelines" ("tenant_id") WHERE "is_default" = true;

-- ---- Pipeline Stages (configurable per tenant) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."pipeline_stages" (
    "id"                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id"           UUID NOT NULL,
    "pipeline_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."pipelines"("id") ON DELETE RESTRICT,
    "name"                VARCHAR(100) NOT NULL,
    "slug"                VARCHAR(100),
    "color"               VARCHAR(20) DEFAULT '#3498db',
    "position"            INTEGER NOT NULL DEFAULT 0,
    "default_probability" INTEGER DEFAULT 0,
    "sla_hours"           INTEGER,
    "is_terminal"         BOOLEAN DEFAULT false,
    "terminal_outcome"    VARCHAR(10),
    "transition_rules"    JSONB DEFAULT '[]'::jsonb,
    "created_at"          TIMESTAMP DEFAULT NOW(),
    CONSTRAINT "pipeline_stages_terminal_outcome_check" CHECK (
        (COALESCE("is_terminal", false) = false AND "terminal_outcome" IS NULL)
        OR ("is_terminal" = true AND "terminal_outcome" IN ('won', 'lost'))
    )
);
CREATE INDEX IF NOT EXISTS "idx_pipeline_stages_tenant_id" ON "{{SCHEMA_NAME}}"."pipeline_stages" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_pipeline_stages_position" ON "{{SCHEMA_NAME}}"."pipeline_stages" ("position");
ALTER TABLE "{{SCHEMA_NAME}}"."pipeline_stages" ADD COLUMN IF NOT EXISTS "terminal_outcome" VARCHAR(10);
UPDATE "{{SCHEMA_NAME}}"."pipeline_stages"
SET "terminal_outcome" = NULL
WHERE COALESCE("is_terminal", false) = false AND "terminal_outcome" IS NOT NULL;
-- Backfill únicamente para slugs cuya semántica es canónica y, por tanto,
-- inequívoca. Una etapa terminal personalizada antigua sin outcome queda en
-- NULL y se bloquea para revisión explícita: la probabilidad es una métrica de
-- forecast, no evidencia suficiente para inventar un resultado de negocio.
UPDATE "{{SCHEMA_NAME}}"."pipeline_stages"
SET "terminal_outcome" = CASE
    WHEN "slug" IN (
        'ganado', 'cerrado', 'cerrado_ganado', 'completado', 'completada',
        'entregado', 'entregada', 'alta', 'vip', 'aprobado', 'poliza_emitida'
    ) THEN 'won'
    WHEN "slug" IN (
        'perdido', 'no_interesado', 'cerrado_perdido', 'cancelado', 'declinado',
        'desercion', 'devolucion', 'no_show', 'rechazado', 'inactivo'
    ) THEN 'lost'
END
WHERE "is_terminal" = true
  AND "terminal_outcome" IS NULL
  AND "slug" IN (
      'ganado', 'cerrado', 'cerrado_ganado', 'completado', 'completada',
      'entregado', 'entregada', 'alta', 'vip', 'aprobado', 'poliza_emitida',
      'perdido', 'no_interesado', 'cerrado_perdido', 'cancelado', 'declinado',
      'desercion', 'devolucion', 'no_show', 'rechazado', 'inactivo'
  );
ALTER TABLE "{{SCHEMA_NAME}}"."pipeline_stages" DROP CONSTRAINT IF EXISTS "pipeline_stages_terminal_outcome_check";
ALTER TABLE "{{SCHEMA_NAME}}"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_terminal_outcome_check" CHECK (
    (COALESCE("is_terminal", false) = false AND "terminal_outcome" IS NULL)
    OR ("is_terminal" = true AND "terminal_outcome" IN ('won', 'lost'))
) NOT VALID;
UPDATE "{{SCHEMA_NAME}}"."opportunities" o
SET "won_at" = COALESCE(o."won_at", o."updated_at", o."created_at", NOW()),
    "lost_at" = NULL
FROM "{{SCHEMA_NAME}}"."pipeline_stages" ps
WHERE o."stage" = ps."slug" AND ps."terminal_outcome" = 'won' AND o."won_at" IS NULL;
UPDATE "{{SCHEMA_NAME}}"."opportunities" o
SET "lost_at" = COALESCE(o."lost_at", o."updated_at", o."created_at", NOW()),
    "won_at" = NULL
FROM "{{SCHEMA_NAME}}"."pipeline_stages" ps
WHERE o."stage" = ps."slug" AND ps."terminal_outcome" = 'lost' AND o."lost_at" IS NULL;

-- ---- Deals (sales pipeline tracking) ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."deals" (
    "id"                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id"          UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id"),
    "title"               VARCHAR(255) NOT NULL,
    "value"               DECIMAL(14,2) DEFAULT 0,
    "currency"            VARCHAR(10) DEFAULT 'COP',
    "pipeline_id"         UUID REFERENCES "{{SCHEMA_NAME}}"."pipelines"("id") ON DELETE RESTRICT,
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

-- Exact, durable Opportunity -> Deal ownership. Contact identity is not a safe
-- correlation key because one contact can have multiple concurrent opportunities.
ALTER TABLE "{{SCHEMA_NAME}}"."opportunities"
    ADD COLUMN IF NOT EXISTS "deal_id" UUID REFERENCES "{{SCHEMA_NAME}}"."deals"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_opportunities_deal_id" ON "{{SCHEMA_NAME}}"."opportunities" ("deal_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_opportunities_deal_id"
    ON "{{SCHEMA_NAME}}"."opportunities" ("deal_id")
    WHERE "deal_id" IS NOT NULL;

-- Keep the B2B Deal mirror aligned with the canonical stage outcome. This is
-- deliberately slug-independent so every vertical and language behaves alike.
UPDATE "{{SCHEMA_NAME}}"."deals" d
SET "status" = CASE
        WHEN ps."terminal_outcome" = 'won' THEN 'won'
        WHEN ps."terminal_outcome" = 'lost' THEN 'lost'
        ELSE 'open'
    END,
    "updated_at" = NOW()
FROM "{{SCHEMA_NAME}}"."pipeline_stages" ps
WHERE d."stage_id" = ps."id"
  AND (COALESCE(ps."is_terminal", false) = false OR ps."terminal_outcome" IN ('won', 'lost'))
  AND d."status" IS DISTINCT FROM CASE
        WHEN ps."terminal_outcome" = 'won' THEN 'won'
        WHEN ps."terminal_outcome" = 'lost' THEN 'lost'
        ELSE 'open'
    END;

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
    "microsoft_home_account_id" VARCHAR(512),
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
ALTER TABLE "{{SCHEMA_NAME}}"."calendar_integrations" ADD COLUMN IF NOT EXISTS "microsoft_home_account_id" VARCHAR(512);

-- Non-unique index for lookups
CREATE INDEX IF NOT EXISTS "ci_user_provider_idx" ON "{{SCHEMA_NAME}}"."calendar_integrations" ("user_id", "provider");
CREATE INDEX IF NOT EXISTS "ci_assignment_idx" ON "{{SCHEMA_NAME}}"."calendar_integrations" ("assignment_type", "assignment_id") WHERE "is_active" = true;

-- ---- Appointments ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."appointments" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE SET NULL,
    "opportunity_id" UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE RESTRICT,
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
-- Public booking retries must converge even after the first request committed but
-- its HTTP response was lost. Cancelled rows leave the index so an intentional
-- rebooking of the same request can create a new active appointment.
CREATE UNIQUE INDEX IF NOT EXISTS "appt_public_booking_idempotency_idx"
    ON "{{SCHEMA_NAME}}"."appointments" (("metadata"->>'publicBookingIdempotencyKey'))
    WHERE "source" = 'public_booking'
      AND "status" <> 'cancelled'
      AND "metadata"->>'publicBookingIdempotencyKey' IS NOT NULL;
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
    "date_range_semantics" SMALLINT NOT NULL DEFAULT 2,
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
    "opportunity_id" UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE RESTRICT,
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
-- Preserve historical rows for explicit reconciliation while enforcing sane
-- capacity on every new/updated departure. NOT VALID avoids turning a legacy
-- over-restored row into a destructive deploy migration.
DO $tour_inventory_capacity_constraint$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint constraint_ref
          JOIN pg_class table_ref ON table_ref.oid = constraint_ref.conrelid
          JOIN pg_namespace schema_ref ON schema_ref.oid = table_ref.relnamespace
         WHERE schema_ref.nspname = '{{SCHEMA_NAME}}'
           AND table_ref.relname = 'tour_inventory'
           AND constraint_ref.conname = 'tour_inventory_capacity_check'
           AND constraint_ref.contype = 'c'
    ) THEN
        ALTER TABLE "{{SCHEMA_NAME}}"."tour_inventory"
            ADD CONSTRAINT "tour_inventory_capacity_check" CHECK (
                "total_seats" >= 0
                AND "available_seats" >= 0
                AND "available_seats" <= "total_seats"
            ) NOT VALID;
    END IF;
END
$tour_inventory_capacity_constraint$;

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."tour_bookings" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "package_id" UUID NOT NULL,
    "inventory_id" UUID,
    "contact_id" UUID,
    "opportunity_id" UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE RESTRICT,
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
DO $tour_booking_party_constraint$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint constraint_ref
          JOIN pg_class table_ref ON table_ref.oid = constraint_ref.conrelid
          JOIN pg_namespace schema_ref ON schema_ref.oid = table_ref.relnamespace
         WHERE schema_ref.nspname = '{{SCHEMA_NAME}}'
           AND table_ref.relname = 'tour_bookings'
           AND constraint_ref.conname = 'tour_bookings_party_composition_check'
           AND constraint_ref.contype = 'c'
    ) THEN
        ALTER TABLE "{{SCHEMA_NAME}}"."tour_bookings"
            ADD CONSTRAINT "tour_bookings_party_composition_check" CHECK (
                "party_size" > 0
                AND "adults" >= 0
                AND COALESCE("children", 0) >= 0
                AND "adults" + COALESCE("children", 0) = "party_size"
            ) NOT VALID;
    END IF;
END
$tour_booking_party_constraint$;

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
    "opportunity_id" UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE RESTRICT,
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
    "opportunity_id" UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE RESTRICT,
    "conversation_id" UUID,
    "service_id" UUID CONSTRAINT "service_requests_service_id_fk"
        REFERENCES "{{SCHEMA_NAME}}"."services"("id") ON DELETE RESTRICT,
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
-- Legacy tenant schemas predate the catalogue-backed capacity contract. Keep
-- every historical request, but detach references to catalogue rows that were
-- already hard-deleted before this FK existed. `service_type` remains the
-- capacity fallback, while metadata preserves the original UUID for audit.
ALTER TABLE "{{SCHEMA_NAME}}"."service_requests" ADD COLUMN IF NOT EXISTS "service_id" UUID;
UPDATE "{{SCHEMA_NAME}}"."service_requests" AS sr
   SET "metadata" = COALESCE(sr."metadata", '{}'::jsonb)
                    || jsonb_build_object('legacyDeletedServiceId', sr."service_id"::text),
       "service_id" = NULL,
       "updated_at" = NOW()
 WHERE sr."service_id" IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
         FROM "{{SCHEMA_NAME}}"."services" AS s
        WHERE s."id" = sr."service_id"
   );
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
         WHERE n.nspname = '{{SCHEMA_NAME}}'
           AND r.relname = 'service_requests'
           AND c.conname = 'service_requests_service_id_fk'
    ) THEN
        ALTER TABLE "{{SCHEMA_NAME}}"."service_requests"
            ADD CONSTRAINT "service_requests_service_id_fk"
            FOREIGN KEY ("service_id")
            REFERENCES "{{SCHEMA_NAME}}"."services"("id")
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;
ALTER TABLE "{{SCHEMA_NAME}}"."service_requests"
    VALIDATE CONSTRAINT "service_requests_service_id_fk";
CREATE INDEX IF NOT EXISTS "idx_service_requests_status" ON "{{SCHEMA_NAME}}"."service_requests" ("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "idx_service_requests_contact" ON "{{SCHEMA_NAME}}"."service_requests" ("contact_id", "created_at" DESC) WHERE "contact_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_service_requests_urgency" ON "{{SCHEMA_NAME}}"."service_requests" ("urgency", "scheduled_at") WHERE "status" IN ('pending', 'scheduled', 'dispatched');
CREATE INDEX IF NOT EXISTS "idx_service_requests_capacity" ON "{{SCHEMA_NAME}}"."service_requests" ("service_id", "scheduled_at") WHERE "status" IN ('scheduled', 'dispatched', 'in_progress');

-- ─── Photography vertical ───────────────────────────────────────────
-- Photo sessions: differentiates fotografia tenants from generic appointments
-- by adding session-type, package, and gallery delivery tracking.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."photo_sessions" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID,
    "opportunity_id" UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE RESTRICT,
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
    "status" VARCHAR(30) DEFAULT 'scheduled',               -- requested | scheduled | in_progress | delivered | cancelled
    "hold_expires_at" TIMESTAMPTZ,                           -- requested quote owns date only while this clock is alive
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

-- ---- Automotive workshop — customer vehicles & repair orders ---------
-- Workshop vehicles belong to a customer and must not be mixed with the
-- dealership/rental inventory above. A repair order is also not an
-- appointment, estimate or CRM opportunity: it keeps its own lifecycle and
-- links those records only when they actually exist.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."customer_vehicles" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "contact_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE RESTRICT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INT,
    "vin" TEXT,
    "license_plate" TEXT,
    "color" TEXT,
    "mileage_km" INT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "customer_vehicles_year_check" CHECK ("year" IS NULL OR "year" BETWEEN 1886 AND 2200),
    CONSTRAINT "customer_vehicles_mileage_check" CHECK ("mileage_km" IS NULL OR "mileage_km" >= 0),
    CONSTRAINT "customer_vehicles_identity_check" CHECK (
        NULLIF(BTRIM(COALESCE("vin", '')), '') IS NOT NULL
        OR NULLIF(BTRIM(COALESCE("license_plate", '')), '') IS NOT NULL
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_vehicles_contact_vin"
    ON "{{SCHEMA_NAME}}"."customer_vehicles" ("contact_id", LOWER("vin"))
    WHERE "vin" IS NOT NULL AND BTRIM("vin") <> '';
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_vehicles_contact_plate"
    ON "{{SCHEMA_NAME}}"."customer_vehicles" ("contact_id", LOWER("license_plate"))
    WHERE "license_plate" IS NOT NULL AND BTRIM("license_plate") <> '';
CREATE INDEX IF NOT EXISTS "idx_customer_vehicles_contact"
    ON "{{SCHEMA_NAME}}"."customer_vehicles" ("contact_id", "updated_at" DESC);

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."repair_orders" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "contact_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE RESTRICT,
    "vehicle_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."customer_vehicles"("id") ON DELETE RESTRICT,
    "appointment_id" UUID REFERENCES "{{SCHEMA_NAME}}"."appointments"("id") ON DELETE SET NULL,
    "opportunity_id" UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE RESTRICT,
    "conversation_id" UUID REFERENCES "{{SCHEMA_NAME}}"."conversations"("id") ON DELETE SET NULL,
    "customer_concern" TEXT NOT NULL,
    "reported_symptoms" JSONB NOT NULL DEFAULT '[]',
    "inspection" JSONB NOT NULL DEFAULT '{}',
    "diagnosis_summary" TEXT,
    "estimate_line_items" JSONB NOT NULL DEFAULT '[]',
    "estimate_amount_cents" BIGINT,
    "final_line_items" JSONB NOT NULL DEFAULT '[]',
    "final_amount_cents" BIGINT,
    -- Set when the first estimate is published from the tenant's regional
    -- operating currency. A country-specific default here would corrupt a
    -- workshop's first monetary record outside Colombia.
    "currency" VARCHAR(3),
    "approval_status" VARCHAR(30) NOT NULL DEFAULT 'not_requested',
    "status" VARCHAR(30) NOT NULL DEFAULT 'intake',
    "assigned_technician_id" UUID REFERENCES "{{SCHEMA_NAME}}"."staff_members"("id") ON DELETE RESTRICT,
    "promised_at" TIMESTAMPTZ,
    "source_system" VARCHAR(80) NOT NULL DEFAULT 'parallly',
    "external_id" VARCHAR(255),
    "idempotency_key" VARCHAR(255),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "repair_orders_status_check" CHECK ("status" IN (
        'intake', 'estimating', 'awaiting_approval', 'approved',
        'in_progress', 'ready', 'delivered', 'rejected', 'cancelled'
    )),
    CONSTRAINT "repair_orders_approval_status_check" CHECK ("approval_status" IN (
        'not_requested', 'pending', 'approved', 'rejected'
    )),
    CONSTRAINT "repair_orders_amounts_check" CHECK (
        ("estimate_amount_cents" IS NULL OR "estimate_amount_cents" >= 0)
        AND ("final_amount_cents" IS NULL OR "final_amount_cents" >= 0)
    ),
    CONSTRAINT "repair_orders_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "repair_orders_concern_check" CHECK (BTRIM("customer_concern") <> ''),
    CONSTRAINT "repair_orders_version_check" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_repair_orders_idempotency"
    ON "{{SCHEMA_NAME}}"."repair_orders" ("idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_repair_orders_external_source"
    ON "{{SCHEMA_NAME}}"."repair_orders" ("source_system", "external_id")
    WHERE "external_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_repair_orders_status_updated"
    ON "{{SCHEMA_NAME}}"."repair_orders" ("status", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_repair_orders_contact_updated"
    ON "{{SCHEMA_NAME}}"."repair_orders" ("contact_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_repair_orders_vehicle"
    ON "{{SCHEMA_NAME}}"."repair_orders" ("vehicle_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."repair_order_events" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "repair_order_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."repair_orders"("id") ON DELETE CASCADE,
    "event_type" VARCHAR(80) NOT NULL,
    "from_status" VARCHAR(30),
    "to_status" VARCHAR(30),
    "actor_id" UUID,
    "actor_type" VARCHAR(30) NOT NULL DEFAULT 'tenant_user',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_repair_order_events_order_created"
    ON "{{SCHEMA_NAME}}"."repair_order_events" ("repair_order_id", "created_at" DESC);

-- ---- Resource rentals -------------------------------------------------
-- One half-open date-range contract for vertical resources that are not
-- appointments: vehicle hire and pet hotel/day-care capacity.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."resource_rentals" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "rental_type" VARCHAR(30) NOT NULL,
    "resource_id" UUID NOT NULL,
    "service_id" UUID,
    "contact_id" UUID REFERENCES "{{SCHEMA_NAME}}"."contacts"("id") ON DELETE SET NULL,
    "opportunity_id" UUID REFERENCES "{{SCHEMA_NAME}}"."opportunities"("id") ON DELETE RESTRICT,
    "customer_name" VARCHAR(255),
    "customer_phone" VARCHAR(50),
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'reserved',
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "resource_rentals_date_range_check"
        CHECK ("end_date" > "start_date"),
    CONSTRAINT "resource_rentals_type_service_check"
        CHECK (
            ("rental_type" = 'vehicle_rental' AND "service_id" IS NULL)
            OR
            ("rental_type" = 'pet_boarding' AND "service_id" IS NOT NULL)
        ),
    CONSTRAINT "resource_rentals_status_check"
        CHECK (
            ("rental_type" = 'vehicle_rental'
                AND "status" IN ('reserved', 'picked_up', 'returned', 'cancelled'))
            OR
            ("rental_type" = 'pet_boarding'
                AND "status" IN ('reserved', 'checked_in', 'checked_out', 'cancelled'))
        )
);
CREATE INDEX IF NOT EXISTS "idx_resource_rentals_resource_dates"
    ON "{{SCHEMA_NAME}}"."resource_rentals"
    ("rental_type", "resource_id", "start_date", "end_date")
    WHERE "status" IN ('reserved', 'picked_up', 'checked_in');
CREATE INDEX IF NOT EXISTS "idx_resource_rentals_service_dates"
    ON "{{SCHEMA_NAME}}"."resource_rentals"
    ("service_id", "start_date", "end_date")
    WHERE "rental_type" = 'pet_boarding'
      AND "status" IN ('reserved', 'checked_in');
CREATE INDEX IF NOT EXISTS "idx_resource_rentals_status_start"
    ON "{{SCHEMA_NAME}}"."resource_rentals" ("status", "start_date");

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
    "sync_generation" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    UNIQUE(external_id, provider)
);
ALTER TABLE "{{SCHEMA_NAME}}"."cm_listings" ADD COLUMN IF NOT EXISTS "sync_generation" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."cm_listings" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."cm_listings" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
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
    "sync_generation" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    UNIQUE(external_id, provider)
);
ALTER TABLE "{{SCHEMA_NAME}}"."cm_reservations" ADD COLUMN IF NOT EXISTS "sync_generation" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."cm_reservations" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."cm_reservations" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
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
    agent_id UUID,
    agent_config_version INTEGER,
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
ALTER TABLE "{{SCHEMA_NAME}}"."conversation_quality_scores"
    ADD COLUMN IF NOT EXISTS agent_id UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."conversation_quality_scores"
    ADD COLUMN IF NOT EXISTS agent_config_version INTEGER;
CREATE INDEX IF NOT EXISTS idx_cqs_conversation ON "{{SCHEMA_NAME}}"."conversation_quality_scores"(conversation_id);
CREATE INDEX IF NOT EXISTS idx_cqs_created ON "{{SCHEMA_NAME}}"."conversation_quality_scores"(created_at);
CREATE INDEX IF NOT EXISTS idx_cqs_agent_created ON "{{SCHEMA_NAME}}"."conversation_quality_scores"(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cqs_agent_version_conversation_created ON "{{SCHEMA_NAME}}"."conversation_quality_scores"(agent_id, agent_config_version, conversation_id, created_at DESC) WHERE agent_id IS NOT NULL;

-- ---- Durable proactive Agent Quality attention ----
-- Snapshots contain fixed numeric/coded fields only. Signals never persist
-- transcripts, prompts, judge prose, KB queries or conversation identifiers.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."agent_quality_snapshots" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    agent_config_version INTEGER NOT NULL,
    status VARCHAR(40) NOT NULL,
    next_milestone VARCHAR(50) NOT NULL,
    preparation_status VARCHAR(40) NOT NULL,
    preparation_score NUMERIC,
    tested_status VARCHAR(40) NOT NULL,
    tested_score NUMERIC,
    production_status VARCHAR(40) NOT NULL,
    production_score NUMERIC,
    recommendation_count INTEGER NOT NULL DEFAULT 0,
    critical_count INTEGER NOT NULL DEFAULT 0,
    high_count INTEGER NOT NULL DEFAULT 0,
    fingerprint VARCHAR(64) NOT NULL,
    trigger VARCHAR(50) NOT NULL DEFAULT 'manual',
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (agent_id, agent_config_version, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_agent_quality_snapshots_latest
    ON "{{SCHEMA_NAME}}"."agent_quality_snapshots"(agent_id, agent_config_version, calculated_at DESC);

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."agent_quality_signals" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    agent_config_version INTEGER NOT NULL,
    code VARCHAR(120) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    pillar VARCHAR(30) NOT NULL,
    dimension VARCHAR(50) NOT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'open',
    href VARCHAR(300) NOT NULL,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    fingerprint VARCHAR(64) NOT NULL UNIQUE,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID,
    snoozed_until TIMESTAMPTZ,
    snoozed_by UUID,
    resolved_at TIMESTAMPTZ,
    superseded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_quality_signals_attention
    ON "{{SCHEMA_NAME}}"."agent_quality_signals"(state, severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_quality_signals_agent_version
    ON "{{SCHEMA_NAME}}"."agent_quality_signals"(agent_id, agent_config_version, state);

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
    locale TEXT,
    profile_id TEXT,
    contract_version INTEGER,
    seed_origin TEXT,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    criteria TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE "{{SCHEMA_NAME}}"."eval_scenarios" ADD COLUMN IF NOT EXISTS expected_actions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "{{SCHEMA_NAME}}"."eval_scenarios" ADD COLUMN IF NOT EXISTS locale TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."eval_scenarios" ADD COLUMN IF NOT EXISTS profile_id TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."eval_scenarios" ADD COLUMN IF NOT EXISTS contract_version INTEGER;
ALTER TABLE "{{SCHEMA_NAME}}"."eval_scenarios" ADD COLUMN IF NOT EXISTS seed_origin TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."eval_scenarios" ADD COLUMN IF NOT EXISTS managed_seed_key TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."eval_scenarios" ADD COLUMN IF NOT EXISTS seed_state TEXT NOT NULL DEFAULT 'active';
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
    sync_generation UUID,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    UNIQUE(provider, item_type, external_id)
);
ALTER TABLE "{{SCHEMA_NAME}}"."vi_items" ADD COLUMN IF NOT EXISTS sync_generation UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."vi_items" ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."vi_items" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
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
-- El id que devuelve el proveedor al aceptar el mensaje. Lo escribe
-- `broadcast.service.ts` en CADA envío, y sólo existía en la copia perezosa del
-- DDL: para un tenant provisto por el camino canónico —o sea, todos los
-- nuevos—, `CREATE TABLE IF NOT EXISTS` era un no-op, la columna nunca se
-- creaba y el primer envío de campaña fallaba con "column does not exist".
ALTER TABLE "{{SCHEMA_NAME}}"."campaign_recipients" ADD COLUMN IF NOT EXISTS "provider_message_id" VARCHAR(255);
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_documents" ADD COLUMN IF NOT EXISTS "satisfaction_score" DECIMAL(3,2);
ALTER TABLE "{{SCHEMA_NAME}}"."knowledge_documents" ADD COLUMN IF NOT EXISTS "feedback_count" INTEGER DEFAULT 0;
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "was_handed_off" BOOLEAN DEFAULT false;
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "handoff_at" TIMESTAMPTZ;
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "handoff_summary" JSONB;
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "handoff_trace_id" VARCHAR(128);
ALTER TABLE "{{SCHEMA_NAME}}"."conversations" ADD COLUMN IF NOT EXISTS "handoff_summary_generated_at" TIMESTAMPTZ;
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
-- references appointments / service_staff / staff_service_links / deals /
-- stage_transitions and the pipeline_id column added above, all of which must
-- already exist.
--
-- Pre-existing duplicates: the pipeline cleanup remaps audit history before
-- removing exact stages and refuses stages used by current deals. The remaining
-- cleanup only removes rows that nothing references, so it cannot cascade away
-- staff assignments or orphan an appointment. When a protected duplicate is
-- referenced it survives and the
-- CREATE UNIQUE INDEX fails for that tenant. That is deliberate and safe:
-- migrate-tenants.js reports SQLSTATE 23505 as a warning and the production
-- workflow aborts promotion until the legacy data is reconciled. Destroying
-- referenced tenant data merely to gain an index would be a far worse trade.

-- ---- pipeline_stages: unique per (pipeline_id, slug) ----
-- NOT keyed on slug alone: pipeline_stages.pipeline_id exists (multi-pipeline,
-- plan-gated via maxPipelines) and a second pipeline legitimately reuses the
-- same slugs ("ganado", "perdido"), which are auto-derived from the stage name.
-- A unique on slug alone would turn that paid flow into an untranslated 23505.
-- NULLS NOT DISTINCT (PG15+) is what makes the index still bite for tenants
-- whose stages have pipeline_id NULL — exactly where the bootstrap writes.
-- stage_transitions intentionally stores historical stage UUIDs as TEXT, so it
-- cannot enforce a foreign key. Lock writers, remap both audit columns to the
-- deterministic keeper, and only then remove exact duplicates in the same
-- transaction/statement. This DO block is atomic even when createTenantSchema
-- executes template statements individually.
DO $pipeline_stage_cleanup$
BEGIN
    LOCK TABLE
        "{{SCHEMA_NAME}}"."pipeline_stages",
        "{{SCHEMA_NAME}}"."deals",
        "{{SCHEMA_NAME}}"."stage_transitions"
        IN SHARE ROW EXCLUSIVE MODE;

    WITH duplicate_stage_map AS (
        SELECT DISTINCT ON (a."id")
               a."id" AS duplicate_id,
               b."id" AS keeper_id
          FROM "{{SCHEMA_NAME}}"."pipeline_stages" a
          JOIN "{{SCHEMA_NAME}}"."pipeline_stages" b
            ON a."slug" IS NOT NULL
           AND a."slug" = b."slug"
           AND a."pipeline_id" IS NOT DISTINCT FROM b."pipeline_id"
           AND a."name" IS NOT DISTINCT FROM b."name"
           AND a."color" IS NOT DISTINCT FROM b."color"
           AND a."position" IS NOT DISTINCT FROM b."position"
           AND a."default_probability" IS NOT DISTINCT FROM b."default_probability"
           AND a."sla_hours" IS NOT DISTINCT FROM b."sla_hours"
           AND a."is_terminal" IS NOT DISTINCT FROM b."is_terminal"
           AND a."terminal_outcome" IS NOT DISTINCT FROM b."terminal_outcome"
           AND COALESCE(a."transition_rules", '[]'::jsonb) = COALESCE(b."transition_rules", '[]'::jsonb)
           AND (COALESCE(a."created_at", 'epoch'::timestamp), a."id")
               > (COALESCE(b."created_at", 'epoch'::timestamp), b."id")
         WHERE NOT EXISTS (
               SELECT 1
                 FROM "{{SCHEMA_NAME}}"."deals" d
                WHERE d."stage_id" = a."id"
         )
         ORDER BY a."id", COALESCE(b."created_at", 'epoch'::timestamp), b."id"
    )
    UPDATE "{{SCHEMA_NAME}}"."stage_transitions" history
       SET "from_stage" = COALESCE(
               (SELECT map.keeper_id::text
                  FROM duplicate_stage_map map
                 WHERE LOWER(history."from_stage") = map.duplicate_id::text),
               history."from_stage"
           ),
           "to_stage" = COALESCE(
               (SELECT map.keeper_id::text
                  FROM duplicate_stage_map map
                 WHERE LOWER(history."to_stage") = map.duplicate_id::text),
               history."to_stage"
           )
     WHERE EXISTS (
           SELECT 1
             FROM duplicate_stage_map map
            WHERE LOWER(history."from_stage") = map.duplicate_id::text
               OR LOWER(history."to_stage") = map.duplicate_id::text
     );

    DELETE FROM "{{SCHEMA_NAME}}"."pipeline_stages" a
    USING "{{SCHEMA_NAME}}"."pipeline_stages" b
    WHERE a."slug" IS NOT NULL
      AND a."slug" = b."slug"
      AND a."pipeline_id" IS NOT DISTINCT FROM b."pipeline_id"
      AND a."name" IS NOT DISTINCT FROM b."name"
      AND a."color" IS NOT DISTINCT FROM b."color"
      AND a."position" IS NOT DISTINCT FROM b."position"
      AND a."default_probability" IS NOT DISTINCT FROM b."default_probability"
      AND a."sla_hours" IS NOT DISTINCT FROM b."sla_hours"
      AND a."is_terminal" IS NOT DISTINCT FROM b."is_terminal"
      AND a."terminal_outcome" IS NOT DISTINCT FROM b."terminal_outcome"
      AND COALESCE(a."transition_rules", '[]'::jsonb) = COALESCE(b."transition_rules", '[]'::jsonb)
      AND (COALESCE(a."created_at", 'epoch'::timestamp), a."id") > (COALESCE(b."created_at", 'epoch'::timestamp), b."id")
      AND NOT EXISTS (SELECT 1 FROM "{{SCHEMA_NAME}}"."deals" d WHERE d."stage_id" = a."id");
END
$pipeline_stage_cleanup$;
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_pipeline_stages_pipeline_slug" ON "{{SCHEMA_NAME}}"."pipeline_stages" ("pipeline_id", "slug") NULLS NOT DISTINCT;

-- ---- services: unique per name ----
-- The booking engine reads services back to the customer as a plain numbered
-- list, so two rows with the same name are indistinguishable to them anyway.
DELETE FROM "{{SCHEMA_NAME}}"."services" a
USING "{{SCHEMA_NAME}}"."services" b
WHERE a."name" = b."name"
  AND a."description" IS NOT DISTINCT FROM b."description"
  AND a."duration_minutes" IS NOT DISTINCT FROM b."duration_minutes"
  AND a."buffer_minutes" IS NOT DISTINCT FROM b."buffer_minutes"
  AND a."price" IS NOT DISTINCT FROM b."price"
  AND a."currency" IS NOT DISTINCT FROM b."currency"
  AND a."color" IS NOT DISTINCT FROM b."color"
  AND a."is_active" IS NOT DISTINCT FROM b."is_active"
  AND a."sort_order" IS NOT DISTINCT FROM b."sort_order"
  AND COALESCE(a."metadata", '{}'::jsonb) = COALESCE(b."metadata", '{}'::jsonb)
  AND a."category" IS NOT DISTINCT FROM b."category"
  AND a."location_type" IS NOT DISTINCT FROM b."location_type"
  AND a."max_concurrent" IS NOT DISTINCT FROM b."max_concurrent"
  AND COALESCE(a."required_fields", '[]'::jsonb) = COALESCE(b."required_fields", '[]'::jsonb)
  AND a."is_public" IS NOT DISTINCT FROM b."is_public"
  AND a."meeting_link" IS NOT DISTINCT FROM b."meeting_link"
  AND a."location_address" IS NOT DISTINCT FROM b."location_address"
  AND a."duration_type" IS NOT DISTINCT FROM b."duration_type"
  AND a."duration_minutes_max" IS NOT DISTINCT FROM b."duration_minutes_max"
  AND a."rebook_after_days" IS NOT DISTINCT FROM b."rebook_after_days"
  AND (COALESCE(a."created_at", 'epoch'::timestamp), a."id") > (COALESCE(b."created_at", 'epoch'::timestamp), b."id")
  AND NOT EXISTS (SELECT 1 FROM "{{SCHEMA_NAME}}"."appointments" ap WHERE ap."service_id" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "{{SCHEMA_NAME}}"."service_staff" ss WHERE ss."service_id" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "{{SCHEMA_NAME}}"."staff_service_links" sl WHERE sl."service_id" = a."id");
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_services_name" ON "{{SCHEMA_NAME}}"."services" ("name");

-- ---- faqs: unique per question ----
-- No table references FAQs, but repeated text alone does not prove the newer
-- answer/tags are disposable. Only semantically exact rows are removed;
-- divergent rows deliberately make the unique index fail for manual review.
DELETE FROM "{{SCHEMA_NAME}}"."faqs" a
USING "{{SCHEMA_NAME}}"."faqs" b
WHERE a."question" = b."question"
  AND a."answer" IS NOT DISTINCT FROM b."answer"
  AND a."category" IS NOT DISTINCT FROM b."category"
  AND a."tags" IS NOT DISTINCT FROM b."tags"
  AND a."order_index" IS NOT DISTINCT FROM b."order_index"
  AND a."is_published" IS NOT DISTINCT FROM b."is_published"
  AND a."views" IS NOT DISTINCT FROM b."views"
  AND a."search_tsv" IS NOT DISTINCT FROM b."search_tsv"
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

-- Version 1 stores check_out as the final occupied day (legacy/imported rows
-- and the dashboard's inclusive manual range picker). Synced iCal rows use
-- version 2 and retain DTEND as the exclusive checkout date. Keeping the
-- version avoids freeing one occupied night while old feeds are refreshed.
ALTER TABLE "{{SCHEMA_NAME}}"."ical_blocks"
    ADD COLUMN IF NOT EXISTS "date_range_semantics" SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE "{{SCHEMA_NAME}}"."ical_blocks"
    ALTER COLUMN "date_range_semantics" SET DEFAULT 2;

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

-- =====================================================================
-- Vertical operating decisions v1 (Aug 2026)
-- =====================================================================
-- These structures make money lineage, resource ownership, external-calendar
-- reconciliation and future vertical migration explicit. Vertical migration
-- remains preview-only until a versioned mapping adapter is registered.

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."money_lineage" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "object_type" VARCHAR(64) NOT NULL,
    "object_id" VARCHAR(200) NOT NULL,
    "line_id" VARCHAR(200),
    "source_amount_minor" NUMERIC(30,0) NOT NULL,
    "source_currency" VARCHAR(3) NOT NULL CHECK ("source_currency" ~ '^[A-Z]{3}$'),
    "operating_amount_minor" NUMERIC(30,0) NOT NULL,
    "operating_currency" VARCHAR(3) NOT NULL CHECK ("operating_currency" ~ '^[A-Z]{3}$'),
    "source_system" VARCHAR(128) NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL UNIQUE,
    "fx_snapshot" JSONB,
    "payload_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (("source_currency" = "operating_currency" AND "fx_snapshot" IS NULL)
        OR ("source_currency" <> "operating_currency" AND "fx_snapshot" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "idx_money_lineage_object" ON "{{SCHEMA_NAME}}"."money_lineage" ("object_type", "object_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_money_lineage_operating" ON "{{SCHEMA_NAME}}"."money_lineage" ("operating_currency", "created_at");

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."operational_locations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."operational_resources" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "location_id" UUID REFERENCES "{{SCHEMA_NAME}}"."operational_locations"("id") ON DELETE SET NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "capacity" INTEGER NOT NULL CHECK ("capacity" BETWEEN 1 AND 1000000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."staff_operational_bindings" (
    "staff_id" UUID PRIMARY KEY REFERENCES "{{SCHEMA_NAME}}"."staff_members"("id") ON DELETE CASCADE,
    "user_id" UUID REFERENCES public."users"("id") ON DELETE SET NULL,
    "location_id" UUID REFERENCES "{{SCHEMA_NAME}}"."operational_locations"("id") ON DELETE SET NULL,
    "calendar_integration_id" UUID REFERENCES "{{SCHEMA_NAME}}"."calendar_integrations"("id") ON DELETE SET NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_staff_operational_user" ON "{{SCHEMA_NAME}}"."staff_operational_bindings" ("user_id") WHERE "user_id" IS NOT NULL;
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."staff_resource_assignments" (
    "staff_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."staff_members"("id") ON DELETE CASCADE,
    "resource_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."operational_resources"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("staff_id", "resource_id")
);

-- The provider event's owning account is durable evidence. Disconnecting an
-- integration deactivates it; deleting it is rejected while appointments or
-- outbox work still reference it, so reconciliation can never fall back to a
-- different account implicitly.
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "calendar_integration_id" UUID REFERENCES "{{SCHEMA_NAME}}"."calendar_integrations"("id") ON DELETE RESTRICT;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "calendar_owner_id" UUID REFERENCES public."users"("id") ON DELETE SET NULL;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "calendar_provider" VARCHAR(20);
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "calendar_event_id" TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "calendar_sync_state" VARCHAR(24) NOT NULL DEFAULT 'not_configured';
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "calendar_sync_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "calendar_sync_error" TEXT;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "calendar_synced_at" TIMESTAMPTZ;
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" DROP CONSTRAINT IF EXISTS "appointments_calendar_provider_chk";
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD CONSTRAINT "appointments_calendar_provider_chk" CHECK ("calendar_provider" IS NULL OR "calendar_provider" IN ('google', 'microsoft'));
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" DROP CONSTRAINT IF EXISTS "appointments_calendar_sync_state_chk";
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD CONSTRAINT "appointments_calendar_sync_state_chk" CHECK ("calendar_sync_state" IN ('not_configured', 'pending', 'processing', 'synced', 'failed', 'reconciliation_required', 'deleted'));
CREATE INDEX IF NOT EXISTS "idx_appointments_calendar_owner" ON "{{SCHEMA_NAME}}"."appointments" ("calendar_integration_id", "calendar_sync_state");

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."calendar_sync_outbox" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."appointments"("id") ON DELETE CASCADE,
    "operation" VARCHAR(16) NOT NULL CHECK ("operation" IN ('upsert', 'delete')),
    "revision" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(240) NOT NULL UNIQUE,
    "integration_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."calendar_integrations"("id"),
    "provider" VARCHAR(20) NOT NULL CHECK ("provider" IN ('google', 'microsoft')),
    "payload" JSONB NOT NULL,
    "provider_event_id" TEXT,
    "state" VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'processing', 'failed', 'completed', 'superseded', 'reconciliation_required')),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE ("appointment_id", "revision", "operation")
);
ALTER TABLE "{{SCHEMA_NAME}}"."calendar_sync_outbox" ALTER COLUMN "state" TYPE VARCHAR(32);
ALTER TABLE "{{SCHEMA_NAME}}"."calendar_sync_outbox" DROP CONSTRAINT IF EXISTS "calendar_sync_outbox_state_check";
ALTER TABLE "{{SCHEMA_NAME}}"."calendar_sync_outbox" ADD CONSTRAINT "calendar_sync_outbox_state_check" CHECK ("state" IN ('pending', 'processing', 'failed', 'completed', 'superseded', 'reconciliation_required'));
CREATE INDEX IF NOT EXISTS "idx_calendar_sync_outbox_due" ON "{{SCHEMA_NAME}}"."calendar_sync_outbox" ("state", "next_attempt_at", "created_at") WHERE "state" IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS "idx_calendar_sync_outbox_appointment" ON "{{SCHEMA_NAME}}"."calendar_sync_outbox" ("appointment_id", "revision");

CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."vertical_migrations" (
    "id" UUID PRIMARY KEY,
    "status" VARCHAR(24) NOT NULL CHECK ("status" IN ('preview', 'approved', 'applying', 'applied', 'rolled_back', 'failed')),
    "from_industry" VARCHAR(100) NOT NULL,
    "from_subtype" VARCHAR(100),
    "to_industry" VARCHAR(100) NOT NULL,
    "to_subtype" VARCHAR(100),
    "preview_hash" CHAR(64) NOT NULL,
    "preview_payload" JSONB NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "applied_by" UUID,
    "rolled_back_by" UUID,
    "archive_id" UUID,
    "inserted_rows" JSONB NOT NULL DEFAULT '{"pipelineStages":[],"faqs":[],"services":[]}'::jsonb,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "approved_at" TIMESTAMPTZ,
    "applied_at" TIMESTAMPTZ,
    "rolled_back_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."vertical_migration_archives" (
    "id" UUID PRIMARY KEY,
    "migration_id" UUID NOT NULL UNIQUE REFERENCES "{{SCHEMA_NAME}}"."vertical_migrations"("id") ON DELETE RESTRICT,
    "snapshot" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE "{{SCHEMA_NAME}}"."vertical_migrations" DROP CONSTRAINT IF EXISTS "vertical_migrations_archive_fk";
ALTER TABLE "{{SCHEMA_NAME}}"."vertical_migrations" ADD CONSTRAINT "vertical_migrations_archive_fk" FOREIGN KEY ("archive_id") REFERENCES "{{SCHEMA_NAME}}"."vertical_migration_archives"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "idx_vertical_migrations_status" ON "{{SCHEMA_NAME}}"."vertical_migrations" ("status", "expires_at");
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."vertical_migration_outbox" (
    "id" UUID PRIMARY KEY,
    "migration_id" UUID NOT NULL REFERENCES "{{SCHEMA_NAME}}"."vertical_migrations"("id") ON DELETE CASCADE,
    "event_type" VARCHAR(100) NOT NULL,
    "idempotency_key" VARCHAR(240) NOT NULL UNIQUE,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'published', 'failed')),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "last_error" TEXT,
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_vertical_migration_outbox_due" ON "{{SCHEMA_NAME}}"."vertical_migration_outbox" ("status", "next_attempt_at") WHERE "status" IN ('pending', 'failed');

-- Native operational evidence belongs to an exact CRM opportunity. Existing
-- rows intentionally remain NULL and continue through the conservative legacy
-- evaluator; contact-only data is never bulk-attributed to an opportunity.
ALTER TABLE "{{SCHEMA_NAME}}"."appointments" ADD COLUMN IF NOT EXISTS "opportunity_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."tour_bookings" ADD COLUMN IF NOT EXISTS "opportunity_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."property_bookings" ADD COLUMN IF NOT EXISTS "opportunity_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."service_requests" ADD COLUMN IF NOT EXISTS "opportunity_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."service_requests" ADD COLUMN IF NOT EXISTS "service_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."food_orders" ADD COLUMN IF NOT EXISTS "opportunity_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."photo_sessions" ADD COLUMN IF NOT EXISTS "opportunity_id" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."resource_rentals" ADD COLUMN IF NOT EXISTS "opportunity_id" UUID;

-- A property stay is a payable purchase like a tour or a restaurant order, but
-- property_bookings never carried the column the tenant-owned payment resolver
-- reads, so a vacation-rental tenant could charge for a tour and NOT for a
-- stay — the core sale of the whole vertical. Strictly additive with the same
-- default every other payable table uses.
ALTER TABLE "{{SCHEMA_NAME}}"."property_bookings"
    ADD COLUMN IF NOT EXISTS "payment_status" VARCHAR(20) DEFAULT 'pending';
ALTER TABLE "{{SCHEMA_NAME}}"."orders" ADD COLUMN IF NOT EXISTS "opportunity_id" UUID;

-- =====================================================================
-- Política de confirmación por ítem vendible
-- =====================================================================
-- El dueño decide, POR PRODUCTO O SERVICIO, si confirmarlo exige pago. Sin
-- esto el agente confirmaba todo al instante y recién después salía a buscar el
-- enlace de pago — le decía al huésped "tu reserva quedó confirmada" y después
-- le pedía que pagara, que es exactamente al revés.
--
--   payment_policy:  'none'    — se confirma sin pago (comportamiento actual)
--                    'full'    — exige el total
--                    'deposit' — exige un anticipo
--                    'any'     — el cliente elige entre total y anticipo
--   deposit_percent: 1-100, el anticipo como % del total
--   deposit_amount:  anticipo de monto fijo (gana sobre el porcentaje si están
--                    los dos, para que el dueño pueda fijar "50.000 y listo")
--
-- Sin CHECK a propósito: `ADD CONSTRAINT` no admite IF NOT EXISTS y un deploy
-- que corre dos veces fallaría. La validación vive en la capa de servicio, que
-- además puede explicar el error.
--
-- Estrictamente aditivo y con default 'none': un tenant que no toque nada se
-- comporta igual que antes.
--
-- `amount_due` en la operación es lo que vuelve REAL al anticipo: el resolvedor
-- de cobros del tenant saca el importe de `total_price`, así que sin esta
-- columna un "anticipo del 30%" habría cobrado el 100% — una mentira peor que
-- no ofrecer anticipos. Queda NULL cuando se cobra todo.
ALTER TABLE "{{SCHEMA_NAME}}"."property_bookings"
    ADD COLUMN IF NOT EXISTS "amount_due" DECIMAL(15,2);

-- Una cita es lo que más se vende en la plataforma (salud, belleza, estética) y
-- era la única entidad vendible sin `payment_status`: el resolvedor de cobros
-- del tenant no tenía dónde escribir, así que una cita no se podía cobrar. Con
-- esto y el tipo pagable 'appointment' se puede exigir seña para confirmar.
--
-- OJO con el vocabulario: el default de `appointments.status` es 'pending', que
-- significa "agendada, falta que el negocio la confirme" y SÍ ocupa el turno.
-- 'pending_payment' es otra cosa y no ocupa nada. No se conflacionan.
ALTER TABLE "{{SCHEMA_NAME}}"."appointments"
    ADD COLUMN IF NOT EXISTS "payment_status" VARCHAR(20) DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS "amount_due" DECIMAL(15,2);

-- =====================================================================
-- RETENCIÓN: las fechas quedan guardadas mientras el cliente paga
-- =====================================================================
-- Decisión del dueño (ago 2026), que revierte la anterior de "no bloquea nada
-- hasta el pago": sin retención la promesa no es promesa — el huésped recibe un
-- enlace, paga, y puede encontrarse con que las fechas se fueron mientras
-- pagaba. Ahora se le dice "te las guardo 15 minutos" y se cumple.
--
-- `hold_expires_at` es el reloj de esa promesa. Una operación en
-- 'pending_payment' ocupa cupo SOLO mientras esta fecha esté en el futuro; al
-- vencer deja de ocupar sin que nadie tenga que correr nada. Por eso la
-- caducidad es por tiempo y no por un estado que un cron tenga que escribir: si
-- el cron muere, las fechas se liberan igual.
--
-- NULL = sin retención. Es deliberado y es lo que hace segura la migración: las
-- filas 'pending_payment' que ya existen siguen sin ocupar cupo, exactamente
-- como hasta hoy, porque `NULL > NOW()` no es verdadero.
ALTER TABLE "{{SCHEMA_NAME}}"."property_bookings"
    ADD COLUMN IF NOT EXISTS "hold_expires_at" TIMESTAMPTZ;

ALTER TABLE "{{SCHEMA_NAME}}"."appointments"
    ADD COLUMN IF NOT EXISTS "hold_expires_at" TIMESTAMPTZ;

-- Photography quote requests are real, short-lived date holds. Existing
-- requested rows keep NULL and therefore do not consume capacity after this
-- migration; only requests created by the atomic writer receive a clock.
ALTER TABLE "{{SCHEMA_NAME}}"."photo_sessions"
    ADD COLUMN IF NOT EXISTS "hold_expires_at" TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS "idx_photo_sessions_capacity"
    ON "{{SCHEMA_NAME}}"."photo_sessions" ("scheduled_at", "status", "hold_expires_at");

-- Tours: el cupo funciona AL REVÉS que las fechas.
--
-- El asiento se descuenta de `tour_inventory` al crear la reserva, así que una
-- reserva impaga ya lo tiene tomado desde el minuto cero: no hace falta
-- retenerlo. Lo que hace falta es DEVOLVERLO si nadie paga, y por eso
-- `hold_expires_at` también vive acá — es el reloj que le dice al barrido cuándo
-- soltar el asiento.
ALTER TABLE "{{SCHEMA_NAME}}"."tour_bookings"
    ADD COLUMN IF NOT EXISTS "amount_due" DECIMAL(15,2),
    ADD COLUMN IF NOT EXISTS "hold_expires_at" TIMESTAMPTZ;

-- Venta libre y bajo receta no son el mismo producto.
--
-- El catálogo genérico trata a todo por igual: si está disponible, el agente lo
-- busca, lo cotiza y arma el pedido. En una farmacia eso significa que un
-- medicamento de venta bajo fórmula se puede pedir por WhatsApp sin que ningún
-- farmacéutico vea la receta — y la conversación queda como si el negocio lo
-- hubiera aceptado.
--
-- `false` por defecto es correcto y deliberado: en las otras siete verticales
-- de catálogo NADA requiere receta, y una farmacia ya cargada marca lo suyo
-- desde Inventario. Un default `true` habría apagado el catálogo entero de
-- todos los tenants existentes.
ALTER TABLE "{{SCHEMA_NAME}}"."products"
    ADD COLUMN IF NOT EXISTS "requires_prescription" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "idx_products_requires_prescription"
    ON "{{SCHEMA_NAME}}"."products" ("requires_prescription")
    WHERE "requires_prescription" = true;
DO $payment_policy_columns$
DECLARE
    sellable TEXT;
BEGIN
    FOREACH sellable IN ARRAY ARRAY['properties', 'services', 'tour_packages', 'products', 'courses']
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = '{{SCHEMA_NAME}}' AND table_name = sellable
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I.%I
                    ADD COLUMN IF NOT EXISTS payment_policy VARCHAR(16) DEFAULT ''none'',
                    ADD COLUMN IF NOT EXISTS deposit_percent SMALLINT,
                    ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(15,2)',
                '{{SCHEMA_NAME}}', sellable);
        END IF;
    END LOOP;
END
$payment_policy_columns$;

DO $native_evidence_opportunity_fks$
DECLARE
    evidence_table TEXT;
    fk_name TEXT;
BEGIN
    FOREACH evidence_table IN ARRAY ARRAY[
        'appointments', 'tour_bookings', 'property_bookings', 'service_requests',
        'food_orders', 'photo_sessions', 'resource_rentals', 'orders'
    ] LOOP
        fk_name := evidence_table || '_opportunity_id_fkey';
        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint constraint_ref
              JOIN pg_class table_ref ON table_ref.oid = constraint_ref.conrelid
              JOIN pg_namespace schema_ref ON schema_ref.oid = table_ref.relnamespace
             WHERE schema_ref.nspname = '{{SCHEMA_NAME}}'
               AND table_ref.relname = evidence_table
               AND constraint_ref.conname = fk_name
               AND constraint_ref.contype = 'f'
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (opportunity_id) REFERENCES %I.opportunities(id) ON DELETE RESTRICT NOT VALID',
                '{{SCHEMA_NAME}}', evidence_table, fk_name, '{{SCHEMA_NAME}}'
            );
        END IF;
    END LOOP;
END
$native_evidence_opportunity_fks$;

CREATE INDEX IF NOT EXISTS "idx_appointments_opportunity_id" ON "{{SCHEMA_NAME}}"."appointments" ("opportunity_id") WHERE "opportunity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_tour_bookings_opportunity_id" ON "{{SCHEMA_NAME}}"."tour_bookings" ("opportunity_id") WHERE "opportunity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_property_bookings_opportunity_id" ON "{{SCHEMA_NAME}}"."property_bookings" ("opportunity_id") WHERE "opportunity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_service_requests_opportunity_id" ON "{{SCHEMA_NAME}}"."service_requests" ("opportunity_id") WHERE "opportunity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_food_orders_opportunity_id" ON "{{SCHEMA_NAME}}"."food_orders" ("opportunity_id") WHERE "opportunity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_photo_sessions_opportunity_id" ON "{{SCHEMA_NAME}}"."photo_sessions" ("opportunity_id") WHERE "opportunity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_resource_rentals_opportunity_id" ON "{{SCHEMA_NAME}}"."resource_rentals" ("opportunity_id") WHERE "opportunity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_orders_opportunity_id" ON "{{SCHEMA_NAME}}"."orders" ("opportunity_id") WHERE "opportunity_id" IS NOT NULL;

CREATE OR REPLACE FUNCTION "{{SCHEMA_NAME}}"."validate_native_evidence_opportunity"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = "{{SCHEMA_NAME}}", public
AS $native_evidence_opportunity_guard$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.opportunity_id IS NOT NULL
       AND NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id THEN
        RAISE EXCEPTION 'native evidence opportunity ownership is immutable'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'native_evidence_opportunity_immutable';
    END IF;

    IF NEW.opportunity_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- `contact_id` es FK ON DELETE SET NULL en estas tablas: al borrar un contacto
    -- PostgreSQL ejecuta un UPDATE real que dispara este mismo trigger. Sin esta
    -- excepción, borrar un contacto que tenga una cita/orden/reserva con
    -- opportunity_id falla con 23514 y se rompe el borrado de contacto, la purga
    -- de tenant y el borrado GDPR. Se permite SOLO ese desprendimiento: la
    -- oportunidad no cambia y el contacto pasa de presente a ausente.
    IF TG_OP = 'UPDATE'
       AND NEW.contact_id IS NULL
       AND OLD.contact_id IS NOT NULL
       AND NEW.opportunity_id IS NOT DISTINCT FROM OLD.opportunity_id THEN
        RETURN NEW;
    END IF;

    IF NEW.contact_id IS NULL OR NOT EXISTS (
        SELECT 1
         FROM "{{SCHEMA_NAME}}"."opportunities" opportunity_ref
          JOIN "{{SCHEMA_NAME}}"."leads" lead_ref
            ON lead_ref.id = opportunity_ref.lead_id
         WHERE opportunity_ref.id = NEW.opportunity_id
           AND (
                lead_ref.contact_id = NEW.contact_id
                OR EXISTS (
                    SELECT 1
                      FROM "{{SCHEMA_NAME}}"."contact_identities" evidence_identity
                      JOIN "{{SCHEMA_NAME}}"."contact_identities" lead_identity
                        ON lead_identity.customer_profile_id = evidence_identity.customer_profile_id
                     WHERE evidence_identity.contact_id = NEW.contact_id
                       AND lead_identity.contact_id = lead_ref.contact_id
                )
           )
    ) THEN
        RAISE EXCEPTION 'native evidence opportunity does not belong to contact'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'native_evidence_opportunity_contact_check';
    END IF;

    RETURN NEW;
END
$native_evidence_opportunity_guard$;

DO $native_evidence_opportunity_triggers$
DECLARE
    evidence_table TEXT;
    trigger_name TEXT;
BEGIN
    FOREACH evidence_table IN ARRAY ARRAY[
        'appointments', 'tour_bookings', 'property_bookings', 'service_requests',
        'food_orders', 'photo_sessions', 'resource_rentals', 'orders'
    ] LOOP
        trigger_name := evidence_table || '_opportunity_owner_guard';
        IF NOT EXISTS (
            SELECT 1
              FROM pg_trigger trigger_ref
              JOIN pg_class table_ref ON table_ref.oid = trigger_ref.tgrelid
              JOIN pg_namespace schema_ref ON schema_ref.oid = table_ref.relnamespace
             WHERE schema_ref.nspname = '{{SCHEMA_NAME}}'
               AND table_ref.relname = evidence_table
               AND trigger_ref.tgname = trigger_name
               AND NOT trigger_ref.tgisinternal
        ) THEN
            EXECUTE format(
                'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF opportunity_id, contact_id ON %I.%I FOR EACH ROW EXECUTE FUNCTION %I.validate_native_evidence_opportunity()',
                trigger_name, '{{SCHEMA_NAME}}', evidence_table, '{{SCHEMA_NAME}}'
            );
        END IF;
    END LOOP;
END
$native_evidence_opportunity_triggers$;


-- ============================================
-- ANDAMIAJE DE INTEGRACIONES (provider-neutral)
-- ============================================
-- Cada integracion resolvia los mismos cuatro problemas de nuevo y distinto:
-- no perder una escritura con el proveedor caido, no procesar dos veces el
-- mismo webhook, saber si los dos lados siguen diciendo lo mismo, y probar el
-- adapter sin credenciales. Cuatro problemas x N proveedores = N formas
-- distintas de fallar.
--
-- Ninguna de estas tablas sabe que es Hostaway, Toast o Cliniko: el contrato es
-- sobre la MECANICA y el adapter aporta el significado.

-- ---- Outbox: la escritura que todavia no salio ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."integration_outbox" (
    "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "provider"         VARCHAR(40) NOT NULL,
    -- A cual conexion de ese proveedor pertenece. La unicidad de abajo es
    -- (proveedor, clave), y eso alcanza mientras haya UNA conexion por
    -- proveedor: con dos cuentas de Hostaway el mismo hecho deriva la misma
    -- clave y la segunda escritura choca contra la fila de la primera, o sea
    -- desaparece. La clave derivada ya incluye la conexion cuando la hay; esta
    -- columna la deja consultable y auditable.
    "connection_id"    VARCHAR(120),
    "operation"        VARCHAR(80) NOT NULL,
    -- Derivada del hecho de negocio, no de un contador: reintentar es repetir
    -- la MISMA escritura, y una clave nueva por intento crea una reserva nueva
    -- en cada reintento — el modo de falla exacto que un outbox evita.
    "idempotency_key"  VARCHAR(255) NOT NULL,
    "payload"          JSONB NOT NULL DEFAULT '{}',
    "status"           VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts"         INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at"  TIMESTAMPTZ,
    "lease_expires_at" TIMESTAMPTZ,
    -- Fencing: each reclaim rotates the token and advances the generation.
    -- A late worker must present both values before it can change state.
    "claim_token"      UUID,
    "claim_generation" BIGINT NOT NULL DEFAULT 0,
    "last_error"       TEXT,
    "external_id"      VARCHAR(255),
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- La clave es unica POR PROVEEDOR: dos proveedores pueden usar el mismo
-- contador y no hay nada que lo impida.
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_integration_outbox_key"
    ON "{{SCHEMA_NAME}}"."integration_outbox" ("provider", "idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_integration_outbox_claimable"
    ON "{{SCHEMA_NAME}}"."integration_outbox" ("status", "next_attempt_at")
 WHERE "status" IN ('pending', 'retrying');
-- Expand-contract: los schemas creados antes de que existiera esta columna ya
-- tienen la tabla, y `CREATE TABLE IF NOT EXISTS` no la agrega. Aditivo y
-- nullable, asi que el codigo viejo sigue corriendo contra el schema nuevo
-- durante el deploy.
ALTER TABLE "{{SCHEMA_NAME}}"."integration_outbox"
    ADD COLUMN IF NOT EXISTS "connection_id" VARCHAR(120);
ALTER TABLE "{{SCHEMA_NAME}}"."integration_outbox"
    ADD COLUMN IF NOT EXISTS "claim_token" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."integration_outbox"
    ADD COLUMN IF NOT EXISTS "claim_generation" BIGINT NOT NULL DEFAULT 0;

-- Lo que necesita ojos humanos: muerto, suprimido o vencido.
CREATE INDEX IF NOT EXISTS "idx_integration_outbox_review"
    ON "{{SCHEMA_NAME}}"."integration_outbox" ("status", "updated_at" DESC)
 WHERE "status" IN ('dead', 'suppressed', 'expired');

-- ---- Webhook inbox: el evento que llego ----
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."integration_webhook_inbox" (
    "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "provider"          VARCHAR(40) NOT NULL,
    "external_event_id" VARCHAR(255) NOT NULL,
    "event_type"        VARCHAR(80) NOT NULL,
    "payload"           JSONB NOT NULL DEFAULT '{}',
    "status"            VARCHAR(20) NOT NULL DEFAULT 'received',
    "attempts"          INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "lease_expires_at"  TIMESTAMPTZ,
    "claim_token"       UUID,
    "claim_generation"  BIGINT NOT NULL DEFAULT 0,
    "received_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "processed_at"      TIMESTAMPTZ,
    "last_error"        TEXT
);
ALTER TABLE "{{SCHEMA_NAME}}"."integration_webhook_inbox" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "{{SCHEMA_NAME}}"."integration_webhook_inbox" ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "{{SCHEMA_NAME}}"."integration_webhook_inbox" ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMPTZ;
ALTER TABLE "{{SCHEMA_NAME}}"."integration_webhook_inbox" ADD COLUMN IF NOT EXISTS "claim_token" UUID;
ALTER TABLE "{{SCHEMA_NAME}}"."integration_webhook_inbox" ADD COLUMN IF NOT EXISTS "claim_generation" BIGINT NOT NULL DEFAULT 0;
-- Un proveedor reenvia cuando no recibe un 200 a tiempo, y una reserva
-- procesada dos veces es una reserva doble.
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_integration_webhook_event"
    ON "{{SCHEMA_NAME}}"."integration_webhook_inbox" ("provider", "external_event_id");
CREATE INDEX IF NOT EXISTS "idx_integration_webhook_pending"
    ON "{{SCHEMA_NAME}}"."integration_webhook_inbox" ("status", "received_at")
 WHERE "status" = 'received';

-- ---- Reconciliacion: la diferencia entre los dos lados ----
-- Se guarda el REPORTE, no la correccion: corregir automaticamente es como una
-- lectura desactualizada del proveedor borra una reserva local que si existe.
CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."integration_reconciliations" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "provider"     VARCHAR(40) NOT NULL,
    "checked_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "local_count"  INTEGER NOT NULL DEFAULT 0,
    "remote_count" INTEGER NOT NULL DEFAULT 0,
    "drift"        JSONB NOT NULL DEFAULT '[]',
    -- Una comparacion que no se pudo completar NO es "sin drift".
    "incomplete"   BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "idx_integration_reconciliations_provider"
    ON "{{SCHEMA_NAME}}"."integration_reconciliations" ("provider", "checked_at" DESC);
