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

async function migrate() {
  console.log('--- Started Tenant Schema Migration ---');
  try {
    const tplPath = path.join(process.cwd(), 'prisma', 'tenant-schema.sql');
    if (!fs.existsSync(tplPath)) {
      console.error('ERROR: tenant-schema.sql not found at', tplPath);
      process.exit(1);
    }
    const tpl = fs.readFileSync(tplPath, 'utf-8');
    
    // Get all active tenants
    const tenants = await prisma.$queryRaw`
      SELECT id, schema_name FROM tenants WHERE is_active = true
    `;
    
    console.log(`Found ${tenants.length} active tenants.`);
    let successCount = 0;
    let skipCount = 0;
    let cleanedCount = 0;
    // Statements que fallaron por algo que NO es "ya existe". Sin contarlos, un
    // tenant cuyas 40 sentencias fallaron igual se reportaba [OK] y sumaba a
    // successCount: el resumen decia "todo bien" con el schema a medio migrar.
    let warnCount = 0;

    for (const t of tenants) {
      console.log(`Migrating tenant schema: ${t.schema_name}`);

      // ONE-TIME PURGE FOR CORRUPTED TEST TENANT
      if (t.schema_name === 'tenant_fundaci_n_beta') {
        console.log(`  [X] Purging corrupted tenant_fundaci_n_beta...`);
        try {
          await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS "tenant_fundaci_n_beta" CASCADE');
          await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE tenant_id = '${t.id}'::uuid`);
          await prisma.$executeRawUnsafe(`DELETE FROM users WHERE tenant_id = '${t.id}'::uuid`);
          await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${t.id}'::uuid`);
          console.log(`  [X] Successfully purged tenant_fundaci_n_beta`);
          cleanedCount++;
          continue;
        } catch (e) {
          console.error(`  [X] Failed to purge tenant_fundaci_n_beta:`, e.message);
        }
      }

      try {
        // Step 1: Check if schema exists
        const schemaCheck = await prisma.$queryRawUnsafe(
          `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
          t.schema_name,
        );

        // Step 2: If schema doesn't exist, create it explicitly FIRST
        if (schemaCheck.length === 0) {
          console.log(`  [!] Schema "${t.schema_name}" does not exist — creating it before template...`);
          try {
            await prisma.$executeRawUnsafe(
              `CREATE SCHEMA IF NOT EXISTS "${t.schema_name}"`
            );
            console.log(`  [+] Schema "${t.schema_name}" created`);
          } catch (createErr) {
            // Schema creation failed entirely — clean up the orphan tenant record
            console.error(`  [X] Cannot create schema "${t.schema_name}": ${createErr.message}`);
            console.log(`  [X] Cleaning up orphan tenant record (id: ${t.id})...`);
            await prisma.$executeRawUnsafe(
              `DELETE FROM audit_logs WHERE tenant_id = $1`, t.id
            );
            await prisma.$executeRawUnsafe(
              `DELETE FROM users WHERE tenant_id = $1`, t.id
            );
            await prisma.$executeRawUnsafe(
              `DELETE FROM tenants WHERE id = $1`, t.id
            );
            console.log(`  [X] Orphan tenant cleaned up`);
            cleanedCount++;
            continue; // Skip the rest of migration since the schema couldn't be created
          }
        }

        const sql = tpl.replace(/\{\{SCHEMA_NAME\}\}/g, t.schema_name);

        // First, strip all SQL comments (-- comment) to avoid parser bugs
        const cleanSql = sql.replace(/--.*$/gm, '');

        const stmts = splitSqlStatements(cleanSql);

        for (const stmt of stmts) {
          try {
            await prisma.$executeRawUnsafe(stmt.endsWith(';') ? stmt : stmt + ';');
          } catch (e) {
            // Log ALL errors but continue — never let one table block the rest
            const shortMsg = (e.message || '').substring(0, 120);
            if (e.message && (e.message.includes('already exists') || e.message.includes('duplicate'))) {
              // Silently skip existing objects
            } else {
              console.log(`  [WARN] Non-fatal error: ${shortMsg}`);
              warnCount++;
            }
          }
        }
        console.log(`  [OK] ${t.schema_name}`);
        successCount++;
      } catch (tenantError) {
        // Log but DO NOT crash — continue to next tenant
        console.error(`  [SKIP] Error migrating ${t.schema_name}: ${tenantError.message}`);
        skipCount++;
      }
    }

    console.log(`Results: ${successCount} OK, ${skipCount} skipped, ${cleanedCount} orphans cleaned, ${warnCount} statement warnings`);
    // Linea legible por maquina para que el workflow pueda anotar el deploy sin
    // parsear prosa. El deploy NO falla por esto a proposito (ver el comentario
    // del `|| true` en deploy.yml): un tenant roto no puede bloquear a los
    // demas. Pero tiene que VERSE — hasta ahora un fallo sistematico quedaba
    // enterrado en un log de deploy verde, que es donde nadie mira.
    console.log(`MIGRATE_TENANTS_SUMMARY ok=${successCount} skipped=${skipCount} warnings=${warnCount}`);
  } catch (error) {
    console.error('Fatal error during tenant migration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    console.log('--- Tenant Migration Complete ---');
  }
}

migrate();
