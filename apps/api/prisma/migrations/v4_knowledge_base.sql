-- Migración V4: Knowledge Base / RAG

CREATE TABLE IF NOT EXISTS knowledge_resources (
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
CREATE INDEX IF NOT EXISTS idx_kr_tenant ON knowledge_resources("tenant_id", "status");

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "resource_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "metadata_json" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kc_resource ON knowledge_chunks("resource_id");

CREATE TABLE IF NOT EXISTS knowledge_approvals (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "resource_id" UUID NOT NULL,
    "approved_by" VARCHAR(255),
    "approved_at" TIMESTAMP DEFAULT NOW(),
    "notes" TEXT
);
CREATE INDEX IF NOT EXISTS idx_ka_resource ON knowledge_approvals("resource_id");
