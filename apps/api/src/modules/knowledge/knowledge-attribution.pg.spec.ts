import { randomUUID } from 'crypto';
import { KnowledgeService } from './knowledge.service';
import { ComplianceService } from '../compliance/compliance.service';
import type { RetrievedKnowledgeItem } from '@parallext/shared';

// Opt-in integration against a disposable loopback PostgreSQL database only.
// This suite owns exactly one random schema and never reads public tenant rows.
const databaseUrl = process.env.KNOWLEDGE_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Knowledge attribution on real PostgreSQL', () => {
    const schema = `tenant_knowledge_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID(), contactId = randomUUID(), conversationId = randomUUID(), otherConversationId = randomUUID();
    const documentId = randomUUID(), chunkId = randomUUID(), retrievalId = randomUUID();
    const source: RetrievedKnowledgeItem = { source: 'kb_article', id: chunkId, documentId, retrievalId, title: 'Conditions', content: 'Current conditions.' };
    let pool: any, prisma: any, service: KnowledgeService;

    async function transaction<T>(work: (query: <R = any[]>(sql: string, params?: any[]) => Promise<R>) => Promise<T>) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL search_path TO "${schema}", public`);
            const result = await work(async (sql, params = []) => (await client.query(sql, params)).rows);
            await client.query('COMMIT'); return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }
    const execute = (sql: string, params: any[] = []): Promise<any[]> => transaction(query => query(sql, params));
    const track = (results: any[]) => (service as any).trackRetrieval(schema, tenantId, 'Customer private query', results, 0.35, conversationId);
    const result = { id: chunkId, document_id: documentId, retrievalId, score: 0.9, title: 'Conditions', doc_version: 2 };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('Knowledge integration requires a disposable loopback *_eval_isolation database');
        }
        const { Pool } = require('pg');
        pool = new Pool({ connectionString: databaseUrl, max: 6 });
        if (!/^tenant_knowledge_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_test_schema');
        await pool.query(`CREATE SCHEMA "${schema}"`);
        for (const statement of [
            `CREATE TABLE contacts(id UUID PRIMARY KEY)`,
            `CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID,metadata JSONB DEFAULT '{}'::jsonb)`,
            `CREATE TABLE messages(id UUID PRIMARY KEY,conversation_id UUID)`,
            `CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)`,
            `CREATE TABLE customer_memory_facts(id UUID,owner_kind TEXT,owner_id UUID,source_contact_id UUID)`,
            `CREATE TABLE customer_memories(contact_id UUID)`,
            `CREATE TABLE knowledge_documents(id UUID PRIMARY KEY,title TEXT,source_type TEXT,status TEXT,version INT,
                content_text TEXT,chunk_count INT,category TEXT,is_regulated BOOLEAN,authority TEXT,jurisdiction TEXT,
                valid_from DATE,valid_to DATE,error_message TEXT,satisfaction_score NUMERIC,feedback_count INT,
                updated_at TIMESTAMP DEFAULT NOW(),created_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE kb_retrieval_log(id UUID DEFAULT gen_random_uuid() PRIMARY KEY,document_id UUID REFERENCES knowledge_documents(id),
                chunk_id UUID,query TEXT NOT NULL,score NUMERIC,was_used BOOLEAN DEFAULT false,conversation_id UUID,created_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE kb_unanswered_queries(id UUID DEFAULT gen_random_uuid() PRIMARY KEY,query TEXT,query_hash TEXT,occurrences INT,
                last_seen_at TIMESTAMP,resolved BOOLEAN DEFAULT false)`,
            `CREATE UNIQUE INDEX kb_test_unanswered ON kb_unanswered_queries(query_hash) WHERE resolved=false`,
        ]) await execute(statement);
        prisma = {
            executeInTenantSchema: async (name: string, sql: string, params: any[] = []) => {
                if (name !== schema) throw new Error('test_scope_violation');
                return execute(sql, params);
            },
            transactionInTenantSchema: async (name: string, action: any) => {
                if (name !== schema) throw new Error('test_scope_violation');
                return transaction(action);
            },
        };
        service = new KnowledgeService(prisma, { get: async () => null, set: async () => undefined } as any,
            {} as any, {} as any, {} as any, {} as any);
        jest.spyOn(service as any, 'tenantSchema').mockResolvedValue(schema);
        await (service as any).ensureAttributionSchema(schema);
        await (service as any).ensureKbFeedbackTable(schema);
    });

    beforeEach(async () => {
        await execute(`TRUNCATE contacts,conversations,messages,knowledge_documents,kb_retrieval_log,kb_unanswered_queries,
            kb_feedback,customer_memory_erasure,contact_identities,customer_memory_facts,customer_memories CASCADE`);
        await execute(`INSERT INTO contacts(id) VALUES ($1::uuid)`, [contactId]);
        await execute(`INSERT INTO conversations(id,contact_id) VALUES ($1::uuid,$2::uuid),($3::uuid,$2::uuid)`, [conversationId, contactId, otherConversationId]);
        await execute(`INSERT INTO knowledge_documents(id,title,source_type,status,version,content_text,chunk_count,updated_at)
            VALUES ($1::uuid,'Conditions','text','ready',2,'Current conditions.',2,'2026-08-01')`, [documentId]);
    });

    afterAll(async () => {
        if (pool) {
            if (!/^tenant_knowledge_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_test_cleanup_scope');
            try { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await pool.end(); }
        }
    });

    it('keeps legacy relevance out of response evidence and counts searches/documents rather than chunks', async () => {
        await execute(`INSERT INTO kb_retrieval_log(document_id,query,score,was_used) VALUES ($1::uuid,'legacy',0.99,true)`, [documentId]);
        const second = { ...result, id: randomUUID(), retrievalId: randomUUID(), score: 0.2 };
        await track([result, second]);
        expect((await execute(`SELECT was_used,relevance_passed FROM kb_retrieval_log WHERE attribution_version=1`)))
            .toEqual(expect.arrayContaining([{ was_used: false, relevance_passed: true }, { was_used: false, relevance_passed: false }]));
        expect((await service.recordResponseAttribution(tenantId, otherConversationId, '[Article: Conditions]', [source])).persistence).toBe('incomplete');
        const report = await service.recordResponseAttribution(tenantId, conversationId, '[Article: Conditions]',
            [source, { ...source, id: second.id, retrievalId: second.retrievalId }]);
        expect(report.persistence).toBe('recorded');
        await track([]);
        const analytics = await service.getAnalytics(tenantId);
        expect(analytics.overview).toMatchObject({ uniqueQueries: 1, totalRetrievals: 2, hitRate: 0.5,
            observedRate: 1, assessedSearches: 1, candidateSearches: 1, legacyRows: 1 });
        expect(analytics.topDocuments[0]).toMatchObject({ document_id: documentId, document_name: 'Conditions', retrieval_count: 1, used_count: 1 });
        expect(analytics.dailyVolume[0]).toMatchObject({ queries: 2, hits: 1 });
        expect(analytics.dailyVolume[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect((await service.getDocumentQualityScores(tenantId))[0]).toMatchObject({ readiness: 'ready', correctnessStatus: 'unverified', stats: { usedCount: 1 } });
    });

    it('negative feedback and corrections trigger review without refreshing document currency', async () => {
        const feedback = await service.submitFeedback(tenantId, { conversationId, documentId, rating: 1, comment: 'private correction' });
        await service.markFalsePositive(tenantId, feedback.id);
        const rows = await execute(`SELECT updated_at FROM knowledge_documents WHERE id=$1::uuid`, [documentId]);
        expect(rows[0].updated_at.toISOString().slice(0, 10)).toBe('2026-08-01');
        expect((await service.getDocumentQualityScores(tenantId))[0]).toMatchObject({ readiness: 'review_required',
            reasons: ['retrieval_corrections', 'negative_feedback'], correctnessStatus: 'unverified' });
    });

    it('real erasure removes query/hashes, redacts feedback and prevents late analytics resurrection', async () => {
        await track([{ ...result, score: 0.2 }]);
        await service.recordResponseAttribution(tenantId, conversationId, '[Article: Conditions]', [source]);
        await service.submitFeedback(tenantId, { conversationId, documentId, rating: 1, query: 'Private query', comment: 'Private comment' });
        const compliance = new ComplianceService(prisma);
        await (compliance as any).eraseCustomerMemory(schema, contactId, tenantId);
        expect(await execute(`SELECT id FROM kb_retrieval_log`)).toEqual([]);
        expect(await execute(`SELECT id FROM kb_unanswered_queries`)).toEqual([]);
        expect(await execute(`SELECT query,comment,message_id FROM kb_feedback`)).toEqual([{ query: null, comment: null, message_id: null }]);
        await track([result]);
        expect((await service.recordResponseAttribution(tenantId, conversationId, '[Article: Conditions]', [source])).persistence).toBe('contact_erased');
        expect(await execute(`SELECT id FROM kb_retrieval_log`)).toEqual([]);
    });

    it('a queued finalizer cannot cross an in-progress exclusive erasure lock', async () => {
        await track([result]);
        const erasure = await pool.connect();
        try {
            await erasure.query('BEGIN');
            await erasure.query(`SET LOCAL search_path TO "${schema}", public`);
            await erasure.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`agent-privacy:${schema}`]);
            const finalizing = service.recordResponseAttribution(tenantId, conversationId, '[Article: Conditions]', [source]);
            await erasure.query(`INSERT INTO customer_memory_erasure(contact_id) VALUES ($1::uuid)`, [contactId]);
            await erasure.query(`DELETE FROM kb_retrieval_log WHERE conversation_id=$1::uuid`, [conversationId]);
            await erasure.query('COMMIT');
            expect((await finalizing).persistence).toBe('contact_erased');
            expect(await execute(`SELECT id FROM kb_retrieval_log`)).toEqual([]);
        } finally { await erasure.query('ROLLBACK'); erasure.release(); }
    });
});
