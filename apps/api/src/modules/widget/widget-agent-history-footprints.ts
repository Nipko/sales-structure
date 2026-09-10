import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import type { LearningSourceQuery } from '../learning/learning-inbox-source';
import type { RuntimeLearningFootprint } from '../learning/learning-runtime-footprint';
import { mergeAgentReplyLearningFootprints } from '../conversations/agent-reply-provenance';
import { validServedAgentAuthority } from '../persona/served-agent-authority';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface WidgetAgentHistoryFootprints {
    footprints: RuntimeLearningFootprint[];
    trustedMessageIds: string[];
}

/** The store supplies its already-bound tenant/privacy transaction. Missing
 * receipts are untracked history, never evidence of "no learning". A redacted
 * receipt invalidates a previously loaded text snapshot, even after its contact
 * and conversation links were erased. No raw message text is read or returned. */
export async function readWidgetAgentHistoryFootprints(query: LearningSourceQuery, schema: string,
    tenantId: string, conversationId: string, messageIds: readonly string[]): Promise<WidgetAgentHistoryFootprints> {
    if (!/^[a-z][a-z0-9_]*$/.test(schema) || !UUID.test(tenantId) || !UUID.test(conversationId)
        || !Array.isArray(messageIds) || messageIds.some(id => !UUID.test(id))) throw new LLMSourceAuthorityUnavailable();
    const ids = [...new Set(messageIds)];
    if (!ids.length) return {footprints:[],trustedMessageIds:[]};
    const rows = await query<any[]>(`SELECT message_id,conversation_id,status,operational_scope,learning_footprint
        FROM widget_agent_replies WHERE message_id=ANY($1::uuid[])`, [ids]);
    const groups: RuntimeLearningFootprint[] = [];
    const trusted = new Set<string>();
    for (const row of rows) {
        if (!ids.includes(row.message_id) || row.status === 'redacted') throw new LLMSourceAuthorityUnavailable();
        if (row.status !== 'stored' || row.conversation_id !== conversationId
            || !validServedAgentAuthority(row.operational_scope, schema, tenantId)
            || !Array.isArray(row.learning_footprint)) throw new LLMSourceAuthorityUnavailable();
        groups.push(...row.learning_footprint);
        trusted.add(row.message_id);
    }
    return {footprints:[...mergeAgentReplyLearningFootprints(tenantId, groups)],
        trustedMessageIds:ids.filter(id => trusted.has(id))};
}
