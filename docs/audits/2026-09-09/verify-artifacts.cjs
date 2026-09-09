/*
 * Fails when any generated artefact in this directory does not correspond to
 * HEAD.
 *
 * Every one of them had been generated one or two commits before the revision
 * it claimed to describe, and nothing noticed — which is the failure mode of a
 * document that says "generado desde autoridades ejecutables": it is only true
 * for as long as somebody remembers to run the generator.
 *
 *   node docs/audits/2026-09-09/verify-artifacts.cjs
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const GENERATORS = [
    'generate-closure-state.cjs',
    'generate-certification-manifest.cjs',
    'generate-closure-report.cjs',
];
let failed = 0;
for (const generator of GENERATORS) {
    try {
        execFileSync(process.execPath, [path.join(__dirname, generator), '--check'], { stdio: 'inherit' });
    } catch {
        failed++;
    }
}
if (failed) {
    console.error(`${failed} artefacto(s) desactualizado(s). Regenerá con los mismos scripts sin --check.`);
    process.exit(1);
}
console.log('todos los artefactos corresponden a HEAD');
