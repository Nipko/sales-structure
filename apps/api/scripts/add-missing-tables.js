// scripts/add-missing-tables.js
// One-time migration: adds whatsapp_channels, conversation_assignments,
// and csat_surveys to existing tenant schemas that don't have them.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TABLES_SQL = (s) => `
-- WhatsApp Channels
CREATE TABLE IF NOT EXISTS "${s}"."whatsapp_channels" (
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
);

-- WhatsApp Templates
CREATE TABLE IF NOT EXISTS "${s}"."whatsapp_templates" (
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
);

-- WhatsApp Webhook Events
CREATE TABLE IF NOT EXISTS "${s}"."whatsapp_webhook_events" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "channel_id" UUID,
    "event_type" VARCHAR(100),
    "payload" JSONB DEFAULT '{}',
    "processed" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP DEFAULT NOW()
);

-- WhatsApp Message Logs
CREATE TABLE IF NOT EXISTS "${s}"."whatsapp_message_logs" (
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
);

-- Conversation Assignments
CREATE TABLE IF NOT EXISTS "${s}"."conversation_assignments" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP DEFAULT NOW(),
    "first_response_at" TIMESTAMP,
    "resolved_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW()
);

-- CSAT Surveys
CREATE TABLE IF NOT EXISTS "${s}"."csat_surveys" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL,
    "contact_id" UUID,
    "agent_id" UUID,
    "rating" INTEGER NOT NULL CHECK ("rating" >= 1 AND "rating" <= 5),
    "feedback" TEXT,
    "created_at" TIMESTAMP DEFAULT NOW()
);
`;

async function migrate() {
  console.log('=== Adding missing tables to existing tenant schemas ===');
  
  const tenants = await prisma.$queryRaw\`
    SELECT id, schema_name FROM tenants WHERE is_active = true
  \`;

  console.log(\`Found \${tenants.length} tenants\`);

  for (const t of tenants) {
    const s = t.schema_name;
    console.log(\`  → Migrating: \${s}\`);

    try {
      // Check schema exists
      const schemaCheck = await prisma.$queryRawUnsafe(
        \`SELECT schema_name FROM information_schema.schemata WHERE schema_name = '\${s}'\`
      );
      if (!schemaCheck || schemaCheck.length === 0) {
        console.log(\`    ⚠ Schema \${s} does not exist, skipping\`);
        continue;
      }

      // Run all CREATE TABLE IF NOT EXISTS statements
      const statements = TABLES_SQL(s)
        .split(';')
        .map(st => st.trim())
        .filter(st => st.length > 0 && !st.startsWith('--'));

      for (const stmt of statements) {
        try {
          await prisma.$executeRawUnsafe(stmt);
        } catch (err) {
          // Ignore "already exists" errors
          if (err.message && err.message.includes('already exists')) {
            continue;
          }
          console.log(\`    ⚠ Warning: \${err.message?.substring(0, 120)}\`);
        }
      }

      console.log(\`    ✓ Done\`);
    } catch (err) {
      console.error(\`    ✗ Failed: \${err.message}\`);
    }
  }

  console.log('=== Migration complete ===');
}

migrate()
  .catch(err => { console.error('Fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
