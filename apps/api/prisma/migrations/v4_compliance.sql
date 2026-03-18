-- Migración V4: Compliance & Audit
-- Tablas de consentimiento, opt-out, borrado y textos legales.

CREATE TABLE IF NOT EXISTS legal_text_versions (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "channel" VARCHAR(50) NOT NULL DEFAULT 'web',
    "version" INTEGER NOT NULL DEFAULT 1,
    "text" TEXT NOT NULL,
    "active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_legal_text_tenant ON legal_text_versions("tenant_id", "channel", "active");

CREATE TABLE IF NOT EXISTS consent_records (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "lead_id" UUID,
    "channel" VARCHAR(50) NOT NULL DEFAULT 'web',
    "legal_text_version" INTEGER,
    "legal_text_snapshot" TEXT,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "source_url" VARCHAR(500),
    "granted_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_lead ON consent_records("lead_id");

CREATE TABLE IF NOT EXISTS opt_out_records (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "lead_id" UUID,
    "channel" VARCHAR(50) NOT NULL,
    "scope" VARCHAR(50) DEFAULT 'marketing',
    "reason" TEXT,
    "detected_from" VARCHAR(100),
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_optout_lead ON opt_out_records("lead_id");

CREATE TABLE IF NOT EXISTS deletion_requests (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "lead_id" UUID,
    "requested_by" VARCHAR(255),
    "status" VARCHAR(50) DEFAULT 'pending',
    "requested_at" TIMESTAMP DEFAULT NOW(),
    "processed_at" TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deletion_status ON deletion_requests("status");
