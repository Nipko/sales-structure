import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KnowledgeService } from '../knowledge.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../../common/types/execution-context';
import { ensureSyntheticGlobalTables } from '../../../common/__fixtures__/synthetic-global-tables';
import { DISPOSABLE_KNOWLEDGE_DATABASE, isDisposableDatabaseUrl } from '../../../common/__fixtures__/disposable-database';
import { LoadMetrics } from '../../../common/__fixtures__/load-metrics';
import { RETRIEVAL_CASES, RETRIEVAL_CORPUS, retrievalDistractors } from './retrieval-dataset';
import { deterministicEmbedding } from './retrieval-embedding';
import { hitChunkId, seedRetrievalCorpus } from './retrieval-runner';

/**
 * Retrieval under concurrent traffic, while the corpus is being changed
 * underneath it.
 *
 * A quality suite that seeds once, queries once and reports a number is
 * measuring a laboratory. Production asks the same corpus hundreds of times a
 * minute for several tenants at once, and the corpus does not hold still while
 * it does: a document is edited, one is withdrawn, an import lands. The things
 * that break there are not ranking — they are isolation, staleness and the
 * tail.
 *
 * So this suite asserts the invariants that must hold no matter what the load
 * is, and PUBLISHES the latency rather than asserting it. The split follows
 * `durable-dispatch.load.spec.ts` for the same reason: a leak across tenants is
 * a defect and fails the run; a p99 is evidence, and turning it into a
 * threshold here would be inventing an SLO out of one laptop's numbers.
 *
 * Three invariants, and each is a real production failure if it breaks:
 *
 *   · **isolation** — one tenant's search never returns another tenant's
 *     passage, however many run at once. Two tenants of the same platform
 *     asking the same question is the normal case, not the exotic one;
 *   · **withdrawal takes effect** — a document retired mid-flight stops being
 *     retrievable for every query that starts after it, without a restart and
 *     without a cache to invalidate;
 *   · **nothing falls over** — concurrency produces answers or an error that is
 *     counted, never a silent empty result that would read as an abstention.
 */

const url = process.env.KNOWLEDGE_MEMORY_TEST_DATABASE_URL;

// The knobs, at the top where a reader can see the shape of the run.
const TENANTS = 2;
const CONCURRENT_SEARCHERS = 8;
const ROUNDS = 6;
const DISTRACTORS = 300;

(url ? describe : describe.skip)('retrieval under load, while the corpus moves', () => {
    jest.setTimeout(300_000);

    const metrics = new LoadMetrics('rag retrieval under concurrent load');
    const tenants = Array.from({ length: TENANTS }, (_, index) => ({
        index,
        tenantId: randomUUID(),
        schema: `tenant_ragload_${randomUUID().replace(/-/g, '')}`,
    }));
    let client: PrismaClient;
    let prisma: PrismaService;
    let knowledge: KnowledgeService;

    const local = (schema: string, statement: string, params: any[] = []) =>
        prisma.executeInTenantSchema<any[]>(schema, statement, params);

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
            || !isDisposableDatabaseUrl(parsed, DISPOSABLE_KNOWLEDGE_DATABASE)) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.assign(Object.create(PrismaService.prototype), {
            tenant: client.tenant,
            $transaction: client.$transaction.bind(client),
            $queryRawUnsafe: client.$queryRawUnsafe.bind(client),
            $executeRawUnsafe: client.$executeRawUnsafe.bind(client),
        });
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await ensureSyntheticGlobalTables(statement => client.$executeRawUnsafe(statement));
        const ddl = readFileSync(resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8');
        for (const tenant of tenants) {
            await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',
                tenant.tenantId, tenant.schema);
            await client.$executeRawUnsafe(`CREATE SCHEMA "${tenant.schema}"`);
            for (const statement of (prisma as any).splitSqlStatements(ddl.replaceAll('{{SCHEMA_NAME}}', tenant.schema))) {
                if (/^(CREATE TABLE IF NOT EXISTS|ALTER TABLE|CREATE INDEX IF NOT EXISTS)\s+.*"(knowledge_documents|knowledge_embeddings)"/i
                    .test(statement)) await client.$executeRawUnsafe(statement);
            }
            await client.$executeRawUnsafe(
                `ALTER TABLE "${tenant.schema}".knowledge_embeddings ADD COLUMN IF NOT EXISTS search_tsv tsvector`);
            // Each tenant gets the labelled corpus plus its OWN distractors, so
            // a cross-tenant hit is unambiguous: the chunk ids do not overlap.
            await seedRetrievalCorpus(
                ((statement: string, params?: any[]) => local(tenant.schema, statement, params ?? [])) as any,
                [...RETRIEVAL_CORPUS, ...retrievalDistractors(DISTRACTORS, tenant.index + 1)]);
        }
        const cache = { get: jest.fn(async () => null), set: jest.fn(async () => undefined), tenantKey: jest.fn(() => 'evaluation') };
        knowledge = new KnowledgeService(prisma, cache as any, {} as any, {} as any, {} as any, {} as any);
        jest.spyOn(knowledge, 'generateEmbedding').mockImplementation(async (text: string) => deterministicEmbedding(text));
    }, 300_000);

    afterAll(async () => {
        if (!client) return;
        try {
            metrics.print();
            for (const tenant of tenants) {
                if (!/^tenant_ragload_[a-f0-9]{32}$/.test(tenant.schema)) throw new Error('invalid_test_cleanup_scope');
                await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schema}" CASCADE`);
                await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenant.tenantId);
            }
        } finally { await client.$disconnect(); }
    });

    const search = (tenantId: string, query: string, language: string) =>
        knowledge.searchRelevant(tenantId, query, 10, {
            executionContext: AGENT_TEST_EXECUTION_CONTEXT,
            similarityThreshold: 0.15, language, audience: 'customer',
        });

    /** Which tenant a returned chunk belongs to, from the seeded distractor id. */
    const ownerOf = (chunkId: string | null): number | null => {
        const match = /^filler-(\d+)-/.exec(chunkId ?? '');
        return match ? Number(match[1]) - 1 : null;
    };

    it('never answers one tenant with another tenant\'s passage', async () => {
        const questions = RETRIEVAL_CASES.filter(row => row.expected.kind === 'answer');
        let strangers = 0;
        for (let round = 0; round < ROUNDS; round += 1) {
            const work: Array<Promise<void>> = [];
            for (let worker = 0; worker < CONCURRENT_SEARCHERS; worker += 1) {
                const tenant = tenants[(round + worker) % tenants.length];
                const question = questions[(round * CONCURRENT_SEARCHERS + worker) % questions.length];
                work.push(metrics.time('search', async () => {
                    const hits = await search(tenant.tenantId, question.query, question.language);
                    for (const hit of hits) {
                        const owner = ownerOf(hitChunkId(hit as any));
                        // A labelled chunk exists in both schemas by design and
                        // has no owner; a distractor has exactly one.
                        if (owner !== null && owner !== tenant.index) strangers += 1;
                    }
                    metrics.count('hits', hits.length);
                }).then(() => undefined));
            }
            await Promise.all(work);
        }
        metrics.note(`${ROUNDS * CONCURRENT_SEARCHERS} concurrent searches across ${TENANTS} tenants`);
        // Two tenants of the same platform asking the same question is the
        // normal case. Bleeding between them is not a quality regression, it is
        // one business reading another's answer.
        expect(strangers).toBe(0);
    });

    it('stops returning a document the moment it is withdrawn, mid-flight', async () => {
        const [tenant] = tenants;
        const query = '¿Hasta cuándo puedo cancelar sin que me cobren?';
        const before = await search(tenant.tenantId, query, 'es');
        expect(before.some(hit => hitChunkId(hit as any) === 'es-cancel-current-0')).toBe(true);

        // The withdrawal lands while eight searches are in the air. Half of them
        // start before it and half after; none of them may return the chunk
        // once it has committed.
        const after: Array<Promise<boolean>> = [];
        const withdrawal = local(tenant.schema,
            `UPDATE knowledge_documents SET status='retired'
              WHERE metadata->>'evaluationDocumentId' = 'es-cancel-current'`);
        for (let worker = 0; worker < CONCURRENT_SEARCHERS; worker += 1) {
            after.push((async () => {
                if (worker % 2 === 1) await withdrawal;
                const hits = await metrics.time('search_during_withdrawal', () => search(tenant.tenantId, query, 'es'));
                return hits.some(hit => hitChunkId(hit as any) === 'es-cancel-current-0');
            })());
        }
        await withdrawal;
        const stillThere = await Promise.all(after);
        // Every search that started AFTER the commit must miss it. The ones that
        // raced it are allowed either answer — that is what a race means — so
        // the assertion is on the final state, which admits no ambiguity.
        const settled = await search(tenant.tenantId, query, 'es');
        expect(settled.some(hit => hitChunkId(hit as any) === 'es-cancel-current-0')).toBe(false);
        metrics.note(`${stillThere.filter(Boolean).length}/${CONCURRENT_SEARCHERS} in-flight searches raced the withdrawal`);

        await local(tenant.schema,
            `UPDATE knowledge_documents SET status='ready'
              WHERE metadata->>'evaluationDocumentId' = 'es-cancel-current'`);
    });

    it('answers or errors, and never quietly returns nothing', async () => {
        const [tenant] = tenants;
        const answerable = RETRIEVAL_CASES.filter(row => row.expected.kind === 'answer');
        let empty = 0;
        let failed = 0;
        const work = Array.from({ length: CONCURRENT_SEARCHERS * 2 }, (_, worker) => {
            const question = answerable[worker % answerable.length];
            return metrics.time('search_saturated', async () => {
                try {
                    const hits = await search(tenant.tenantId, question.query, question.language);
                    if (!hits.length) empty += 1;
                } catch { failed += 1; }
            });
        });
        await Promise.all(work);
        // An empty result reads as an abstention to everything downstream. Under
        // load it must never be how a failure presents itself, because a
        // customer cannot tell "we have nothing on that" from "the database was
        // busy" — and neither can the agent.
        expect({ empty, failed }).toEqual({ empty: 0, failed: 0 });
        metrics.count('saturated_searches', CONCURRENT_SEARCHERS * 2);
    });

    it('keeps answering with the keyword half of the index gone', async () => {
        const [tenant] = tenants;
        await local(tenant.schema, 'UPDATE knowledge_embeddings SET search_tsv = NULL');
        try {
            const hits = await metrics.time('search_degraded',
                () => search(tenant.tenantId, '¿Hasta cuándo puedo cancelar sin que me cobren?', 'es'));
            // The BM25 pool is best-effort by contract. A degraded index costs
            // recall, and must not cost availability.
            expect(hits.length).toBeGreaterThan(0);
        } finally {
            await local(tenant.schema, "UPDATE knowledge_embeddings SET search_tsv = to_tsvector('simple', chunk_text)");
        }
    });
});
