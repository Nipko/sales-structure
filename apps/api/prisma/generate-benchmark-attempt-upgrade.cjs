/*
 * Emits the tenant-schema block and the migration that add the claim columns to
 * a `benchmark_attempts` that predates them, FROM the constant the runtime
 * executes.
 *
 * Its own file for the same reason the evidence-provenance one is: the
 * certification generator creates tables and its parity test refuses an ALTER,
 * which is the right rule for it. A column added to a table that already holds
 * rows is a different risk and belongs in its own migration.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
require(path.join(root, 'node_modules/ts-node')).register({ transpileOnly: true });
require(path.join(root, 'node_modules/tsconfig-paths')).register({
    baseUrl: root, paths: { '@parallext/shared': ['packages/shared/src/index.ts'] },
});
const { BENCHMARK_ATTEMPT_UPGRADE_DDL } =
    require(path.join(root, 'apps/api/src/modules/simulation/benchmark-harness.ts'));

const qualify = sql => sql.replace(/ALTER TABLE ([a-z_]+)/g,
    (_m, name) => `ALTER TABLE "{{SCHEMA_NAME}}"."${name}"`);

const templateBlock = ['-- BEGIN BENCHMARK ATTEMPT CLAIM',
    '-- Un intento se RESERVA antes de llamar al modelo, no se escribe después.',
    '-- El bucle anterior corría el runner y recién entonces insertaba con ON',
    '-- CONFLICT DO NOTHING: en un job reintentado eso volvía a contestar cada',
    '-- tarea —con un modelo real, a precio real— y tiraba la respuesta por el',
    '-- conflicto. El camino más caro del programa pagaba dos veces por trabajo',
    '-- que ya tenía. La fila reservada además le da al presupuesto algo que',
    '-- cobrar y al lease algo que vencer.',
    '-- Generado desde la constante DDL que ejecuta el runtime',
    '-- (prisma/generate-benchmark-attempt-upgrade.cjs).',
    ...BENCHMARK_ATTEMPT_UPGRADE_DDL.map(sql => `${qualify(sql).trim()};`),
    '-- END BENCHMARK ATTEMPT CLAIM', ''].join('\n');

const template = path.join(root, 'apps/api/prisma/tenant-schema.sql');
let text = fs.readFileSync(template, 'utf8');
if (text.includes('-- BEGIN BENCHMARK ATTEMPT CLAIM')) {
    text = text.replace(/-- BEGIN BENCHMARK ATTEMPT CLAIM[\s\S]*?-- END BENCHMARK ATTEMPT CLAIM\r?\n/, templateBlock);
} else {
    text = `${text.replace(/\s*$/, '')}\n\n${templateBlock}`;
}
fs.writeFileSync(template, text);

const indent = sql => sql.replace(/ALTER TABLE ([a-z_]+)/g, (_m, name) => `ALTER TABLE %s."${name}"`)
    .trim().split('\n').map(line => `                ${line}`).join('\n').trimStart();
const migration = ['-- Las columnas de reserva de un intento de benchmark.',
    '--',
    '-- Enteramente ADITIVA: ADD COLUMN IF NOT EXISTS sobre columnas nulables o',
    '-- con default, y ni una fila escrita. El código viejo las ignora durante el',
    '-- rolling restart, que es lo que exige expand-contract.',
    '--',
    '-- Las filas que ya existen quedan en `recorded`, que es exactamente lo que',
    '-- son: intentos ya contestados. Ninguna se reinterpreta.',
    'DO $benchmark_attempt_claim$',
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
    '        -- Un tenant sin la tabla tampoco: la creará su propio bootstrap.',
    '        IF EXISTS (SELECT 1 FROM "information_schema"."tables"',
    '                    WHERE table_schema = tenant_record."schema_name"',
    "                      AND table_name = 'benchmark_attempts') THEN",
    ...BENCHMARK_ATTEMPT_UPGRADE_DDL.flatMap(sql => [
        '            EXECUTE format($ddl$', `                ${indent(sql)}`, '            $ddl$, target);']),
    '        END IF;',
    '    END LOOP;',
    'END',
    '$benchmark_attempt_claim$;', ''].join('\n');

const dir = path.join(root, 'apps/api/prisma/migrations/20260909200000_add_benchmark_attempt_claim');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'migration.sql'), migration);
process.stdout.write(`statements=${BENCHMARK_ATTEMPT_UPGRADE_DDL.length}\n`);
