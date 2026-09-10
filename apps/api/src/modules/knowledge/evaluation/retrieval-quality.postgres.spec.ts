import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KnowledgeService } from '../knowledge.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../../common/types/execution-context';
import { ensureSyntheticGlobalTables } from '../../../common/__fixtures__/synthetic-global-tables';
import { DISPOSABLE_KNOWLEDGE_DATABASE, isDisposableDatabaseUrl } from '../../../common/__fixtures__/disposable-database';
import {
    RETRIEVAL_CASES, RETRIEVAL_CORPUS, retrievalDistractors, type RetrievalCase,
} from './retrieval-dataset';
import { DETERMINISTIC_EMBEDDING_ID, deterministicEmbedding } from './retrieval-embedding';
import {
    renderRetrievalReport, runRetrievalCases, seedRetrievalCorpus,
    type RetrievalHit, type RetrievalReport,
} from './retrieval-runner';

/**
 * What the retrieval path actually returns, measured against written-down
 * answers, on real PostgreSQL and real pgvector.
 *
 * This is the run that makes the rest of the folder more than a contract. It
 * uses the production `KnowledgeService.searchRelevant` — the same hybrid SQL,
 * the same RRF fusion, the same jurisdiction, audience, language and validity
 * gates — over a corpus written into the real tables by the real column names.
 * The only substitution is the embedding, and that one is stated on every line
 * of every report: `deterministic_lexical` is not `text-embedding-3-small`, so
 * these numbers are a measurement of the PIPELINE and never of the model.
 *
 * The invariants below are assertions; the metrics are printed. That split is
 * deliberate and follows `durable-dispatch.load.spec.ts`: a leak is a defect
 * and fails, a recall number is evidence and gets published. Turning recall
 * into a hard assertion here would either be a threshold nobody justified, or a
 * number so low it protects nothing.
 */

const url = process.env.KNOWLEDGE_MEMORY_TEST_DATABASE_URL;

(url ? describe : describe.skip)('what retrieval returns, against written-down answers', () => {
    jest.setTimeout(240_000);

    const tenantId = randomUUID();
    const schema = `tenant_ragqual_${randomUUID().replace(/-/g, '')}`;
    const agentId = randomUUID();
    let client: PrismaClient;
    let prisma: PrismaService;
    let knowledge: KnowledgeService;
    const reports: Array<{ label: string; report: RetrievalReport }> = [];

    const sql = (statement: string, ...params: any[]) => client.$queryRawUnsafe(statement, ...params) as Promise<any[]>;
    const local = (statement: string, params: any[] = []) =>
        prisma.executeInTenantSchema<any[]>(schema, statement, params);

    /**
     * The production entry point, under the scope the case declares.
     *
     * `similarityThreshold` is the knob that decides abstention: a case that
     * should return nothing returns nothing only if the cut is somewhere honest.
     * It is a parameter of the run and printed with the report, never a constant
     * hidden in here.
     */
    const searchWith = (threshold: number, topK = 10) => async (row: RetrievalCase): Promise<readonly RetrievalHit[]> => {
        const hits = await knowledge.searchRelevant(tenantId, row.query, topK, {
            executionContext: AGENT_TEST_EXECUTION_CONTEXT,
            similarityThreshold: threshold,
            language: row.language,
            audience: row.scope?.audience ?? 'customer',
            jurisdiction: row.scope?.jurisdiction ?? null,
            agentId: row.scope?.agentId ?? agentId,
        });
        return hits.map(hit => ({ metadata: hit.metadata, score: hit.score }));
    };

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
        const extensions = await sql(
            "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'");
        if (extensions.length !== 1 || extensions[0].nspname !== 'public') throw new Error('disposable_public_pgvector_required');
        await ensureSyntheticGlobalTables(statement => client.$executeRawUnsafe(statement));
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

        // The real tables, from the checked-in template. The gates being measured
        // are enforced against these exact columns, so a simplified corpus would
        // measure a simplified pipeline.
        const ddl = readFileSync(resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8')
            .replaceAll('{{SCHEMA_NAME}}', schema);
        for (const statement of (prisma as any).splitSqlStatements(ddl)) {
            if (/^(CREATE TABLE IF NOT EXISTS|ALTER TABLE|CREATE INDEX IF NOT EXISTS)\s+.*"(knowledge_documents|knowledge_embeddings)"/i
                .test(statement)) {
                await client.$executeRawUnsafe(statement);
            }
        }
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_embeddings ADD COLUMN IF NOT EXISTS search_tsv tsvector`);

        const cache = {
            get: jest.fn(async () => null), set: jest.fn(async () => undefined),
            tenantKey: jest.fn(() => 'evaluation'),
        };
        knowledge = new KnowledgeService(prisma, cache as any, {} as any, {} as any, {} as any, {} as any);
        // The one substitution, and it is stated in every report this file prints.
        jest.spyOn(knowledge, 'generateEmbedding')
            .mockImplementation(async (text: string) => deterministicEmbedding(text));
    }, 180_000);

    afterAll(async () => {
        if (!client) return;
        try {
            // eslint-disable-next-line no-console
            for (const entry of reports) console.log(`\n[rag-quality] ${entry.label}\n${renderRetrievalReport(entry.report)}`);
            if (!/^tenant_ragqual_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_test_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    const reseed = async (corpus = RETRIEVAL_CORPUS) => {
        await local('TRUNCATE knowledge_documents, knowledge_embeddings CASCADE');
        return seedRetrievalCorpus(local as any, corpus);
    };

    const record = (label: string, report: RetrievalReport) => { reports.push({ label, report }); return report; };

    // ── The measurement ─────────────────────────────────────────────────────

    it('finds the labelled passage, and never a forbidden one', async () => {
        await reseed();
        const report = record('baseline · 14 docs · threshold 0.15',
            await runRetrievalCases(searchWith(0.15), { similarityThreshold: 0.15, k: 5 }));

        expect(report.conditions.embeddingModel).toBe(DETERMINISTIC_EMBEDDING_ID);
        expect(report.overall.cases).toBe(RETRIEVAL_CASES.length);
        // Errors are a defect in the harness or the SQL, not a quality number.
        expect(report.overall.errors).toBe(0);
        // A leak is a withdrawn promise, an internal margin or a foreign
        // regulation reaching a customer. There is no acceptable rate.
        expect({ leaks: report.overall.leaks, cases: report.overall.leakedCaseIds })
            .toEqual({ leaks: 0, cases: [] });
        // And the floor: if the obvious question misses the obvious paragraph,
        // nothing else in the report is worth reading.
        const plain = report.scores.find(score => score.caseId === 'es-plain-cancel')!;
        expect(plain.recallAtK).toBe(1);
        expect(plain.reciprocalRank).toBe(1);
    });

    it('keeps a withdrawn document out even when it is the best match in the corpus', async () => {
        await reseed();
        const report = await runRetrievalCases(searchWith(0.05), { similarityThreshold: 0.05, k: 5 });
        const retired = report.scores.find(score => score.caseId === 'es-retired-promo')!;
        // Threshold deliberately low: this must be excluded by STATUS, not by
        // scoring badly. A pass that depends on the cut is a pass that stops
        // being true the day somebody lowers it.
        //
        // Abstention is NOT asserted here, and that is the point of running at
        // 0.05: at a cut this low everything in the corpus comes back, so the
        // only thing this run can prove is that the gate held. Where abstention
        // becomes correct is measured below, not assumed here.
        expect(retired.leaked).toEqual([]);
    });

    it('keeps the tenant\'s own numbers away from the tenant\'s customer', async () => {
        await reseed();
        const report = await runRetrievalCases(searchWith(0.05), { similarityThreshold: 0.05, k: 5 });
        const internal = report.scores.find(score => score.caseId === 'es-internal-leak')!;
        // Same reasoning as above: at 0.05 the claim is the audience gate, and
        // nothing else.
        expect(internal.leaked).toEqual([]);
    });

    it('answers with the norm of the country it is asked in, and with neither elsewhere', async () => {
        await reseed();
        const report = await runRetrievalCases(searchWith(0.05), { similarityThreshold: 0.05, k: 5 });
        const us = report.scores.find(score => score.caseId === 'en-regulated-us')!;
        const fr = report.scores.find(score => score.caseId === 'fr-regulated-eu')!;
        const third = report.scores.find(score => score.caseId === 'en-regulated-wrong-jurisdiction')!;
        expect(us.leaked).toEqual([]);
        expect(fr.leaked).toEqual([]);
        // A tenant in a third country gets neither, because citing a foreign
        // norm as current is its own kind of wrong answer.
        expect(third.leaked).toEqual([]);
    });

    it('reports the same labels at two corpus sizes, and says which was which', async () => {
        await reseed();
        const small = record('small · 14 docs',
            await runRetrievalCases(searchWith(0.15), { similarityThreshold: 0.15, k: 5, corpus: RETRIEVAL_CORPUS }));
        const grown = [...RETRIEVAL_CORPUS, ...retrievalDistractors(200)];
        await reseed(grown);
        const large = record('grown · 214 docs',
            await runRetrievalCases(searchWith(0.15), { similarityThreshold: 0.15, k: 5, corpus: grown }));

        expect(small.conditions.corpusDocuments).toBe(RETRIEVAL_CORPUS.length);
        expect(large.conditions.corpusDocuments).toBe(RETRIEVAL_CORPUS.length + 200);
        // A recall number taken over fourteen documents says almost nothing
        // about a tenant with four thousand. Adding pressure must not add leaks.
        expect(large.overall.leaks).toBe(0);
        expect(large.overall.errors).toBe(0);
        // The revision covers the corpus as well as the cases, so growing it
        // changes the identity — which is the point: these two reports are
        // measurements of the same QUESTIONS under different CONDITIONS, and
        // the hash refuses to let them be filed as the same run.
        expect(large.conditions.datasetRevision).not.toBe(small.conditions.datasetRevision);
        await reseed();
    });

    it('stops citing a document the moment it is retired mid-evaluation', async () => {
        await reseed();
        const before = await runRetrievalCases(searchWith(0.05), { similarityThreshold: 0.05, k: 5 });
        expect(before.scores.find(score => score.caseId === 'es-plain-cancel')!.recallAtK).toBe(1);

        // The update lands while the evaluation is running, which is the case a
        // suite that seeds once and queries once can never see.
        await local(`UPDATE knowledge_documents SET status='retired'
                      WHERE metadata->>'evaluationDocumentId' = 'es-cancel-current'`);
        const after = await runRetrievalCases(searchWith(0.05), { similarityThreshold: 0.05, k: 5 });
        const plain = after.scores.find(score => score.caseId === 'es-plain-cancel')!;
        // The label still says that chunk is the answer. Retrieval no longer
        // returns it, so the case now MISSES — and that is the correct reading:
        // the corpus no longer contains the answer it was labelled against.
        expect(plain.recallAtK).toBe(0);
        expect(after.overall.leaks).toBe(0);
        await reseed();
    });

    it('degrades to vector-only rather than failing when the keyword half is gone', async () => {
        await reseed();
        const hybrid = await runRetrievalCases(searchWith(0.15), { similarityThreshold: 0.15, k: 5 });
        // The BM25 pool is best-effort by design. Emptying it is the closest
        // local stand-in for a degraded index, and the run must survive it with
        // numbers rather than with an exception.
        await local('UPDATE knowledge_embeddings SET search_tsv = NULL');
        const degraded = record('degraded · no keyword pool',
            await runRetrievalCases(searchWith(0.15), { similarityThreshold: 0.15, k: 5 }));
        expect(degraded.overall.errors).toBe(0);
        expect(degraded.overall.leaks).toBe(0);
        // Published rather than asserted: the point is to SEE what the keyword
        // half was worth, and a threshold on it would be a number nobody justified.
        // eslint-disable-next-line no-console
        console.log(`[rag-quality] keyword pool worth: recall ${hybrid.overall.recallAtK} → ${degraded.overall.recallAtK}`);
        await reseed();
    });

    it('answers in the language it was asked in', async () => {
        await reseed();
        const report = record('per-language · threshold 0.15',
            await runRetrievalCases(searchWith(0.15), { similarityThreshold: 0.15, k: 5 }));
        // Every language has to be represented in the report, or "results per
        // es/en/pt/fr" is a claim about a table with empty rows.
        for (const language of ['es', 'en', 'pt', 'fr']) {
            expect(report.byLanguage[language]?.cases ?? 0).toBeGreaterThan(0);
            expect(report.byLanguage[language].errors).toBe(0);
            expect(report.byLanguage[language].leaks).toBe(0);
        }
        const french = report.scores.find(score => score.caseId === 'fr-no-answer-warranty')!;
        // The warranty document exists — in Portuguese. Answering a French
        // question from it is confidently wrong, and the label says so.
        expect(french.leaked).toEqual([]);
    });

    it('finds the cut where it can both answer and stay silent, by measuring it', async () => {
        await reseed();
        const sweep: Array<{ threshold: number; recall: number | null; abstention: number | null;
            answer: number | null; leaks: number; }> = [];
        for (const threshold of [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65]) {
            const report = await runRetrievalCases(searchWith(threshold), { similarityThreshold: threshold, k: 5 });
            // The gates are not a function of the cut. If a leak ever appears at
            // one threshold and not another, the exclusion was scoring, not a gate.
            expect({ threshold, leaks: report.overall.leaks }).toEqual({ threshold, leaks: 0 });
            expect(report.overall.errors).toBe(0);
            sweep.push({ threshold, recall: report.overall.recallAtK,
                abstention: report.overall.abstentionAccuracy,
                answer: report.overall.answerAccuracy, leaks: report.overall.leaks });
        }
        // eslint-disable-next-line no-console
        console.log(['[rag-quality] threshold sweep · 14 docs · deterministic_lexical',
            '| threshold | recall@5 | abstention | answer | leaks |', '|---:|---:|---:|---:|---:|',
            ...sweep.map(row => `| ${row.threshold} | ${row.recall?.toFixed(3) ?? '—'} | `
                + `${row.abstention?.toFixed(3) ?? '—'} | ${row.answer?.toFixed(3) ?? '—'} | ${row.leaks} |`),
        ].join('\n'));

        // The claim this run has to support is not a chosen number — it is that
        // the pipeline HAS a working point: somewhere it stays silent on every
        // question the corpus cannot answer while still finding answers to the
        // ones it can. A system with no such point is not tuned badly, it is
        // broken, and no threshold would fix it.
        const workable = sweep.filter(row => row.abstention === 1 && (row.recall ?? 0) > 0);
        expect(workable.length).toBeGreaterThan(0);
        // Published rather than hard-coded: the lowest cut that abstains cleanly
        // is the number the runbook quotes, and it is derived here every run.
        // eslint-disable-next-line no-console
        console.log(`[rag-quality] cleanest abstention from threshold ${workable[0].threshold} `
            + `(recall@5 ${workable[0].recall?.toFixed(3)})`);
        await reseed();
    });

    it('scores the answer-shaped metrics on what retrieval actually returned', async () => {
        await reseed();

        // Two synthetic answerers, and what they are for is worth stating: they
        // measure the METRIC, not the agent. A grounded answerer quotes the top
        // hit it was given; a sloppy one cites a passage it never received and
        // says something the corpus does not. Running both over the same real
        // retrieval output is how citation precision and lexical support get
        // exercised end to end without a model.
        //
        // The real generative answer and the entailment judge need credentials
        // and stay behind the LLM gate. Nothing here is a claim about them:
        // `semanticEntailment` is `not_evaluated` in both reports.
        const grounded = record('grounded answerer',
            await runRetrievalCases(searchWith(0.15), {
                similarityThreshold: 0.15, k: 5,
                answer: (row, hits) => {
                    const cited = hits.map(hit => (hit.metadata as any)?.chunkId)
                        .filter((id: unknown): id is string => typeof id === 'string'
                            && row.expected.kind === 'answer' && row.expected.authorisedCitations.includes(id));
                    const support = row.expected.kind === 'answer' ? row.expected.support.join(' ') : '';
                    return { citations: cited, text: cited.length ? support : 'No tengo esa información.' };
                },
            }));
        expect(grounded.overall.citationPrecision).toBe(1);
        expect(grounded.overall.lexicalSupportRate).toBeGreaterThan(0);
        expect(grounded.overall.semanticEntailment).toBe('not_evaluated');

        const sloppy = await runRetrievalCases(searchWith(0.15), {
            similarityThreshold: 0.15, k: 5,
            answer: () => ({ citations: ['es-retired-promo-0'], text: 'Sí, tenemos un 2x1 vigente.' }),
        });
        // Citing a withdrawn promotion it was never given, and saying something
        // no retrieved passage supports. Both columns have to notice.
        expect(sloppy.overall.citationPrecision).toBe(0);
        expect(sloppy.overall.lexicalSupportRate).toBe(0);
        // And retrieval was identical in both runs — the difference is entirely
        // the answer, which is what makes these columns about the answer.
        expect(sloppy.overall.recallAtK).toBe(grounded.overall.recallAtK);
        expect(sloppy.overall.leaks).toBe(0);
    });

    it('publishes every metric the report claims to have, per challenge', async () => {
        await reseed();
        const report = await runRetrievalCases(searchWith(0.15), { similarityThreshold: 0.15, k: 5 });
        for (const challenge of ['plain', 'ambiguity', 'negation', 'conflict', 'temporality', 'retired', 'no_answer']) {
            expect(report.byChallenge[challenge]?.cases ?? 0).toBeGreaterThan(0);
        }
        // Latency is reported at three points, because a p50 alone hides the
        // tail that actually times a customer out.
        expect(report.overall.latency.p99).toBeGreaterThanOrEqual(report.overall.latency.p95);
        expect(report.overall.latency.p95).toBeGreaterThanOrEqual(report.overall.latency.p50);
        // And nothing here ever claims entailment.
        expect(report.overall.semanticEntailment).toBe('not_evaluated');
    });
});
