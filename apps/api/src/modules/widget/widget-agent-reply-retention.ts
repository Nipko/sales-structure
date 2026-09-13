export type WidgetReplyRetentionQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Bootstrap outside any privacy/authority transaction. The inbound receipt has
 * no cascading message/contact FK: erasure must not remove its deduplication fact.
 * No text, media or copied source corpus belongs in either provenance table. */
export const WIDGET_AGENT_REPLY_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS widget_agent_replies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID, contact_id UUID, inbound_message_id UUID NOT NULL UNIQUE,
        channel_account_id TEXT, operational_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
        learning_footprint JSONB, message_id UUID NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('stored','redacted')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK(status='redacted' OR (conversation_id IS NOT NULL AND contact_id IS NOT NULL AND channel_account_id IS NOT NULL))
    )`,
    `CREATE TABLE IF NOT EXISTS widget_agent_reply_sources (
        reply_id UUID NOT NULL REFERENCES widget_agent_replies(id) ON DELETE CASCADE,
        source_id UUID NOT NULL, source_contact_id UUID,
        PRIMARY KEY(reply_id,source_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_widget_agent_replies_contact ON widget_agent_replies(contact_id) WHERE status='stored'`,
    `CREATE INDEX IF NOT EXISTS idx_widget_agent_replies_conversation ON widget_agent_replies(conversation_id) WHERE status='stored'`,
    `CREATE INDEX IF NOT EXISTS idx_widget_agent_reply_sources_source ON widget_agent_reply_sources(source_id,reply_id)`,
    `CREATE INDEX IF NOT EXISTS idx_widget_agent_reply_sources_contact ON widget_agent_reply_sources(source_contact_id,reply_id)`,
]);

export interface WidgetReplyRedactionScope {
    /** The caller expands the current unified contact family under the identity lock. */
    contactIds?: string[];
    sourceIds?: string[];
    releaseIds?: string[];
}

/** Redact on the caller's SAME tenant transaction. The exclusive privacy fence
 * excludes an admitted reply, history read or emit until redaction commits.
 * Source references survive release/source snapshot retirement, so erasing a
 * training OR holdout contact can redact replies sent to another recipient.
 * Keep only the receipt identity after redaction; never DELETE or revive it. */
export async function redactWidgetAgentReplies(query: WidgetReplyRetentionQuery, schema: string,
    input: WidgetReplyRedactionScope): Promise<number> {
    const contactIds = [...new Set(input.contactIds || [])].sort();
    const sourceIds = [...new Set(input.sourceIds || [])].sort();
    const releaseIds = [...new Set(input.releaseIds || [])].sort();
    if (!/^tenant_[a-z0-9_]+$/.test(schema) || [...contactIds,...sourceIds,...releaseIds].some(id => !UUID.test(id)))
        throw new Error('widget_reply_redaction_scope_invalid');
    if (!contactIds.length && !sourceIds.length && !releaseIds.length) return 0;
    const [tables] = await query<any[]>(`SELECT current_schema() AS schema,
        to_regclass($1)::text AS replies,to_regclass($2)::text AS sources`,
        [`${schema}.widget_agent_replies`, `${schema}.widget_agent_reply_sources`]);
    if (tables?.schema !== schema) throw new Error('widget_reply_redaction_scope_invalid');
    if (!tables.replies) return 0;
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
    // A missing source index beside an existing receipt table is a partial
    // migration, not evidence that no derived replies exist. Fail atomically.
    if (!tables.sources) throw new Error('widget_reply_source_index_unavailable');
    const rows = await query<any[]>(`SELECT r.id,r.message_id FROM widget_agent_replies r
        WHERE r.status='stored' AND (
            r.contact_id=ANY($1::uuid[])
            OR EXISTS(SELECT 1 FROM widget_agent_reply_sources s WHERE s.reply_id=r.id
                AND (s.source_contact_id=ANY($1::uuid[]) OR s.source_id=ANY($2::uuid[])))
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE
                WHEN jsonb_typeof(r.learning_footprint)='array' THEN r.learning_footprint ELSE '[]'::jsonb END) footprint
                CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(footprint->'entries')='array'
                    THEN footprint->'entries' ELSE '[]'::jsonb END) entry WHERE entry->>'releaseId'=ANY($3::text[])))
        ORDER BY r.id FOR UPDATE OF r`, [contactIds,sourceIds,releaseIds]);
    if (!rows.length) return 0;
    const ids = rows.map(row => row.id);
    // A redacted content type is excluded by the existing persisted Widget
    // transport. Clearing every content carrier also protects other readers.
    await query(`UPDATE messages SET content_type='redacted',content_text=NULL,
        media_url=NULL,media_mime_type=NULL,caption=NULL,metadata='{}'::jsonb,status='redacted'
        WHERE id=ANY($1::uuid[])`, [rows.map(row => row.message_id)]);
    await query(`UPDATE widget_agent_replies SET status='redacted',conversation_id=NULL,contact_id=NULL,
        channel_account_id=NULL,operational_scope='{}'::jsonb,learning_footprint=NULL WHERE id=ANY($1::uuid[])`, [ids]);
    await query('DELETE FROM widget_agent_reply_sources WHERE reply_id=ANY($1::uuid[])', [ids]);
    return rows.length;
}
