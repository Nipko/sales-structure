// scripts/add-missing-tables.js
// Migration: adds ALL missing tables to existing tenant schemas.
// Uses CREATE TABLE IF NOT EXISTS for safe idempotent execution.
// This is the safety net for schemas that were partially created.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function buildSQL(s) {
  return [
    // ---- Core tables ----
    `CREATE TABLE IF NOT EXISTS "${s}"."contacts" (
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
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."conversations" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "contact_id" UUID,
      "channel_type" VARCHAR(50) NOT NULL,
      "channel_account_id" VARCHAR(255) NOT NULL,
      "status" VARCHAR(50) DEFAULT 'active',
      "stage" VARCHAR(50) DEFAULT 'greeting',
      "assigned_to" VARCHAR(255),
      "summary" TEXT,
      "estimated_ticket_value" DECIMAL(15, 2) DEFAULT 0,
      "metadata" JSONB DEFAULT '{}',
      "resolved_at" TIMESTAMP,
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."messages" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "conversation_id" UUID,
      "direction" VARCHAR(20) NOT NULL,
      "content_type" VARCHAR(50) NOT NULL DEFAULT 'text',
      "content_text" TEXT,
      "media_url" VARCHAR(500),
      "media_mime_type" VARCHAR(100),
      "caption" TEXT,
      "status" VARCHAR(50) DEFAULT 'pending',
      "llm_model_used" VARCHAR(100),
      "llm_tokens_used" INTEGER DEFAULT 0,
      "llm_cost" DECIMAL(10, 6) DEFAULT 0,
      "routing_tier" VARCHAR(50),
      "routing_score" DECIMAL(5, 2),
      "external_id" VARCHAR(255),
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."persona_config" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "version" INTEGER DEFAULT 1,
      "is_active" BOOLEAN DEFAULT true,
      "config_yaml" TEXT NOT NULL DEFAULT '',
      "config_json" JSONB NOT NULL DEFAULT '{}',
      "created_by" VARCHAR(255),
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."knowledge_documents" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "title" VARCHAR(500) NOT NULL,
      "file_name" VARCHAR(500),
      "file_url" VARCHAR(500),
      "file_type" VARCHAR(50),
      "file_size" INTEGER DEFAULT 0,
      "content_text" TEXT,
      "chunk_count" INTEGER DEFAULT 0,
      "status" VARCHAR(50) DEFAULT 'pending',
      "error_message" TEXT,
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."knowledge_embeddings" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "document_id" UUID,
      "chunk_index" INTEGER NOT NULL,
      "chunk_text" TEXT NOT NULL,
      "embedding" TEXT,
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."conversation_memory" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "contact_id" UUID,
      "conversation_id" UUID,
      "summary" TEXT NOT NULL,
      "key_facts" JSONB DEFAULT '[]',
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."products" (
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
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."orders" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "contact_id" UUID,
      "conversation_id" UUID,
      "items" JSONB NOT NULL DEFAULT '[]',
      "total_amount" DECIMAL(15, 2) NOT NULL DEFAULT 0,
      "currency" VARCHAR(10) DEFAULT 'COP',
      "status" VARCHAR(50) DEFAULT 'pending',
      "payment_status" VARCHAR(50) DEFAULT 'pending',
      "payment_reference" VARCHAR(255),
      "notes" TEXT,
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."tool_configs" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "name" VARCHAR(255) NOT NULL,
      "description" TEXT,
      "type" VARCHAR(50) NOT NULL DEFAULT 'internal',
      "endpoint" VARCHAR(500),
      "auth_type" VARCHAR(50),
      "auth_credentials" TEXT,
      "parameters_schema" JSONB DEFAULT '{}',
      "is_active" BOOLEAN DEFAULT true,
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."business_rules" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "name" VARCHAR(255) NOT NULL,
      "description" TEXT,
      "rule_type" VARCHAR(100) NOT NULL,
      "conditions" JSONB NOT NULL DEFAULT '{}',
      "actions" JSONB NOT NULL DEFAULT '{}',
      "priority" INTEGER DEFAULT 0,
      "is_active" BOOLEAN DEFAULT true,
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."analytics_events" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "event_type" VARCHAR(100) NOT NULL,
      "conversation_id" UUID,
      "contact_id" UUID,
      "data" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    // ---- Commercial Domain ----
    `CREATE TABLE IF NOT EXISTS "${s}"."courses" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "code" VARCHAR(50),
      "name" VARCHAR(500) NOT NULL,
      "slug" VARCHAR(255) NOT NULL,
      "description" TEXT,
      "price" DECIMAL(15, 2) NOT NULL DEFAULT 0,
      "currency" VARCHAR(10) DEFAULT 'COP',
      "duration_hours" INTEGER,
      "modality" VARCHAR(50) DEFAULT 'presencial',
      "brochure_url" VARCHAR(500),
      "faq_version" INTEGER DEFAULT 1,
      "policy_version" INTEGER DEFAULT 1,
      "is_active" BOOLEAN DEFAULT true,
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."campaigns" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "code" VARCHAR(50),
      "name" VARCHAR(500) NOT NULL,
      "course_id" UUID,
      "source_type" VARCHAR(50) DEFAULT 'landing',
      "channel" VARCHAR(50) DEFAULT 'whatsapp',
      "wa_template_name" VARCHAR(255),
      "status" VARCHAR(50) DEFAULT 'draft',
      "starts_at" TIMESTAMP,
      "ends_at" TIMESTAMP,
      "schedule_json" JSONB DEFAULT '{}',
      "office_hours_start" INTEGER DEFAULT 8,
      "office_hours_end" INTEGER DEFAULT 20,
      "default_owner_rule" VARCHAR(255),
      "automation_profile_id" UUID,
      "max_attempts" INTEGER DEFAULT 3,
      "retry_delay_hours" INTEGER DEFAULT 24,
      "fallback_email" BOOLEAN DEFAULT false,
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."companies" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "name" VARCHAR(500) NOT NULL,
      "industry" VARCHAR(255),
      "city" VARCHAR(255),
      "country" VARCHAR(100) DEFAULT 'CO',
      "website" VARCHAR(500),
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."leads" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "contact_id" UUID,
      "company_id" UUID,
      "first_name" VARCHAR(255),
      "last_name" VARCHAR(255),
      "phone" VARCHAR(50) NOT NULL,
      "email" VARCHAR(255),
      "score" INTEGER DEFAULT 0,
      "stage" VARCHAR(50) DEFAULT 'nuevo',
      "primary_intent" VARCHAR(100),
      "secondary_intent" VARCHAR(100),
      "is_vip" BOOLEAN DEFAULT false,
      "preferred_contact" VARCHAR(50) DEFAULT 'whatsapp',
      "campaign_id" UUID,
      "course_id" UUID,
      "utm_source" VARCHAR(255),
      "utm_medium" VARCHAR(255),
      "utm_campaign" VARCHAR(255),
      "utm_content" VARCHAR(255),
      "referrer_url" VARCHAR(500),
      "gclid" VARCHAR(500),
      "fbclid" VARCHAR(500),
      "assigned_to" VARCHAR(255),
      "opted_out" BOOLEAN DEFAULT false,
      "opted_out_at" TIMESTAMP,
      "last_contacted_at" TIMESTAMP,
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."opportunities" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "lead_id" UUID,
      "course_id" UUID,
      "campaign_id" UUID,
      "conversation_id" UUID,
      "stage" VARCHAR(50) DEFAULT 'nuevo',
      "score" INTEGER DEFAULT 0,
      "estimated_value" DECIMAL(15, 2),
      "currency" VARCHAR(10) DEFAULT 'COP',
      "sla_deadline" TIMESTAMP,
      "won_at" TIMESTAMP,
      "lost_at" TIMESTAMP,
      "loss_reason" TEXT,
      "assigned_to" VARCHAR(255),
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    // ---- Consent, tags, tasks, notes ----
    `CREATE TABLE IF NOT EXISTS "${s}"."consent_records" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "lead_id" UUID,
      "channel" VARCHAR(50) NOT NULL DEFAULT 'web_form',
      "legal_version" VARCHAR(50) NOT NULL,
      "legal_text_hash" VARCHAR(64),
      "ip_address" VARCHAR(45),
      "user_agent" TEXT,
      "origin_url" VARCHAR(500),
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."opt_out_records" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "lead_id" UUID,
      "phone" VARCHAR(50),
      "channel" VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
      "trigger_msg" TEXT,
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."tags" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "name" VARCHAR(100) NOT NULL,
      "color" VARCHAR(20) DEFAULT '#6c5ce7',
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."tasks" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "lead_id" UUID,
      "opportunity_id" UUID,
      "title" VARCHAR(500) NOT NULL,
      "description" TEXT,
      "type" VARCHAR(50) DEFAULT 'follow_up',
      "status" VARCHAR(50) DEFAULT 'pending',
      "due_at" TIMESTAMP,
      "completed_at" TIMESTAMP,
      "assigned_to" VARCHAR(255),
      "created_by" VARCHAR(255),
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."notes" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "lead_id" UUID,
      "opportunity_id" UUID,
      "conversation_id" UUID,
      "content" TEXT NOT NULL,
      "created_by" VARCHAR(255),
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."stage_history" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "lead_id" UUID,
      "opportunity_id" UUID,
      "from_stage" VARCHAR(50),
      "to_stage" VARCHAR(50) NOT NULL,
      "reason" TEXT,
      "triggered_by" VARCHAR(50) DEFAULT 'system',
      "agent_id" VARCHAR(255),
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    // ---- WhatsApp ----
    `CREATE TABLE IF NOT EXISTS "${s}"."whatsapp_channels" (
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
      "access_token_ref" TEXT,
      "app_id" VARCHAR(255),
      "webhook_verify_token_ref" VARCHAR(255),
      "webhook_callback_url" VARCHAR(500),
      "webhook_subscription_status" VARCHAR(50),
      "channel_status" VARCHAR(50) DEFAULT 'pending',
      "is_coexistence" BOOLEAN DEFAULT false,
      "coexistence_status" VARCHAR(50),
      "onboarding_id" UUID,
      "connected_at" TIMESTAMP,
      "last_healthcheck_at" TIMESTAMP,
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."whatsapp_templates" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "channel_id" UUID,
      "course_id" UUID,
      "campaign_id" UUID,
      "name" VARCHAR(255) NOT NULL,
      "language" VARCHAR(10) DEFAULT 'es',
      "category" VARCHAR(50),
      "components_json" JSONB DEFAULT '[]',
      "approval_status" VARCHAR(50) DEFAULT 'PENDING',
      "last_sync_at" TIMESTAMP,
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."whatsapp_webhook_events" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "channel_id" UUID,
      "event_type" VARCHAR(100),
      "payload" JSONB DEFAULT '{}',
      "processed" BOOLEAN DEFAULT false,
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."whatsapp_message_logs" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "channel_id" UUID,
      "conversation_id" UUID,
      "direction" VARCHAR(20),
      "wa_message_id" VARCHAR(255),
      "wa_status" VARCHAR(50),
      "content_type" VARCHAR(50),
      "content_text" TEXT,
      "error_code" VARCHAR(50),
      "error_message" TEXT,
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    // ---- Landing / Intake ----
    `CREATE TABLE IF NOT EXISTS "${s}"."landing_pages" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "slug" VARCHAR(255) NOT NULL,
      "course_id" UUID,
      "campaign_id" UUID,
      "title" VARCHAR(500) NOT NULL,
      "subtitle" TEXT,
      "hero_json" JSONB DEFAULT '{}',
      "sections_json" JSONB DEFAULT '[]',
      "status" VARCHAR(50) DEFAULT 'draft',
      "published_at" TIMESTAMP,
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."form_definitions" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "landing_page_id" UUID,
      "name" VARCHAR(255) NOT NULL,
      "version" INTEGER DEFAULT 1,
      "fields_json" JSONB DEFAULT '[]',
      "consent_text_version" VARCHAR(50),
      "active" BOOLEAN DEFAULT true,
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."form_submissions" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "landing_page_id" UUID,
      "form_definition_id" UUID,
      "campaign_id" UUID,
      "course_id" UUID,
      "lead_id" UUID,
      "raw_payload_json" JSONB NOT NULL DEFAULT '{}',
      "normalized_payload_json" JSONB,
      "source_url" VARCHAR(500),
      "referrer" VARCHAR(500),
      "utm_json" JSONB DEFAULT '{}',
      "ip_address" VARCHAR(45),
      "user_agent" TEXT,
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    // ---- Automation ----
    `CREATE TABLE IF NOT EXISTS "${s}"."automation_rules" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "tenant_id" VARCHAR(255) NOT NULL DEFAULT '',
      "name" VARCHAR(255) NOT NULL,
      "trigger_type" VARCHAR(100) NOT NULL,
      "conditions_json" JSONB DEFAULT '{}',
      "actions_json" JSONB DEFAULT '[]',
      "active" BOOLEAN DEFAULT false,
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."automation_executions" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "rule_id" UUID,
      "entity_type" VARCHAR(50) NOT NULL,
      "entity_id" UUID NOT NULL,
      "status" VARCHAR(50) DEFAULT 'pending',
      "started_at" TIMESTAMP DEFAULT NOW(),
      "finished_at" TIMESTAMP,
      "result_json" JSONB DEFAULT '{}'
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."wait_jobs" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "tenant_id" VARCHAR(255) NOT NULL DEFAULT '',
      "job_type" VARCHAR(50) NOT NULL,
      "run_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "payload_json" JSONB DEFAULT '{}',
      "status" VARCHAR(50) DEFAULT 'pending',
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    // ---- Compliance ----
    `CREATE TABLE IF NOT EXISTS "${s}"."legal_text_versions" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "tenant_id" VARCHAR(255) NOT NULL DEFAULT '',
      "channel" VARCHAR(50) NOT NULL DEFAULT 'web',
      "version" INTEGER NOT NULL DEFAULT 1,
      "text" TEXT NOT NULL DEFAULT '',
      "active" BOOLEAN DEFAULT true,
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."deletion_requests" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "tenant_id" VARCHAR(255) NOT NULL DEFAULT '',
      "lead_id" UUID,
      "requested_by" VARCHAR(255),
      "status" VARCHAR(50) DEFAULT 'pending',
      "requested_at" TIMESTAMP DEFAULT NOW(),
      "processed_at" TIMESTAMP
    )`,

    // ---- Analytics ----
    `CREATE TABLE IF NOT EXISTS "${s}"."daily_metrics" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "tenant_id" VARCHAR(255) NOT NULL DEFAULT '',
      "metric_date" DATE NOT NULL DEFAULT CURRENT_DATE,
      "dimension_type" VARCHAR(50) NOT NULL DEFAULT '',
      "dimension_id" VARCHAR(255),
      "metrics_json" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    // ---- Carla AI ----
    `CREATE TABLE IF NOT EXISTS "${s}"."carla_personality_profiles" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "tenant_id" VARCHAR(255) NOT NULL DEFAULT '',
      "name" VARCHAR(255) NOT NULL,
      "tone" VARCHAR(50) DEFAULT 'professional',
      "language" VARCHAR(10) DEFAULT 'es',
      "objectives_json" JSONB DEFAULT '[]',
      "rules_json" JSONB DEFAULT '[]',
      "disclaimers" TEXT,
      "active" BOOLEAN DEFAULT true,
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."carla_prompt_templates" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "tenant_id" VARCHAR(255) NOT NULL DEFAULT '',
      "name" VARCHAR(255) NOT NULL,
      "campaign_id" UUID,
      "course_id" UUID,
      "template_type" VARCHAR(50) DEFAULT 'system',
      "content" TEXT NOT NULL DEFAULT '',
      "version" INTEGER DEFAULT 1,
      "active" BOOLEAN DEFAULT true,
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."carla_conversation_context" (
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
    )`,

    // ---- Knowledge Base V4 ----
    `CREATE TABLE IF NOT EXISTS "${s}"."knowledge_resources" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "tenant_id" VARCHAR(255) NOT NULL DEFAULT '',
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
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."knowledge_chunks" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "resource_id" UUID NOT NULL,
      "chunk_index" INTEGER NOT NULL,
      "content" TEXT NOT NULL,
      "metadata_json" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."knowledge_approvals" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "resource_id" UUID NOT NULL,
      "approved_by" VARCHAR(255),
      "approved_at" TIMESTAMP DEFAULT NOW(),
      "notes" TEXT
    )`,

    // ---- Agent Console ----
    `CREATE TABLE IF NOT EXISTS "${s}"."conversation_assignments" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "conversation_id" UUID NOT NULL,
      "agent_id" UUID NOT NULL,
      "assigned_at" TIMESTAMP DEFAULT NOW(),
      "first_response_at" TIMESTAMP,
      "resolved_at" TIMESTAMP,
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS "${s}"."csat_surveys" (
      "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      "conversation_id" UUID NOT NULL,
      "contact_id" UUID,
      "agent_id" UUID,
      "rating" INTEGER NOT NULL DEFAULT 3,
      "feedback" TEXT,
      "created_at" TIMESTAMP DEFAULT NOW()
    )`,
  ];
}

async function migrate() {
  console.log('=== Adding missing tables to existing tenant schemas ===');

  const tenants = await prisma.$queryRawUnsafe(
    'SELECT id, schema_name FROM tenants WHERE is_active = true'
  );

  console.log('Found ' + tenants.length + ' tenants');

  for (const t of tenants) {
    const s = t.schema_name;
    console.log('  -> Migrating: ' + s);

    try {
      // Ensure schema exists first
      await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS "' + s + '"');

      const statements = buildSQL(s);
      let created = 0;

      for (const stmt of statements) {
        try {
          await prisma.$executeRawUnsafe(stmt);
          created++;
        } catch (err) {
          // Ignore "already exists" errors
          if (err.message && err.message.includes('already exists')) {
            continue;
          }
          console.log('    ! Warning: ' + (err.message || '').substring(0, 150));
        }
      }

      console.log('    OK (' + created + '/' + statements.length + ' statements executed)');
    } catch (err) {
      console.error('    FAIL: ' + err.message);
    }
  }

  console.log('=== Migration complete ===');
}

migrate()
  .catch(function(err) { console.error('Fatal:', err); process.exit(1); })
  .finally(function() { return prisma.$disconnect(); });

