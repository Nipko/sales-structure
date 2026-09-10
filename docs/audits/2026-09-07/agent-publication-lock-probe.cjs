// Disposable PostgreSQL lock reproduction. Does not import or modify product services.
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const assert = require('node:assert/strict');
const url = process.env.PARALLLY_ISOLATION_TEST_URL;
if (!url) throw new Error('disposable_loopback_database_required');
const parsed = new URL(url);
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.startsWith('/parallly_eval_isolation')) throw new Error('disposable_loopback_database_required');
const schema = `tenant_publication_probe_${randomUUID().replaceAll('-', '')}`;
const pool = new Pool({ connectionString: url });
const gate = `agent-operational-effects:${schema}`;
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const shared = c => c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [gate]);
const exclusive = c => c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [gate]);
const settled = promise => promise.then(() => ({ ok: true }), error => ({ ok: false, code: error.code }));
let a, b, c;
async function begin(client, timeout = 1500) {
    await client.query('BEGIN'); await client.query(`SET LOCAL search_path TO "${schema}",public`);
    await client.query(`SET LOCAL lock_timeout='${timeout}ms'`);
}
async function rollbackAll() { for (const client of [a, b, c]) await client.query('ROLLBACK'); }
async function waiting(client, blocker) {
    const pid = client.processID;
    for (let i = 0; i < 50; i++) {
        const result = await pool.query('SELECT pg_blocking_pids($1::int) AS blockers', [pid]);
        if (result.rows[0].blockers.includes(blocker.processID)) return;
        await pause(10);
    }
    throw new Error('expected_wait_not_observed');
}
(async () => {
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(`CREATE TABLE "${schema}".tenants(id int PRIMARY KEY,settings jsonb)`);
        await pool.query(`INSERT INTO "${schema}".tenants VALUES(1,'{}')`);
        await pool.query(`CREATE TABLE "${schema}".agent_personas(id int PRIMARY KEY,version int)`);
        await pool.query(`INSERT INTO "${schema}".agent_personas VALUES(1,7)`);
        await pool.query(`CREATE TABLE "${schema}".effects(id int PRIMARY KEY,agent_version int)`);
        [a, b, c] = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);

        await begin(a); await a.query('SELECT id FROM tenants WHERE id=1 FOR SHARE'); await begin(b, 150);
        const direct = await settled(b.query("UPDATE tenants SET settings='{}' WHERE id=1"));
        assert.equal(direct.code, '55P03'); results.push({ case: 'outer_tenant_row_share_blocks_own_handler_connection', result: direct.code });
        await rollbackAll();

        await begin(a); await a.query('SELECT id FROM agent_personas WHERE id=1 FOR SHARE');
        await begin(b); await b.query('SELECT id FROM tenants WHERE id=1 FOR UPDATE');
        const publication = settled(b.query('SELECT id FROM agent_personas WHERE id=1 FOR UPDATE'));
        await waiting(b, a); await begin(c, 150);
        const handler = await settled(c.query("UPDATE tenants SET settings='{}' WHERE id=1"));
        assert.equal(handler.code, '55P03');
        await a.query('ROLLBACK'); assert.equal((await publication).ok, true);
        results.push({ case: 'agent_row_guard_plus_tenant_first_publication_blocks_handler', result: handler.code, publicationWaitsForGuard: true });
        await rollbackAll();

        await begin(a); await shared(a); await begin(b); const publicationGate = settled(exclusive(b)); await waiting(b, a);
        await begin(c, 150); await c.query("UPDATE tenants SET settings='{}' WHERE id=1"); await c.query('COMMIT');
        await a.query('COMMIT'); assert.equal((await publicationGate).ok, true);
        await b.query('SELECT id FROM tenants WHERE id=1 FOR UPDATE'); await b.query('UPDATE agent_personas SET version=8 WHERE id=1'); await b.query('COMMIT');
        results.push({ case: 'advisory_exclusive_before_rows_allows_inflight_handler', handler: 'completed', publication: 'after_guard' });

        await begin(a); await shared(a); await begin(b); const queuedExclusive = settled(exclusive(b)); await waiting(b, a);
        await begin(c, 150); const nested = await settled(shared(c)); assert.equal(nested.code, '55P03');
        await a.query('ROLLBACK'); assert.equal((await queuedExclusive).ok, true);
        results.push({ case: 'nested_shared_on_another_connection_waits_behind_publisher', result: nested.code }); await rollbackAll();

        await begin(a); await shared(a); const captured = (await a.query('SELECT version FROM agent_personas WHERE id=1')).rows[0].version;
        await a.query('ROLLBACK'); // parent transaction expired/lost while its asynchronous callback still exists
        await begin(b); await exclusive(b); await b.query('UPDATE agent_personas SET version=9 WHERE id=1'); await b.query('COMMIT');
        await begin(c); await c.query('INSERT INTO effects VALUES(1,$1)', [captured]); await c.query('COMMIT');
        const late = await pool.query(`SELECT e.agent_version,a.version FROM "${schema}".effects e CROSS JOIN "${schema}".agent_personas a`);
        assert.deepEqual(late.rows[0], { agent_version: 8, version: 9 });
        results.push({ case: 'lost_outer_fence_does_not_cancel_other_connection_callback', effectVersion: 8, liveVersion: 9 });

        await begin(c); await shared(c);
        const current = (await c.query('SELECT version FROM agent_personas WHERE id=1')).rows[0].version;
        if (current === captured) await c.query('INSERT INTO effects VALUES(2,$1)', [captured]);
        await c.query('COMMIT');
        const count = (await pool.query(`SELECT count(*)::int AS count FROM "${schema}".effects WHERE id=2`)).rows[0].count;
        assert.equal(count, 0); results.push({ case: 'fence_and_version_check_in_effect_transaction_refuses_old_version', inserted: count });
        console.log(JSON.stringify({ passed: results.length, results }, null, 2));
    } finally {
        if (a && b && c) { await rollbackAll(); for (const client of [a, b, c]) client.release(); }
        if (!/^tenant_publication_probe_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
