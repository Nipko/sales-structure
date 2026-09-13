import { randomUUID } from 'crypto';
import { revisionHash } from '../../evaluation-revision/evaluation-revision';
import { KNOWLEDGE_REPLICA_SLOT_BYTES, type EvaluationKnowledgeReplica } from '../../evaluation-revision/evaluation-knowledge-replica';

/** Synthetic sealed descriptor for unit tests. Database ownership and expiry
 * are exercised by the real PostgreSQL integration suites, never by this stub. */
export function evaluationKnowledgeFixture(tenantId: string, agentId: string, sourceSchema = 'tenant_test'): EvaluationKnowledgeReplica {
    const tables = ['knowledge_documents', 'knowledge_embeddings', 'faqs', 'policies', 'companies',
        'knowledge_conflict_cases', 'knowledge_conflict_decisions'];
    const capturedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const body = { version: 1 as const, kind: 'knowledge_replica' as const,
        lease: { tenantId, sourceSchema, schemaName: 'tenant_eval_11111111_111111111111111111111111',
            token: randomUUID(), expiresAt, tables }, capturedAt, keywordSearch: 'available' as const,
        collections: Object.fromEntries(tables.map(table => [table, { state: 'present', rows: 0, hash: revisionHash([]) }])) as EvaluationKnowledgeReplica['collections'],
        management: { slot: 0, sourceRevision: revisionHash('fixture'), reservedBytes: KNOWLEDGE_REPLICA_SLOT_BYTES } };
    return { ...body, integrityHash: revisionHash(body), usage: { token: randomUUID(), agentId, expiresAt } };
}
