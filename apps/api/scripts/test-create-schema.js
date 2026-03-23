// scripts/test-create-schema.js
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function testCreate() {
  const schemaName = 'tenant_test_create_sql';
  try {
    const tplPath = path.join(process.cwd(), 'prisma', 'tenant-schema.sql');
    let template = fs.readFileSync(tplPath, 'utf-8');
    
    template = template.replace(/\{\{SCHEMA_NAME\}\}/g, schemaName);

    // This is EXACTLY what prisma.service.ts does
    const statements = template
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));

    console.log(`Starting to execute ${statements.length} statements...`);

    let i = 0;
    for (const statement of statements) {
        i++;
        try {
            await prisma.$executeRawUnsafe(statement + ';');
        } catch (e) {
            console.error(`\n[ERROR] Statement #${i} failed!`);
            console.error(`Statement snippet: ${statement.substring(0, 150)}...`);
            console.error(`Error: ${e.message}`);
            break;
        }
    }
    
    console.log(`\nSuccessfully executed up to statement #${i} (out of ${statements.length}).`);
  } catch (e) {
    console.error('Fatal:', e);
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`);
    await prisma.$disconnect();
  }
}

testCreate();
