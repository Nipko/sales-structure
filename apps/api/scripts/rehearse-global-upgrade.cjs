const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { Client } = require('pg');

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Global upgrade rehearsal is restricted to NODE_ENV=test');
}

const targetUrl = process.env.PARALLLY_UPGRADE_TEST_URL;
if (!targetUrl) throw new Error('PARALLLY_UPGRADE_TEST_URL is required');
const parsed = new URL(targetUrl);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
  || !parsed.pathname.endsWith('_eval_isolation')) {
  throw new Error('disposable_loopback_database_required');
}

const apiRoot = resolve(__dirname, '..');
const repositoryRoot = resolve(apiRoot, '..', '..');
const baseRef = process.env.UPGRADE_BASE_REF || 'main';
const migrationPrefix = 'apps/api/prisma/migrations/';

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function baselineMigrations() {
  const paths = git(['ls-tree', '-r', '--name-only', baseRef, migrationPrefix])
    .split(/\r?\n/)
    .filter(path => path.endsWith('/migration.sql'))
    .sort();
  if (!paths.length) throw new Error(`no migrations found at ${baseRef}`);
  return paths.map(path => ({
    name: path.slice(migrationPrefix.length).split('/')[0],
    sql: git(['show', `${baseRef}:${path}`], 'buffer'),
  }));
}

async function main() {
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  try {
    const occupied = await client.query(`SELECT to_regclass('public._prisma_migrations')::text AS name`);
    assert.equal(occupied.rows[0].name, null,
      'upgrade rehearsal requires a freshly-created disposable database');

    await client.query(`CREATE TABLE public._prisma_migrations (
      id VARCHAR(36) PRIMARY KEY NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL,
      logs TEXT,
      rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    )`);

    const baseline = baselineMigrations();
    for (const migration of baseline) {
      await client.query(migration.sql.toString('utf8'));
      await client.query(`INSERT INTO public._prisma_migrations(
          id, checksum, finished_at, migration_name, applied_steps_count)
        VALUES($1,$2,clock_timestamp(),$3,1)`, [
        randomUUID(),
        createHash('sha256').update(migration.sql).digest('hex'),
        migration.name,
      ]);
    }

    const evidenceKey = `upgrade_rehearsal_${randomUUID()}`;
    await client.query(`INSERT INTO public.platform_settings(key,value,category)
      VALUES($1,'preserve-me','rehearsal')`, [evidenceKey]);

    const env = {
      ...process.env,
      DATABASE_URL: targetUrl,
      DIRECT_DATABASE_URL: targetUrl,
    };
    execFileSync(process.execPath, [
      resolve(repositoryRoot, 'node_modules', 'prisma', 'build', 'index.js'),
      'migrate', 'deploy', '--schema', resolve(apiRoot, 'prisma', 'schema.prisma'),
    ], { cwd: apiRoot, env, stdio: 'inherit' });

    const result = await client.query(`SELECT
        COUNT(*)::int AS applied,
        COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished
      FROM public._prisma_migrations`);
    const preserved = await client.query(
      'SELECT value FROM public.platform_settings WHERE key=$1', [evidenceKey]);
    const currentCount = Number(result.rows[0].applied);
    assert.ok(currentCount > baseline.length,
      `candidate must add migrations after ${baseRef}`);
    assert.equal(result.rows[0].unfinished, 0);
    assert.deepEqual(preserved.rows, [{ value: 'preserve-me' }]);
    console.log(`GLOBAL_UPGRADE_REHEARSAL base=${baseRef} baseline=${baseline.length} `
      + `current=${currentCount} unfinished=0 evidence=preserved`);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
