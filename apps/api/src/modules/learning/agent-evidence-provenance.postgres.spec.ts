import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import {
    ensureEvidenceProvenance, evidenceWithoutProvenance, invalidateEvidenceByRelease,
    releasesForMessages, EVIDENCE_STORES, type EvidenceQuery,
} from './agent-evidence-provenance';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * What a withdrawn release does to the evidence that rests on it.
 *
 * Before this, retiring a release left every evaluation, simulation, release
 * candidate, frozen regression case and judge's verdict that depended on it
 * standing — still counting as proof of an agent configured with learning nobody
 * may use any more. Five stores, and not one of them reachable by a retraction.
 *
 * Each test here is one half of the design. The first four are that the mark
 * actually lands, in all five, by whichever key that store carries. The rest are
 * the restraint: nothing is deleted, a row that names no release is left exactly
 * as it was, and retiring twice does not rewrite when the evidence stopped
 * counting.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

(connection ? describe : describe.skip)('what a withdrawn release does to the evidence', () => {
    let pool: Pool;
    const schema = `evidence_${randomUUID().replace(/-/g, '')}`;
    const retired = randomUUID();
    const kept = randomUUID();

    const transaction = async <T>(work: (query: EvidenceQuery) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL search_path TO "${schema}"`);
            const value = await work((async (text: string, params: any[] = []) =>
                (await client.query(text, params)).rows) as EvidenceQuery);
            await client.query('COMMIT');
            return value;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        transaction(query => query(text, params)) as Promise<any[]>;

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 4 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        // The five stores as they stand before the marks, plus the ledger the two
        // recording stores read their provenance from.
        for (const ddl of [
            `CREATE TABLE eval_runs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agent_snapshot JSONB,
                results JSONB NOT NULL DEFAULT '[]'::jsonb, release_evidence JSONB)`,
            `CREATE TABLE simulation_runs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), persona_snapshot JSONB,
                results JSONB DEFAULT '[]'::jsonb, summary JSONB, scenario_definitions JSONB)`,
            'CREATE TABLE agent_release_candidates(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agent_snapshot JSONB)',
            `CREATE TABLE agent_release_evaluations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                candidate_id UUID REFERENCES agent_release_candidates(id),
                results JSONB NOT NULL DEFAULT '[]'::jsonb, evidence JSONB)`,
            // `proposal` is NOT NULL with no default on purpose: it is the column
            // that would make a naive `SET ... = DEFAULT` roll back an erasure.
            `CREATE TABLE quality_regression_cases(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                proposal JSONB NOT NULL DEFAULT '{}'::jsonb, approved_scenario JSONB)`,
            `CREATE TABLE conversation_quality_scores(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                flags JSONB DEFAULT '[]'::jsonb, verification_reason TEXT, conversational_resolution_reason TEXT)`,
            `CREATE TABLE agent_turn_ledger(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                inbound_message_id UUID NOT NULL UNIQUE, envelope JSONB)`,
        ]) await transaction(query => query(ddl));
        await transaction(ensureEvidenceProvenance);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
            await pool.end();
        }
    });

    /** One row per store: the first resting on `retired`, the second on `kept`. */
    const seed = async (): Promise<Record<string, { doomed: string; safe: string }>> => {
        const snapshot = (release: string) => JSON.stringify({ learningReleaseId: release });
        const out: Record<string, { doomed: string; safe: string }> = {};
        const [a, b] = await sql(
            `INSERT INTO eval_runs(agent_snapshot, results, release_evidence)
             VALUES($1::jsonb,$3::jsonb,$3::jsonb),($2::jsonb,$3::jsonb,$3::jsonb) RETURNING id`,
            [snapshot(retired), snapshot(kept), JSON.stringify([{ transcript: ['Lo de siempre, gracias'] }])]);
        out.eval_runs = { doomed: a.id, safe: b.id };
        const [c, d] = await sql(
            `INSERT INTO simulation_runs(persona_snapshot) VALUES($1::jsonb),($2::jsonb) RETURNING id`,
            [snapshot(retired), snapshot(kept)]);
        out.simulation_runs = { doomed: c.id, safe: d.id };
        const [e, f] = await sql(
            `INSERT INTO agent_release_candidates(agent_snapshot) VALUES($1::jsonb),($2::jsonb) RETURNING id`,
            [snapshot(retired), snapshot(kept)]);
        const [g, h] = await sql(
            `INSERT INTO agent_release_evaluations(candidate_id) VALUES($1::uuid),($2::uuid) RETURNING id`,
            [e.id, f.id]);
        out.agent_release_evidence = { doomed: g.id, safe: h.id };
        for (const table of ['quality_regression_cases', 'conversation_quality_scores']) {
            // The doomed row crossed two releases; only one of them is withdrawn,
            // and an overlap is what makes that enough.
            const text = table === 'quality_regression_cases'
                ? `, proposal) VALUES($1::text[],'{"observedReplies":["Lo de siempre"]}'::jsonb),`
                    + `($2::text[],'{"observedReplies":["Lo de siempre"]}'::jsonb)`
                : `, verification_reason) VALUES($1::text[],'El cliente dijo que ya lo había pagado'),`
                    + `($2::text[],'El cliente dijo que ya lo había pagado')`;
            const [i, j] = await sql(
                `INSERT INTO ${table}(source_release_ids${text} RETURNING id`,
                [[retired, kept], [kept]]);
            out[table === 'quality_regression_cases' ? 'quality_regression_cases' : 'quality_scores'] =
                { doomed: i.id, safe: j.id };
        }
        return out;
    };

    const markOf = async (table: string, id: string) =>
        (await sql(`SELECT invalidated_at, invalidated_reason FROM ${table} WHERE id=$1::uuid`, [id]))[0];

    const clear = async () => {
        for (const table of ['eval_runs', 'simulation_runs', 'agent_release_evaluations',
            'agent_release_candidates', 'quality_regression_cases', 'conversation_quality_scores',
            'agent_turn_ledger']) await sql(`DELETE FROM ${table}`);
    };

    beforeEach(clear);

    it('reaches all five stores, by whichever key each one carries', async () => {
        const rows = await seed();
        const result = await transaction(query => invalidateEvidenceByRelease(query, [retired]));
        expect(result.map(entry => entry.store).sort())
            .toEqual(EVIDENCE_STORES.map(store => store.id).sort());
        expect(result.every(entry => entry.invalidated === 1)).toBe(true);
        for (const store of EVIDENCE_STORES) {
            const mark = await markOf(store.table, rows[store.id].doomed);
            expect(mark.invalidated_at).not.toBeNull();
            expect(mark.invalidated_reason).toBe('release_retired');
        }
    }, 120000);

    it('does not delete the evaluation that really did run', async () => {
        const rows = await seed();
        await transaction(query => invalidateEvidenceByRelease(query, [retired]));
        // The transcript survives with the row. A retraction withdraws a release;
        // it does not unwrite the history of what the agent said.
        const [run] = await sql('SELECT agent_snapshot FROM eval_runs WHERE id=$1::uuid', [rows.eval_runs.doomed]);
        expect(run.agent_snapshot).toEqual({ learningReleaseId: retired });
        const [count] = await sql('SELECT count(*)::int AS n FROM eval_runs');
        expect(Number(count.n)).toBe(2);
    }, 120000);

    it('leaves evidence that rests on a release nobody withdrew', async () => {
        const rows = await seed();
        await transaction(query => invalidateEvidenceByRelease(query, [retired]));
        for (const store of EVIDENCE_STORES) {
            expect((await markOf(store.table, rows[store.id].safe)).invalidated_at).toBeNull();
        }
    }, 120000);

    it('leaves a row that names no release alone, and counts it', async () => {
        await sql('INSERT INTO eval_runs(agent_snapshot) VALUES(NULL)');
        await sql('INSERT INTO conversation_quality_scores(source_release_ids) VALUES(NULL)');
        await sql(`INSERT INTO quality_regression_cases(source_release_ids) VALUES('{}'::text[])`);
        // Nothing can match them: no release is named. Invalidating on suspicion
        // would throw away evidence that may be perfectly sound.
        await transaction(query => invalidateEvidenceByRelease(query, [retired, kept]));
        const [row] = await sql('SELECT count(*)::int AS n FROM eval_runs WHERE invalidated_at IS NOT NULL');
        expect(Number(row.n)).toBe(0);
        // So the gap is a number somebody can see rather than a silence.
        const gaps = await transaction(evidenceWithoutProvenance);
        expect(gaps.eval_runs).toBe(1);
        expect(gaps.quality_scores).toBe(1);
        // An empty array counts as no provenance too, not as "matched nothing".
        expect(gaps.quality_regression_cases).toBe(1);
    }, 120000);

    it('takes their words out of it when the person is the one being erased', async () => {
        const rows = await seed();
        // A withdrawal of a release is a decision about what may be used; an
        // erasure is a right. Same match, and deliberately not the same effect.
        const result = await transaction(query =>
            invalidateEvidenceByRelease(query, [retired], { derivedText: 'redact' }));
        expect(result.every(entry => entry.invalidated === 1)).toBe(true);
        const [run] = await sql('SELECT results, release_evidence, agent_snapshot, invalidated_reason FROM eval_runs WHERE id=$1::uuid',
            [rows.eval_runs.doomed]);
        expect(run.results).toEqual([]);
        expect(run.release_evidence).toBeNull();
        expect(run.invalidated_reason).toBe('release_erased');
        // The row survives as the fact that the run happened. What it no longer
        // holds is anything the person said.
        expect(run.agent_snapshot).toEqual({ learningReleaseId: retired });
        // `proposal` is NOT NULL with no default: the empty shape has to be
        // stated, or the erasure would roll back on a constraint.
        const [frozen] = await sql('SELECT proposal, approved_scenario FROM quality_regression_cases WHERE id=$1::uuid',
            [rows.quality_regression_cases.doomed]);
        expect(frozen.proposal).toEqual({});
        expect(frozen.approved_scenario).toBeNull();
        const [verdict] = await sql('SELECT flags, verification_reason FROM conversation_quality_scores WHERE id=$1::uuid',
            [rows.quality_scores.doomed]);
        expect(verdict.flags).toEqual([]);
        expect(verdict.verification_reason).toBeNull();
        // And nobody else's evidence, on either count.
        const [other] = await sql('SELECT results, invalidated_at FROM eval_runs WHERE id=$1::uuid', [rows.eval_runs.safe]);
        expect(other.results).not.toEqual([]);
        expect(other.invalidated_at).toBeNull();
    }, 120000);

    it('still clears the words on a row a withdrawal had already marked', async () => {
        const rows = await seed();
        await transaction(query => invalidateEvidenceByRelease(query, [retired]));
        const marked = await markOf('eval_runs', rows.eval_runs.doomed);
        expect((await sql('SELECT results FROM eval_runs WHERE id=$1::uuid', [rows.eval_runs.doomed]))[0].results)
            .not.toEqual([]);
        // The mark is not what an erasure is for, so being already marked cannot
        // be what stops one — and it keeps the moment the evidence stopped
        // counting rather than moving it to the erasure.
        await transaction(query => invalidateEvidenceByRelease(query, [retired], { derivedText: 'redact' }));
        const [run] = await sql('SELECT results, invalidated_at, invalidated_reason FROM eval_runs WHERE id=$1::uuid',
            [rows.eval_runs.doomed]);
        expect(run.results).toEqual([]);
        expect(run.invalidated_at).toEqual(marked.invalidated_at);
        expect(run.invalidated_reason).toBe('release_retired');
    }, 120000);

    it('does not rewrite when the evidence stopped counting', async () => {
        const rows = await seed();
        await transaction(query => invalidateEvidenceByRelease(query, [retired]));
        const first = await markOf('eval_runs', rows.eval_runs.doomed);
        const second = await transaction(query => invalidateEvidenceByRelease(query, [retired]));
        expect(second.every(entry => entry.invalidated === 0)).toBe(true);
        expect((await markOf('eval_runs', rows.eval_runs.doomed)).invalidated_at).toEqual(first.invalidated_at);
    }, 120000);

    it('survives a tenant that has only some of the five', async () => {
        const partial = `evidence_${randomUUID().replace(/-/g, '')}`;
        const client = await pool.connect();
        try {
            await client.query(`CREATE SCHEMA "${partial}"`);
            await client.query(`SET search_path TO "${partial}"`);
            await client.query('CREATE TABLE eval_runs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agent_snapshot JSONB)');
            const query = (async (text: string, params: any[] = []) =>
                (await client.query(text, params)).rows) as EvidenceQuery;
            await ensureEvidenceProvenance(query);
            await client.query('BEGIN');
            await query('INSERT INTO eval_runs(agent_snapshot) VALUES($1::jsonb)',
                [JSON.stringify({ learningReleaseId: retired })]);
            // The whole point of probing first: a missing relation inside somebody
            // else's transaction aborts every statement after it, and the COMMIT
            // with them. One under-provisioned tenant must not make retraction
            // impossible.
            const result = await invalidateEvidenceByRelease(query, [retired]);
            await client.query('COMMIT');
            expect(result).toEqual([{ store: 'eval_runs', invalidated: 1 }]);
        } finally {
            await client.query('SET search_path TO public');
            await client.query(`DROP SCHEMA IF EXISTS "${partial}" CASCADE`);
            client.release();
        }
    }, 120000);

    it('reads a production turn\'s releases off the ledger it wrote them to', async () => {
        const inbound = randomUUID();
        const other = randomUUID();
        await sql(`INSERT INTO agent_turn_ledger(inbound_message_id, envelope) VALUES($1::uuid,$2::jsonb)`,
            [inbound, JSON.stringify({ learningFootprints: [
                { entries: [{ releaseId: retired }, { releaseId: kept }] },
            ] })]);
        await sql(`INSERT INTO agent_turn_ledger(inbound_message_id, envelope) VALUES($1::uuid,$2::jsonb)`,
            [other, JSON.stringify({ learningFootprints: [{ entries: [{ releaseId: randomUUID() }] }] })]);
        const found = await transaction(query => releasesForMessages(query, [inbound]));
        expect(found).toEqual([retired, kept].sort());
        // A turn that used no learning at all answers with nothing, and that is a
        // real answer rather than a missing one.
        await sql(`UPDATE agent_turn_ledger SET envelope='{}'::jsonb WHERE inbound_message_id=$1::uuid`, [inbound]);
        expect(await transaction(query => releasesForMessages(query, [inbound]))).toEqual([]);
    }, 120000);

    it('answers nothing for a tenant with no ledger, instead of failing the turn', async () => {
        const bare = `evidence_${randomUUID().replace(/-/g, '')}`;
        const client = await pool.connect();
        try {
            await client.query(`CREATE SCHEMA "${bare}"`);
            await client.query(`SET search_path TO "${bare}"`);
            const query = (async (text: string, params: any[] = []) =>
                (await client.query(text, params)).rows) as EvidenceQuery;
            expect(await releasesForMessages(query, [randomUUID()])).toEqual([]);
        } finally {
            await client.query('SET search_path TO public');
            await client.query(`DROP SCHEMA IF EXISTS "${bare}" CASCADE`);
            client.release();
        }
    }, 120000);
});
