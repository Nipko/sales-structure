import OpenAI from 'openai';
import { BadRequestException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { EmbeddingBreaker, EmbeddingProviderUnavailable, isEmbeddingOutage, lexicalCoverage } from './embedding-fallback';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import type { ExternalSourceAuthority } from '../ai/interfaces/external-source-authority';

const tenant = '11111111-1111-4111-8111-111111111111';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' } });
const vector = () => json({ object: 'list', model: 'text-embedding-3-small', data: [{ object: 'embedding', index: 0,
    embedding: Buffer.from(new Float32Array([0.25, 0.5]).buffer).toString('base64') }], usage: { prompt_tokens: 9, total_tokens: 9 } });
const noCredits = () => json({ error: { message: 'You have no credits remaining. Add credits to continue using the API.', type: 'insufficient_quota', code: 'insufficient_quota' } }, 429);

const lexicalRow = (id: string, matched: number, total: number, allTerms: boolean) => ({
    chunk_id: id, document_id: `doc-${id}`, title: 'Información de la clínica', chunk_text: `Texto ${id}`, chunk_index: 0, metadata: {},
    doc_language: 'es', doc_is_regulated: false, doc_version: 1, doc_audience: 'customer', doc_agent_ids: [],
    all_terms: allTerms, matched_terms: matched, total_terms: total,
});

function fixture() {
    const fetch = jest.fn(async (_url: any, _init: any) => vector());
    const client = new OpenAI({ apiKey: 'synthetic-test-key', fetch: fetch as any });
    const redis = {
        getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined),
        incrBy: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1), sadd: jest.fn().mockResolvedValue(1),
    };
    const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([]) };
    const llm = { execute: jest.fn() };
    const knowledge = new KnowledgeService(prisma as any, redis as any, {} as any, {} as any, {} as any, llm as any);
    jest.spyOn(knowledge as any, 'ensureOpenAI').mockResolvedValue(client);
    jest.spyOn(knowledge as any, 'tenantSchema').mockResolvedValue('tenant_source');
    const sqlOf = (needle: string) => prisma.executeInTenantSchema.mock.calls.filter(call => String(call[1]).includes(needle));
    return { knowledge, fetch, redis, prisma, sqlOf };
}

describe('isEmbeddingOutage', () => {
    it('treats provider unavailability as an outage', () => {
        expect(isEmbeddingOutage({ status: 429, message: '429 You have no credits remaining' })).toBe(true);
        expect(isEmbeddingOutage({ status: 429, message: 'Rate limit reached' })).toBe(true);
        expect(isEmbeddingOutage({ status: 503, message: 'Service Unavailable' })).toBe(true);
        expect(isEmbeddingOutage({ status: 401, message: 'Incorrect API key provided' })).toBe(true);
        expect(isEmbeddingOutage(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }))).toBe(true);
        expect(isEmbeddingOutage(new BadRequestException({ error: 'embeddings_unavailable', message: 'no key' }))).toBe(true);
        expect(isEmbeddingOutage(new EmbeddingProviderUnavailable('breaker_open'))).toBe(true);
    });
    it('never treats a revoked source or our own bug as an outage', () => {
        expect(isEmbeddingOutage(new LLMSourceAuthorityUnavailable())).toBe(false);
        expect(isEmbeddingOutage({ status: 400, message: 'Invalid input' })).toBe(false);
        expect(isEmbeddingOutage(new TypeError('cannot read properties of undefined'))).toBe(false);
    });
});

describe('EmbeddingBreaker and lexicalCoverage', () => {
    it('opens for its window and closes on its own', () => {
        let now = 1_000;
        const breaker = new EmbeddingBreaker(() => now, 60_000);
        expect(breaker.isOpen()).toBe(false);
        breaker.trip('quota');
        expect(breaker.isOpen()).toBe(true);
        expect(breaker.kind()).toBe('quota');
        now += 60_000;
        expect(breaker.isOpen()).toBe(false);
    });
    it('is the share of query lexemes found, bounded to 0–1', () => {
        expect(lexicalCoverage(2, 4)).toBe(0.5);
        expect(lexicalCoverage('3', '3')).toBe(1);
        expect(lexicalCoverage(1, 0)).toBe(0);
        expect(lexicalCoverage(null, 5)).toBe(0);
    });
});

describe('generateEmbedding during an OpenAI outage', () => {
    it('surfaces an out-of-credit 429 as EmbeddingProviderUnavailable and skips OpenAI on the next call', async () => {
        const f = fixture();
        f.fetch.mockImplementation(async () => noCredits());
        const authority: ExternalSourceAuthority = async invoke => invoke();
        await expect(f.knowledge.generateEmbedding('hola', tenant, AGENT_TEST_EXECUTION_CONTEXT, authority))
            .rejects.toBeInstanceOf(EmbeddingProviderUnavailable);
        // No credit is not transient: no retries against an empty account.
        expect(f.fetch).toHaveBeenCalledTimes(1);
        await expect(f.knowledge.generateEmbedding('hola', tenant)).rejects.toMatchObject({ kind: 'quota' });
        expect(f.fetch).toHaveBeenCalledTimes(1);
    });
    it('honours the router breaker shared in Redis without calling OpenAI', async () => {
        const f = fixture();
        f.redis.get.mockImplementation(async (key: string) => key === 'llm:health:openai:open' ? '1' : null);
        await expect(f.knowledge.generateEmbedding('hola', tenant)).rejects.toMatchObject({ kind: 'breaker_open' });
        expect(f.fetch).not.toHaveBeenCalled();
    });
    it('still embeds and records usage when OpenAI answers', async () => {
        const f = fixture();
        expect(await f.knowledge.generateEmbedding('hola', tenant)).toEqual([0.25, 0.5]);
        await new Promise(resolve => setImmediate(resolve));
        expect(f.redis.incrBy).toHaveBeenCalledWith(expect.stringMatching(/:embeddings:calls$/), 1);
    });
});

describe('searchRelevant degrades to the lexical index', () => {
    it('returns lexical hits instead of failing when OpenAI has no credit', async () => {
        const f = fixture();
        f.fetch.mockImplementation(async () => noCredits());
        f.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => {
            if (sql.includes('loose_q')) return [lexicalRow('a', 3, 3, true), lexicalRow('b', 2, 6, false), lexicalRow('c', 1, 6, false)];
            return [];
        });
        const hits = await f.knowledge.searchRelevant(tenant, 'horario de atención los sábados', 5,
            { similarityThreshold: 0.35, executionContext: AGENT_TEST_EXECUTION_CONTEXT });
        // The full match always stays; partial matches must clear the threshold on coverage.
        expect(hits.map(h => h.id)).toEqual(['a']);
        expect(hits[0]).toMatchObject({ retrievalMode: 'lexical_fallback', similarity: 0, score: 1, keywordHit: true });
        expect(f.sqlOf('<=> $1::vector')).toHaveLength(0);
    });
    it('uses coverage plus the language boost as the score', async () => {
        const f = fixture();
        f.fetch.mockImplementation(async () => json({ error: { message: 'Service Unavailable' } }, 503));
        f.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) =>
            sql.includes('loose_q') ? [lexicalRow('b', 2, 6, false)] : []);
        const hits = await f.knowledge.searchRelevant(tenant, 'precio limpieza dental', 5,
            { similarityThreshold: 0.35, language: 'es', executionContext: AGENT_TEST_EXECUTION_CONTEXT });
        expect(hits).toHaveLength(1);
        expect(hits[0].score).toBeCloseTo(2 / 6 + 0.1, 5);
    });
    it('counts the fallback in the usage record without billing an embedding call', async () => {
        const f = fixture();
        f.fetch.mockImplementation(async () => noCredits());
        f.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) =>
            sql.includes('loose_q') ? [lexicalRow('a', 1, 1, true)] : []);
        const hits = await f.knowledge.searchRelevant(tenant, 'abono', 5);
        expect(hits).toHaveLength(1);
        await new Promise(resolve => setImmediate(resolve));
        expect(f.redis.incrBy).toHaveBeenCalledWith(expect.stringMatching(/:embeddings:lexical_fallback$/), 1);
        expect(f.redis.incrBy).not.toHaveBeenCalledWith(expect.stringMatching(/:embeddings:calls$/), expect.anything());
    });
    it('keeps hybrid retrieval when the embedding succeeds', async () => {
        const f = fixture();
        f.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) =>
            sql.includes('FROM knowledge_embeddings') && sql.includes('<=>')
                ? [{ ...lexicalRow('v', 0, 0, false), distance: 0.2 }] : []);
        const hits = await f.knowledge.searchRelevant(tenant, 'abono', 5, { executionContext: AGENT_TEST_EXECUTION_CONTEXT });
        expect(hits[0]).toMatchObject({ id: 'v', retrievalMode: 'hybrid' });
        expect(f.sqlOf('loose_q')).toHaveLength(0);
    });
    it('still propagates a revoked data source instead of degrading', async () => {
        const f = fixture();
        const revoked: ExternalSourceAuthority = async () => { throw new LLMSourceAuthorityUnavailable(); };
        await expect(f.knowledge.searchRelevant(tenant, 'abono', 5,
            { executionContext: AGENT_TEST_EXECUTION_CONTEXT, withDataSourceAuthority: revoked }))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(f.sqlOf('loose_q')).toHaveLength(0);
    });
    it('does not hide an unrelated failure behind the fallback', async () => {
        const f = fixture();
        f.fetch.mockImplementation(async () => json({ error: { message: 'Invalid input' } }, 400));
        await expect(f.knowledge.searchRelevant(tenant, 'abono', 5, { executionContext: AGENT_TEST_EXECUTION_CONTEXT }))
            .rejects.toMatchObject({ status: 400 });
    });
});

describe('searchFiltered degrades to the lexical index', () => {
    it('returns lexical results with coverage scores', async () => {
        const f = fixture();
        f.fetch.mockImplementation(async () => noCredits());
        f.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) =>
            sql.includes('loose_q') ? [{ ...lexicalRow('a', 2, 4, false), category: 'faq', source_type: 'upload', language: 'es' }] : []);
        const results = await f.knowledge.searchFiltered(tenant, 'precio limpieza', { category: 'faq' });
        expect(results).toEqual([expect.objectContaining({ id: 'a', score: 0.5, retrievalMode: 'lexical_fallback', category: 'faq' })]);
        const [, sql, params] = f.sqlOf('loose_q')[0];
        expect(sql).toContain('kd.category = $2');
        expect(params).toEqual(['precio limpieza', 'faq', 10]);
    });
});
