/*
 * Fails when any generated artefact no longer reflects the code it was
 * generated from.
 *
 * Every one of them had been generated one or two commits before the revision
 * it claimed to describe, and nothing noticed -- which is the failure mode of a
 * document that says "generado desde autoridades ejecutables": it is only true
 * for as long as somebody remembers to run the generator.
 *
 * ── ONE LIST, SHARED BY EVERY CALLER ────────────────────────────────────────
 *
 * The tool-profile audit lived outside this file, in another directory, and
 * was wired into no workflow. So `--check` was red on it for days while this
 * verifier printed "todos los artefactos reflejan el codigo actual" -- true of
 * the three it happened to know about, and read by everybody as true of the
 * repository.
 *
 * A verifier that knows a subset is worse than no verifier, because it is
 * believed. `GENERATORS` is now exported so `candidate`, `deploy` and
 * `vertical-quality` ask the same question from one place, and a generator
 * added here reaches all of them without anybody editing a workflow.
 *
 *   node docs/audits/2026-09-09/verify-artifacts.cjs
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const AUDITS = path.resolve(__dirname, "..");

/** Every generator that owns a committed artefact. Path is relative to docs/audits. */
const GENERATORS = [
    '2026-09-09/generate-closure-state.cjs',
    '2026-09-09/generate-certification-manifest.cjs',
    '2026-09-09/generate-closure-report.cjs',
    // The tools programme. Added because it was red and invisible: its
    // artefact is what claims 20 verticals, 76 profiles and 268 tasks, and
    // nothing was checking that the claim still matched its sources.
    '2026-09-11/generate-tool-profile-audit.cjs',
];

function verify() {
    const stale = [];
    for (const generator of GENERATORS) {
        try {
            execFileSync(process.execPath, [path.join(AUDITS, generator), '--check'],
                { stdio: 'inherit' });
        } catch {
            stale.push(generator);
        }
    }
    return stale;
}

module.exports = { GENERATORS, verify };

if (require.main === module) {
    const stale = verify();
    if (stale.length) {
        console.error(`${stale.length} artefacto(s) desactualizado(s): ${stale.join(', ')}.`);
        console.error('Regenerá con los mismos scripts sin --check.');
        process.exit(1);
    }
    console.log(`todos los artefactos (${GENERATORS.length}) reflejan el codigo actual`);
}
