import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * ═══ A VERIFIER THAT KNOWS A SUBSET IS BELIEVED ABOUT THE WHOLE ═══
 *
 * `verify-artifacts.cjs` ran three generators and printed "todos los artefactos
 * reflejan el codigo actual". A fourth generator — the tools programme audit,
 * the artefact that claims 20 verticals, 76 profiles, 123 static tools and 268
 * tasks — lived in a different directory, was wired into no workflow, and had
 * been red for days. The sentence was true of the three it knew and read by
 * everybody as true of the repository.
 *
 * So the list is now exported from one place and these cases hold it there:
 * the tools audit is in it, the workflows ask THAT list rather than their own
 * copy, and — the only assertion that actually proves a gate — changing an
 * audited source turns the verifier red.
 */
const ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const VERIFIER = resolve(ROOT, 'docs', 'audits', '2026-09-09', 'verify-artifacts.cjs');

const run = (args: string[] = []): { status: number; out: string } => {
    try {
        const out = execFileSync(process.execPath, [VERIFIER, ...args],
            { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { status: 0, out };
    } catch (error: any) {
        return { status: error.status ?? 1, out: String(error.stdout || '') + String(error.stderr || '') };
    }
};

describe('the artefact gate covers the tools programme', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GENERATORS } = require(VERIFIER);

    it('carries the tool-profile audit in its list', () => {
        expect(GENERATORS).toContain('2026-09-11/generate-tool-profile-audit.cjs');
        // And the three it always had, so adding one did not replace them.
        expect(GENERATORS).toContain('2026-09-09/generate-closure-report.cjs');
        expect(GENERATORS).toContain('2026-09-09/generate-closure-state.cjs');
        expect(GENERATORS).toContain('2026-09-09/generate-certification-manifest.cjs');
    });

    it('goes RED when an audited source changes and the artefact does not', () => {
        // The only assertion that proves a gate. A tool definition is added to
        // a real audited file, the artefact is left alone, and the verifier has
        // to notice — which is exactly what it failed to do for days.
        //
        // The BASELINE is captured rather than assumed green. An earlier version
        // asserted the whole repository was up to date before mutating, which is
        // a property of the tree and not of the gate: another agent editing an
        // audited source in the same working tree turned this red for a reason
        // that had nothing to do with what it was testing. What must hold is the
        // TRANSITION — green-or-red, then red, then back to where it started.
        const TOOL_FILE = resolve(ROOT, 'apps', 'api', 'src', 'modules', 'conversations',
            'tools', 'catalog-tools.ts');
        const baseline = run().status;
        const original = readFileSync(TOOL_FILE, 'utf8');
        try {
            writeFileSync(TOOL_FILE, `${original}
export const ARTEFACT_GATE_PROBE_TOOL = {
    name: 'artefact_gate_probe',
    description: 'Temporary probe written by artifact-gate-authority.spec.ts',
    parameters: { type: 'object', properties: {}, required: [] },
};
`, 'utf8');
            const { status, out } = run();
            expect({ status, mentions: /tool-profile-audit/.test(out) })
                .toEqual({ status: 1, mentions: true });
        } finally {
            writeFileSync(TOOL_FILE, original, 'utf8');
        }
        // And back to where it started, which is what proves the red above was
        // the mutation and not something this test left behind.
        expect(run().status).toBe(baseline);
        expect(readFileSync(TOOL_FILE, 'utf8')).toBe(original);
    });
});

describe('the workflows ask the shared list, not their own copy', () => {
    const workflow = (name: string) =>
        readFileSync(resolve(ROOT, '.github', 'workflows', name), 'utf8');

    it.each(['candidate.yml', 'vertical-quality.yml', 'deploy.yml'])(
        '%s runs the verifier rather than naming generators itself', name => {
            const text = workflow(name);
            expect(text).toContain('verify-artifacts.cjs');
            // A workflow that lists generators by hand is a second list, and a
            // second list is how the tools audit came to be checked nowhere.
            expect(text).not.toContain('generate-closure-state.cjs --check');
        });
});
