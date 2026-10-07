/**
 * The 30 most recent messages of a conversation, newest first, for the model's history.
 *
 *  $1 conversation id
 *  $2 the live inbound message (excluded: it is re-added as the user turn), or NULL
 *  $3 the start of an unattended handoff when this turn is the replay of what the
 *     customer wrote while waiting, or NULL. Those inbound messages are already
 *     folded into the live turn, so leaving them here put each of them in the prompt
 *     twice. Everything before the handoff, and every outbound message, stays.
 */
export function conversationHistorySql(widgetProvenance: boolean): string {
    return `SELECT id, direction, content_text, metadata FROM messages WHERE conversation_id = $1::uuid
               AND ($2::uuid IS NULL OR id <> $2::uuid)
               AND ($3::timestamptz IS NULL OR NOT (direction = 'inbound' AND created_at > $3::timestamptz))
               ${widgetProvenance ? "AND content_type<>'redacted' AND content_text IS NOT NULL AND BTRIM(content_text)<>''" : ''}
             ORDER BY created_at DESC, id DESC LIMIT 30`;
}
