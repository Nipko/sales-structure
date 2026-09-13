import { KnowledgeService } from './knowledge.service';

function publicHarness(results: Array<Promise<unknown>>) {
    const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
    const queue = [...results];
    Object.assign(service as any, {
        prisma: { executeInTenantSchema: jest.fn(() => queue.shift()) },
        logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
        resolveSchemaFromSlug: jest.fn().mockResolvedValue('tenant_public_kb'),
    });
    return service;
}

describe('public knowledge availability is not confused with empty content', () => {
    it('serves the surviving canonical source during a one-table compatibility gap', async () => {
        const article = { id: 'doc-1', slug: 'returns' };
        const service = publicHarness([
            Promise.reject(new Error('legacy table absent')),
            Promise.resolve([article]),
        ]);

        await expect(service.getPublicArticles('store')).resolves.toEqual([article]);
    });

    it('fails when neither source can prove the public catalogue', async () => {
        const service = publicHarness([
            Promise.reject(new Error('connection lost')),
            Promise.reject(new Error('connection lost')),
        ]);

        await expect(service.getPublicArticles('store')).rejects.toThrow('public_knowledge_unavailable');
    });

    it('returns an article proved by either source even when the sibling source is absent', async () => {
        const article = { id: 'doc-2', slug: 'shipping' };
        const service = publicHarness([
            Promise.reject(new Error('legacy table absent')),
            Promise.resolve([article]),
        ]);

        await expect(service.getPublicArticle('store', 'shipping')).resolves.toEqual(article);
    });

    it('does not answer not-found from one empty result and one failed lookup', async () => {
        const service = publicHarness([
            Promise.resolve([]),
            Promise.reject(new Error('connection lost')),
        ]);

        await expect(service.getPublicArticle('store', 'shipping')).rejects.toThrow('public_knowledge_unavailable');
    });
});

describe('knowledge suggestions redact provider failures', () => {
    it('returns a localized closed error instead of provider credentials or request text', async () => {
        const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
        const prisma = {
            executeInTenantSchema: jest.fn()
                .mockResolvedValueOnce([{ query: 'precio', occurrences: 2 }])
                .mockResolvedValueOnce([]),
        };
        Object.assign(service as any, {
            prisma,
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
            tenantSchema: jest.fn().mockResolvedValue('tenant_secret'),
            getTenantLanguage: jest.fn().mockResolvedValue('es'),
            ensureOpenAI: jest.fn().mockRejectedValue(
                new Error('Authorization Bearer sk-private SELECT tenant_secret'),
            ),
        });

        const result = await service.generateArticleSuggestions('tenant-id');

        expect(result).toMatchObject({
            suggestions: [],
            error: 'suggestions_unavailable',
        });
        expect(JSON.stringify(result)).not.toMatch(/sk-private|tenant_secret|Authorization Bearer/);
    });
});
