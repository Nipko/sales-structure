/** One statement per query for PgBouncer transaction pooling. */
export const LEARNING_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS learning_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agent_id UUID NOT NULL,
        source_kind VARCHAR(16) NOT NULL CHECK (source_kind IN ('inbox','file')),
        source_key CHAR(64) NOT NULL, group_key CHAR(64) NOT NULL,
        source_contact_id UUID, source_conversation_id UUID,
        split VARCHAR(12) NOT NULL CHECK (split IN ('train','holdout')),
        channel VARCHAR(40) NOT NULL, language VARCHAR(2) NOT NULL,
        transcript JSONB NOT NULL, content_hash CHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
        created_by VARCHAR(100) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (agent_id, source_kind, source_key))`,
    `CREATE INDEX IF NOT EXISTS idx_learning_sources_group ON learning_sources(group_key, split)`,
    `CREATE INDEX IF NOT EXISTS idx_learning_sources_contact ON learning_sources(source_contact_id)`,
    `ALTER TABLE learning_sources ADD COLUMN IF NOT EXISTS source_evidence JSONB`,
    `CREATE TABLE IF NOT EXISTS learning_examples (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_id UUID NOT NULL REFERENCES learning_sources(id) ON DELETE CASCADE,
        agent_id UUID NOT NULL, kind VARCHAR(24) NOT NULL DEFAULT 'brand_style'
            CHECK (kind IN ('brand_style','operational_pattern','business_fact','customer_memory','regression')),
        intent VARCHAR(40) NOT NULL, episode JSONB NOT NULL, content_hash CHAR(64) NOT NULL,
        response_pattern TEXT, rationale TEXT, facts_required JSONB NOT NULL DEFAULT '[]'::jsonb,
        analysis JSONB, embedding vector(1536), evidence_refs UUID[] NOT NULL DEFAULT '{}'::uuid[],
        dedup_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (dedup_status IN ('pending','clear','conflict')),
        status VARCHAR(16) NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','analyzing','analyzed','failed','flagged','approved','rejected','retired')),
        revision INTEGER NOT NULL DEFAULT 1, reviewed_by VARCHAR(100), reviewed_at TIMESTAMPTZ, review_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(source_id, content_hash))`,
    `CREATE INDEX IF NOT EXISTS idx_learning_examples_agent ON learning_examples(agent_id, status, intent)`,
    `CREATE TABLE IF NOT EXISTS learning_reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), example_id UUID NOT NULL REFERENCES learning_examples(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, decision VARCHAR(16) NOT NULL, snapshot JSONB NOT NULL,
        reviewer_id VARCHAR(100) NOT NULL, note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS learning_releases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agent_id UUID NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','published','retired')),
        example_ids UUID[] NOT NULL, snapshot JSONB NOT NULL, snapshot_hash CHAR(64) NOT NULL,
        baseline_release_id UUID, traffic_percent INTEGER NOT NULL DEFAULT 100 CHECK (traffic_percent BETWEEN 0 AND 100),
        evaluation_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (evaluation_status IN ('pending','running','passed','failed')),
        evaluation JSONB, created_by VARCHAR(100) NOT NULL, published_by VARCHAR(100), published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_learning_releases_active ON learning_releases(agent_id, status, created_at DESC)`,
    `ALTER TABLE learning_releases ADD COLUMN IF NOT EXISTS evaluation_namespaces JSONB`,
    // A tenant whose tables predate these keeps the CREATE TABLE above; the
    // widening is what reaches it.
    `ALTER TABLE learning_releases ADD COLUMN IF NOT EXISTS retired_by VARCHAR(100)`,
    `ALTER TABLE learning_releases ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ`,
    // The wall-clock bound of the attempt currently running, stamped by the
    // database when the attempt is claimed and never renewed. It lives on the
    // release row because that row is the one every write path already locks:
    // a deadline checked anywhere else would be a second opinion, and the whole
    // point is that the expiry is decided by the same authority, in the same
    // transaction, that decides whether this worker still owns the attempt.
    `ALTER TABLE learning_releases ADD COLUMN IF NOT EXISTS evaluation_deadline_at TIMESTAMPTZ`,
    // What one attempt is allowed to spend, and what it did spend. Deliberately
    // NOT a counter inside `learning_releases.evaluation`: that blob is replaced
    // wholesale when the evaluation finalizes, so the runs that cost the most —
    // the ones abandoned half way — are exactly the ones whose cost a blob
    // would lose. `units_max` is frozen per attempt so raising the environment
    // ceiling never retroactively enlarges a run already in flight, and
    // `outcome` is the state an operator reads to learn why a release is still
    // a candidate: NULL while the attempt runs, then one closed word.
    `CREATE TABLE IF NOT EXISTS learning_evaluation_budget (
        attempt_id UUID PRIMARY KEY, release_id UUID NOT NULL, agent_id UUID NOT NULL,
        budget_day DATE NOT NULL DEFAULT CURRENT_DATE,
        units_used INTEGER NOT NULL DEFAULT 0 CHECK (units_used >= 0),
        units_max INTEGER NOT NULL CHECK (units_max > 0),
        outcome VARCHAR(40) CHECK (outcome IN ('evaluated','failed','budget_exhausted','deadline_exceeded')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_learning_evaluation_budget_release ON learning_evaluation_budget(release_id, created_at DESC)`,
] as const;
