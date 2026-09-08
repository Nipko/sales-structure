import { ForbiddenException } from '@nestjs/common';
import { learningSnapshotHash, type LearningMessage } from './learning-contracts';
import { retireLearningReleases } from './learning-evaluation-retention';

export type LearningSourceQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;
export class LearningInboxSourceUnavailable extends ForbiddenException {
    constructor() { super({ error: 'learning_inbox_source_changed', action: 'reimport_and_review' }); }
}
export interface LearningInboxEvidence {
    version: 1;
    kind: 'inbox_snapshot';
    agentId: string;
    conversationId: string;
    contactId: string;
    channel: string;
    sourceRevision: string;
    sourceHash: string;
    transcriptHash: string;
    messageIds: string[];
}

/** One statement binds identity, order and text to the same PostgreSQL snapshot.
 * Commit callers hold the conversation/contact locks until their write commits.
 * The message revision trigger serializes transcript edits with that fence.
 */
export async function readLearningInboxSource(query: LearningSourceQuery, conversationId: string, lock = false) {
    if(lock)await query('LOCK TABLE contact_identities IN SHARE MODE');
    const [row] = await query<any[]>(`SELECT current_schema() AS schema_name,c.id,c.contact_id,c.channel_type,
        to_jsonb(c)->>'qa_revision' AS source_revision,
        to_jsonb(c)->>'agent_id' AS source_agent_id,
        to_jsonb(c)->>'agent_persona_id' AS attributed_agent_id,
        ct.name,ct.phone,ct.email,
        ARRAY(SELECT DISTINCT ci.customer_profile_id::text FROM contact_identities ci
            WHERE ci.contact_id=c.contact_id ORDER BY ci.customer_profile_id::text) AS profile_ids,
        EXISTS(SELECT 1 FROM customer_memory_erasure d WHERE d.contact_id=c.contact_id) AS erased,
        COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at,m.id) FROM
            (SELECT id,direction,content_text,created_at FROM messages
             WHERE conversation_id=c.id AND direction IN ('inbound','outbound') AND content_text IS NOT NULL
             ORDER BY created_at,id LIMIT 201) m),'[]'::jsonb) AS messages
        FROM conversations c JOIN contacts ct ON ct.id=c.contact_id WHERE c.id=$1::uuid
        ${lock ? 'FOR SHARE OF c,ct NOWAIT' : ''}`, [conversationId]);
    if (!row || row.erased || row.source_revision == null || row.messages.length < 2 || row.messages.length > 200)
        throw new LearningInboxSourceUnavailable();
    const { erased, ...content } = row;
    return {
        conversationId: row.id as string, contactId: row.contact_id as string, channel: row.channel_type as string,
        sourceRevision: row.source_revision as string, sourceHash: learningSnapshotHash(content),
        messageIds: row.messages.map((m: any) => m.id) as string[],
        messages: row.messages.map((m: any): LearningMessage => ({
            role: m.direction === 'inbound' ? 'customer' : 'assistant', text: m.content_text,
            timestamp: new Date(m.created_at).toISOString(),
        })) as LearningMessage[],
        redactTerms: [row.name,row.phone,row.email].filter(Boolean) as string[],
        originals: row.messages.map((m: any) => ({ direction: m.direction,content_text: m.content_text,created_at: m.created_at })),
    };
}

export function learningInboxEvidence(agentId: string, source: Awaited<ReturnType<typeof readLearningInboxSource>>,
    transcript: LearningMessage[]): LearningInboxEvidence {
    return { version: 1,kind: 'inbox_snapshot',agentId,conversationId: source.conversationId,contactId: source.contactId,
        channel: source.channel,sourceRevision: source.sourceRevision,sourceHash: source.sourceHash,
        transcriptHash: learningSnapshotHash(transcript),messageIds: source.messageIds };
}

export async function assertLearningInboxSource(query: LearningSourceQuery, source: any, lock = false) {
    if (source.source_kind === 'file') return;
    if (source.source_kind !== 'inbox') throw new LearningInboxSourceUnavailable();
    const evidence = source.source_evidence as LearningInboxEvidence | null;
    // Legacy imports have no provable original version. Never infer/backfill approval.
    if (!evidence || evidence.version !== 1 || evidence.kind !== 'inbox_snapshot'
        || evidence.agentId !== source.agent_id || evidence.conversationId !== source.source_conversation_id
        || evidence.contactId !== source.source_contact_id || evidence.channel !== source.channel
        || evidence.transcriptHash !== learningSnapshotHash(source.transcript)) throw new LearningInboxSourceUnavailable();
    const current = await readLearningInboxSource(query,evidence.conversationId,lock);
    if (learningSnapshotHash(learningInboxEvidence(source.agent_id,current,source.transcript)) !== learningSnapshotHash(evidence))
        throw new LearningInboxSourceUnavailable();
    return current;
}

/** Reimporting a changed conversation requires new examples and a new review.
 * Retire train AND holdout derivatives, including any completed evaluation traces.
 */
export async function retireLearningSources(query: LearningSourceQuery, sourceIds: string[]) {
    if (!sourceIds.length) return;
    await query(`UPDATE learning_sources SET status='withdrawn',transcript='[]'::jsonb,source_evidence=NULL
        WHERE id=ANY($1::uuid[])`,[sourceIds]);
    const examples = await query<any[]>(`UPDATE learning_examples SET status='retired',episode='[]'::jsonb,
        response_pattern=NULL,rationale=NULL,facts_required='[]'::jsonb,analysis=NULL,embedding=NULL,review_note=NULL,updated_at=NOW()
        WHERE source_id=ANY($1::uuid[]) RETURNING id`,[sourceIds]);
    const ids = examples.map(e => e.id);
    await query(`DELETE FROM learning_reviews WHERE example_id=ANY($1::uuid[])`,[ids]);
    await retireLearningReleases(query,{sourceIds});
}
