const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function purge() {
  const schema = 'tenant_fundaci_n_beta';
  console.log('Purging', schema);
  try {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    const t = await prisma.$queryRawUnsafe(`SELECT id FROM tenants WHERE schema_name = $1`, schema);
    if (t.length > 0) {
      const id = t[0].id;
      await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE tenant_id = $1`, id);
      await prisma.$executeRawUnsafe(`DELETE FROM users WHERE tenant_id = $1`, id);
      await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, id);
    }
    console.log('Purge complete');
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
purge();
