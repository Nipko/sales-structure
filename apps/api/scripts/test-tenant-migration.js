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
const RENTAL_VERTICAL = { verticalConfig: { industry: 'automotriz', subType: 'alquiler' } };
const agentIds = {
  neverSet: require('crypto').randomUUID(),
  ownerOff: require('crypto').randomUUID(),
  inactive: require('crypto').randomUUID(),
  retainedNeverSet: require('crypto').randomUUID(),
};

async function createTenant({ name, slug, schemaName: tenantSchema, isActive, industry = 'other', settings }) {
  const tenant = await prisma.tenant.create({
    data: {
      name,
      slug,
      industry,
      schemaName: tenantSchema,
      isActive,
      ...(settings ? { settings } : {}),
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

async function createLegacyPhotoSessions(tenantSchema) {
  // Reproduce the production shape immediately before quote holds shipped:
  // CREATE TABLE IF NOT EXISTS is a no-op because the table already exists,
  // but hold_expires_at is not there yet.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${tenantSchema}"."photo_sessions" (
      "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      "contact_id" UUID,
      "opportunity_id" UUID,
      "conversation_id" UUID,
      "session_type" VARCHAR(50) NOT NULL,
      "package_name" VARCHAR(255),
      "package_description" TEXT,
      "client_name" VARCHAR(255),
      "client_phone" VARCHAR(50),
      "scheduled_at" TIMESTAMP,
      "duration_minutes" INTEGER,
      "location" TEXT,
      "deliverables" JSONB DEFAULT '[]',
      "deliverable_count" INTEGER,
      "delivered_count" INTEGER DEFAULT 0,
      "gallery_url" TEXT,
      "gallery_password" VARCHAR(100),
      "delivery_due_at" DATE,
      "delivered_at" TIMESTAMP,
      "price" DECIMAL(10,2),
      "currency" VARCHAR(10) DEFAULT 'COP',
      "deposit_paid" DECIMAL(10,2) DEFAULT 0,
      "status" VARCHAR(30) DEFAULT 'scheduled',
      "notes" TEXT,
      "metadata" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW(),
      "updated_at" TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function createLegacyOptOuts(tenantSchema) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${tenantSchema}"."opt_out_records" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID,
      phone VARCHAR(50),
      channel VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
      trigger_msg TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "${tenantSchema}"."opt_out_records" (phone, channel, trigger_msg)
    VALUES ('+573001112233', 'whatsapp', 'STOP'),
           ('+573001112233', 'whatsapp', 'no me escriban')
  `);
}

async function assertPhotoHoldMigration(tenantSchema) {
  const [result] = await prisma.$queryRawUnsafe(
    `SELECT
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'photo_sessions'
           AND column_name = 'hold_expires_at'
       ) AS column_exists,
       EXISTS (
         SELECT 1 FROM pg_indexes
         WHERE schemaname = $1 AND tablename = 'photo_sessions'
           AND indexname = 'idx_photo_sessions_capacity'
       ) AS index_exists`,
    tenantSchema,
  );
  assert.deepEqual(
    result,
    { column_exists: true, index_exists: true },
    `legacy photo_sessions in ${tenantSchema} must add the hold clock before its capacity index`,
  );
}

// Agents of a pre-PR #77 vehicle-rental tenant, plus one of a retained (inactive) tenant.
async function seedRentalAgents() {
  const insert = (schema, id, name, config, active, version) => prisma.$executeRawUnsafe(
    `INSERT INTO "${schema}"."agent_personas" (id, name, config_json, is_active, version)
     VALUES ($1::uuid, $2, $3::jsonb, $4, $5)`,
    id, name, JSON.stringify(config), active, version,
  );
  await insert(schemaName, agentIds.neverSet, 'CI rental never set', { tools: { faqs: { enabled: true } } }, true, 3);
  await insert(schemaName, agentIds.ownerOff, 'CI rental owner off', { tools: { vehicleRentals: { enabled: false } } }, true, 5);
  await insert(schemaName, agentIds.inactive, 'CI rental inactive', { tools: {} }, false, 7);
  await insert(retainedSchemaName, agentIds.retainedNeverSet, 'CI retained never set', { tools: {} }, true, 2);
}

async function readAgent(schema, id) {
  const [row] = await prisma.$queryRawUnsafe(
    `SELECT config_json, version FROM "${schema}"."agent_personas" WHERE id = $1::uuid`, id,
  );
  return row;
}

// The additive tool-family backfill (scripts/tool-family-backfill.js) against real
// PostgreSQL: it enables the missing family, keeps an owner's explicit off, never
// touches an inactive agent or tenant, and a second deploy writes nothing.
async function assertToolFamilyBackfill(firstOutput, rerun) {
  assert.match(
    firstOutput,
    /TOOL_FAMILY_BACKFILL_SUMMARY tenants=1 tenants_changed=1 agents_changed=1 families_enabled=1 already_on=0 preserved_off=1 errors=0/,
    'the first deploy must enable vehicleRentals on exactly the never-set agent of the active rental tenant',
  );
  const neverSet = await readAgent(schemaName, agentIds.neverSet);
  assert.deepEqual(neverSet.config_json.tools, { faqs: { enabled: true }, vehicleRentals: { enabled: true } });
  assert.equal(neverSet.version, 4, 'the backfill bumps the agent version once');

  const ownerOff = await readAgent(schemaName, agentIds.ownerOff);
  assert.deepEqual(ownerOff.config_json, { tools: { vehicleRentals: { enabled: false } } }, 'an explicit off belongs to the owner');
  assert.equal(ownerOff.version, 5);

  const inactive = await readAgent(schemaName, agentIds.inactive);
  assert.deepEqual(inactive.config_json, { tools: {} }, 'an inactive agent is never read or written');
  assert.equal(inactive.version, 7);

  const retained = await readAgent(retainedSchemaName, agentIds.retainedNeverSet);
  assert.deepEqual(retained.config_json, { tools: {} }, 'an inactive tenant is never backfilled');
  assert.equal(retained.version, 2);

  const secondOutput = rerun(1);
  assert.match(
    secondOutput,
    /TOOL_FAMILY_BACKFILL_SUMMARY tenants=1 tenants_changed=0 agents_changed=0 families_enabled=0 already_on=1 preserved_off=1 errors=0/,
    'the second deploy must be a no-op',
  );
  const again = await readAgent(schemaName, agentIds.neverSet);
  assert.equal(again.version, 4, 'a second run must not bump the version');
  assert.deepEqual(again.config_json, neverSet.config_json);
}

async function main() {
  await createTenant({
    name: 'CI legacy tenant',
    slug: tenantSlug,
    schemaName,
    isActive: true,
    industry: 'automotriz',
    settings: RENTAL_VERTICAL,
  });
  await createTenant({
    name: 'CI retained inactive tenant',
    slug: `ci-retained-${suffix}`,
    schemaName: retainedSchemaName,
    isActive: false,
    industry: 'automotriz',
    settings: RENTAL_VERTICAL,
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
  await createLegacyPhotoSessions(schemaName);
  await createLegacyPhotoSessions(retainedSchemaName);
  await createLegacyOptOuts(schemaName);
  await createLegacyOptOuts(retainedSchemaName);
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

  await seedRentalAgents();

  const output = runMigration(1);

  assert.match(
    output,
    /MIGRATE_TENANTS_SUMMARY ok=2 skipped=1 warnings=0/,
    'Migration must upgrade active and retained schemas, while reporting an active missing schema',
  );
  assert.equal(await schemaExists(retainedSchemaName), true, 'retained inactive schema must be migrated');
  assert.equal(await schemaExists(archivedSchemaName), false, 'archived inactive schema must not be recreated');
  assert.equal(await schemaExists(missingActiveSchemaName), false, 'missing active schema must not be recreated');
  await assertPhotoHoldMigration(schemaName);
  await assertPhotoHoldMigration(retainedSchemaName);

  for (const migratedSchema of [schemaName, retainedSchemaName]) {
    const [optOutState] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS active,
        COUNT(*) FILTER (WHERE status = 'superseded')::int AS superseded,
        EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = $1 AND indexname = 'uidx_opt_out_records_active_phone'
        ) AS unique_index_exists
      FROM "${migratedSchema}"."opt_out_records"`, migratedSchema);
    assert.deepEqual(optOutState, { active: 1, superseded: 1, unique_index_exists: true },
      'migration must preserve duplicate opt-out evidence while leaving one active request');
  }

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

  await assertToolFamilyBackfill(output, runMigration);

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
