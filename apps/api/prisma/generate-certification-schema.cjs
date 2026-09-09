/*
 * Emits the tenant-schema block and the migration for the certification and
 * benchmark ledgers FROM the DDL constants the runtime executes, so the three
 * paths cannot be written by three different hands.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
require(path.join(root, 'node_modules/ts-node')).register({ transpileOnly: true });
require(path.join(root, 'node_modules/tsconfig-paths')).register({
    baseUrl: root, paths: { '@parallext/shared': ['packages/shared/src/index.ts'] },
});
const { CERTIFICATION_LEDGER_DDL } = require(path.join(root, 'apps/api/src/modules/simulation/certification-ledger.ts'));
const { BENCHMARK_LEDGER_DDL } = require(path.join(root, 'apps/api/src/modules/simulation/benchmark-harness.ts'));
const { COMMITMENT_PROPOSAL_DDL } = require(path.join(root, 'apps/api/src/modules/conversations/commitment-proposal.ts'));

// The constants create objects unqualified, relying on search_path. Both the
// template and the migration have to name the schema, so the identifier right
// after CREATE TABLE / CREATE INDEX ... ON is qualified and nothing else is.
const qualify = (sql, prefix) => sql
    .replace(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g, (_m, name) => `CREATE TABLE IF NOT EXISTS ${prefix}"${name}"`)
    .replace(/ON ([a-z_]+) \(/g, (_m, name) => `ON ${prefix}"${name}" (`)
    .replace(/ON ([a-z_]+)\(/g, (_m, name) => `ON ${prefix}"${name}"(`);

const statements = [...CERTIFICATION_LEDGER_DDL, ...BENCHMARK_LEDGER_DDL, ...COMMITMENT_PROPOSAL_DDL]
    // Comments inside the DDL are for the reader of the TypeScript; the SQL
    // artefacts carry their own prose and keeping both would be two copies.
    .map(sql => sql.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\n/gm, ''));

const templateBlock = ['-- BEGIN AGENT CERTIFICATION LEDGER',
    '-- El ejecutor de certificación y el arnés de benchmark guardan aquí lo que',
    '-- ejecutan: un run, un sujeto por perfil, un caso por escenario, y los',
    '-- intentos y revisiones ciegas del benchmark, y la propuesta que el cliente',
    '-- aceptó antes de que el negocio se comprometiera. Generado desde las constantes',
    '-- DDL que ejecuta el runtime (prisma/generate-certification-schema.cjs), para que',
    '-- el bootstrap perezoso, este archivo y la migración no puedan divergir.',
    ...statements.map(sql => `${qualify(sql, '"{{SCHEMA_NAME}}".').trim()};`),
    '-- END AGENT CERTIFICATION LEDGER', ''].join('\n');

const template = path.join(root, 'apps/api/prisma/tenant-schema.sql');
let text = fs.readFileSync(template, 'utf8');
if (text.includes('-- BEGIN AGENT CERTIFICATION LEDGER')) {
    text = text.replace(/-- BEGIN AGENT CERTIFICATION LEDGER[\s\S]*?-- END AGENT CERTIFICATION LEDGER\n/,
        templateBlock);
} else {
    text = `${text.replace(/\s*$/, '')}\n\n${templateBlock}`;
}
fs.writeFileSync(template, text);

const indent = sql => qualify(sql, '%s.').trim().split('\n').map(line => `                ${line}`).join('\n').trimStart();
const migration = ['-- El ejecutor de certificación y el arnés de benchmark necesitan sus tablas en',
    '-- los tenants que ya existen. Enteramente ADITIVA: CREATE TABLE / CREATE INDEX',
    '-- con IF NOT EXISTS y ni una fila escrita, así que el código viejo la ignora',
    '-- durante el rolling restart, que es lo que exige expand-contract.',
    '--',
    '-- SQL dinámico porque las tablas viven en el schema de cada tenant.',
    'DO $agent_certification_backfill$',
    'DECLARE',
    '    tenant_record RECORD;',
    '    target TEXT;',
    'BEGIN',
    '    FOR tenant_record IN',
    '        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"',
    '    LOOP',
    '        target := quote_ident(tenant_record."schema_name");',
    '        -- Un schema nombrado en `tenants` que ya no existe no detiene al resto.',
    '        CONTINUE WHEN NOT EXISTS (',
    '            SELECT 1 FROM "information_schema"."schemata"',
    '            WHERE "schema_name" = tenant_record."schema_name"',
    '        );',
    ...statements.flatMap(sql => ['        EXECUTE format($ddl$', `            ${indent(sql)}`, '        $ddl$, target);']),
    '    END LOOP;',
    'END',
    '$agent_certification_backfill$;', ''].join('\n');

const dir = path.join(root, 'apps/api/prisma/migrations/20260909120000_add_agent_certification_ledger');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'migration.sql'), migration);
process.stdout.write(`statements=${statements.length}\n`);
