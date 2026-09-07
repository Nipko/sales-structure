/** Tenant search_path is set by PrismaService. Each statement runs separately for PgBouncer. */
export const QUALITY_EVIDENCE_DDL = [
    `CREATE TABLE IF NOT EXISTS customer_memory_erasure (contact_id UUID PRIMARY KEY, erased_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    // These legacy ALTERs occur later in tenant-schema.sql. A trigger must not
    // reference them until they exist, including during incremental upgrades.
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS resolution_type VARCHAR(50)`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS was_handed_off BOOLEAN DEFAULT false`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_persona_id UUID`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_config_version INTEGER`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_attribution_conflicted BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS qa_revision BIGINT NOT NULL DEFAULT 0`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS resolution_verification_source TEXT`,
    `ALTER TABLE conversation_quality_scores ADD COLUMN IF NOT EXISTS source_revision BIGINT`,
    `ALTER TABLE conversation_quality_scores ADD COLUMN IF NOT EXISTS source_message_ids UUID[]`,
    `ALTER TABLE conversation_quality_scores ADD COLUMN IF NOT EXISTS transcript_hash TEXT`,
    `ALTER TABLE conversation_quality_scores ADD COLUMN IF NOT EXISTS coverage JSONB`,
    `ALTER TABLE conversation_quality_scores ADD COLUMN IF NOT EXISTS rubric_hash TEXT`,
    `ALTER TABLE conversation_quality_scores ADD COLUMN IF NOT EXISTS configuration_snapshot JSONB`,
    `ALTER TABLE conversation_quality_scores ADD COLUMN IF NOT EXISTS conversational_resolved BOOLEAN`,
    `ALTER TABLE conversation_quality_scores ADD COLUMN IF NOT EXISTS conversational_resolution_reason TEXT`,
    `ALTER TABLE conversation_quality_scores ADD COLUMN IF NOT EXISTS operational_outcome TEXT NOT NULL DEFAULT 'unknown'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cqs_revision_rubric ON conversation_quality_scores(conversation_id,source_revision,rubric_hash)`,
    `CREATE OR REPLACE FUNCTION qa_conversation_revision() RETURNS trigger LANGUAGE plpgsql AS $qa$
    BEGIN
      IF ROW(NEW.status,NEW.resolution_type,NEW.was_handed_off,NEW.contact_id,NEW.agent_persona_id,
             NEW.agent_config_version,NEW.agent_attribution_conflicted,NEW.metadata)
         IS DISTINCT FROM ROW(OLD.status,OLD.resolution_type,OLD.was_handed_off,OLD.contact_id,OLD.agent_persona_id,
             OLD.agent_config_version,OLD.agent_attribution_conflicted,OLD.metadata) THEN
        NEW.qa_revision := OLD.qa_revision + 1;
      END IF;
      RETURN NEW;
    END $qa$`,
    `CREATE OR REPLACE FUNCTION qa_message_revision() RETURNS trigger LANGUAGE plpgsql AS $qa$
    BEGIN
      IF TG_OP <> 'INSERT' AND OLD.direction IN ('inbound','outbound') THEN
        EXECUTE format('UPDATE %I.conversations SET qa_revision=qa_revision+1 WHERE id=$1::uuid',TG_TABLE_SCHEMA) USING OLD.conversation_id;
      END IF;
      IF TG_OP <> 'DELETE' AND NEW.direction IN ('inbound','outbound')
         AND (TG_OP='INSERT' OR COALESCE(OLD.direction,'') NOT IN ('inbound','outbound') OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id) THEN
        EXECUTE format('UPDATE %I.conversations SET qa_revision=qa_revision+1 WHERE id=$1::uuid',TG_TABLE_SCHEMA) USING NEW.conversation_id;
      END IF;
      RETURN NULL;
    END $qa$`,
    `CREATE OR REPLACE TRIGGER qa_conversation_revision BEFORE UPDATE ON conversations
       FOR EACH ROW EXECUTE FUNCTION qa_conversation_revision()`,
    `CREATE OR REPLACE TRIGGER qa_message_revision AFTER INSERT OR UPDATE OR DELETE ON messages
       FOR EACH ROW EXECUTE FUNCTION qa_message_revision()`,
];
