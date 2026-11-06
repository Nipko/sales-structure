/*
 * Forwarder kept only because .github/workflows/deploy.yml still runs
 * `node docs/audits/2026-09-09/verify-artifacts.cjs`. The verifier and its
 * generators moved to apps/api/scripts/artifacts/ and the generated documents
 * to docs/generated/ (ADR 0005). Delete this file in the same change that
 * points deploy.yml at `npm run verify:artifacts`.
 */
const verifier = require('../../../apps/api/scripts/artifacts/verify-artifacts.cjs');

module.exports = verifier;

if (require.main === module) {
    const stale = verifier.verify();
    if (stale.length) {
        console.error(`${stale.length} artefacto(s) desactualizado(s): ${stale.join(', ')}.`);
        process.exit(1);
    }
    console.log(`todos los artefactos (${verifier.GENERATORS.length}) reflejan el codigo actual`);
}
