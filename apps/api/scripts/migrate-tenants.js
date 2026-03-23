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

    for (const t of tenants) {
      console.log(`Migrating tenant schema: ${t.schema_name}`);
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
            console.error(`Error migrating tenant ${t.schema_name} on statement: ${stmt}`);
            console.error(e);
            throw e;
          }
        }
      }
      console.log(`  [OK] ${t.schema_name}`);
    }
  } catch (error) {
    console.error('Fatal error during tenant migration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    console.log('--- Tenant Migration Complete ---');
  }
}

migrate();
