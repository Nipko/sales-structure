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

export class LearningContactObjected extends ForbiddenException {
    constructor() { super({ error: 'learning_source_contact_objected', action: 'withdraw_source' }); }
}

/**
 * A customer who has objected stops teaching the agent.
 *
 * An executed erasure was already honoured on every path. The two objections
 * that come BEFORE an erasure were not: an opt-out record and a deletion
 * request are how a person says "stop" while the compliance queue still has
 * their data, and neither was visible to learning. So a conversation could be
 * imported as a training example, reviewed, published, and go on shaping every
 * future answer for that tenant while a deletion request for that same person
 * sat pending — the objection was recorded, acknowledged, and had no effect on
 * the one system that had already copied the words.
 *
 * Read as its own statement instead of joined into `readLearningInboxSource`:
 * that row is hashed whole into the import evidence, so an added column would
 * change every stored `sourceHash` at once and silently invalidate every source
 * ever imported. An objection is a gate over the snapshot, never part of it.
 *
 * `to_regclass` guards each table. The compliance tables belong to the canonical
 * tenant schema, but not to the minimal schemas evaluation namespaces and tests
 * build; where the table does not exist no objection can ever have been recorded
 * in it, so there is nothing to honour. That is an absent record, not an absent
 * check — and it is why the guard reads the catalog rather than swallowing 42P01,
 * which would also swallow a real permissions or search_path fault.
 *
 * A `rejected` opt-out is a reviewed false positive and does not object. Every
 * other status does, `pending` included: an unreviewed "stop" is still a stop.
 */
export async function objectingLearningContacts(query: LearningSourceQuery,
    contactIds: readonly (string | null | undefined)[]): Promise<string[]> {
    const ids = [...new Set(contactIds.filter((id): id is string => !!id))];
    if (!ids.length) return [];
    const [tables] = await query<any[]>(`SELECT to_regclass('leads') IS NOT NULL AS has_leads,
        to_regclass('opt_out_records') IS NOT NULL AS has_opt_outs,
        to_regclass('deletion_requests') IS NOT NULL AS has_deletions`);
    if (!tables?.has_leads) return [];
    const objections: string[] = [];
    if (tables.has_opt_outs) objections.push(`EXISTS(SELECT 1 FROM opt_out_records o
        WHERE o.lead_id=l.id AND COALESCE(o.status,'pending')<>'rejected')`);
    if (tables.has_deletions) objections.push(`EXISTS(SELECT 1 FROM deletion_requests d WHERE d.lead_id=l.id)`);
    if (!objections.length) return [];
    const rows = await query<any[]>(`SELECT DISTINCT l.contact_id::text AS contact_id FROM leads l
        WHERE l.contact_id=ANY($1::uuid[]) AND (${objections.join(' OR ')})`, [ids]);
    return rows.map(row => row.contact_id as string);
}

export async function assertLearningContactsAllowed(query: LearningSourceQuery,
    contactIds: readonly (string | null | undefined)[]): Promise<void> {
    if ((await objectingLearningContacts(query, contactIds)).length) throw new LearningContactObjected();
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
