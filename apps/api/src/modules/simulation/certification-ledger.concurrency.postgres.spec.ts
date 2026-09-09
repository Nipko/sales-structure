import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import {
    certificationEvidenceFromLedger, certificationProgress, driveCertificationRun,
    ensureCertificationLedger, leaseCertificationCase, planCertificationLedger,
    recordCertificationCase, type CertificationCaseResult, type CertificationQuery,
} from './certification-ledger';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * What a second worker does to the executor.
 *
 * The first ledger spec is sequential: it leases a case, records it, and leases
 * the next one. Every guarantee that involves two workers at once is therefore
 * untested by it, and the pre-deployment review was right that the interesting
 * failures live exactly there:
 *
 *  · the budget is compared against what has already been RECORDED, so N
 *    workers holding N leases all see the same untouched `spent` and all pass
 *    the check. The overshoot is bounded by how many workers there are, not by
 *    one case;
 *  · "nothing claimable" is not "finished". With every case leased by somebody
 *    else there is no row to hand out, and calling that `complete` closes a run
 *    whose results are still in flight;
 *  · a result rejected for a lost lease is not a result. Counting it as one
 *    makes a worker's batch limit consume work it did not do.
 *
 * Each test here asserts the behaviour the executor must have. They were
 * written before the fix, against the code that had none, and each one failed
 * for the reason named above.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const profileId = listCanonicalSubtypeExperienceProfileIds()[0];

(connection ? describe : describe.skip)('certification ledger under two workers', () => {
    let pool: Pool;
    const schema = `cert_conc_${randomUUID().replace(/-/g, '')}`;
    const planInput = {
        agentId: randomUUID(), configHash: 'config-1', dependencyRevision: 'dependency-1',
        profiles: [profileId], languages: ['es'], channels: ['whatsapp'], models: ['gpt-4.1-mini'],
    };
    const transaction = async <T>(work: (query: CertificationQuery) => Promise<T>): Promise<T> => {
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
    const sql: CertificationQuery = <R = any[]>(text: string, params: any[] = []) =>
        transaction(query => query<R>(text, params));
    const result = (over: Partial<CertificationCaseResult> = {}): CertificationCaseResult => ({
        passed: true, servedModel: 'gpt-4.1-mini', costUsdCents: 2, latencyMs: 10,
        transcript: [], tools: [], verification: { ok: true }, scenario: { key: 'k' }, ...over,
    });

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 8 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        await transaction(ensureCertificationLedger);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
            await pool.end();
        }
    });

    const freshRun = (over: Record<string, unknown> = {}) =>
        planCertificationLedger(sql, { ...planInput, ...over } as any);

    it('does not hand out more work than the budget can pay for, however many workers ask', async () => {
        // Four cents of budget and cases that cost two. At most two may ever be
        // handed out — and the third must be refused BEFORE it runs, not after
        // it has been paid for.
        const run = await freshRun({ budgetUsdCents: 4 });
        const leases = [];
        for (let worker = 0; worker < 4; worker++) {
            const claim = await transaction(query => leaseCertificationCase(query, run.id));
            if (claim.ok) leases.push(claim.lease); else break;
        }
        expect(leases).toHaveLength(2);
        for (const lease of leases) {
            await transaction(query => recordCertificationCase(query, lease, result({ costUsdCents: 2 })));
        }
        const progress = (await certificationProgress(sql, run.id))!;
        expect(progress.spentUsdCents).toBeLessThanOrEqual(4);
    }, 120000);

    it('refuses concurrently, not just one at a time', async () => {
        const run = await freshRun({ budgetUsdCents: 2 });
        // Both transactions open before either commits: the guarantee has to
        // survive the interleaving, not just the sequence.
        const [first, second] = await Promise.all([
            transaction(query => leaseCertificationCase(query, run.id)),
            transaction(query => leaseCertificationCase(query, run.id)),
        ]);
        expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    }, 120000);

    it('does not call a run finished while another worker still holds cases', async () => {
        const run = await freshRun();
        const held = [];
        for (;;) {
            const claim = await transaction(query => leaseCertificationCase(query, run.id));
            if (!claim.ok) { expect(claim.stopReason).toBe('in_flight'); break; }
            held.push(claim.lease);
        }
        expect(held.length).toBe(run.plannedCases);
        const progress = (await certificationProgress(sql, run.id))!;
        // Still running: the work is out with workers, not done.
        expect(progress.state).toBe('running');
        expect(progress.leased).toBe(run.plannedCases);
        // And once they all come back, it really is complete.
        for (const lease of held) {
            await transaction(query => recordCertificationCase(query, lease, result()));
        }
        const done = await transaction(query => leaseCertificationCase(query, run.id));
        expect(done).toEqual({ ok: false, stopReason: 'complete' });
        expect((await certificationProgress(sql, run.id))!.state).toBe('finished');
    }, 180000);

    it('does not count a result the ledger refused as work this worker did', async () => {
        const run = await freshRun();
        // The runner takes long enough that the case is handed to somebody else
        // — simulated by rotating the lease token while the runner is inside.
        const driven = await driveCertificationRun({
            transaction, runId: run.id, maxCases: 1,
            runner: async lease => {
                await sql('UPDATE agent_certification_cases SET lease_token = gen_random_uuid() WHERE id = $1::uuid',
                    [lease.caseId]);
                return result();
            },
        });
        expect(driven.processed).toBe(0);
        expect(driven.stopReason).toBe('lease_lost');
    }, 120000);

    it('names the subject of each profile, so one profile does not certify another', async () => {
        // Two profiles in one run. Each is a different template, so each has its
        // own configuration; evidence that cannot say which one it ran against
        // cannot certify either of them.
        const [first, second] = listCanonicalSubtypeExperienceProfileIds().slice(0, 2);
        const run = await planCertificationLedger(sql, {
            ...planInput, profiles: [first, second], languages: ['es'],
            subjects: {
                [first]: { agentId: randomUUID(), configHash: 'config-first', dependencyRevision: 'dep-first' },
                [second]: { agentId: randomUUID(), configHash: 'config-second', dependencyRevision: 'dep-second' },
            },
        } as any);
        for (;;) {
            const claim = await transaction(query => leaseCertificationCase(query, run.id));
            if (!claim.ok) break;
            await transaction(query => recordCertificationCase(query, claim.lease, result({
                scenario: { key: claim.lease.scenarioKey, profileId: claim.lease.profileId,
                    language: 'es', managedSeedKey: claim.lease.scenarioKey },
            })));
        }
        const evidence = await certificationEvidenceFromLedger(sql, run.id);
        const hashes = new Set(evidence.evidence.map(row => row.configHash));
        expect(hashes).toEqual(new Set(['config-first', 'config-second']));

        // Changing the first profile's template invalidates its evidence and
        // leaves the second's standing. A shared authority would take both.
        const narrowed = await certificationEvidenceFromLedger(sql, run.id, {
            subjects: { [first]: { configHash: 'config-first-edited' } },
        } as any);
        expect(narrowed.evidence.map(row => row.configHash)).toEqual(['config-second']);
        expect((narrowed as any).staleSubjects).toEqual([first]);
    }, 240000);
});
