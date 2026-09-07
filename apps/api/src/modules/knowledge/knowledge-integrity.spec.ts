import { ConflictException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { knowledgeSourceAvailable } from './knowledge-contracts';

const tenantId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const stamp = new Date('2026-09-01T00:00:00Z');
beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00Z')));
afterAll(() => jest.useRealTimers());

function build() {
    const state = {
        doc: { id: documentId, title: 'Policy', file_type: 'text/plain', content_text: 'Old policy', version: 1, updated_at: stamp, status: 'ready', is_regulated: false },
        chunks: ['Old policy'], history: [] as string[], writes: [] as string[], failInsert: false,
    };
    const query = jest.fn(async (sql: string, params: any[] = []) => {
        if (sql.trimStart().startsWith('SELECT') && /SELECT .*version|SELECT id, title/s.test(sql)) return [{ ...state.doc }];
        state.writes.push(sql);
        if (sql.includes('INSERT INTO knowledge_document_versions')) state.history.push(state.doc.content_text);
        if (sql.includes('DELETE FROM knowledge_embeddings')) state.chunks = [];
        if (sql.includes('INSERT INTO knowledge_embeddings')) {
            if (state.failInsert) throw new Error('database insert failed');
            state.chunks.push(params[2]);
        }
        if (sql.includes('UPDATE knowledge_documents') && sql.includes('content_text = $3')) {
            Object.assign(state.doc, { title: params[1], content_text: params[2], version: params[10], status: 'ready' });
        }
        return [];
    });
    const prisma = {
        executeInTenantSchema: jest.fn((_schema: string, sql: string, params: any[]) => query(sql, params)),
        transactionInTenantSchema: jest.fn(async (_schema: string, callback: (q: typeof query) => Promise<unknown>) => {
            const before = { doc: { ...state.doc }, chunks: [...state.chunks], history: [...state.history] };
            try { return await callback(query); } catch (error) { Object.assign(state, before); throw error; }
        }),
    };
    const service = new KnowledgeService(prisma as any, {} as any, {} as any,
        { getPlanLimit: jest.fn().mockResolvedValue(Infinity) } as any, {} as any, {} as any);
    jest.spyOn(service as any, 'tenantSchema').mockResolvedValue('tenant_integrity');
    jest.spyOn(service as any, 'invalidateHasKnowledgeCache').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'prepareEmbeddedChunks').mockResolvedValue([
        { text: 'New policy part 1', embedding: '[0.1,0.2]', regconfig: 'english' },
        { text: 'New policy part 2', embedding: '[0.2,0.3]', regconfig: 'english' },
    ]);
    return { service, prisma, query, state };
}

describe('Knowledge source publication', () => {
    it('keeps the previous ready source and embeddings when the provider fails before publication', async () => {
        const { service, prisma, state } = build();
        (service as any).prepareEmbeddedChunks.mockRejectedValue(new Error('embedding timeout'));
        await expect(service.updateDocument(tenantId, documentId, { content: 'New policy' })).rejects.toThrow('embedding timeout');
        expect(state.doc).toMatchObject({ status: 'ready', version: 1, content_text: 'Old policy' });
        expect(state.chunks).toEqual(['Old policy']);
        expect(state.history).toEqual([]);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        expect(state.writes.some(sql => sql.includes('DELETE FROM knowledge_embeddings'))).toBe(false);
    });

    it('rolls back the entire source replacement if inserting a new chunk fails', async () => {
        const { service, state } = build();
        state.failInsert = true;
        await expect(service.updateDocument(tenantId, documentId, { content: 'New policy' })).rejects.toThrow('database insert failed');
        expect(state.doc).toMatchObject({ status: 'ready', version: 1, content_text: 'Old policy' });
        expect(state.chunks).toEqual(['Old policy']);
        expect(state.history).toEqual([]);
    });

    it('does not delete the live chunks when the second actual embedding request fails', async () => {
        const { service, prisma, state } = build();
        (service as any).prepareEmbeddedChunks.mockRestore();
        (service as any).redis = { get: jest.fn().mockResolvedValue('0') };
        jest.spyOn(service as any, 'ensureKbSearchVector').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'chunkText').mockReturnValue(['first', 'second']);
        jest.spyOn(service, 'generateEmbedding').mockResolvedValueOnce([0.1]).mockRejectedValueOnce(new Error('provider down'));
        await expect(service.updateDocument(tenantId, documentId, { content: 'New policy' })).rejects.toThrow('provider down');
        expect(service.generateEmbedding).toHaveBeenCalledTimes(2);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        expect(state.chunks).toEqual(['Old policy']);
    });

    it('publishes all chunks, content and version together, archiving the prior version once', async () => {
        const { service, state } = build();
        const result = await service.updateDocument(tenantId, documentId, { content: 'New policy' });
        expect(result).toMatchObject({ status: 'ready', version: 2, chunkCount: 2 });
        expect(state.doc).toMatchObject({ status: 'ready', version: 2, content_text: 'New policy' });
        expect(state.chunks).toEqual(['New policy part 1', 'New policy part 2']);
        expect(state.history).toEqual(['Old policy']);
    });

    it('does not overwrite a concurrent edit completed while embeddings were being generated', async () => {
        const { service, state } = build();
        (service as any).prepareEmbeddedChunks.mockImplementation(async () => {
            state.doc.version = 2;
            state.doc.content_text = 'Concurrent policy';
            state.chunks = ['Concurrent policy'];
            return [];
        });
        await expect(service.updateDocument(tenantId, documentId, { content: 'Slow policy' })).rejects.toBeInstanceOf(ConflictException);
        expect(state.chunks).toEqual(['Concurrent policy']);
        expect(state.history).toEqual([]);
    });
});

describe('Knowledge provenance and availability', () => {
    it.each([false, true])('preserves provenance after fusion and rerank=%s', async (rerank) => {
        const { service, prisma } = build();
        const row = {
            chunk_id: 'chunk', document_id: documentId, title: 'Rule', chunk_text: 'Applicable rule', chunk_index: 0,
            metadata: {}, distance: 0.1, doc_language: 'es', doc_is_regulated: true, doc_jurisdiction: 'CO',
            doc_authority: 'Source authority', doc_valid_from: '2026-01-01', doc_valid_to: '2026-12-31',
            doc_version: 4, doc_source_url: 'https://example.test/rule',
        };
        prisma.executeInTenantSchema.mockImplementation(async (_schema, sql) => sql.includes('FROM knowledge_embeddings') ? [row, { ...row, chunk_id: 'second' }] as any : []);
        (service as any).llmRouter = { execute: jest.fn().mockResolvedValue({ content: '[1,0]' }) };
        jest.spyOn(service as any, 'ensureKbSearchVector').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'embedQueryCached').mockResolvedValue([0.1, 0.2]);
        jest.spyOn(service as any, 'trackRetrieval').mockResolvedValue(undefined);
        const results = await service.searchRelevant(tenantId, 'Applicable rule', 2, { jurisdiction: 'CO', rerank });
        expect(results[0]).toMatchObject({
            doc_is_regulated: true, doc_jurisdiction: 'CO', doc_authority: 'Source authority',
            doc_valid_from: '2026-01-01', doc_valid_to: '2026-12-31', doc_version: 4, doc_source_url: row.doc_source_url,
        });
        expect(results[0].id).toBe(rerank ? 'second' : 'chunk');
    });

    it('requires explicit authority and country for regulated source metadata', () => {
        const { service } = build();
        expect(() => (service as any).validateSourceMetadata({ isRegulated: true })).toThrow();
        expect((service as any).validateSourceMetadata({ isRegulated: true, jurisdiction: ' co ', authority: 'Owner' }))
            .toEqual({ isRegulated: true, jurisdiction: 'CO', authority: 'Owner' });
    });

    it.each([{ validFrom: '2026-02-30' }, { validFrom: '2026-12-01', validTo: '2026-01-01' }, { jurisdiction: 'CO; DROP TABLE' }])(
        'rejects malformed validity and jurisdiction %j', (meta) => {
            const { service } = build();
            expect(() => (service as any).validateSourceMetadata(meta)).toThrow();
        },
    );

    it('does not expose internal or other-agent sources to a customer agent, including keyword hits', async () => {
        const { service, prisma } = build();
        const base = { title: 'Price', document_id: documentId, chunk_text: 'Price', distance: 0, doc_audience: 'customer', doc_agent_ids: [] };
        prisma.executeInTenantSchema.mockImplementation(async (_schema, sql) => sql.includes('FROM knowledge_embeddings') ? [
            { ...base, chunk_id: 'public' },
            { ...base, chunk_id: 'internal', doc_audience: 'internal' },
            { ...base, chunk_id: 'mine', doc_agent_ids: [tenantId] },
            { ...base, chunk_id: 'other', doc_agent_ids: [documentId] },
        ] as any : []);
        jest.spyOn(service as any, 'ensureKbSearchVector').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'embedQueryCached').mockResolvedValue([0.1, 0.2]);
        jest.spyOn(service as any, 'trackRetrieval').mockResolvedValue(undefined);
        const result = await service.searchRelevant(tenantId, 'Price', 5, { agentId: tenantId });
        expect(result.map(r => r.id)).toEqual(['public', 'mine']);
        for (const [, sql, params] of prisma.executeInTenantSchema.mock.calls.filter(([, sql]) => sql.includes('FROM knowledge_embeddings'))) {
            expect(sql).toContain('ANY(kd.agent_ids)');
            expect(sql).toContain('kd.audience');
            expect(params).toEqual(expect.arrayContaining([tenantId, 'customer']));
        }
    });

    it('treats missing agent context as unavailable for a scoped source', () => {
        expect(knowledgeSourceAvailable({ doc_audience: 'customer', doc_agent_ids: [tenantId], doc_is_regulated: false,
            doc_jurisdiction: null, doc_valid_from: null, doc_valid_to: null })).toBe(false);
    });

    it('applies expiry to business information and fails closed on unknown regulated jurisdiction', () => {
        const base = { doc_audience: 'customer' as const, doc_agent_ids: [], doc_is_regulated: false,
            doc_jurisdiction: null, doc_valid_from: null, doc_valid_to: null };
        expect(knowledgeSourceAvailable({ ...base, doc_valid_to: '2020-01-01' })).toBe(false);
        expect(knowledgeSourceAvailable({ ...base, doc_is_regulated: true }, { jurisdiction: 'CO' })).toBe(false);
        expect(knowledgeSourceAvailable({ ...base, doc_is_regulated: true, doc_jurisdiction: 'CO' }, { jurisdiction: 'CO' })).toBe(true);
    });

    it('rejects internally restricted sources published to the public portal', () => {
        const { service } = build();
        expect(() => (service as any).validateSourceMetadata({ audience: 'internal', isPublic: true })).toThrow();
        expect(() => (service as any).validateSourceMetadata({ agentIds: ['not-an-id'] })).toThrow();
    });
});
