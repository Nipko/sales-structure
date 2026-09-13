export const KNOWLEDGE_CONFLICT_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS knowledge_conflict_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pair_key VARCHAR(64) NOT NULL UNIQUE,
        source_a JSONB NOT NULL, source_b JSONB NOT NULL,
        quote_a TEXT NOT NULL, quote_b TEXT NOT NULL, detail TEXT NOT NULL, suggestion TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'open', revision INTEGER NOT NULL DEFAULT 1,
        document_a UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        document_b UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        faq_a UUID REFERENCES faqs(id) ON DELETE CASCADE, faq_b UUID REFERENCES faqs(id) ON DELETE CASCADE,
        policy_a UUID REFERENCES policies(id) ON DELETE CASCADE, policy_b UUID REFERENCES policies(id) ON DELETE CASCADE,
        business_a UUID REFERENCES companies(id) ON DELETE CASCADE, business_b UUID REFERENCES companies(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS knowledge_conflict_decisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), case_id UUID NOT NULL REFERENCES knowledge_conflict_cases(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, decision VARCHAR(30) NOT NULL, reason TEXT NOT NULL, actor_id UUID NOT NULL,
        source_a_hash VARCHAR(64) NOT NULL, source_b_hash VARCHAR(64) NOT NULL, scope JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(case_id,revision))`,
    `CREATE TABLE IF NOT EXISTS knowledge_conflict_scans (
        id UUID PRIMARY KEY, report JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_knowledge_conflict_status ON knowledge_conflict_cases(status,created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_knowledge_conflict_decisions ON knowledge_conflict_decisions(case_id,revision DESC)`,
];
