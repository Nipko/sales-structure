#!/usr/bin/env node
/**
 * readiness:report — informe de preparación (rebanada R1) para un tenant o para los 7 tenants QA.
 *
 *   npm run readiness:report --workspace=@parallext/api -- --all-qa --psql "<comando psql>" [--export-fixtures DIR] [--out-md F] [--out-json F]
 *   npm run readiness:report --workspace=@parallext/api -- --tenant tenant_x --psql "<comando psql>"
 *   npm run readiness:report --workspace=@parallext/api -- --fixtures packages/business-spec/test/fixtures/qa-tenants
 *
 * Solo lectura: cada sentencia va precedida de `SET default_transaction_read_only = on`.
 * El comando psql recibe el SQL por stdin y debe imprimir una línea JSON (-At), p. ej.
 *   ssh -o ConnectTimeout=10 root@HOST 'docker exec -i parallext-postgres psql -U parallext -d parallext_engine -At'
 */
'use strict';
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
require('ts-node').register({ project: path.join(ROOT, 'apps/api/tsconfig.json'), transpileOnly: true });
require('tsconfig-paths').register({
    baseUrl: ROOT,
    paths: {
        '@parallext/shared': ['packages/shared/src/index.ts'],
        '@parallext/business-spec': ['packages/business-spec/src/index.ts'],
        '@parallext/business-spec/*': ['packages/business-spec/*'],
    },
});
require('./readiness-report.ts').main(process.argv.slice(2)).catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
