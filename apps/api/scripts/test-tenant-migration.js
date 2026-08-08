const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
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
const retainedSchemaName = `tenant_ci_retained_${suffix}`;
const archivedSchemaName = `tenant_ci_archived_${suffix}`;
const missingActiveSchemaName = `tenant_ci_missing_${suffix}`;
const tenantSlug = `ci-legacy-${suffix}`;
const tenantIds = [];

async function createTenant({ name, slug, schemaName: tenantSchema, isActive }) {
  const tenant = await prisma.tenant.create({
    data: {
      name,
      slug,
      industry: 'other',
      schemaName: tenantSchema,
      isActive,
    },
  });
  tenantIds.push(tenant.id);
  return tenant;
}

function runMigration(expectedStatus) {
  const env = { ...process.env };
  delete env.MIGRATE_TENANTS_ALLOW_INCOMPLETE_FOR_TESTS;
  const result = spawnSync(process.execPath, ['scripts/migrate-tenants.js'], {
    cwd: path.resolve(__dirname, '..'),
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(output);
  assert.equal(
    result.status,
    expectedStatus,
    `Tenant migrator exit code must be ${expectedStatus}; output:\n${output}`,
  );
  return output;
}

async function schemaExists(tenantSchema) {
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists',
    tenantSchema,
  );
  return row.exists;
}

async function main() {
  await createTenant({
    name: 'CI legacy tenant',
    slug: tenantSlug,
    schemaName,
    isActive: true,
  });
  await createTenant({
    name: 'CI retained inactive tenant',
    slug: `ci-retained-${suffix}`,
    schemaName: retainedSchemaName,
    isActive: false,
  });
  await createTenant({
    name: 'CI archived inactive tenant',
    slug: `ci-archived-${suffix}`,
    schemaName: archivedSchemaName,
    isActive: false,
  });
  await createTenant({
    name: 'CI active tenant missing schema',
    slug: `ci-missing-${suffix}`,
    schemaName: missingActiveSchemaName,
    isActive: true,
  });

  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${retainedSchemaName}"`);
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
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${retainedSchemaName}"."agent_personas" (
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

  const output = runMigration(1);

  assert.match(
    output,
    /MIGRATE_TENANTS_SUMMARY ok=2 skipped=1 warnings=0/,
    'Migration must upgrade active and retained schemas, while reporting an active missing schema',
  );
  assert.equal(await schemaExists(retainedSchemaName), true, 'retained inactive schema must be migrated');
  assert.equal(await schemaExists(archivedSchemaName), false, 'archived inactive schema must not be recreated');
  assert.equal(await schemaExists(missingActiveSchemaName), false, 'missing active schema must not be recreated');

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

  const [retainedColumn] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'agent_personas'
         AND column_name = 'channel_bindings'
     ) AS exists`,
    retainedSchemaName,
  );
  assert.equal(retainedColumn.exists, true, 'retained inactive schema was not upgraded');
  const [retainedIndex] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname = $1 AND tablename = 'agent_personas'
         AND indexname = 'idx_agent_personas_bindings'
     ) AS exists`,
    retainedSchemaName,
  );
  assert.equal(retainedIndex.exists, true, 'retained inactive schema index was not upgraded');

  // A data-integrity violation is not an "already exists" condition. Keep both
  // duplicate services referenced so the safe cleanup cannot delete either,
  // then require SQLSTATE 23505 to surface as a migration warning.
  await prisma.$executeRawUnsafe(`DROP INDEX "${schemaName}"."uidx_services_name"`);
  const services = await prisma.$queryRawUnsafe(`
    INSERT INTO "${schemaName}"."services" (name, duration_minutes)
    VALUES ('CI duplicate service', 30), ('CI duplicate service', 30)
    RETURNING id
  `);
  for (const service of services) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}"."appointments" (service_id, service_name, start_at, end_at)
       VALUES ($1::uuid, 'CI duplicate service', NOW(), NOW() + INTERVAL '30 minutes')`,
      service.id,
    );
  }

  const conflictOutput = runMigration(1);
  assert.match(
    conflictOutput,
    /Tenant transaction rolled back at statement \d+ \(23505\)/,
    'A legacy UNIQUE violation must retain its PostgreSQL integrity code',
  );
  assert.match(
    conflictOutput,
    /MIGRATE_TENANTS_SUMMARY ok=1 skipped=2 warnings=1/,
    'A 23505 conflict must make the machine-readable summary fail closed',
  );
  const [preserved] = await prisma.$queryRawUnsafe(
    `SELECT
       (SELECT COUNT(*)::int FROM "${schemaName}"."services" WHERE name = 'CI duplicate service') AS services,
       (SELECT COUNT(*)::int FROM "${schemaName}"."appointments" WHERE service_name = 'CI duplicate service') AS appointments,
       EXISTS (
         SELECT 1 FROM pg_indexes
         WHERE schemaname = $1 AND indexname = 'uidx_services_name'
       ) AS unique_index_exists`,
    schemaName,
  );
  assert.deepEqual(
    preserved,
    { services: 2, appointments: 2, unique_index_exists: false },
    'Failed tenant transaction must preserve referenced legacy data and leave the invalid index unapplied',
  );
}

async function cleanup() {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${retainedSchemaName}" CASCADE`);
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${archivedSchemaName}" CASCADE`);
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${missingActiveSchemaName}" CASCADE`);
  if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
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
