/*
 * Emits the tenant-schema block and the migration that give the five evidence
 * stores their provenance marks, FROM the registry the runtime executes.
 *
 * Separate from `generate-certification-schema.cjs` on purpose: that one creates
 * tables and its parity test refuses an `ALTER`, which is the correct rule for
 * it. These are additive columns on tables that already exist — a different
 * risk, its own file, its own migration.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
require(path.join(root, 'node_modules/ts-node')).register({ transpileOnly: true });
require(path.join(root, 'node_modules/tsconfig-paths')).register({
    baseUrl: root, paths: { '@parallext/shared': ['packages/shared/src/index.ts'] },
});
const { EVIDENCE_STORES } = require(path.join(root, 'apps/api/src/modules/learning/agent-evidence-provenance.ts'));

const columnsFor = store => [
    'ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ',
    'ADD COLUMN IF NOT EXISTS invalidated_reason TEXT',
    ...(store.recordedColumn
        ? [`ADD COLUMN IF NOT EXISTS ${store.recordedColumn.name} ${store.recordedColumn.type}`]
        : []),
];

const templateBlock = ['-- BEGIN AGENT EVIDENCE PROVENANCE',
    '-- Una retractación retira un RELEASE; no deshace la evaluación que ocurrió.',
    '-- Por eso la fila sobrevive con su transcripción intacta y se la marca inválida:',
    '-- la marca es lo que impide que siga certificando a un agente cuyo aprendizaje',
    '-- ya nadie puede usar. Los dos stores que no tenían ninguna clave reciben una,',
    '-- y es un conjunto: una conversación juzgada pudo cruzar dos releases, y elegir',
    '-- uno solo sería desconocer al otro en silencio.',
    '-- Generado desde el registro que ejecuta el runtime (prisma/generate-evidence-provenance.cjs).',
    ...EVIDENCE_STORES.map(store =>
        `ALTER TABLE "{{SCHEMA_NAME}}"."${store.table}"\n    ${columnsFor(store).join(',\n    ')};`),
    '-- END AGENT EVIDENCE PROVENANCE', ''].join('\n');

const template = path.join(root, 'apps/api/prisma/tenant-schema.sql');
let text = fs.readFileSync(template, 'utf8');
if (text.includes('-- BEGIN AGENT EVIDENCE PROVENANCE')) {
    // `\r?\n`, because git hands this file back with CRLF endings and anchoring
    // on a bare newline makes the replacement silently do nothing.
    text = text.replace(/-- BEGIN AGENT EVIDENCE PROVENANCE[\s\S]*?-- END AGENT EVIDENCE PROVENANCE\r?\n/,
        templateBlock);
} else {
    text = `${text.replace(/\s*$/, '')}\n\n${templateBlock}`;
}
fs.writeFileSync(template, text);

const migration = ['-- Marcas de procedencia para la evidencia del agente.',
    '--',
    '-- Enteramente ADITIVA: sólo ADD COLUMN IF NOT EXISTS sobre columnas nulables y',
    '-- ni una fila escrita, así que el código viejo las ignora durante el rolling',
    '-- restart, que es lo que exige expand-contract.',
    '--',
    '-- Una fila anterior a esto no nombra ningún release, así que nada la invalida',
    '-- y nada finge hacerlo: invalidar por sospecha tiraría evidencia que puede ser',
    '-- perfectamente sólida. `evidenceWithoutProvenance` las cuenta, para que el',
    '-- hueco sea un número que alguien pueda ver y no un silencio.',
    'DO $agent_evidence_provenance$',
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
    ...EVIDENCE_STORES.flatMap(store => [
        `        -- ${store.id}: un tenant sin esta tabla tampoco detiene al resto.`,
        '        IF EXISTS (SELECT 1 FROM "information_schema"."tables"',
        '                    WHERE table_schema = tenant_record."schema_name"',
        `                      AND table_name = '${store.table}') THEN`,
        '            EXECUTE format($ddl$',
        `                ALTER TABLE %s."${store.table}"`,
        `                    ${columnsFor(store).join(',\n                    ')}`,
        '            $ddl$, target);',
        '        END IF;',
    ]),
    '    END LOOP;',
    'END',
    '$agent_evidence_provenance$;', ''].join('\n');

const dir = path.join(root, 'apps/api/prisma/migrations/20260909180000_add_agent_evidence_provenance');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'migration.sql'), migration);
process.stdout.write(`stores=${EVIDENCE_STORES.length}\n`);
