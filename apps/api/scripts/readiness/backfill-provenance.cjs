#!/usr/bin/env node
/**
 * backfill-provenance — migración de procedencia de los tenants existentes (C0 §2.9, rebanada R3).
 * Uso y garantías: ver backfill-provenance.ts. Siempre primero --dry-run; --apply escribe.
 *
 *   node scripts/readiness/backfill-provenance.cjs --psql "<comando psql>" --all-qa --dry-run
 *   node scripts/readiness/backfill-provenance.cjs --fixtures packages/business-spec/test/fixtures/qa-tenants --dry-run
 */
'use strict';
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
require('ts-node').register({ project: path.join(ROOT, 'apps/api/tsconfig.json'), transpileOnly: true });
require('tsconfig-paths').register({
    baseUrl: ROOT,
    paths: {
        '@parallext/shared': ['packages/shared/src/index.ts'],
        '@parallext/business-spec': ['packages/business-spec/src/index.ts'],
        '@parallext/business-spec/*': ['packages/business-spec/*'],
    },
});
const argv = process.argv.slice(2).map(a => (a.startsWith('packages/') ? path.join(ROOT, a) : a));
require('./backfill-provenance.ts').main(argv).catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
