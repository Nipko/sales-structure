/*
 * Emits the tenant-schema block and the migration for the CRM note receipts,
 * FROM the DDL constant the runtime executes.
 *
 * Its own file and its own migration rather than a line in the certification
 * generator, because a migration's name should be true: this creates the table
 * that records where a pushed handoff note went, and has nothing to do with the
 * agent certification ledger.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
require(path.join(root, 'node_modules/ts-node')).register({ transpileOnly: true });
require(path.join(root, 'node_modules/tsconfig-paths')).register({
    baseUrl: root, paths: { '@parallext/shared': ['packages/shared/src/index.ts'] },
});
const { CRM_NOTE_RECEIPT_DDL } = require(path.join(root, 'apps/api/src/modules/external-crm/crm-note-receipts.ts'));

const qualify = (sql, prefix) => sql
    .replace(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g, (_m, name) => `CREATE TABLE IF NOT EXISTS ${prefix}"${name}"`)
    .replace(/ON ([a-z_]+)(\s*\(|\s+USING\s)/g, (_m, name, tail) => `ON ${prefix}"${name}"${tail}`);

const statements = CRM_NOTE_RECEIPT_DDL
    .map(sql => sql.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\n/gm, ''));

const templateBlock = ['-- BEGIN CRM NOTE RECEIPTS',
    '-- Adónde fue a parar el resumen del traspaso cuando salió de la plataforma.',
    '-- El adapter devolvía el id de la nota y `runJob` lo tiraba, así que la copia',
    '-- afuera no tenía dirección: un borrado podía limpiar `handoff_summary` y las',
    '-- notas internas y dejar el mismo párrafo en el HubSpot del tenant. Esta fila',
    '-- es esa dirección, y el estado de recuperarla — aceptado, rechazado o',
    '-- desconocido, nunca "se intentó".',
    '-- Generado desde la constante DDL que ejecuta el runtime',
    '-- (prisma/generate-crm-note-receipts.cjs).',
    ...statements.map(sql => `${qualify(sql, '"{{SCHEMA_NAME}}".').trim()};`),
    '-- END CRM NOTE RECEIPTS', ''].join('\n');

const template = path.join(root, 'apps/api/prisma/tenant-schema.sql');
let text = fs.readFileSync(template, 'utf8');
if (text.includes('-- BEGIN CRM NOTE RECEIPTS')) {
    text = text.replace(/-- BEGIN CRM NOTE RECEIPTS[\s\S]*?-- END CRM NOTE RECEIPTS\r?\n/, templateBlock);
} else {
    text = `${text.replace(/\s*$/, '')}\n\n${templateBlock}`;
}
fs.writeFileSync(template, text);

const indent = sql => qualify(sql, '%s.').trim().split('\n').map(line => `                ${line}`).join('\n').trimStart();
const migration = ['-- La tabla que guarda adónde fue una nota empujada al CRM del tenant.',
    '--',
    '-- Enteramente ADITIVA: CREATE TABLE / CREATE INDEX con IF NOT EXISTS y ni una',
    '-- fila escrita, así que el código viejo la ignora durante el rolling restart,',
    '-- que es lo que exige expand-contract.',
    '--',
    '-- Una nota empujada antes de esto no dejó recibo y no se inventa uno: no hay',
    '-- de dónde sacar el id que devolvió el proveedor. Lo que cambia es de acá en',
    '-- adelante.',
    '--',
    '-- SQL dinámico porque la tabla vive en el schema de cada tenant.',
    'DO $crm_note_receipts$',
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
    '$crm_note_receipts$;', ''].join('\n');

const dir = path.join(root, 'apps/api/prisma/migrations/20260909190000_add_crm_note_receipts');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'migration.sql'), migration);
process.stdout.write(`statements=${statements.length}\n`);
