#!/usr/bin/env node
/*
 * What is actually running on the host, before anything is changed.
 *
 *   node scripts/vps-inventory.cjs [--json <path>]
 *
 * Read-only, and structurally so: it issues SELECTs and nothing else. It runs
 * against the OPERATIONAL database on purpose — an inventory of somewhere else
 * is not an inventory — which is exactly why it must not be able to write. There
 * is no code path here that can.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The October cut-over replaces the platform on the VPS that already serves
 * tenants. Step one of that is knowing what is there: which tenants, which of
 * them agreed to be in the pilot, how far the migrations have got, how much room
 * is left, and how much work is sitting in a queue that a restart would
 * interrupt. Every one of those is a number somebody has to see BEFORE choosing
 * a maintenance window, not after.
 *
 * ── WHAT IT WILL NOT PRINT ──────────────────────────────────────────────────
 *
 * No secret, no connection string, no customer. Tenants come out by id, slug and
 * schema; contacts and messages come out as counts. A pre-change inventory is
 * not a reason to copy a customer list into a CI artifact, and the file this
 * writes is meant to be attached to a change record.
 *
 * Exit: 0 inventory complete, 1 a section failed (reported, never silently
 * empty), 2 the inventory could not run at all.
 */
const { writeFileSync } = require('node:fs');

const CONNECTION = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

/** Sections are independent: one failure must not hide the other five. */
const SECTIONS = [
    {
        name: 'migrations',
        // How far the public schema has got, and whether anything is stuck.
        sql: `SELECT count(*)::int AS applied,
                     count(*) FILTER (WHERE finished_at IS NULL)::int AS unfinished,
                     count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::int AS rolled_back,
                     max(migration_name) AS latest
                FROM _prisma_migrations`,
        shape: 'one',
    },
    {
        name: 'tenants',
        // By id and slug. A cut-over that assumes every tenant present is
        // disposable is a cut-over that resets somebody's customers.
        sql: `SELECT t.id::text AS id, t.slug, t.schema_name,
                     t.is_active, t.created_at,
                     EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname = t.schema_name) AS schema_present
                FROM public.tenants t ORDER BY t.created_at`,
        shape: 'many',
    },
    {
        name: 'schema_sizes',
        // Room, and where it went. Sizing the backup window is arithmetic, and
        // it needs the numbers first.
        sql: `SELECT n.nspname AS schema_name,
                     pg_size_pretty(COALESCE(sum(pg_total_relation_size(c.oid)), 0)) AS pretty,
                     COALESCE(sum(pg_total_relation_size(c.oid)), 0)::bigint AS bytes,
                     count(c.oid)::int AS relations
                FROM pg_namespace n
                LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r','m','i','t')
               WHERE n.nspname = 'public' OR n.nspname LIKE 'tenant\\_%'
               GROUP BY n.nspname ORDER BY 3 DESC`,
        shape: 'many',
    },
    {
        name: 'database',
        sql: `SELECT current_database() AS name,
                     pg_size_pretty(pg_database_size(current_database())) AS pretty,
                     pg_database_size(current_database())::bigint AS bytes,
                     version() AS server`,
        shape: 'one',
    },
    {
        name: 'connections',
        // A migration behind a long transaction waits, and a maintenance window
        // that did not budget for it overruns.
        sql: `SELECT count(*)::int AS total,
                     count(*) FILTER (WHERE state = 'active')::int AS active,
                     count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_transaction,
                     COALESCE(max(EXTRACT(EPOCH FROM (now() - xact_start)))::int, 0) AS oldest_transaction_seconds
                FROM pg_stat_activity WHERE datname = current_database()`,
        shape: 'one',
    },
    {
        name: 'dispatch_rollout',
        // Real-provider validation cohort. Durable delivery is mandatory.
        sql: `SELECT value FROM public.platform_settings WHERE key = 'dispatch.normalOutbox'`,
        shape: 'one',
    },
];

/**
 * Pending work per tenant, which a restart would interrupt.
 *
 * Counts only, and every table probed with `to_regclass` first: a tenant that
 * predates a table is not an error, and a failed probe must never read as zero.
 */
const PENDING_TABLES = [
    { table: 'agent_dispatch_outbox', where: `state IN ('prepared','queued','admitted')` },
    { table: 'agent_dispatch_outbox', where: `state = 'reconciliation_required'`, as: 'dispatch_reconciliation' },
    { table: 'commitment_proposals', where: `accepted_at IS NULL` },
];

async function main() {
    if (!CONNECTION) {
        console.error('::error::no DIRECT_DATABASE_URL/DATABASE_URL; the inventory has nothing to inspect');
        process.exit(2);
    }
    const { Client } = require('pg');
    const client = new Client({ connectionString: CONNECTION });
    const inventory = {
        version: 1, takenAt: new Date().toISOString(),
        sections: {}, tenantPending: [], failures: [],
    };
    try {
        await client.connect();
        // Belt and braces: this session cannot write even if a section were
        // edited to try. A read-only inventory should be unable to be otherwise.
        await client.query('SET default_transaction_read_only = on');
        await client.query('BEGIN READ ONLY');

        for (const section of SECTIONS) {
            try {
                const rows = (await client.query(section.sql)).rows;
                inventory.sections[section.name] = section.shape === 'one' ? (rows[0] ?? null) : rows;
            } catch (error) {
                // Named, never silently absent. An inventory with a hole must
                // show the hole.
                inventory.failures.push({ section: section.name, code: error && error.code, message: 'inspection_failed' });
                inventory.sections[section.name] = null;
            }
        }

        for (const tenant of inventory.sections.tenants || []) {
            if (!tenant.schema_present) continue;
            const pending = { tenantId: tenant.id, schema: tenant.schema_name, counts: {}, failures: [] };
            for (const probe of PENDING_TABLES) {
                const key = probe.as || probe.table;
                try {
                    const exists = (await client.query('SELECT to_regclass($1)::text AS relation',
                        [`${tenant.schema_name}.${probe.table}`])).rows[0];
                    if (!exists || !exists.relation) { pending.counts[key] = null; continue; }
                    const counted = await client.query(
                        `SELECT count(*)::int AS n FROM "${tenant.schema_name}".${probe.table} WHERE ${probe.where}`);
                    pending.counts[key] = Number(counted.rows[0].n);
                } catch (error) {
                    pending.failures.push({ probe: key, code: error && error.code });
                    pending.counts[key] = null;
                }
            }
            inventory.tenantPending.push(pending);
        }
        await client.query('COMMIT');
    } catch (error) {
        console.error(`::error::the inventory could not run: ${error && error.message}`);
        process.exit(2);
    } finally {
        await client.end().catch(() => {});
    }

    const tenants = inventory.sections.tenants || [];
    const pendingTotal = inventory.tenantPending.reduce((sum, entry) =>
        sum + Object.values(entry.counts).reduce((n, value) => n + (typeof value === 'number' ? value : 0), 0), 0);
    const unknownProbes = inventory.tenantPending.reduce((sum, entry) =>
        sum + Object.values(entry.counts).filter(value => value === null).length, 0);

    for (const tenant of tenants) {
        const pending = inventory.tenantPending.find(entry => entry.tenantId === tenant.id);
        console.log(`  tenant=${tenant.id} slug=${tenant.slug} schema=${tenant.schema_name} `
            + `active=${tenant.is_active ? 1 : 0} schema_present=${tenant.schema_present ? 1 : 0} `
            + `pending=${pending ? JSON.stringify(pending.counts) : '{}'}`);
    }
    const migrations = inventory.sections.migrations || {};
    console.log(`VPS_INVENTORY tenants=${tenants.length} `
        + `active=${tenants.filter(t => t.is_active).length} `
        + `migrations=${migrations.applied ?? 'unknown'} unfinished=${migrations.unfinished ?? 'unknown'} `
        + `pending_effects=${pendingTotal} unknown_probes=${unknownProbes} `
        + `failures=${inventory.failures.length}`);

    const jsonFlag = process.argv.indexOf('--json');
    if (jsonFlag > -1 && process.argv[jsonFlag + 1]) {
        writeFileSync(process.argv[jsonFlag + 1], JSON.stringify(inventory, null, 2));
        console.log(`  written to ${process.argv[jsonFlag + 1]}`);
    }
    if (inventory.failures.length) {
        console.error(`::error::${inventory.failures.length} inventory section(s) could not be read: `
            + `${inventory.failures.map(f => f.section).join(', ')}. An inventory with a hole is not an inventory.`);
        process.exit(1);
    }
    process.exit(0);
}

main().catch(error => { console.error(`::error::inventory crashed: ${error && error.message}`); process.exit(2); });
