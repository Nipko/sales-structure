import { createHash } from 'crypto';

export const QUALITY_RUBRIC_VERSION = 'v3';
export const QUALITY_MESSAGE_LIMIT = 60;
export const QUALITY_CHARACTER_LIMIT = 24_000;

export interface QualityCoverage {
    totalMessages: number;
    textMessages: number;
    selectedMessages: number;
    omittedMessages: number;
    truncatedMessages: number;
    selectedCharacters: number;
    complete: boolean;
    selection: 'latest_text_messages';
}

/** Tail selection keeps the closing turn. Missing media/text is explicit evidence loss. */
export function qualityTranscript(
    rows: Array<{ id: string; direction: string; content_text: string; original_characters: number }>,
    totalMessages: number,
    textMessages: number,
) {
    let remaining = QUALITY_CHARACTER_LIMIT;
    let truncatedMessages = 0;
    const selected: Array<{ id: string; line: string }> = [];
    for (const row of rows.filter(row => row.direction === 'inbound' || row.direction === 'outbound').reverse()) {
        const prefix = row.direction === 'inbound' ? 'Cliente: ' : 'Agente: ';
        if (remaining <= prefix.length + 1) break;
        const content = row.content_text.slice(-(remaining - prefix.length - 1)).replace(/^[\uDC00-\uDFFF]/, '');
        if (Array.from(content).length < Number(row.original_characters)) truncatedMessages++;
        const line = `${prefix}${content}`;
        selected.unshift({ id: row.id, line });
        remaining -= line.length + 1;
    }
    const transcript = selected.map((row) => row.line).join('\n');
    const coverage: QualityCoverage = {
        totalMessages, textMessages, selectedMessages: selected.length,
        omittedMessages: Math.max(0, totalMessages - selected.length), truncatedMessages,
        selectedCharacters: transcript.length,
        complete: totalMessages === selected.length && truncatedMessages === 0,
        selection: 'latest_text_messages',
    };
    return { transcript, messageIds: selected.map((row) => row.id), coverage };
}

export function qualityHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** All consumers use current revisions only; old text-only "verified" flags are never evidence. */
export const CURRENT_QUALITY_CTE = `WITH current_quality AS (
    SELECT DISTINCT ON (q.conversation_id) q.*
    FROM conversation_quality_scores q JOIN conversations c ON c.id=q.conversation_id
    WHERE q.source_revision=c.qa_revision AND q.rubric_version='v3' AND q.rubric_hash=$3
      AND NOT EXISTS (SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=c.contact_id)
    ORDER BY q.conversation_id,q.created_at DESC,q.id DESC
)`;
