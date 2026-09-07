/** Lazy compatibility migration for existing tenant schemas. New tenants use the
 * matching declaration in tenant-schema.sql. Legacy rows remain version 0. */
export const KNOWLEDGE_ATTRIBUTION_SCHEMA = [
    `ALTER TABLE kb_retrieval_log
        ADD COLUMN IF NOT EXISTS retrieval_batch_id UUID,
        ADD COLUMN IF NOT EXISTS relevance_passed BOOLEAN,
        ADD COLUMN IF NOT EXISTS attribution_version SMALLINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS source_version INTEGER,
        ADD COLUMN IF NOT EXISTS source_title TEXT,
        ADD COLUMN IF NOT EXISTS presented BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS response_signal VARCHAR(40) NOT NULL DEFAULT 'unobserved',
        ADD COLUMN IF NOT EXISTS attribution_granularity VARCHAR(10) NOT NULL DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS response_id UUID,
        ADD COLUMN IF NOT EXISTS response_hash CHAR(64),
        ADD COLUMN IF NOT EXISTS evidence_hash CHAR(64),
        ADD COLUMN IF NOT EXISTS attributed_at TIMESTAMPTZ`,
    `CREATE INDEX IF NOT EXISTS idx_krl_attribution_batch ON kb_retrieval_log (retrieval_batch_id) WHERE retrieval_batch_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS customer_memory_erasure (contact_id UUID PRIMARY KEY, erased_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
];
