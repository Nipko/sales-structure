import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { benchmarkStatement, type BenchmarkSubject } from './agent-benchmark';
import {
    ensureBenchmarkLedger, generateBenchmarkCorpus, loadBenchmarkEvidence, recordBenchmarkReview,
    runBenchmarkSubject, summariseStoredBenchmark, syntheticBenchmarkRunner, type BenchmarkQuery,
} from './benchmark-harness';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * The benchmark end to end, without a provider or a competitor's account.
 *
 * The corpus is generated from the catalogue, two synthetic subjects run it,
 * the attempts and blind scores are stored, and the summary is computed back
 * out of the database. Everything the local half owes is exercised; what is
 * left over is exactly what needs somebody else's account, which is the point
 * of drawing the line here.
 *
 * The last assertion is the one that matters most: with a real alternative
 * missing, the harness must refuse to state a comparison rather than produce a
 * flattering one.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const profiles = listCanonicalSubtypeExperienceProfileIds().slice(0, 6);

(connection ? describe : describe.skip)('benchmark harness on disposable PostgreSQL', () => {
    let pool: Pool;
    const schema = `benchmark_${randomUUID().replace(/-/g, '')}`;
    const transaction = async <T>(work: (query: BenchmarkQuery) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL search_path TO "${schema}"`);
            const value = await work(async <R = any[]>(text: string, params: any[] = []) =>
                (await client.query(text, params)).rows as R);
            await client.query('COMMIT');
            return value;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const sql: BenchmarkQuery = <R = any[]>(text: string, params: any[] = []) =>
        transaction(query => query<R>(text, params));

    const parallly: BenchmarkSubject = {
        id: 'parallly', kind: 'self', label: 'Parallly', blindLabel: 'sujeto-A', setupMinutes: 12,
    };
    const alternative: BenchmarkSubject = {
        id: 'synthetic-alt', kind: 'alternative', label: 'Alternativa sintética',
        blindLabel: 'sujeto-B', setupMinutes: 20,
    };

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 4 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        await transaction(ensureBenchmarkLedger);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
            await pool.end();
        }
    });

    const corpusOf = (seed: string, id = 'local') =>
        generateBenchmarkCorpus({ id, profiles, languages: ['es'], channels: ['whatsapp'], perStratum: 2, seed });

    it('generates a stratified corpus from the catalogue, and says what it refused', () => {
        const built = corpusOf('bench-1');
        expect(built.corpus.tasks.length).toBeGreaterThan(0);
        // Stratified: at most `perStratum` per profile/language/channel, so one
        // vertical with many scenarios cannot dominate the comparison.
        for (const profileId of profiles) {
            expect(built.corpus.tasks.filter(task => task.profileId === profileId).length).toBeLessThanOrEqual(2);
        }
        // Every task is confirmable where the result lands. A corpus of
        // transcripts would measure how an answer reads.
        for (const task of built.corpus.tasks) {
            expect(task.confirms.length).toBeGreaterThan(0);
            for (const confirm of task.confirms) expect(typeof confirm.table).toBe('string');
            expect(task.messages.length).toBeGreaterThan(0);
        }
        // And the ones left out are counted with a reason, not dropped quietly.
        expect(built.refusals.no_confirmable_outcome).toBeGreaterThan(0);
    });

    it('gives the same corpus for the same seed and a different one for another', () => {
        expect(corpusOf('bench-1').corpus.contentHash).toBe(corpusOf('bench-1').corpus.contentHash);
        const other = corpusOf('bench-2').corpus;
        // Same size, different selection: the seed chooses which tasks, not how
        // many, so two runs stay comparable in shape and distinct in content.
        expect(other.tasks.length).toBe(corpusOf('bench-1').corpus.tasks.length);
        expect(other.contentHash).not.toBe(corpusOf('bench-1').corpus.contentHash);
    });

    it('runs synthetic subjects, stores every attempt, and keeps repeats as repeats', async () => {
        const { corpus } = corpusOf('bench-run');
        await transaction(query => runBenchmarkSubject({
            query, corpus, subject: parallly, runner: syntheticBenchmarkRunner({ seed: 'p', confirmRate: 0.9 }),
        }));
        await transaction(query => runBenchmarkSubject({
            query, corpus, subject: alternative, runner: syntheticBenchmarkRunner({ seed: 'a', confirmRate: 0.6 }),
        }));
        // A second run of the same subject is a repeat, not an overwrite:
        // reliability is "did it agree with itself", which a table that keeps
        // only the last answer cannot measure.
        await transaction(query => runBenchmarkSubject({
            query, corpus, subject: parallly, runIndex: 2,
            runner: syntheticBenchmarkRunner({ seed: 'p', confirmRate: 0.9 }),
        }));
        const evidence = await loadBenchmarkEvidence(sql, corpus.contentHash);
        expect(evidence.attempts.length).toBe(corpus.tasks.length * 3);
        expect(evidence.attempts.every(attempt => attempt.corpusHash === corpus.contentHash)).toBe(true);
    }, 120000);

    it('records a crashed runner as unchecked rather than as a failure', async () => {
        const { corpus } = corpusOf('bench-crash', 'crash');
        await transaction(query => runBenchmarkSubject({
            query, corpus, subject: parallly,
            runner: async () => { throw new Error('subject_unreachable'); },
        }));
        const evidence = await loadBenchmarkEvidence(sql, corpus.contentHash);
        expect(evidence.attempts.every(attempt => attempt.confirmed === null)).toBe(true);
        expect(evidence.attempts[0].error).toBe('subject_unreachable');
        // `null` is not `false`. "The subject failed" and "nobody checked" are
        // different findings, and the summary refuses to compare on the second.
        const report = await summariseStoredBenchmark({ query: sql, corpus, subjects: [parallly, alternative] });
        expect(report.blockers).toContain('unconfirmed_result:parallly');
        expect(report.comparable).toBe(false);
    }, 120000);

    it('refuses a blind score for a task nobody attempted', async () => {
        const { corpus } = corpusOf('bench-review', 'review');
        await transaction(query => runBenchmarkSubject({
            query, corpus, subject: parallly, runner: syntheticBenchmarkRunner({ seed: 'p', confirmRate: 1 }),
        }));
        await transaction(query => recordBenchmarkReview(query, corpus.contentHash, {
            taskKey: 'a-task-that-was-never-run', blindLabel: 'sujeto-A', reviewerId: 'rev-1', score: 9,
        }));
        const evidence = await loadBenchmarkEvidence(sql, corpus.contentHash);
        expect(evidence.reviews).toHaveLength(0);
        await transaction(query => recordBenchmarkReview(query, corpus.contentHash, {
            taskKey: corpus.tasks[0].key, blindLabel: 'sujeto-A', reviewerId: 'rev-1', score: 9,
        }));
        expect((await loadBenchmarkEvidence(sql, corpus.contentHash)).reviews).toHaveLength(1);
    }, 120000);

    it('will not state a comparison the local half cannot earn', async () => {
        const { corpus } = corpusOf('bench-statement', 'statement');
        await transaction(query => runBenchmarkSubject({
            query, corpus, subject: parallly, runner: syntheticBenchmarkRunner({ seed: 'p', confirmRate: 1 }),
        }));
        // One subject, and it is us. Every number exists and none of them is a
        // comparison — which is exactly the state the local half ends in, and
        // saying so is the whole reason the summary refuses.
        const alone = await summariseStoredBenchmark({ query: sql, corpus, subjects: [parallly] });
        expect(alone.comparable).toBe(false);
        expect(alone.blockers).toEqual(expect.arrayContaining(['single_subject', 'no_alternative_subject']));
        expect(benchmarkStatement(alone)).toContain('No comparison can be stated');
        expect(benchmarkStatement(alone)).not.toMatch(/best|mejor|superior/i);
        // The subject's own numbers are still reported: refusing a comparison is
        // not refusing to measure.
        expect(alone.subjects[0]).toMatchObject({ subjectId: 'parallly', attempts: corpus.tasks.length });
        expect(alone.subjects[0].confirmedSuccesses).toBe(corpus.tasks.length);
    }, 120000);
});
