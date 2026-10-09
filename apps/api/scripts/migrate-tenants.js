// scripts/migrate-tenants.js
const fs = require('fs');
const path = require('path');
const { createToolFamilyBackfill, readBackfillOptions } = require('./tool-family-backfill');

/**
 * Tenants to migrate, plus the vertical identity the tool-family backfill reads.
 *
 * The identity columns go through `to_jsonb(t)` on purpose: the migrator must
 * work against a reduced `public.tenants` (the lock-contention E2E fixture has
 * only id, schema_name and is_active), and a direct `t.industry` / `t.settings`
 * is a 42703 there that would fail the deploy gate. A missing column is simply
 * NULL, which the backfill reads as "not a backfilled profile".
 */
const TENANTS_QUERY = `
      SELECT t.id, t.schema_name, t.is_active,
             to_jsonb(t)->>'industry' AS industry,
             to_jsonb(t)->'settings'->'verticalConfig'->>'industry' AS vc_industry,
             to_jsonb(t)->'settings'->'verticalConfig'->>'subType' AS vc_sub_type,
             to_jsonb(t)->'settings'->'verticalConfig'->>'subtype' AS vc_sub_type_lower,
             to_jsonb(t)->'settings'->>'subType' AS legacy_sub_type
      FROM tenants t
      WHERE t.schema_name IS NOT NULL
        AND (
          t.is_active = true
          OR EXISTS (
            SELECT 1 FROM pg_namespace n WHERE n.nspname = t.schema_name
          )
        )
    `;

/**
 * Divide la plantilla en statements RESPETANDO el dollar-quoting de Postgres.
 *
 * Antes esto era un `.split(';')` pelado, que partía el bloque `DO $$ ... $$;`
 * de tenant-schema.sql en pedazos sueltos: cada deploy tiraba tres errores 42601
 * ("unterminated dollar-quoted string" + "syntax error") por tenant, tragados por
 * el `|| true` del workflow. El bloque afectado nunca llegaba a ejecutarse, y
 * cualquier futuro `DO $$` para migrar tenants existentes habría corrido la misma
 * suerte en silencio.
 *
 * Misma lógica que PrismaService.splitSqlStatements, que sí lo hacía bien.
 */
function splitSqlStatements(sql) {
  const results = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Apertura/cierre de bloques $$ o $tag$.
    for (const dm of line.match(/\$[^$]*\$/g) || []) {
      if (!inDollarQuote) {
        inDollarQuote = true;
        dollarTag = dm;
      } else if (dm === dollarTag) {
        inDollarQuote = false;
        dollarTag = '';
      }
    }

    current += line + '\n';

    // Solo cortar en el ';' que está FUERA de un bloque dollar-quoted.
    if (!inDollarQuote && trimmed.endsWith(';')) {
      const stmt = current.trim();
      if (stmt.length > 1) results.push(stmt);
      current = '';
    }
  }

  const remaining = current.trim();
  if (remaining.length > 1) results.push(remaining);

  return results;
}

function postgresErrorCode(error) {
  const candidates = [error?.meta?.code, error?.cause?.code, error?.code];
  return candidates.find((value) => typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) || null;
}

// ---------------------------------------------------------------------------
// Contención de locks con tráfico en vivo
// ---------------------------------------------------------------------------
//
// La migración corre contra la base VIVA antes de recrear los contenedores. Cada
// tenant es UNA transacción con cientos de DDL, y cada `ALTER TABLE` /
// `CREATE INDEX` toma su lock (ACCESS EXCLUSIVE / SHARE) y lo conserva hasta el
// COMMIT, aunque la sentencia sea un no-op (`ADD COLUMN IF NOT EXISTS` de una
// columna que ya existe sigue bloqueando la tabla). Mientras tanto el tráfico en
// vivo toma AccessShare/RowExclusive sobre las mismas tablas en otro orden:
// 2026-10-06 y 2026-10-07 Postgres eligió a la migración como víctima de un
// deadlock (40P01) y el deploy abortó. Cada re-run pasó.
//
// Defensa en tres capas, sin debilitar la garantía "o el tenant queda migrado
// completo o el deploy aborta":
//   1. `lock_timeout` dentro de la transacción: un DDL que espera detrás de
//      tráfico falla rápido (55P03) en vez de acumular locks en una cadena.
//   2. Reintento del tenant COMPLETO (transacción nueva desde el principio) ante
//      40P01 / 55P03 / 40001, con intentos acotados y backoff con jitter. Es
//      seguro porque la transacción anterior hizo ROLLBACK completo: el schema
//      está exactamente como antes, y la plantilla ya debe ser re-ejecutable
//      (cada deploy la corre sobre schemas ya migrados).
//   3. Los no-ops obvios (`ADD COLUMN IF NOT EXISTS` de columnas existentes,
//      `CREATE [UNIQUE] INDEX IF NOT EXISTS` de índices existentes) se omiten
//      tras consultar el catálogo, así NO toman el lock pesado sobre la tabla.
//
// Un tenant que agota los intentos, o que falla por algo que no es contención
// (p. ej. 23505), sigue contando como skipped+warning y el proceso sale con 1.

const TRANSIENT_SQLSTATES = new Set([
  '40P01', // deadlock_detected
  '55P03', // lock_not_available (lock_timeout)
  '40001', // serialization_failure
]);

const DEFAULT_OPTIONS = Object.freeze({
  maxAttempts: 4,
  // lock_timeout base por intento; el intento N usa N * base (5s, 10s, 15s, 20s).
  lockTimeoutMs: 5_000,
  // Espera por el advisory lock compartido con el runtime (no es contención de
  // tablas: se toma ANTES de cualquier otro lock de la transacción).
  advisoryLockTimeoutMs: 60_000,
  // 0 = no tocar statement_timeout (lo acota el timeout de la transacción).
  statementTimeoutMs: 0,
  retryMinMs: 2_000,
  retryMaxMs: 15_000,
  skipNoopDdl: true,
  txMaxWaitMs: 10_000,
  txTimeoutMs: 600_000,
});

function readIntEnv(env, name, fallback, { min = 0 } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min ? value : fallback;
}

function readOptions(env = process.env) {
  const retryMinMs = readIntEnv(env, 'MIGRATE_TENANTS_RETRY_MIN_MS', DEFAULT_OPTIONS.retryMinMs);
  return {
    ...DEFAULT_OPTIONS,
    maxAttempts: readIntEnv(env, 'MIGRATE_TENANTS_MAX_ATTEMPTS', DEFAULT_OPTIONS.maxAttempts, { min: 1 }),
    lockTimeoutMs: readIntEnv(env, 'MIGRATE_TENANTS_LOCK_TIMEOUT_MS', DEFAULT_OPTIONS.lockTimeoutMs, { min: 1 }),
    advisoryLockTimeoutMs: readIntEnv(
      env, 'MIGRATE_TENANTS_ADVISORY_LOCK_TIMEOUT_MS', DEFAULT_OPTIONS.advisoryLockTimeoutMs, { min: 1 },
    ),
    statementTimeoutMs: readIntEnv(env, 'MIGRATE_TENANTS_STATEMENT_TIMEOUT_MS', DEFAULT_OPTIONS.statementTimeoutMs),
    retryMinMs,
    retryMaxMs: Math.max(
      retryMinMs,
      readIntEnv(env, 'MIGRATE_TENANTS_RETRY_MAX_MS', DEFAULT_OPTIONS.retryMaxMs),
    ),
    skipNoopDdl: env.MIGRATE_TENANTS_SKIP_NOOP_DDL !== 'false',
  };
}

/** True when the failure is lock contention that a fresh transaction can outlive. */
function isTransientLockError(error) {
  // Prisma's own "write conflict or a deadlock, retry your transaction" signal.
  // Checked first: 'P2034' also happens to look like a 5-character SQLSTATE.
  if (error?.code === 'P2034') return true;
  const sqlState = postgresErrorCode(error);
  if (sqlState) return TRANSIENT_SQLSTATES.has(sqlState);
  return /deadlock detected|canceling statement due to lock timeout/i.test(String(error?.message || ''));
}

/** Jittered exponential backoff: between retryMin and min(retryMax, retryMin * 2^failedAttempt). */
function computeBackoffMs(failedAttempt, options, random = Math.random) {
  const cap = Math.min(options.retryMaxMs, options.retryMinMs * 2 ** failedAttempt);
  return Math.round(options.retryMinMs + random() * Math.max(0, cap - options.retryMinMs));
}

/** One-line, bounded error text: Prisma wraps the driver message in a multi-line banner. */
function briefMessage(error, limit = 160) {
  return String(error?.message || '')
    .replace(/^\s*Invalid `[^`]*` invocation:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, limit);
}

const defaultSleep =(ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- No-op DDL detection ----------------------------------------------------

const IDENT = '(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))';
const ADD_COLUMN_STATEMENT = new RegExp(`^ALTER\\s+TABLE\\s+${IDENT}\\s*\\.\\s*${IDENT}\\s+([\\s\\S]+?)\\s*;?\\s*$`, 'i');
const ADD_COLUMN_CLAUSE = new RegExp(`^ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${IDENT}(?=\\s|$)`, 'i');
const CREATE_INDEX_STATEMENT = new RegExp(
  `^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+${IDENT}\\s+ON\\s+${IDENT}\\s*\\.\\s*${IDENT}(?=[\\s(])`,
  'i',
);

const identName = (quoted, bare) => (quoted !== undefined ? quoted : String(bare).toLowerCase());

/** Splits on commas that are outside parentheses, '...' strings and "..." identifiers. */
function splitTopLevelCommas(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null; // '' / "" escapes re-open on the next char
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    if (depth < 0) return null;
  }
  if (quote || depth !== 0) return null;
  parts.push(text.slice(start));
  return parts;
}

/**
 * Recognises ONLY statements whose entire effect is "create X if it is missing":
 *   ALTER TABLE "s"."t" ADD COLUMN IF NOT EXISTS ... [, ADD COLUMN IF NOT EXISTS ...]
 *   CREATE [UNIQUE] INDEX IF NOT EXISTS name ON "s"."t" ...
 * Anything else (including a single clause that is not ADD COLUMN IF NOT EXISTS)
 * returns null and runs exactly as written.
 */
function parseNoopCandidate(stmt, schemaName) {
  const alter = ADD_COLUMN_STATEMENT.exec(stmt);
  if (alter) {
    if (identName(alter[1], alter[2]) !== schemaName) return null;
    const clauses = splitTopLevelCommas(alter[5]);
    if (!clauses) return null;
    const columns = [];
    for (const clause of clauses) {
      const match = ADD_COLUMN_CLAUSE.exec(clause.trim());
      if (!match) return null;
      columns.push(identName(match[1], match[2]));
    }
    return { kind: 'columns', table: identName(alter[3], alter[4]), columns };
  }
  const index = CREATE_INDEX_STATEMENT.exec(stmt);
  if (index) {
    // An index is created in its table's schema; only handle the tenant schema.
    if (identName(index[3], index[4]) !== schemaName) return null;
    return { kind: 'index', name: identName(index[1], index[2]) };
  }
  return null;
}

/**
 * Reads the catalog (no relation lock) to see whether the statement would be a
 * no-op. Runs INSIDE the tenant transaction so earlier DROP/RENAME statements of
 * the same template are visible and never produce a stale "already exists".
 */
async function isNoopDdl(tx, candidate, schemaName) {
  if (candidate.kind === 'columns') {
    const rows = await tx.$queryRawUnsafe(
      `SELECT a.attname AS name
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p')
          AND a.attnum > 0 AND NOT a.attisdropped AND a.attname = ANY($3::text[])`,
      schemaName,
      candidate.table,
      candidate.columns,
    );
    const present = new Set(rows.map((row) => row.name));
    return candidate.columns.every((column) => present.has(column));
  }
  const rows = await tx.$queryRawUnsafe(
    `SELECT 1 AS present
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2`,
    schemaName,
    candidate.name,
  );
  return rows.length > 0;
}

// --- One tenant -------------------------------------------------------------

/**
 * Applies the template to ONE tenant, retrying the whole transaction on
 * transient lock errors.
 *
 * Resolves `{ ok: true, attempts, noopSkipped }` or
 * `{ ok: false, error, sqlState, failedStatement, attempts, transient }`.
 * `attempts - 1` is the number of retries performed.
 */
async function migrateTenantSchema({
  prisma,
  schemaName,
  stmts,
  options = DEFAULT_OPTIONS,
  sleep = defaultSleep,
  random = Math.random,
  log = console.log,
}) {
  let attempt = 0;
  for (;;) {
    attempt++;
    let failedStatement = -1;
    let noopSkipped = 0;
    try {
      // A tenant template is one compatibility unit. In particular, DROP
      // CONSTRAINT + ADD CONSTRAINT must never straddle autocommit: if any
      // statement fails, the whole tenant returns to its prior schema.
      await prisma.$transaction(async (tx) => {
        // Waiting for the shared advisory lock is not table contention: nothing
        // else is held yet, so it gets its own, longer, budget.
        await tx.$queryRawUnsafe(
          "SELECT set_config('lock_timeout', $1, true)",
          `${options.advisoryLockTimeoutMs}ms`,
        );
        // Share the runtime schema lock with API/worker lazy initialization.
        await tx.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text',
          `runtime-schema:${schemaName}`,
        );
        // From here on every DDL that has to queue behind live traffic fails
        // fast (55P03) instead of holding the locks taken so far while it waits.
        await tx.$queryRawUnsafe(
          "SELECT set_config('lock_timeout', $1, true)",
          `${options.lockTimeoutMs * attempt}ms`,
        );
        if (options.statementTimeoutMs > 0) {
          await tx.$queryRawUnsafe(
            "SELECT set_config('statement_timeout', $1, true)",
            `${options.statementTimeoutMs}ms`,
          );
        }
        for (let index = 0; index < stmts.length; index++) {
          failedStatement = index;
          const stmt = stmts[index];
          if (options.skipNoopDdl) {
            const candidate = parseNoopCandidate(stmt, schemaName);
            if (candidate && await isNoopDdl(tx, candidate, schemaName)) {
              noopSkipped++;
              continue;
            }
          }
          await tx.$executeRawUnsafe(stmt.endsWith(';') ? stmt : stmt + ';');
        }
      }, { maxWait: options.txMaxWaitMs, timeout: options.txTimeoutMs });
      return { ok: true, attempts: attempt, noopSkipped };
    } catch (error) {
      const sqlState = postgresErrorCode(error);
      const transient = isTransientLockError(error);
      const where = failedStatement >= 0 ? `statement ${failedStatement + 1}` : 'transaction setup';
      const shortMsg = briefMessage(error);
      if (!transient || attempt >= options.maxAttempts) {
        return { ok: false, error, sqlState, failedStatement, attempts: attempt, transient };
      }
      const delayMs = computeBackoffMs(attempt, options, random);
      log(
        `  [RETRY] ${schemaName} attempt ${attempt}/${options.maxAttempts} rolled back at ${where}`
        + ` (${sqlState || 'lock contention'}): ${shortMsg}; retrying in ${(delayMs / 1000).toFixed(1)}s`,
      );
      await sleep(delayMs);
    }
  }
}

// --- All tenants ------------------------------------------------------------

/**
 * Migrates every tenant and returns the FINAL outcome. A tenant that succeeds on
 * retry counts as ok; `retries` is reported separately and never changes
 * ok/skipped/warnings.
 */
async function runTenantMigrations({
  prisma,
  tpl,
  tenants,
  options = DEFAULT_OPTIONS,
  sleep = defaultSleep,
  random = Math.random,
  log = console.log,
  logError = console.error,
  // Optional per-tenant hook run AFTER the tenant's schema was migrated (used for
  // the additive tool-family backfill). It must never throw; if it does anyway it
  // is logged and ignored: it can neither fail a tenant nor change the counters.
  afterTenantMigrated = null,
}) {
  let successCount = 0;
  let skipCount = 0;
  // Statements que fallaron por algo que NO es "ya existe". Sin contarlos, un
  // tenant cuyas 40 sentencias fallaron igual se reportaba [OK] y sumaba a
  // successCount: el resumen decia "todo bien" con el schema a medio migrar.
  let warnCount = 0;
  let retryCount = 0;

  for (const t of tenants) {
    log(`Migrating tenant schema: ${t.schema_name}`);

    try {
      if (!/^tenant_[a-z0-9_]{1,56}$/.test(t.schema_name)) {
        logError(`  [SKIP] Unsafe tenant schema identifier: ${t.schema_name}`);
        skipCount++;
        continue;
      }
      // Step 1: Check if schema exists
      const schemaCheck = await prisma.$queryRawUnsafe(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        t.schema_name,
      );

      // Provisioning owns schema creation. A deploy migration must never
      // invent a replacement schema (or delete the tenant) when lifecycle
      // state and data are missing; fail closed and require reconciliation.
      if (schemaCheck.length === 0) {
        if (!t.is_active) {
          log(`  [ARCHIVED] Inactive schema "${t.schema_name}" is absent; leaving it dropped.`);
          continue;
        }
        logError(`  [SKIP] Active tenant schema "${t.schema_name}" is missing; provisioning reconciliation is required.`);
        skipCount++;
        continue;
      }

      const sql = tpl.replace(/\{\{SCHEMA_NAME\}\}/g, t.schema_name);

      // First, strip all SQL comments (-- comment) to avoid parser bugs
      const cleanSql = sql.replace(/--.*$/gm, '');

      const stmts = splitSqlStatements(cleanSql);

      const result = await migrateTenantSchema({
        prisma, schemaName: t.schema_name, stmts, options, sleep, random, log,
      });
      retryCount += result.attempts - 1;

      if (!result.ok) {
        const shortMsg = briefMessage(result.error);
        const where = result.failedStatement >= 0
          ? `at statement ${result.failedStatement + 1}`
          : 'during transaction setup';
        log(
          `  [WARN] Tenant transaction rolled back ${where}`
          + `${result.sqlState ? ` (${result.sqlState})` : ''}: ${shortMsg}`
          + `${result.transient ? ` (gave up after ${result.attempts} attempt(s))` : ''}`,
        );
        warnCount++;
        throw result.error;
      }

      const notes = [];
      if (result.attempts > 1) notes.push(`succeeded on attempt ${result.attempts}/${options.maxAttempts}`);
      if (result.noopSkipped > 0) notes.push(`${result.noopSkipped} no-op DDL statements skipped`);
      log(`  [OK] ${t.schema_name}${notes.length ? ` (${notes.join('; ')})` : ''}`);
      successCount++;
      if (afterTenantMigrated) {
        try {
          await afterTenantMigrated(t);
        } catch (hookError) {
          logError(`  [BACKFILL-WARN] ${t.schema_name}: post-migration hook failed: ${briefMessage(hookError)}`);
        }
      }
    } catch (tenantError) {
      // Continue only to inventory every affected tenant. The process exits
      // non-zero in main(), so manual/setup-fresh/deploy callers all fail closed.
      logError(`  [SKIP] Error migrating ${t.schema_name}: ${briefMessage(tenantError, 600)}`);
      skipCount++;
    }
  }

  return { ok: successCount, skipped: skipCount, warnings: warnCount, retries: retryCount };
}

async function migrate() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
      },
    },
  });

  console.log('--- Started Tenant Schema Migration ---');
  try {
    const tplPath = path.join(process.cwd(), 'prisma', 'tenant-schema.sql');
    if (!fs.existsSync(tplPath)) {
      console.error('ERROR: tenant-schema.sql not found at', tplPath);
      process.exit(1);
    }
    const tpl = fs.readFileSync(tplPath, 'utf-8');

    // Upgrade every retained schema, including cancelled/offboarded tenants
    // that may later be reactivated. Inactive tenants whose schema was already
    // archived/dropped are excluded so migration never recreates erased data.
    const tenants = await prisma.$queryRawUnsafe(TENANTS_QUERY);

    console.log(`Found ${tenants.length} active or retained tenant schemas.`);
    const options = readOptions(process.env);
    // Additive data backfill that rides on the same pass (tool-family-backfill.js).
    // It is non-fatal by design: its own summary line is printed below and the
    // MIGRATE_TENANTS_SUMMARY contract the deploy parses is left untouched.
    const backfill = createToolFamilyBackfill({ prisma, ...readBackfillOptions(process.env) });
    const summary = await runTenantMigrations({
      prisma, tpl, tenants, options, afterTenantMigrated: backfill.run,
    });

    console.log(backfill.summaryLine());
    console.log(
      `Results: ${summary.ok} OK, ${summary.skipped} skipped, ${summary.warnings} statement warnings,`
      + ` ${summary.retries} lock-contention retries`,
    );
    // Machine-readable summary. ok/skipped/warnings are the FINAL outcome (a
    // tenant that succeeded on a retry is ok); `retries=` only reports how many
    // transient lock failures were absorbed on the way. It stays LAST: callers
    // parse each field with `sed 's/.*skipped=\([0-9]*\).*/\1/p'`, which does not
    // care what follows. Production promotion fails closed on any skipped tenant
    // or statement warning; a partial multi-tenant schema is not compatible with
    // the runtime that is about to be deployed.
    console.log(
      `MIGRATE_TENANTS_SUMMARY ok=${summary.ok} skipped=${summary.skipped} warnings=${summary.warnings}`
      + ` retries=${summary.retries}`,
    );
    if ((summary.skipped > 0 || summary.warnings > 0)
        && process.env.MIGRATE_TENANTS_ALLOW_INCOMPLETE_FOR_TESTS !== 'true') {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Fatal error during tenant migration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
    console.log('--- Tenant Migration Complete ---');
  }
}

module.exports = {
  TENANTS_QUERY,
  TRANSIENT_SQLSTATES,
  DEFAULT_OPTIONS,
  splitSqlStatements,
  postgresErrorCode,
  readOptions,
  isTransientLockError,
  computeBackoffMs,
  splitTopLevelCommas,
  parseNoopCandidate,
  isNoopDdl,
  migrateTenantSchema,
  runTenantMigrations,
  migrate,
};

if (require.main === module) {
  migrate().catch((err) => {
    console.error('Fatal error during tenant migration:', err);
    process.exit(1);
  });
}
