import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ACCEPTANCE_MATRIX, uncoveredScenarios } from './acceptance-matrix';

/**
 * ═══ THE MAPPING HAS TO BE TRUE, OR IT IS WORSE THAN NOT HAVING ONE ═══
 *
 * A table saying "scenario 3 is covered by that test over there" is a claim,
 * and a claim that nothing checks rots the moment somebody renames a test. It
 * then reports coverage the repository does not have, which is strictly worse
 * than an empty column: an empty column makes somebody look.
 *
 * So every `covered` entry is verified against the file it names — the file
 * exists, and the title fragment appears in it. A scenario with `covered: null`
 * is required to say what a test would have to do, so the gap is actionable
 * rather than a shrug.
 */
const SRC = resolve(__dirname, '../../..');

describe('the R5 acceptance matrix, checked rather than asserted', () => {
    it('has all eighteen rows the handoff prints', () => {
        expect(ACCEPTANCE_MATRIX).toHaveLength(18);
    });

    it('states what evidence each scenario has to produce', () => {
        for (const row of ACCEPTANCE_MATRIX) {
            expect(row.scenario.length).toBeGreaterThan(8);
            expect(row.evidence.length).toBeGreaterThan(15);
        }
    });

    describe('every scenario it claims is covered', () => {
        const covered = ACCEPTANCE_MATRIX.filter(row => row.covered !== null);

        it('names at least one real test for the ones that are', () => {
            // Not "most of them". If this drops to zero the matrix has stopped
            // being about this repository.
            expect(covered.length).toBeGreaterThan(0);
        });

        it.each(covered.map(row => [row.scenario, row.covered!] as const))(
            '%s is answered by a test that exists', (_scenario, covers) => {
                const file = resolve(SRC, covers.file);
                expect(existsSync(file)).toBe(true);
                // Newlines normalised: `core.autocrlf` writes CRLF on a Windows
                // checkout, and a fragment spanning one would match on Linux
                // and not here, about a file neither machine changed.
                const text = readFileSync(file, 'utf8').split('\r\n').join('\n');
                expect(text).toContain(covers.title);
            });
    });

    describe('every scenario it admits is not', () => {
        const missing = uncoveredScenarios();

        it.each(missing.map(row => [row.scenario, row] as const))(
            '%s says what a test would have to do', (_scenario, row) => {
                // A gap with no description is a gap nobody can pick up.
                expect(row.missing).toBeDefined();
                expect(row.missing!.length).toBeGreaterThan(60);
            });

        it('is counted, not hidden', () => {
            // The number is the point. It is what R5 reports, and it is a fact
            // about the repository rather than about who wrote the list — which
            // is why the uncovered rows are IN the table rather than left out
            // of it to make the column look full.
            // Some are covered and some are not, and BOTH halves are asserted:
            // an all-covered matrix would mean somebody deleted the gaps
            // instead of closing them, and an all-uncovered one would mean the
            // mapping stopped being about this repository.
            expect(missing.length).toBeGreaterThan(0);
            expect(missing.length).toBeLessThan(ACCEPTANCE_MATRIX.length);
            expect(missing.length + ACCEPTANCE_MATRIX.filter(row => row.covered).length)
                .toBe(ACCEPTANCE_MATRIX.length);
        });
    });

    it('names no scenario twice', () => {
        const names = ACCEPTANCE_MATRIX.map(row => row.scenario);
        expect(new Set(names).size).toBe(names.length);
    });
});
