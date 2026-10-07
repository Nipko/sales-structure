/*
 * Lock-contention resilience of scripts/migrate-tenants.js.
 *
 *   node scripts/test-tenant-migration-locks.js
 *
 * Part 1 needs no database: a scripted fake Prisma client simulates 40P01 /
 * 55P03 / 40001 and checks retry, backoff, summary and no-op detection.
 * Part 2 (NODE_ENV=test and DATABASE_URL, e.g. the isolated PostgreSQL) provokes
 * REAL lock conflicts with a second connection: a lock_timeout that must be
 * retried once the lock is released, a real deadlock (40P01) that must be
 * survived, a persistent conflict that must still fail closed and roll back.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_OPTIONS,
  readOptions,
  isTransientLockError,
  computeBackoffMs,
  splitSqlStatements,
  splitTopLevelCommas,
  parseNoopCandidate,
  migrateTenantSchema,
  runTenantMigrations,
} = require('./migrate-tenants');

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   - ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  FAIL - ${name}\n${error.stack || error}`);
  }
}

const FAST = Object.freeze({
  ...DEFAULT_OPTIONS,
  retryMinMs: 10,
  retryMaxMs: 40,
  skipNoopDdl: false,
});

/** Error shaped like what Prisma raises for a PostgreSQL error inside $executeRaw. */
function pgError(sqlState, message) {
  const error = new Error(message || `pg error ${sqlState}`);
  error.code = 'P2010';
  error.meta = { code: sqlState, message };
  return error;
}

/**
 * Fake Prisma client. `script` is a list of per-attempt behaviours, consumed in
 * order of $transaction calls: `{ failAt: <statement index>, error }` or `null`
 * for an attempt that succeeds. Records every statement per attempt.
 */
function fakePrisma(script, { catalog } = {}) {
  const attempts = [];
  return {
    attempts,
    async $queryRawUnsafe(sql, ...params) {
      if (/information_schema\.schemata/.test(sql)) return [{ schema_name: params[0] }];
      throw new Error(`unexpected top-level query: ${sql}`);
    },
    async $transaction(fn, options) {
      const behaviour = script[attempts.length] === undefined ? null : script[attempts.length];
      const attempt = { executed: [], settings: [], advisory: [], options };
      attempts.push(attempt);
      let executedIndex = 0;
      const tx = {
        async $queryRawUnsafe(sql, ...params) {
          if (/set_config/.test(sql)) {
            attempt.settings.push([/'([a-z_]+)'/.exec(sql)[1], params[0]]);
            return [{ set_config: params[0] }];
          }
          if (/pg_advisory_xact_lock/.test(sql)) {
            attempt.advisory.push(params[0]);
            return [{ pg_advisory_xact_lock: '' }];
          }
          if (catalog) return catalog(sql, params);
          throw new Error(`unexpected tx query: ${sql}`);
        },
        async $executeRawUnsafe(sql) {
          if (behaviour && behaviour.failAt === executedIndex) throw behaviour.error;
          attempt.executed.push(sql);
          executedIndex++;
          return 1;
        },
      };
      return fn(tx);
    },
  };
}

const TENANT = 'tenant_ci_locks';
const STMTS = [
  `CREATE TABLE IF NOT EXISTS "${TENANT}"."a" (id int);`,
  `ALTER TABLE "${TENANT}"."a" ADD COLUMN IF NOT EXISTS "x" int;`,
  `CREATE INDEX IF NOT EXISTS "idx_a_x" ON "${TENANT}"."a" ("x");`,
];
const TPL = STMTS.join('\n').split(TENANT).join('{{SCHEMA_NAME}}');
const noSleep = () => {
  const calls = [];
  const sleep = async (ms) => { calls.push(ms); };
  sleep.calls = calls;
  return sleep;
};

async function part1() {
  console.log('Part 1: retry logic (no database)');

  await test('40P01 on attempt 1 and success on attempt 2 counts as ok and reports the retry', async () => {
    const prisma = fakePrisma([{ failAt: 2, error: pgError('40P01', 'deadlock detected') }, null]);
    const sleep = noSleep();
    const logs = [];
    const errors = [];
    const summary = await runTenantMigrations({
      prisma, tpl: TPL, tenants: [{ schema_name: TENANT, is_active: true }],
      options: FAST, sleep, random: () => 0.5, log: (m) => logs.push(m), logError: (m) => errors.push(m),
    });
    assert.deepEqual(summary, { ok: 1, skipped: 0, warnings: 0, retries: 1 });
    assert.equal(prisma.attempts.length, 2);
    assert.equal(sleep.calls.length, 1);
    assert.ok(sleep.calls[0] >= FAST.retryMinMs && sleep.calls[0] <= FAST.retryMaxMs);
    // The retry restarted the whole tenant: attempt 2 ran every statement.
    assert.deepEqual(prisma.attempts[1].executed, STMTS);
    assert.deepEqual(prisma.attempts[0].executed, STMTS.slice(0, 2));
    const retryLine = logs.find((line) => line.includes('[RETRY]'));
    assert.match(retryLine, new RegExp(`${TENANT} attempt 1/4 rolled back at statement 3 \\(40P01\\)`));
    assert.ok(logs.some((line) => line.includes(`[OK] ${TENANT}`) && line.includes('succeeded on attempt 2/4')));
    assert.deepEqual(errors, []);
  });

  for (const [label, error] of [
    ['55P03 lock_not_available', pgError('55P03', 'canceling statement due to lock timeout')],
    ['40001 serialization_failure', pgError('40001', 'could not serialize access')],
    ['Prisma P2034', Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), { code: 'P2034' })],
  ]) {
    await test(`${label} is retried`, async () => {
      const prisma = fakePrisma([{ failAt: 0, error }, null]);
      const result = await migrateTenantSchema({
        prisma, schemaName: TENANT, stmts: STMTS, options: FAST, sleep: noSleep(), log: () => {},
      });
      assert.equal(result.ok, true);
      assert.equal(result.attempts, 2);
    });
  }

  await test('persistent 40P01 gives up after maxAttempts: skipped=1 warnings=1, no half-applied attempt', async () => {
    const failing = { failAt: 1, error: pgError('40P01', 'deadlock detected') };
    const prisma = fakePrisma([failing, failing, failing, failing, null]);
    const sleep = noSleep();
    const logs = [];
    const errors = [];
    const summary = await runTenantMigrations({
      prisma, tpl: TPL, tenants: [{ schema_name: TENANT, is_active: true }],
      options: FAST, sleep, log: (m) => logs.push(m), logError: (m) => errors.push(m),
    });
    assert.deepEqual(summary, { ok: 0, skipped: 1, warnings: 1, retries: 3 });
    assert.equal(prisma.attempts.length, 4, 'exactly maxAttempts transactions, never a fifth');
    assert.equal(sleep.calls.length, 3);
    assert.equal(logs.filter((line) => line.includes('[RETRY]')).length, 3);
    assert.ok(logs.some((line) => /Tenant transaction rolled back at statement 2 \(40P01\).*gave up after 4/.test(line)));
    assert.ok(errors.some((line) => line.includes(`[SKIP] Error migrating ${TENANT}`)));
  });

  await test('a failing tenant does not stop the others and keeps the final counts exact', async () => {
    const failing = { failAt: 0, error: pgError('40P01', 'deadlock detected') };
    // tenant A: 40P01 x4 (fails); tenant B: ok first try; tenant C: 40P01 then ok.
    const prisma = fakePrisma([failing, failing, failing, failing, null, failing, null]);
    const summary = await runTenantMigrations({
      prisma, tpl: TPL,
      tenants: ['tenant_ci_a', 'tenant_ci_b', 'tenant_ci_c'].map((schema_name) => ({ schema_name, is_active: true })),
      options: FAST, sleep: noSleep(), log: () => {}, logError: () => {},
    });
    assert.deepEqual(summary, { ok: 2, skipped: 1, warnings: 1, retries: 4 });
  });

  await test('non-transient errors (23505) are NOT retried', async () => {
    const prisma = fakePrisma([{ failAt: 1, error: pgError('23505', 'duplicate key') }, null]);
    const sleep = noSleep();
    const summary = await runTenantMigrations({
      prisma, tpl: TPL, tenants: [{ schema_name: TENANT, is_active: true }],
      options: FAST, sleep, log: () => {}, logError: () => {},
    });
    assert.deepEqual(summary, { ok: 0, skipped: 1, warnings: 1, retries: 0 });
    assert.equal(prisma.attempts.length, 1);
    assert.equal(sleep.calls.length, 0);
  });

  await test('maxAttempts=1 disables retry', async () => {
    const prisma = fakePrisma([{ failAt: 0, error: pgError('40P01') }, null]);
    const result = await migrateTenantSchema({
      prisma, schemaName: TENANT, stmts: STMTS, options: { ...FAST, maxAttempts: 1 }, sleep: noSleep(), log: () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(prisma.attempts.length, 1);
  });

  await test('each attempt sets lock_timeout (advisory budget, then table budget scaled by attempt) before DDL', async () => {
    const failing = { failAt: 1, error: pgError('55P03', 'lock timeout') };
    const prisma = fakePrisma([failing, null]);
    await migrateTenantSchema({
      prisma, schemaName: TENANT, stmts: STMTS, options: { ...FAST, lockTimeoutMs: 5000, advisoryLockTimeoutMs: 60000 },
      sleep: noSleep(), log: () => {},
    });
    assert.deepEqual(prisma.attempts[0].settings, [['lock_timeout', '60000ms'], ['lock_timeout', '5000ms']]);
    assert.deepEqual(prisma.attempts[1].settings, [['lock_timeout', '60000ms'], ['lock_timeout', '10000ms']]);
    assert.deepEqual(prisma.attempts[0].advisory, [`runtime-schema:${TENANT}`]);
    assert.equal(prisma.attempts[0].options.timeout, DEFAULT_OPTIONS.txTimeoutMs);
  });

  await test('statement_timeout is only set when configured', async () => {
    const prisma = fakePrisma([null, null]);
    await migrateTenantSchema({ prisma, schemaName: TENANT, stmts: STMTS, options: FAST, sleep: noSleep(), log: () => {} });
    await migrateTenantSchema({
      prisma, schemaName: TENANT, stmts: STMTS, options: { ...FAST, statementTimeoutMs: 120000 }, sleep: noSleep(), log: () => {},
    });
    assert.ok(!prisma.attempts[0].settings.some(([name]) => name === 'statement_timeout'));
    assert.deepEqual(prisma.attempts[1].settings.pop(), ['statement_timeout', '120000ms']);
  });

  await test('transient classification and backoff bounds', async () => {
    assert.equal(isTransientLockError(pgError('40P01')), true);
    assert.equal(isTransientLockError(pgError('23505')), false);
    assert.equal(isTransientLockError(pgError('57014')), false, 'statement_timeout is not lock contention');
    assert.equal(isTransientLockError(new Error('ERROR: deadlock detected')), true);
    assert.equal(isTransientLockError(new Error('connection refused')), false);
    const o = DEFAULT_OPTIONS;
    assert.equal(computeBackoffMs(1, o, () => 0), 2000);
    assert.equal(computeBackoffMs(1, o, () => 1), 4000);
    assert.equal(computeBackoffMs(2, o, () => 1), 8000);
    assert.equal(computeBackoffMs(3, o, () => 1), 15000, 'capped at retryMaxMs');
    assert.equal(computeBackoffMs(9, o, () => 1), 15000);
    assert.equal(o.maxAttempts, 4);
    assert.equal(o.lockTimeoutMs, 5000);
  });

  await test('readOptions honours env overrides and ignores garbage', async () => {
    const o = readOptions({
      MIGRATE_TENANTS_MAX_ATTEMPTS: '2', MIGRATE_TENANTS_LOCK_TIMEOUT_MS: '300',
      MIGRATE_TENANTS_RETRY_MIN_MS: '5', MIGRATE_TENANTS_RETRY_MAX_MS: '1', MIGRATE_TENANTS_SKIP_NOOP_DDL: 'false',
    });
    assert.equal(o.maxAttempts, 2);
    assert.equal(o.lockTimeoutMs, 300);
    assert.equal(o.retryMaxMs, 5, 'max never below min');
    assert.equal(o.skipNoopDdl, false);
    const d = readOptions({ MIGRATE_TENANTS_MAX_ATTEMPTS: 'abc', MIGRATE_TENANTS_LOCK_TIMEOUT_MS: '-3' });
    assert.equal(d.maxAttempts, 4);
    assert.equal(d.lockTimeoutMs, 5000);
    assert.equal(d.skipNoopDdl, true);
  });

  console.log('Part 1b: no-op DDL detection');

  await test('parseNoopCandidate recognises only pure create-if-missing statements', async () => {
    const s = TENANT;
    assert.deepEqual(
      parseNoopCandidate(`ALTER TABLE "${s}"."conversations"\n    ADD COLUMN IF NOT EXISTS "agent_persona_id" UUID;`, s),
      { kind: 'columns', table: 'conversations', columns: ['agent_persona_id'] },
    );
    assert.deepEqual(
      parseNoopCandidate(
        `ALTER TABLE "${s}"."t"\n ADD COLUMN IF NOT EXISTS "a" VARCHAR(20) DEFAULT 'x,y',\n ADD COLUMN IF NOT EXISTS b NUMERIC(10, 2) CHECK (b IN (1, 2)),\n ADD COLUMN IF NOT EXISTS "c" UUID[] NOT NULL DEFAULT '{}'::uuid[];`, s,
      ),
      { kind: 'columns', table: 't', columns: ['a', 'b', 'c'] },
    );
    assert.deepEqual(
      parseNoopCandidate(`ALTER TABLE "${s}"."opportunities" ADD COLUMN IF NOT EXISTS "deal_id" UUID REFERENCES "${s}"."deals"("id") ON DELETE SET NULL;`, s),
      { kind: 'columns', table: 'opportunities', columns: ['deal_id'] },
    );
    assert.deepEqual(
      parseNoopCandidate(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_x" ON "${s}"."t" ("a") WHERE "a" IS NOT NULL;`, s),
      { kind: 'index', name: 'uidx_x' },
    );
    assert.deepEqual(
      parseNoopCandidate(`CREATE INDEX IF NOT EXISTS idx_cqs ON "${s}"."t"(a);`, s),
      { kind: 'index', name: 'idx_cqs' },
    );
    // Anything that is not purely "add if missing" must run as written.
    const mustRun = [
      `ALTER TABLE "${s}"."t" ADD COLUMN IF NOT EXISTS "a" INT, DROP COLUMN IF EXISTS "b";`,
      `ALTER TABLE "${s}"."t" ADD COLUMN IF NOT EXISTS "a" INT, ALTER COLUMN "z" SET NOT NULL;`,
      `ALTER TABLE "${s}"."t" ADD COLUMN "a" INT;`,
      `ALTER TABLE "${s}"."t" ALTER COLUMN "a" DROP NOT NULL;`,
      `ALTER TABLE "${s}"."t" DROP CONSTRAINT IF EXISTS "c";`,
      `ALTER TABLE "${s}"."t" ADD CONSTRAINT "c" CHECK ("a" > 0) NOT VALID;`,
      `ALTER TABLE IF EXISTS "${s}"."t" ADD COLUMN IF NOT EXISTS "a" INT;`,
      `ALTER TABLE ONLY "${s}"."t" ADD COLUMN IF NOT EXISTS "a" INT;`,
      `ALTER TABLE "other_schema"."t" ADD COLUMN IF NOT EXISTS "a" INT;`,
      `ALTER TABLE "${s}"."t" ADD COLUMN IF NOT EXISTS "a" INT, ADD COLUMN IF NOT EXISTS "b" (;`,
      `CREATE INDEX "idx" ON "${s}"."t" ("a");`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx" ON "${s}"."t" ("a");`,
      `CREATE INDEX IF NOT EXISTS "idx" ON "other_schema"."t" ("a");`,
      `CREATE INDEX IF NOT EXISTS "idx" ON ONLY "${s}"."t" ("a");`,
      `CREATE TABLE IF NOT EXISTS "${s}"."t" (id int);`,
      `DROP INDEX IF EXISTS "${s}"."idx";`,
    ];
    for (const stmt of mustRun) assert.equal(parseNoopCandidate(stmt, s), null, stmt);
    assert.deepEqual(splitTopLevelCommas("a, b(c, d), 'e,f', \"g,h\""), ['a', ' b(c, d)', " 'e,f'", ' "g,h"']);
    assert.equal(splitTopLevelCommas('a, (b'), null);
  });

  await test('the real tenant-schema.sql: every detected no-op is exactly an add-if-missing statement', async () => {
    const tpl = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'tenant-schema.sql'), 'utf8');
    const stmts = splitSqlStatements(tpl.replace(/\{\{SCHEMA_NAME\}\}/g, TENANT).replace(/--.*$/gm, ''));
    let columns = 0;
    let indexes = 0;
    for (const stmt of stmts) {
      const candidate = parseNoopCandidate(stmt, TENANT);
      if (!candidate) continue;
      if (candidate.kind === 'columns') {
        columns++;
        const clauses = (stmt.match(/\bADD\s+COLUMN\b/gi) || []).length;
        assert.equal(candidate.columns.length, clauses, `column count mismatch in: ${stmt}`);
        assert.equal((stmt.match(/IF\s+NOT\s+EXISTS/gi) || []).length >= clauses, true, stmt);
        assert.ok(!/\b(DROP|RENAME|ALTER\s+COLUMN|ADD\s+CONSTRAINT)\b/i.test(stmt), `unexpected clause in: ${stmt}`);
      } else {
        indexes++;
        assert.match(stmt, /^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i);
      }
    }
    // The template is overwhelmingly add-if-missing DDL; the optimisation must
    // actually cover it or it would silently stop protecting anything.
    assert.ok(columns >= 150, `expected >=150 add-column statements, got ${columns}`);
    assert.ok(indexes >= 300, `expected >=300 create-index statements, got ${indexes}`);
    console.log(`       (template: ${stmts.length} statements, ${columns} add-column + ${indexes} create-index detectable as no-ops)`);
  });

  await test('skipNoopDdl skips statements the catalog says already exist and runs the rest', async () => {
    const catalogCalls = [];
    const catalog = (sql, params) => {
      catalogCalls.push(params);
      if (/pg_attribute/.test(sql)) return params[2].includes('x') ? [{ name: 'x' }] : [];
      return /idx_a_x/.test(params[1]) ? [{ present: 1 }] : [];
    };
    const prisma = fakePrisma([null], { catalog });
    const result = await migrateTenantSchema({
      prisma, schemaName: TENANT, stmts: STMTS, options: { ...FAST, skipNoopDdl: true }, sleep: noSleep(), log: () => {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.noopSkipped, 2);
    assert.deepEqual(prisma.attempts[0].executed, [STMTS[0]]);
    assert.deepEqual(catalogCalls[0], [TENANT, 'a', ['x']]);

    // Column missing: the ALTER must run.
    const prisma2 = fakePrisma([null], { catalog: (sql) => (/pg_attribute/.test(sql) ? [] : [{ present: 1 }]) });
    const result2 = await migrateTenantSchema({
      prisma: prisma2, schemaName: TENANT, stmts: STMTS, options: { ...FAST, skipNoopDdl: true }, sleep: noSleep(), log: () => {},
    });
    assert.deepEqual(prisma2.attempts[0].executed, [STMTS[0], STMTS[1]]);
    assert.equal(result2.noopSkipped, 1);

    // Multi-column statement: runs unless EVERY column exists.
    const multi = `ALTER TABLE "${TENANT}"."a"\n ADD COLUMN IF NOT EXISTS "p" int,\n ADD COLUMN IF NOT EXISTS "q" int;`;
    const prisma3 = fakePrisma([null], { catalog: () => [{ name: 'p' }] });
    await migrateTenantSchema({
      prisma: prisma3, schemaName: TENANT, stmts: [multi], options: { ...FAST, skipNoopDdl: true }, sleep: noSleep(), log: () => {},
    });
    assert.deepEqual(prisma3.attempts[0].executed, [multi]);
  });
}

// ---------------------------------------------------------------------------
// Part 2: real PostgreSQL lock conflicts
// ---------------------------------------------------------------------------

async function part2() {
  const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !databaseUrl) {
    console.log('Part 2: skipped (needs NODE_ENV=test and DATABASE_URL pointing at a disposable PostgreSQL)');
    return;
  }
  console.log('Part 2: real lock conflicts (PostgreSQL)');
  const { PrismaClient } = require('@prisma/client');
  const { Client } = require('pg');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = `${process.pid}_${Date.now().toString(36)}`;
  const connect = async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    return client;
  };
  const cleanupSchemas = [];
  const holders = [];
  const setup = async (name) => {
    const schema = `tenant_ci_lock_${name}_${suffix}`;
    cleanupSchemas.push(schema);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "${schema}"."t1" (id int PRIMARY KEY, a int)`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "${schema}"."t2" (id int PRIMARY KEY, a int)`);
    return schema;
  };
  const holder = async () => {
    const client = await connect();
    holders.push(client);
    return client;
  };
  const columnExists = async (schema, table, column) => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      schema, table, column,
    );
    return rows.length > 0;
  };
  const tplFor = (lines) => lines.join('\n');
  const REAL = {
    ...DEFAULT_OPTIONS,
    retryMinMs: 20,
    retryMaxMs: 60,
    skipNoopDdl: true,
  };
  const quiet = { log: () => {}, logError: () => {} };

  try {
    await test('REAL 55P03: DDL queued behind a live reader times out, is retried after the lock is released, and the tenant ends ok', async () => {
      const schema = await setup('timeout');
      const live = await holder();
      await live.query('BEGIN');
      await live.query(`LOCK TABLE "${schema}"."t1" IN ACCESS SHARE MODE`); // live traffic reading t1
      const logs = [];
      const released = [];
      const tpl = tplFor([
        'ALTER TABLE "{{SCHEMA_NAME}}"."t2" ADD COLUMN IF NOT EXISTS "first_col" INT;',
        'ALTER TABLE "{{SCHEMA_NAME}}"."t1" ADD COLUMN IF NOT EXISTS "new_col" INT;',
      ]);
      const summary = await runTenantMigrations({
        prisma, tpl, tenants: [{ schema_name: schema, is_active: true }],
        options: { ...REAL, lockTimeoutMs: 300 },
        // Backoff hook: live traffic finishes while the migration waits to retry.
        sleep: async () => { released.push(Date.now()); await live.query('COMMIT'); },
        log: (m) => logs.push(m), logError: () => {},
      });
      assert.deepEqual(summary, { ok: 1, skipped: 0, warnings: 0, retries: 1 });
      assert.equal(released.length, 1, 'exactly one retry');
      assert.ok(logs.some((l) => /\[RETRY\].*statement 2 \(55P03\)/.test(l)), logs.join('\n'));
      assert.equal(await columnExists(schema, 't1', 'new_col'), true);
      assert.equal(await columnExists(schema, 't2', 'first_col'), true);
    });

    await test('REAL persistent lock conflict: gives up after maxAttempts, fails closed (skipped=1) and rolls the whole tenant back', async () => {
      const schema = await setup('persist');
      const live = await holder();
      await live.query('BEGIN');
      await live.query(`LOCK TABLE "${schema}"."t1" IN ACCESS SHARE MODE`);
      const logs = [];
      const summary = await runTenantMigrations({
        prisma,
        tpl: tplFor([
          'ALTER TABLE "{{SCHEMA_NAME}}"."t2" ADD COLUMN IF NOT EXISTS "first_col" INT;',
          'ALTER TABLE "{{SCHEMA_NAME}}"."t1" ADD COLUMN IF NOT EXISTS "new_col" INT;',
        ]),
        tenants: [{ schema_name: schema, is_active: true }],
        options: { ...REAL, lockTimeoutMs: 150, maxAttempts: 3 },
        log: (m) => logs.push(m), logError: () => {},
      });
      await live.query('ROLLBACK');
      assert.deepEqual(summary, { ok: 0, skipped: 1, warnings: 1, retries: 2 });
      assert.equal(logs.filter((l) => l.includes('[RETRY]')).length, 2);
      assert.ok(logs.some((l) => /rolled back at statement 2 \(55P03\).*gave up after 3/.test(l)), logs.join('\n'));
      assert.ok(!logs.some((l) => l.includes('\n')), 'every log entry is a single line');
      assert.equal(await columnExists(schema, 't2', 'first_col'), false, 'no half-migrated tenant');
      assert.equal(await columnExists(schema, 't1', 'new_col'), false);
    });

    await test('REAL no-op skip: an existing column/index does not queue behind live traffic (no heavy lock taken)', async () => {
      const schema = await setup('noop');
      await prisma.$executeRawUnsafe(`ALTER TABLE "${schema}"."t1" ADD COLUMN "present_col" INT`);
      await prisma.$executeRawUnsafe(`CREATE INDEX "idx_present" ON "${schema}"."t1" ("present_col")`);
      const live = await holder();
      await live.query('BEGIN');
      await live.query(`LOCK TABLE "${schema}"."t1" IN ACCESS SHARE MODE`);
      const tpl = tplFor([
        'ALTER TABLE "{{SCHEMA_NAME}}"."t1" ADD COLUMN IF NOT EXISTS "present_col" INT;',
        'CREATE INDEX IF NOT EXISTS "idx_present" ON "{{SCHEMA_NAME}}"."t1" ("present_col");',
      ]);
      const tenants = [{ schema_name: schema, is_active: true }];
      const withSkip = await runTenantMigrations({
        prisma, tpl, tenants, options: { ...REAL, lockTimeoutMs: 200, maxAttempts: 1 }, ...quiet,
      });
      assert.deepEqual(withSkip, { ok: 1, skipped: 0, warnings: 0, retries: 0 });
      // Control: without the optimisation the very same template queues behind the reader.
      const withoutSkip = await runTenantMigrations({
        prisma, tpl, tenants, options: { ...REAL, lockTimeoutMs: 200, maxAttempts: 1, skipNoopDdl: false }, ...quiet,
      });
      assert.equal(withoutSkip.skipped, 1, 'control must hit the lock timeout');
      await live.query('ROLLBACK');
    });

    await test('REAL 40P01: a genuine deadlock with live traffic is survived by the retry', async () => {
      const schema = await setup('deadlock');
      const live = await holder();
      // Live transaction already reads t2 (AccessShare) ...
      await live.query('BEGIN');
      await live.query(`SELECT 1 FROM "${schema}"."t2"`);
      const logs = [];
      let liveQuery = null;
      const tpl = tplFor([
        // ... migration takes ACCESS EXCLUSIVE on t1 and keeps it until COMMIT ...
        'ALTER TABLE "{{SCHEMA_NAME}}"."t1" ADD COLUMN IF NOT EXISTS "dl_one" INT;',
        // ... then queues for t2 behind the live reader.
        'ALTER TABLE "{{SCHEMA_NAME}}"."t2" ADD COLUMN IF NOT EXISTS "dl_two" INT;',
      ]);
      const migration = runTenantMigrations({
        prisma, tpl, tenants: [{ schema_name: schema, is_active: true }],
        // Long lock_timeout: the failure must come from the deadlock detector, not the timeout.
        options: { ...REAL, lockTimeoutMs: 30_000 },
        sleep: async () => {
          // The retry waits until live traffic has finished.
          await liveQuery.catch(() => {});
          await live.query('COMMIT').catch(() => {});
        },
        log: (m) => logs.push(m), logError: () => {},
      });
      // Once the migration is queued on t2, the live transaction reaches for t1: a cycle.
      await new Promise((resolve) => setTimeout(resolve, 400));
      liveQuery = live.query(`SELECT 1 FROM "${schema}"."t1"`).catch((error) => error);
      const summary = await migration;
      const liveOutcome = await liveQuery;
      // Postgres picks the victim; either way nothing may be left half-done.
      assert.equal(summary.skipped, 0, `migration must finish ok: ${logs.join('\n')}`);
      assert.equal(summary.ok, 1);
      assert.equal(await columnExists(schema, 't1', 'dl_one'), true);
      assert.equal(await columnExists(schema, 't2', 'dl_two'), true);
      if (liveOutcome instanceof Error) {
        // Postgres chose the live side as the victim: the migration needed no retry.
        assert.equal(liveOutcome.code, '40P01');
        assert.equal(summary.retries, 0);
        console.log('       (Postgres chose the live transaction as the deadlock victim this time)');
      } else {
        console.log('       (Postgres chose the migration as the victim: 40P01 -> retried -> ok)');
        assert.equal(summary.retries, 1);
        assert.ok(logs.some((l) => /\[RETRY\].*\(40P01\)/.test(l)), logs.join('\n'));
      }
    });

    await endToEnd(databaseUrl);
  } finally {
    for (const client of holders) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
    for (const schema of cleanupSchemas) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    }
    await prisma.$disconnect().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Part 3: the real CLI against the real tenant-schema.sql, in a scratch database
// ---------------------------------------------------------------------------

function runCli(env, { onLine, cwd } = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    // The CLI reads prisma/tenant-schema.sql from its cwd, so a test can aim it at a tiny template.
    const child = spawn(process.execPath, [path.join(__dirname, 'migrate-tenants.js')], {
      cwd: cwd || path.resolve(__dirname, '..'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let pending = '';
    const feed = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (!onLine) return;
      pending += text;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) onLine(line);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output }));
  });
}

/** Same extraction deploy.yml and october-cutover.sh run, so a format change cannot break them silently. */
function parseSummaryLikeTheWorkflow(output) {
  const summaryLines = output.replace(/\r/g, '').split('\n').map((l) => /MIGRATE_TENANTS_SUMMARY .*/.exec(l)).filter(Boolean);
  const summary = summaryLines.length ? summaryLines[summaryLines.length - 1][0] : '';
  const field = (name) => {
    const match = new RegExp(`.*${name}=([0-9]*).*`).exec(summary);
    return match ? Number(match[1]) : null;
  };
  const parsed = { summary, skipped: field('skipped'), warnings: field('warnings'), ok: field('ok') };
  const { spawnSync } = require('child_process');
  const sed = spawnSync('sed', ['-n', 's/.*skipped=\\([0-9]*\\).*/\\1/p'], { input: `${summary}\n`, encoding: 'utf8' });
  if (!sed.error && sed.status === 0) {
    assert.equal(Number(sed.stdout.trim()), parsed.skipped, 'real sed must agree with the regex mirror');
    const sedWarn = spawnSync('sed', ['-n', 's/.*warnings=\\([0-9]*\\).*/\\1/p'], { input: `${summary}\n`, encoding: 'utf8' });
    assert.equal(Number(sedWarn.stdout.trim()), parsed.warnings);
  }
  return parsed;
}

const E2E_TEMPLATE = [
  'CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."contacts" (id int PRIMARY KEY);',
  'CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."orders" (id int PRIMARY KEY, contact_id int NOT NULL);',
  'ALTER TABLE "{{SCHEMA_NAME}}"."orders" ADD COLUMN IF NOT EXISTS "note" TEXT;',
  'CREATE INDEX IF NOT EXISTS "idx_orders_note" ON "{{SCHEMA_NAME}}"."orders" ("note");',
  // Always takes ACCESS EXCLUSIVE, even on a migrated tenant: this is the statement a live reader blocks.
  'ALTER TABLE "{{SCHEMA_NAME}}"."orders" ALTER COLUMN "contact_id" DROP NOT NULL;',
  '',
].join('\n');

/** Everything the template can change, with the tenant schema name normalised away. */
async function catalogSnapshot(prisma, schema) {
  const normalise = (value) => (typeof value === 'string' ? value.split(schema).join('<S>') : value);
  const rows = async (sql) => (await prisma.$queryRawUnsafe(sql, schema)).map((row) => (
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalise(value)]))
  ));
  return {
    columns: await rows(`SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
        character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, column_name`),
    indexes: (await rows('SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1'))
      .sort((a, b) => `${a.tablename}.${a.indexname}`.localeCompare(`${b.tablename}.${b.indexname}`)),
    constraints: (await rows(`SELECT c.conrelid::regclass::text AS tbl, c.conname, c.contype, c.convalidated,
        pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1`))
      .sort((a, b) => `${a.tbl}.${a.conname}`.localeCompare(`${b.tbl}.${b.conname}`)),
    triggers: (await rows(`SELECT t.tgname, t.tgrelid::regclass::text AS tbl FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = $1`))
      .sort((a, b) => `${a.tbl}.${a.tgname}`.localeCompare(`${b.tbl}.${b.tgname}`)),
    functions: (await rows(`SELECT p.proname, md5(replace(p.prosrc, $1, '<S>')) AS src FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1`))
      .sort((a, b) => a.proname.localeCompare(b.proname)),
  };
}

function assertSameSchema(left, right, label) {
  for (const section of Object.keys(left)) {
    const a = new Set(left[section].map((row) => JSON.stringify(row)));
    const b = new Set(right[section].map((row) => JSON.stringify(row)));
    const onlyLeft = [...a].filter((row) => !b.has(row));
    const onlyRight = [...b].filter((row) => !a.has(row));
    assert.deepEqual(
      { onlyLeft: onlyLeft.slice(0, 8), onlyRight: onlyRight.slice(0, 8) },
      { onlyLeft: [], onlyRight: [] },
      `${label}: ${section} differ between skipNoopDdl=true (left) and false (right)`,
    );
  }
}

async function endToEnd(databaseUrl) {
  const os = require('os');
  const { Client } = require('pg');
  const { PrismaClient } = require('@prisma/client');
  const base = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
    console.log('Part 3: skipped (scratch database only on loopback)');
    return;
  }
  console.log('Part 3: CLI end to end and real template (scratch database)');
  const dbName = `ci_migratelock_${process.pid}_${Date.now().toString(36)}_eval_isolation`;
  assert.match(dbName, /^[a-z0-9_]{1,63}$/);
  const withDb = (name) => { const u = new URL(databaseUrl); u.pathname = `/${name}`; return u.toString(); };
  const admin = new Client({ connectionString: withDb('postgres') });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE template0`);
  const scratchUrl = withDb(dbName);
  const db = new Client({ connectionString: scratchUrl });
  await db.connect();
  const live = new Client({ connectionString: scratchUrl });
  await live.connect();
  const prisma = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-tenants-'));
  try {
    let hasVector = true;
    for (const statement of ['CREATE EXTENSION IF NOT EXISTS "uuid-ossp"', 'CREATE EXTENSION IF NOT EXISTS vector']) {
      await db.query(statement).catch((error) => { if (/vector/.test(statement)) hasVector = false; return error; });
    }
    await db.query('CREATE TABLE public.tenants (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, schema_name text, is_active boolean DEFAULT true)');
    // The only global table the template references (calendar owners -> public."users").
    await db.query('CREATE TABLE public.users (id uuid DEFAULT gen_random_uuid() PRIMARY KEY)');

    // ---- 3a: the real CLI, a tiny template, real lock conflicts ----
    fs.mkdirSync(path.join(tmpDir, 'prisma'));
    fs.writeFileSync(path.join(tmpDir, 'prisma', 'tenant-schema.sql'), E2E_TEMPLATE);
    const schema = `tenant_ci_e2e_${process.pid}`;
    await db.query('INSERT INTO public.tenants (schema_name, is_active) VALUES ($1, true)', [schema]);
    await db.query(`CREATE SCHEMA "${schema}"`);
    const env = {
      ...process.env,
      DATABASE_URL: scratchUrl,
      DIRECT_DATABASE_URL: scratchUrl,
      MIGRATE_TENANTS_LOCK_TIMEOUT_MS: '300',
      MIGRATE_TENANTS_RETRY_MIN_MS: '50',
      MIGRATE_TENANTS_RETRY_MAX_MS: '100',
    };
    delete env.MIGRATE_TENANTS_ALLOW_INCOMPLETE_FOR_TESTS;
    const cli = (extraEnv, hooks) => runCli({ ...env, ...extraEnv }, { ...hooks, cwd: tmpDir });

    await test('E2E first run builds the tenant: exit 0, summary parseable exactly like deploy.yml does', async () => {
      const run = await cli({});
      assert.equal(run.status, 0, run.output);
      const parsed = parseSummaryLikeTheWorkflow(run.output);
      assert.equal(parsed.summary, 'MIGRATE_TENANTS_SUMMARY ok=1 skipped=0 warnings=0 retries=0');
      assert.equal(parsed.skipped, 0);
      assert.equal(parsed.warnings, 0);
    });

    await test('E2E second run is idempotent and skips the no-op DDL that would have taken heavy locks', async () => {
      const run = await cli({});
      assert.equal(run.status, 0, run.output);
      assert.match(run.output, new RegExp(`\\[OK\\] ${schema} \\(2 no-op DDL statements skipped\\)`));
    });

    await test('E2E persistent lock: exit 1, skipped=1 warnings=1, retries reported, deploy-style parsing sees the failure', async () => {
      await live.query('BEGIN');
      await live.query(`LOCK TABLE "${schema}"."orders" IN ACCESS SHARE MODE`); // live reader on a table the template always ALTERs
      try {
        const run = await cli({ MIGRATE_TENANTS_MAX_ATTEMPTS: '2' });
        assert.equal(run.status, 1, run.output);
        const parsed = parseSummaryLikeTheWorkflow(run.output);
        assert.equal(parsed.summary, 'MIGRATE_TENANTS_SUMMARY ok=0 skipped=1 warnings=1 retries=1');
        assert.equal(parsed.skipped, 1);
        assert.equal(parsed.warnings, 1);
        assert.match(run.output, /\[RETRY\] \S+ attempt 1\/2 rolled back at statement 5 \(55P03\)/);
        assert.match(run.output, /Tenant transaction rolled back at statement 5 \(55P03\)/);
      } finally {
        await live.query('ROLLBACK');
      }
    });

    await test('E2E transient lock: live reader releases after the first [RETRY] -> exit 0, ok=1 skipped=0 warnings=0 retries=1', async () => {
      await live.query('BEGIN');
      await live.query(`LOCK TABLE "${schema}"."orders" IN ACCESS SHARE MODE`);
      let release = null;
      const run = await cli({ MIGRATE_TENANTS_RETRY_MIN_MS: '1500', MIGRATE_TENANTS_RETRY_MAX_MS: '1500' }, {
        onLine: (line) => {
          if (line.includes('[RETRY]') && !release) release = live.query('COMMIT');
        },
      });
      if (release) await release; else await live.query('ROLLBACK');
      assert.ok(release, `a retry must have happened: ${run.output}`);
      assert.equal(run.status, 0, run.output);
      const parsed = parseSummaryLikeTheWorkflow(run.output);
      assert.equal(parsed.summary, 'MIGRATE_TENANTS_SUMMARY ok=1 skipped=0 warnings=0 retries=1');
    });

    // ---- 3b: skipping no-ops must be semantically neutral on the REAL template ----
    await test('REAL tenant-schema.sql: skipNoopDdl on/off leave an identical schema, and the second run skips most statements', async () => {
      let tpl = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'tenant-schema.sql'), 'utf8');
      if (!hasVector) {
        // pgvector is not installed on every disposable instance (CI has it).
        // The two statements that need it are not what is under test here.
        tpl = tpl.replace(/^CREATE INDEX IF NOT EXISTS idx_ke_embedding_[^\n]*ivfflat[^\n]*$/gm, '')
          .replace(/vector\(1536\)/g, 'float4[]');
      }
      const schemas = { off: `tenant_ci_eq_off_${process.pid}`, on: `tenant_ci_eq_on_${process.pid}` };
      for (const name of Object.values(schemas)) await db.query(`CREATE SCHEMA "${name}"`);
      const run = async (name, skipNoopDdl) => {
        const logs = [];
        const summary = await runTenantMigrations({
          prisma, tpl, tenants: [{ schema_name: name, is_active: true }],
          options: { ...DEFAULT_OPTIONS, skipNoopDdl, maxAttempts: 1 },
          log: (m) => logs.push(m), logError: (m) => logs.push(m),
        });
        assert.deepEqual(summary, { ok: 1, skipped: 0, warnings: 0, retries: 0 }, logs.join('\n'));
        return logs.find((line) => line.includes(`[OK] ${name}`)) || '';
      };
      await run(schemas.off, false);
      await run(schemas.on, true);
      assertSameSchema(await catalogSnapshot(prisma, schemas.on), await catalogSnapshot(prisma, schemas.off), 'after the first run');
      const started = Date.now();
      await run(schemas.off, false);
      const offMs = Date.now() - started;
      const onStarted = Date.now();
      const okLine = await run(schemas.on, true);
      const onMs = Date.now() - onStarted;
      assertSameSchema(await catalogSnapshot(prisma, schemas.on), await catalogSnapshot(prisma, schemas.off), 'after the second run');
      const skipped = Number((/(\d+) no-op DDL statements skipped/.exec(okLine) || [])[1] || 0);
      assert.ok(skipped >= 500, `second run should skip most add-column/create-index DDL, got: ${okLine}`);
      console.log(`       (second run on a migrated tenant: ${skipped} of 946 statements skipped; ${onMs} ms with skipping vs ${offMs} ms without)`);
    });
  } finally {
    await live.query('ROLLBACK').catch(() => {});
    await live.end().catch(() => {});
    await db.end().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch((e) => console.error('scratch cleanup failed', e.message));
    await admin.end().catch(() => {});
  }
}

(async () => {
  await part1();
  await part2();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
