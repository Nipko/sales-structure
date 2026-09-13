import { AIToolExecutorService } from './ai-tool-executor.service';

describe('knowledge tool retrieval policy parity', () => {
    it('passes the trusted threshold, language, reranking and attribution to the canonical search', async () => {
        const executor = Object.create(AIToolExecutorService.prototype) as any;
        executor.knowledgeService = {
            tenantHasKnowledge: jest.fn().mockResolvedValue(true),
            searchRelevant: jest.fn().mockResolvedValue([{ id: 'chunk', document_id: 'doc', chunk_text: 'Policy', doc_jurisdiction: 'CO', doc_authority: 'issuer', doc_is_regulated: true, doc_valid_to: '2027-01-01', doc_version: 2, doc_source_url: 'https://example.test/policy' }]),
        };
        const context = { mode: 'test', persistence: 'disabled' };
        const result = await executor.searchKnowledgeBase('tenant', 'policy', 4, context, 'CO', {
            similarityThreshold: 0.6, language: 'es', rerank: true, rerankTopN: 3,
        }, 'conversation');
        expect(executor.knowledgeService.searchRelevant).toHaveBeenCalledWith('tenant', 'policy', 4, {
            similarityThreshold: 0.6, language: 'es', rerank: true, rerankTopN: 3, executionContext: context, jurisdiction: 'CO', conversationId: 'conversation',
        });
        expect(JSON.stringify(result)).toContain('issuer');
        expect(JSON.stringify(result)).toContain('2027-01-01');
    });
    it('uses the runtime threshold when an older caller omits policy options', async () => {
        const executor = Object.create(AIToolExecutorService.prototype) as any;
        executor.knowledgeService = { tenantHasKnowledge: async () => true, searchRelevant: jest.fn().mockResolvedValue([]) };
        await executor.searchKnowledgeBase('tenant', 'query');
        expect(executor.knowledgeService.searchRelevant.mock.calls[0][3]).toMatchObject({ similarityThreshold: 0.35 });
    });
});
