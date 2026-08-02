const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Tenant migration smoke test is restricted to NODE_ENV=test');
}

const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({
  datasources: {
    db: { url: databaseUrl },
  },
});

const suffix = `${process.pid}_${Date.now().toString(36)}`;
const schemaName = `tenant_ci_legacy_${suffix}`;
const tenantSlug = `ci-legacy-${suffix}`;
let tenantId;

async function main() {
  const tenant = await prisma.tenant.create({
    data: {
      name: 'CI legacy tenant',
      slug: tenantSlug,
      industry: 'other',
      schemaName,
    },
  });
  tenantId = tenant.id;

  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}"."agent_personas" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" VARCHAR(255) NOT NULL,
      "template_id" VARCHAR(100),
      "is_active" BOOLEAN DEFAULT true,
      "is_default" BOOLEAN DEFAULT false,
      "config_json" JSONB NOT NULL,
      "channels" TEXT[] DEFAULT '{}',
      "schedule_mode" VARCHAR(20) DEFAULT '24_7',
      "version" INTEGER DEFAULT 1,
      "created_by" VARCHAR(255),
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )
  `);

  const output = execFileSync(process.execPath, ['scripts/migrate-tenants.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  process.stdout.write(output);

  assert.match(
    output,
    /MIGRATE_TENANTS_SUMMARY ok=1 skipped=0 warnings=0/,
    'Tenant migration must complete without skipped schemas or statement warnings',
  );

  const [column] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = 'agent_personas'
         AND column_name = 'channel_bindings'
     ) AS exists`,
    schemaName,
  );
  assert.equal(column.exists, true, 'channel_bindings column was not backfilled');

  const [index] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_indexes
       WHERE schemaname = $1
         AND tablename = 'agent_personas'
         AND indexname = 'idx_agent_personas_bindings'
     ) AS exists`,
    schemaName,
  );
  assert.equal(index.exists, true, 'channel_bindings index was not created');
}

async function cleanup() {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  if (tenantId) {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  }
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => cleanup().catch((error) => {
    console.error('Tenant migration smoke-test cleanup failed:', error);
    process.exitCode = 1;
  }));
