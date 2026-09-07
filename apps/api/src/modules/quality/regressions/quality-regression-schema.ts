export const QUALITY_REGRESSION_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS quality_regression_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agent_id UUID NOT NULL REFERENCES agent_personas(id) ON DELETE CASCADE,
        source_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        source_conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('quality_score','tool_ledger')),
        source_evidence_id UUID NOT NULL, source_message_ids UUID[] NOT NULL,
        source_revision BIGINT NOT NULL, source_hash TEXT NOT NULL,
        source_agent_version INTEGER, source_configuration_hash TEXT,
        state TEXT NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','approved','rejected','retired')),
        revision INTEGER NOT NULL DEFAULT 1, scope JSONB NOT NULL,
        proposal JSONB NOT NULL, approved_scenario JSONB, approved_hash TEXT,
        created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(agent_id,source_kind,source_evidence_id,source_hash))`,
    `CREATE TABLE IF NOT EXISTS quality_regression_revisions (
        case_id UUID NOT NULL REFERENCES quality_regression_cases(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, proposal JSONB NOT NULL, scope JSONB NOT NULL,
        created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(case_id,revision))`,
    `CREATE TABLE IF NOT EXISTS quality_regression_reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),case_id UUID NOT NULL REFERENCES quality_regression_cases(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','retired')),
        checks JSONB NOT NULL,note TEXT NOT NULL,reviewed_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_quality_regression_source ON quality_regression_cases(source_conversation_id,source_revision)`,
    `CREATE INDEX IF NOT EXISTS idx_quality_regression_agent ON quality_regression_cases(agent_id,state,updated_at)`,
];
