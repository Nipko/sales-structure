/** Reference-only sampling outbox. Source text never enters this table or its queue payload. */
export const WATCHTOWER_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS quality_sampling_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), sample_day DATE NOT NULL UNIQUE,
        window_start TIMESTAMPTZ NOT NULL, window_end TIMESTAMPTZ NOT NULL,
        eligible_count BIGINT NOT NULL CHECK (eligible_count >= 0),
        selected_count INTEGER NOT NULL CHECK (selected_count >= 0),
        requested_fraction NUMERIC NOT NULL, sample_cap INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS quality_sampling_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), run_id UUID NOT NULL REFERENCES quality_sampling_runs(id) ON DELETE CASCADE,
        conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
        contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
        state VARCHAR(20) NOT NULL DEFAULT 'selected' CHECK (state IN ('selected','queued','failed','erased')),
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lease_token UUID, lease_expires_at TIMESTAMPTZ, last_error_code VARCHAR(60),
        queued_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(run_id,conversation_id))`,
    `CREATE INDEX IF NOT EXISTS idx_quality_sampling_pending ON quality_sampling_items(state,next_attempt_at)`,
    `CREATE TABLE IF NOT EXISTS customer_memory_erasure (contact_id UUID PRIMARY KEY, erased_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
];

export function watchtowerWindow(now: Date): { day: string; start: string; end: string } {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (!Number.isFinite(end.getTime())) throw new Error('invalid_sampling_time');
    const start = new Date(end.getTime() - 86_400_000);
    return { day: start.toISOString().slice(0, 10), start: start.toISOString(), end: end.toISOString() };
}
