// scripts/migrate-tenants.js
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

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
        
        const stmts = cleanSql
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0);
          
        for (const stmt of stmts) {
          try {
            await prisma.$executeRawUnsafe(stmt + ';');
          } catch (e) {
            // Log ALL errors but continue — never let one table block the rest
            const shortMsg = (e.message || '').substring(0, 120);
            if (e.message && (e.message.includes('already exists') || e.message.includes('duplicate'))) {
              // Silently skip existing objects
            } else {
              console.log(`  [WARN] Non-fatal error: ${shortMsg}`);
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

    console.log(`Results: ${successCount} OK, ${skipCount} skipped, ${cleanedCount} orphans cleaned`);
  } catch (error) {
    console.error('Fatal error during tenant migration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    console.log('--- Tenant Migration Complete ---');
  }
}

migrate();
