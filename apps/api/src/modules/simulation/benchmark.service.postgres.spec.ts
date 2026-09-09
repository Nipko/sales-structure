import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { BenchmarkService } from './benchmark.service';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * The benchmark from the entrypoint to the summary, with no competitor account
 * and no provider.
 *
 * Same gap as the certification executor had: functions and PostgreSQL tests,
 * and nothing that could run one. Everything here is the real service — the
 * corpus generator, the queue publication, the worker body, the blind review and
 * the summary — with the queue stubbed so jobs can be inspected and the model
 * stubbed to throw, because a synthetic subject must never reach one.
 *
 * The last test is the one that keeps the whole thing honest: with only
 * synthetic subjects, the summary refuses to state a comparison.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const profiles = listCanonicalSubtypeExperienceProfileIds().slice(0, 4);
const SUPER_ADMIN = { id: '11111111-1111-4111-8111-111111111111', role: 'super_admin' };
const TENANT_ADMIN = { id: '22222222-2222-4222-8222-222222222222', role: 'tenant_admin' };

(connection ? describe : describe.skip)('benchmark service end to end', () => {
    let pool: Pool;
    const schema = `bench_svc_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    let service: BenchmarkService;
    let queued: Array<{ data: any; opts: any }>;
    let audits: any[];

    const transaction = async <T>(work: (query: any) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL search_path TO "${schema}"`);
            const value = await work(async (text: string, params: any[] = []) =>
                (await client.query(text, params)).rows);
            await client.query('COMMIT');
            return value;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        transaction(query => query(text, params)) as Promise<any[]>;

    const body = (over: Record<string, unknown> = {}) => ({
        corpusId: 'local-compare', seed: 'seed-one',
        profiles, languages: ['es'], channels: ['whatsapp'], perStratum: 1,
        subjects: [
            { id: 'alpha', kind: 'alternative' as const, label: 'Alfa', blindLabel: 'sujeto-A', setupMinutes: 20 },
            { id: 'beta', kind: 'alternative' as const, label: 'Beta', blindLabel: 'sujeto-B', setupMinutes: 15 },
        ],
        ...over,
    });

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 6 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        queued = []; audits = [];
        const prisma: any = {
            getTenantSchemaName: async (id: string) => (id === tenantId ? schema : null),
            transactionInTenantSchema: async (_schema: string, work: any) => transaction(work),
            auditLog: { create: async (row: any) => { audits.push(row.data); return row.data; } },
        };
        const queue: any = { add: async (_name: string, data: any, opts: any) => { queued.push({ data, opts }); } };
        const evals: any = { runGateV2: async () => { throw new Error('model_must_not_be_called'); } };
        const agentTest: any = { captureSnapshot: async () => { throw new Error('model_must_not_be_called'); } };
        service = new BenchmarkService(prisma, evals, agentTest, queue);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
            await pool.end();
        }
    });

    it('refuses a label a reviewer could decode', async () => {
        expect(() => service.corpus(body({
            subjects: [{ id: 'alpha', kind: 'alternative', label: 'Alfa', blindLabel: 'Alfa-1', setupMinutes: 1 }],
        }) as any)).toThrow();
        expect(() => service.corpus(body({
            subjects: [{ id: 'alpha', kind: 'alternative', label: 'Alfa', blindLabel: 'alpha', setupMinutes: 1 }],
        }) as any)).toThrow();
    });

    it('shows what would be compared, and what it refused, before anything runs', () => {
        const built = service.corpus(body() as any);
        expect(built.corpus.tasks.length).toBeGreaterThan(0);
        expect(built.corpus.contentHash).toEqual(expect.stringMatching(/^[a-f0-9]{16,}$/));
        // The refusals are part of the answer: a corpus is what survived, and
        // the reader has to be able to see what did not.
        expect(built.refusals.no_confirmable_outcome).toBeGreaterThan(0);
    });

    it('publishes one job per subject, with an id that survives a retried start', async () => {
        await service.plan(tenantId, body() as any, SUPER_ADMIN);
        queued.length = 0;
        await service.start(tenantId, body() as any, SUPER_ADMIN);
        await service.start(tenantId, body() as any, SUPER_ADMIN);
        expect(new Set(queued.map(job => job.opts.jobId)).size).toBe(2);
        expect(audits.some(row => row.action === 'benchmark.started')).toBe(true);
    }, 120000);

    it('runs both subjects through the real worker body and stores every attempt', async () => {
        const built = service.corpus(body() as any);
        queued.length = 0;
        await service.start(tenantId, body() as any, SUPER_ADMIN);
        for (const job of [...queued]) await service.process(job.data);
        const [stored] = await sql('SELECT count(*)::int AS n FROM benchmark_attempts WHERE corpus_hash=$1',
            [built.corpus.contentHash]);
        expect(Number(stored.n)).toBe(built.corpus.tasks.length * 2);
    }, 180000);

    it('keeps a blind score only for a task somebody attempted', async () => {
        const built = service.corpus(body() as any);
        await service.review(tenantId, built.corpus.contentHash, {
            taskKey: 'never-attempted', blindLabel: 'sujeto-A', reviewerId: 'rev-1', score: 9,
        }, SUPER_ADMIN);
        await service.review(tenantId, built.corpus.contentHash, {
            taskKey: built.corpus.tasks[0].key, blindLabel: 'sujeto-A', reviewerId: 'rev-1', score: 9,
        }, SUPER_ADMIN);
        const [stored] = await sql('SELECT count(*)::int AS n FROM benchmark_reviews WHERE corpus_hash=$1',
            [built.corpus.contentHash]);
        expect(Number(stored.n)).toBe(1);
    }, 180000);

    it('will not state a comparison until a real alternative has answered', async () => {
        const report = await service.report(tenantId, body() as any, SUPER_ADMIN);
        expect(report.attempts).toBeGreaterThan(0);
        // Two synthetic subjects are two subjects and still not a comparison:
        // neither of them is us, so nothing here says anything about Parallly.
        expect(report.report.comparable).toBe(false);
        expect(report.report.blockers).toContain('no_self_subject');
        expect(report.statement).toContain('No comparison can be stated');
        expect(report.statement).not.toMatch(/best|mejor|superior/i);
    }, 180000);

    it('refuses to score against a corpus that is not the one that was planned', async () => {
        // The generator is deterministic, so a mismatch means the worker and the
        // planner disagree about what is being compared — which used to produce
        // rows under a hash nobody was reading.
        await service.start(tenantId, body() as any, SUPER_ADMIN, 9);
        const job = { ...queued[queued.length - 1].data, corpusHash: 'a'.repeat(64) };
        await expect(service.process(job)).rejects.toMatchObject({
            response: { error: 'benchmark_corpus_drifted' },
        });
    }, 120000);

    it('keeps operating it a platform decision', async () => {
        await expect(service.plan(tenantId, body() as any, TENANT_ADMIN))
            .rejects.toMatchObject({ response: { error: 'certification_role_required' } });
        await expect(service.report(tenantId, body() as any, TENANT_ADMIN)).resolves.toBeTruthy();
    }, 120000);
});
