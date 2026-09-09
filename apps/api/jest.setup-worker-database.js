/**
 * Point this worker's suites at this worker's database.
 *
 * `jest.global-setup.js` made one database per worker. This runs inside the
 * worker, before any spec is loaded, and rewrites every shared database URL to
 * the copy that belongs to it — so a spec keeps reading the same environment
 * variable it always read, and no spec has to know that workers exist.
 *
 * Left alone on purpose:
 *   · `PARALLLY_PGBOUNCER_TEST_URL` and `PARALLLY_PGBOUNCER_DIRECT_URL`, which
 *     must name the SAME database as each other because one is the proxy in
 *     front of the other, and the proxy points at a fixed database;
 *   · `PARALLLY_MIGRATION_TEST_URL`, which already owns a database of its own
 *     because its migrations iterate `public.tenants` and touch every schema
 *     named there.
 */
const { SHARED_URL_VARS, workerDatabaseName } = require('./jest.global-setup');

const worker = Math.max(1, Number(process.env.JEST_WORKER_ID) || 1);

for (const variable of SHARED_URL_VARS) {
    const value = process.env[variable];
    if (!value) continue;
    let parsed;
    try { parsed = new URL(value); } catch { continue; }
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) continue;
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!name.endsWith('_eval_isolation')) continue;
    parsed.pathname = `/${workerDatabaseName(name, worker)}`;
    process.env[variable] = parsed.toString();
}
