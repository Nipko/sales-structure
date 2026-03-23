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
      SELECT schema_name FROM tenants WHERE is_active = true
    `;
    
    console.log(`Found ${tenants.length} active tenants.`);
    let successCount = 0;
    let skipCount = 0;

    for (const t of tenants) {
      console.log(`Migrating tenant schema: ${t.schema_name}`);

      try {
        // Check if schema exists; if not, create it first
        const schemaCheck = await prisma.$queryRawUnsafe(
          `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
          t.schema_name,
        );

        if (schemaCheck.length === 0) {
          console.log(`  [!] Schema "${t.schema_name}" does not exist — creating it...`);
        }

        const sql = tpl.replace(/\{\{SCHEMA_NAME\}\}/g, t.schema_name);
        
        const stmts = sql
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));
          
        for (const stmt of stmts) {
          try {
            await prisma.$executeRawUnsafe(stmt + ';');
          } catch (e) {
            // Ignore "already exists" and "duplicate" errors for idempotency
            if (!e.message.includes('already exists') && 
                !e.message.includes('duplicate')) {
              throw e;
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

    console.log(`Results: ${successCount} OK, ${skipCount} skipped`);
  } catch (error) {
    console.error('Fatal error during tenant migration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    console.log('--- Tenant Migration Complete ---');
  }
}

migrate();
