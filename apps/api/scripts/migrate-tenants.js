// scripts/migrate-tenants.js
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
    },
  },
});

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

async function migrate() {
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
    const tenants = await prisma.$queryRaw`
      SELECT t.id, t.schema_name, t.is_active
      FROM tenants t
      WHERE t.schema_name IS NOT NULL
        AND (
          t.is_active = true
          OR EXISTS (
            SELECT 1 FROM pg_namespace n WHERE n.nspname = t.schema_name
          )
        )
    `;
    
    console.log(`Found ${tenants.length} active or retained tenant schemas.`);
    let successCount = 0;
    let skipCount = 0;
    // Statements que fallaron por algo que NO es "ya existe". Sin contarlos, un
    // tenant cuyas 40 sentencias fallaron igual se reportaba [OK] y sumaba a
    // successCount: el resumen decia "todo bien" con el schema a medio migrar.
    let warnCount = 0;

    for (const t of tenants) {
      console.log(`Migrating tenant schema: ${t.schema_name}`);

      try {
        if (!/^tenant_[a-z0-9_]{1,56}$/.test(t.schema_name)) {
          console.error(`  [SKIP] Unsafe tenant schema identifier: ${t.schema_name}`);
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
            console.log(`  [ARCHIVED] Inactive schema "${t.schema_name}" is absent; leaving it dropped.`);
            continue;
          }
          console.error(`  [SKIP] Active tenant schema "${t.schema_name}" is missing; provisioning reconciliation is required.`);
          skipCount++;
          continue;
        }

        const sql = tpl.replace(/\{\{SCHEMA_NAME\}\}/g, t.schema_name);

        // First, strip all SQL comments (-- comment) to avoid parser bugs
        const cleanSql = sql.replace(/--.*$/gm, '');

        const stmts = splitSqlStatements(cleanSql);

        let failedStatement = -1;
        try {
          // A tenant template is one compatibility unit. In particular, DROP
          // CONSTRAINT + ADD CONSTRAINT must never straddle autocommit: if any
          // statement fails, the whole tenant returns to its prior schema.
          await prisma.$transaction(async (tx) => {
            for (let index = 0; index < stmts.length; index++) {
              failedStatement = index;
              const stmt = stmts[index];
              await tx.$executeRawUnsafe(stmt.endsWith(';') ? stmt : stmt + ';');
            }
          }, { maxWait: 10_000, timeout: 600_000 });
        } catch (error) {
          const shortMsg = (error.message || '').substring(0, 160);
          const sqlState = postgresErrorCode(error);
          console.log(
            `  [WARN] Tenant transaction rolled back at statement ${failedStatement + 1}`
            + `${sqlState ? ` (${sqlState})` : ''}: ${shortMsg}`,
          );
          warnCount++;
          throw error;
        }
        console.log(`  [OK] ${t.schema_name}`);
        successCount++;
      } catch (tenantError) {
        // Continue only to inventory every affected tenant. The process exits
        // non-zero below, so manual/setup-fresh/deploy callers all fail closed.
        console.error(`  [SKIP] Error migrating ${t.schema_name}: ${tenantError.message}`);
        skipCount++;
      }
    }

    console.log(`Results: ${successCount} OK, ${skipCount} skipped, ${warnCount} statement warnings`);
    // Machine-readable summary. Production promotion fails closed on any
    // skipped tenant or statement warning; a partial multi-tenant schema is not
    // compatible with the runtime that is about to be deployed.
    console.log(`MIGRATE_TENANTS_SUMMARY ok=${successCount} skipped=${skipCount} warnings=${warnCount}`);
    if ((skipCount > 0 || warnCount > 0)
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

migrate().catch((err) => {
  console.error('Fatal error during tenant migration:', err);
  process.exit(1);
});
