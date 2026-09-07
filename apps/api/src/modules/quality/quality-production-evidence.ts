import { PrismaService } from '../prisma/prisma.service';
import type { JudgeResult } from './quality.service';
import { QUALITY_MESSAGE_LIMIT, QUALITY_RUBRIC_VERSION, qualityHash, qualityTranscript } from './quality-evidence';

/** The shared privacy fence spans provider I/O and persistence. Erasure either wins
 * before any transcript leaves the DB or waits, then deletes all derived evidence. */
export async function scoreProductionEvidence(
    prisma: PrismaService,
    schemaName: string,
    conversationId: string,
    rubricHash: string,
    judgeTranscript: (transcript: string) => Promise<JudgeResult>,
) {
    return prisma.transactionInTenantSchema(schemaName, async (query) => {
        await query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text`, [`agent-privacy:${schemaName}`]);
        await query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text`, [`quality:${schemaName}:${conversationId}`]);
        const conversations = await query<any[]>(`SELECT id,contact_id,status,resolution_type,was_handed_off,
            agent_persona_id,agent_config_version,agent_attribution_conflicted,qa_revision
            FROM conversations WHERE id=$1::uuid`, [conversationId]);
        const conversation = conversations[0];
        if (!conversation?.contact_id) return { status: 'unavailable' as const };
        const erased = await query<any[]>(`SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid`, [conversation.contact_id]);
        if (erased.length) return { status: 'erased' as const };
        const existing = await query<any[]>(`SELECT id FROM conversation_quality_scores
            WHERE conversation_id=$1::uuid AND source_revision=$2::bigint AND rubric_hash=$3`,
        [conversationId, String(conversation.qa_revision), rubricHash]);
        if (existing.length) return { status: 'already_scored' as const, evidenceId: existing[0].id };

        const counts = await query<any[]>(`SELECT COUNT(*)::int AS total_messages,
            COUNT(*) FILTER (WHERE content_text IS NOT NULL AND content_text <> '')::int AS text_messages
            FROM messages WHERE conversation_id=$1::uuid AND direction IN ('inbound','outbound')`, [conversationId]);
        const messages = await query<any[]>(`SELECT * FROM (
            SELECT id,direction,RIGHT(content_text,24000) AS content_text,
                CHAR_LENGTH(content_text) AS original_characters,created_at
            FROM messages WHERE conversation_id=$1::uuid AND direction IN ('inbound','outbound') AND content_text IS NOT NULL AND content_text <> ''
            ORDER BY created_at DESC,id DESC LIMIT $2
        ) recent ORDER BY created_at ASC,id ASC`, [conversationId, QUALITY_MESSAGE_LIMIT]);
        if (messages.length < 2) return { status: 'insufficient_messages' as const };
        const selected = qualityTranscript(messages, Number(counts[0].total_messages), Number(counts[0].text_messages));
        // A revision read after both message queries detects changes between their snapshots.
        const captured = await query<any[]>(`SELECT qa_revision FROM conversations WHERE id=$1::uuid`, [conversationId]);
        if (String(captured[0]?.qa_revision) !== String(conversation.qa_revision)) throw new Error('quality_source_changed');

        const attributionEligible = conversation.resolution_type === 'ai_resolved'
            && !conversation.was_handed_off && !conversation.agent_attribution_conflicted;
        const agentId = attributionEligible ? conversation.agent_persona_id ?? null : null;
        const agentConfigVersion = agentId && conversation.agent_config_version != null ? Number(conversation.agent_config_version) : null;
        let configuration: Record<string, unknown> = { state: 'unavailable', reason: 'unattributed_conversation' };
        if (agentId && agentConfigVersion != null) {
            const configs = await query<any[]>(`SELECT config_json,version FROM agent_personas WHERE id=$1::uuid`, [agentId]);
            configuration = configs[0] && Number(configs[0].version) === agentConfigVersion
                ? { state: 'captured', agentId, version: agentConfigVersion, hash: qualityHash(configs[0].config_json), config: configs[0].config_json }
                : { state: 'unavailable', agentId, version: agentConfigVersion, reason: 'historical_configuration_unavailable' };
        }
        const judge = await judgeTranscript(selected.transcript);

        // Locks only the final CAS, never the conversation during slow provider work.
        // Message triggers acquire this row lock too, so their commit cannot interleave
        // between this comparison and INSERT. Later edits invalidate current readers.
        const current = await query<any[]>(`SELECT qa_revision FROM conversations WHERE id=$1::uuid FOR UPDATE`, [conversationId]);
        if (String(current[0]?.qa_revision) !== String(conversation.qa_revision)) throw new Error('quality_source_changed');
        const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n * 10) / 10));
        const rows = await query<any[]>(`INSERT INTO conversation_quality_scores
            (conversation_id, agent_id, agent_config_version, overall_score,resolution_score,tone_score,accuracy_score,empathy_score,
             flags,resolution_type,resolution_verified,verification_reason,scored_by,rubric_version,
             source_revision,source_message_ids,transcript_hash,coverage,rubric_hash,configuration_snapshot,
             conversational_resolved,conversational_resolution_reason,operational_outcome)
            VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,NULL,NULL,'ai',$11,
                $12::bigint,$13::uuid[],$14,$15::jsonb,$16,$17::jsonb,$18,$19,'unknown')
            ON CONFLICT (conversation_id,source_revision,rubric_hash) DO NOTHING RETURNING id`, [
            conversationId, agentId, agentConfigVersion, clamp(judge.overall), clamp(judge.resolution),
            clamp(judge.tone), clamp(judge.accuracy), clamp(judge.empathy),
            JSON.stringify(judge.flags.slice(0,10).map((flag) => flag.slice(0,240))), conversation.resolution_type,
            QUALITY_RUBRIC_VERSION, String(conversation.qa_revision), selected.messageIds,
            qualityHash(selected.transcript), JSON.stringify(selected.coverage), rubricHash, JSON.stringify(configuration),
            selected.coverage.complete ? judge.resolved : null, judge.resolutionReason.slice(0,500),
        ]);
        // No write to conversations.resolution_verified: only a future operational
        // verifier with an explicit source may write that independent field.
        return { status: 'scored' as const, evidenceId: rows[0]?.id, agentId, agentConfigVersion,
            sourceRevision: String(conversation.qa_revision), coverage: selected.coverage };
    }, { timeout: 120_000 });
}
