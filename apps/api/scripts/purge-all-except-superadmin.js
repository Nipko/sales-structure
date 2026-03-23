// scripts/purge-all-except-superadmin.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function purgeAll() {
  console.log('--- Started Global Purge ---');
  try {
    // 1. Get all tenants to drop their schemas
    const tenants = await prisma.$queryRawUnsafe(`SELECT id, schema_name FROM tenants`);
    console.log(`Found ${tenants.length} tenants to purge.`);

    for (const t of tenants) {
      console.log(`Dropping schema: ${t.schema_name}`);
      try {
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${t.schema_name}" CASCADE`);
      } catch (err) {
        console.error(`Error dropping schema ${t.schema_name}:`, err.message);
      }
    }

    // 2. Clear out ChannelAccounts and AuditLogs (which might reference users/tenants)
    console.log('Clearing audit_logs...');
    await prisma.$executeRawUnsafe(`DELETE FROM audit_logs`);
    
    console.log('Clearing channel_accounts...');
    await prisma.$executeRawUnsafe(`DELETE FROM channel_accounts`);

    // 3. Delete all users EXCEPT super_admins
    console.log('Deleting all non-super_admin users...');
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE role != 'super_admin'`);

    // 4. Delete all tenants
    console.log('Deleting all tenants from public schema...');
    await prisma.$executeRawUnsafe(`DELETE FROM tenants`);

    console.log('--- Purge Complete. Only Super Admins remain. ---');
  } catch (e) {
    console.error('Fatal Error during purge:', e);
  } finally {
    await prisma.$disconnect();
  }
}

purgeAll();
