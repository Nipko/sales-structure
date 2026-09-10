#!/usr/bin/env node
/*
 * Builds the staging tenants from scratch, every run.
 *
 *   node scripts/seed-staging-synthetic.cjs [--reset] [--json <path>]
 *
 * Synthetic and only synthetic: three tenants with fixed identifiers, addresses
 * on `.invalid` and phone numbers in the unassigned +99 range, so nothing here
 * can reach a person even if a channel were connected by mistake. A production
 * copy is not an option this script has.
 *
 * `--reset` DROPS the synthetic schemas and deletes their rows before seeding.
 * That is destructive, which is why the first thing it does is refuse any target
 * that is not demonstrably staging — the environment must say staging AND the
 * database name must say staging AND neither may say production.
 *
 * Exit: 0 seeded, 1 a seeding step failed, 2 the target was refused.
 */
const { writeFileSync } = require('node:fs');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

function load() {
    try { return require('../dist/common/utils/staging-operations.js'); }
    catch (compiled) {
        try {
            require('ts-node/register/transpile-only');
            return require(resolve(__dirname, '../src/common/utils/staging-operations.ts'));
        } catch (source) {
            console.error(`::error::staging contract unavailable: ${compiled && compiled.message} / ${source && source.message}`);
            process.exit(2);
        }
    }
}

/** The shipped tenant DDL, wherever the image put it. */
function tenantSchemaSql() {
    for (const candidate of [resolve(process.cwd(), 'prisma/tenant-schema.sql'),
        resolve(__dirname, '../prisma/tenant-schema.sql'), '/app/prisma/tenant-schema.sql']) {
        if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    }
    throw new Error('tenant-schema.sql not found in the image');
}

/**
 * The SHIPPED splitter, not a copy of it.
 *
 * A second implementation of "where does this statement end" is a second thing
 * to be wrong, and it was: a hand-rolled copy here cut one statement in half and
 * PostgreSQL answered `syntax error at end of input` — which says nothing about
 * which statement, or that the splitter was the problem at all. The one the
 * runtime uses to build every tenant schema is the one that builds these.
 */
function splitStatements(sql) {
    let PrismaService;
    try { ({ PrismaService } = require('../dist/modules/prisma/prisma.service.js')); }
    catch (compiled) {
        try {
            require('ts-node/register/transpile-only');
            ({ PrismaService } = require(resolve(__dirname, '../src/modules/prisma/prisma.service.ts')));
        } catch (source) {
            throw new Error(`splitSqlStatements unavailable: ${compiled && compiled.message} / ${source && source.message}`);
        }
    }
    return PrismaService.prototype.splitSqlStatements(sql);
}

async function main() {
    const { assertStagingTarget, SYNTHETIC_TENANTS } = load();
    const reset = process.argv.includes('--reset');
    const jsonFlag = process.argv.indexOf('--json');
    const jsonPath = jsonFlag > -1 ? process.argv[jsonFlag + 1] : null;

    let target;
    try {
        target = assertStagingTarget({
            environment: process.env.PARALLLY_ENVIRONMENT,
            databaseUrl: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
        });
    } catch (error) {
        console.error(`::error::${error.message}`);
        console.error('::error::This script drops schemas. It runs only against a database that says staging.');
        process.exit(2);
    }

    const { Client } = require('pg');
    const client = new Client({ connectionString: target.databaseUrl });
    const summary = { version: 1, seededAt: new Date().toISOString(), database: target.databaseName,
        reset, tenants: [], ddlStatements: 0 };
    try {
        await client.connect();
        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        const template = tenantSchemaSql();

        for (const tenant of SYNTHETIC_TENANTS) {
            if (reset) {
                // Named explicitly, never by pattern: a `LIKE 'tenant_%'` sweep is
                // how a reset stops being about the rows it was written for.
                await client.query(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`);
                await client.query('DELETE FROM public.tenants WHERE id=$1::uuid', [tenant.id]);
            }
            await client.query(`CREATE SCHEMA IF NOT EXISTS "${tenant.schemaName}"`);
            let applied = 0;
            for (const statement of splitStatements(template.replace(/\{\{SCHEMA_NAME\}\}/g, tenant.schemaName))) {
                try { await client.query(statement); applied++; }
                catch (error) {
                    // 42P07/42710/42P06 mean it is already there: a re-run, not a failure.
                    if (!['42P07', '42710', '42P06'].includes(error.code)) throw error;
                }
            }
            summary.ddlStatements += applied;
            await client.query(
                `INSERT INTO public.tenants(id,name,slug,industry,schema_name,is_active,settings,created_at,updated_at)
                 VALUES($1::uuid,$2,$3,$4,$5,true,$6::jsonb,NOW(),NOW())
                 ON CONFLICT (id) DO UPDATE SET schema_name=EXCLUDED.schema_name, settings=EXCLUDED.settings,
                     is_active=true, updated_at=NOW()`,
                [tenant.id, `Staging ${tenant.slug}`, tenant.slug, tenant.industry, tenant.schemaName,
                    JSON.stringify({ verticalConfig: { industry: tenant.industry, subType: tenant.subType },
                        staging: { synthetic: true } })]);
            // One agent, in the shape the publication walk expects to find.
            await client.query(
                `INSERT INTO "${tenant.schemaName}".agent_personas
                    (id,name,config_json,channels,channel_bindings,schedule_mode,is_active,is_default,version)
                 VALUES(uuid_generate_v4(),'Alex',$1::jsonb,ARRAY['web_widget'],ARRAY['web_widget:stg-widget'],'24_7',true,true,1)
                 ON CONFLICT DO NOTHING`,
                [JSON.stringify({ language: 'es',
                    persona: { name: 'Alex', role: 'Asesor sintético de staging',
                        greeting: 'Hola, soy una configuración sintética de staging.',
                        fallbackMessage: 'Te paso con una persona.' },
                    behavior: { rules: ['No prometas nada: este agente es sintético.'],
                        handoffTriggers: ['hablar con humano'] },
                    hours: { aiOutsideHours: true } })]);
            summary.tenants.push({ id: tenant.id, slug: tenant.slug, schema: tenant.schemaName });
            console.log(`  [OK] ${tenant.slug} -> ${tenant.schemaName}`);
        }
        console.log(`STAGING_SEED tenants=${summary.tenants.length} reset=${reset ? 1 : 0} ddl=${summary.ddlStatements}`);
        if (jsonPath) writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
        process.exit(0);
    } catch (error) {
        console.error(`::error::staging seed failed: ${error && error.message}`);
        process.exit(1);
    } finally { await client.end().catch(() => {}); }
}

main();
